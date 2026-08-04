/**
 * 저장소 로컬 `[user]`를 읽기 위한 최소 git-config 파서.
 *
 * 쓰기는 전부 git에게 맡기지만(불변조건 2), **읽기**는 셸 스니펫이 프롬프트마다 해야 하는
 * 일이라 하위 프로세스를 쓸 수 없다. 그래서 세 구현(zsh·bash·여기)이 같은 규칙을 각자
 * 들고 있고, `parity.test.ts`가 실제 git과 대조한다.
 *
 * 이전 구현은 공백을 전부 지우고 `[user]`·`email=` 리터럴과 비교했다. git이 받아들이는
 * 표기 중 다음이 전부 어긋났다(git 2.50.1 실측):
 *
 *   `[user] email = x`   섹션 헤더 줄에 변수가 같이 온다      -> 통째로 놓쳤다
 *   `[USER]` / `EMAIL =` 섹션·키 이름은 대소문자를 안 가린다  -> 통째로 놓쳤다
 *   `email = x ; note`   `#`·`;` 뒤는 주석이다                -> `x;note`로 읽었다
 *   `email = "a#b@x.com"` git 자신이 이렇게 따옴표를 씌워 쓴다 -> 따옴표째 읽었다
 *
 * 앞의 둘은 로컬 identity가 있는데 없다고 답하게 만든다. 프롬프트가 매핑된 프로파일을
 * 보여 주는 사이 git은 다른 identity로 커밋한다 — 불변조건 6이 막으려는 실패다.
 */

const isBlank = (char: string): boolean => char === " " || char === "\t";

/**
 * 값 부분을 git과 같은 규칙으로 읽는다.
 *
 * - 따옴표 밖의 `#`·`;`부터는 주석이다.
 * - 따옴표 밖의 뒤쪽 공백은 버린다. 따옴표 안이나 값 중간의 공백은 살린다.
 * - `\` 다음 한 글자는 그대로 값이 된다. `\n` `\t` `\b`만 제어문자로 바뀐다.
 */
export const parseConfigValue = (raw: string): string => {
  let out = "";
  let pendingBlanks = "";
  let quoted = false;

  // `=` 뒤의 공백은 값의 일부가 아니다. 이 줄이 없으면 `email = x`가 ` x`로 읽힌다.
  // 여는 따옴표보다 앞에 오므로 따옴표 안의 공백은 이 처리에 걸리지 않는다.
  const body = raw.replace(/^[ \t]+/, "");

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] as string;

    if (char === "\\") {
      const escaped = body[index + 1];
      if (escaped === undefined) break;
      index += 1;
      out += pendingBlanks;
      pendingBlanks = "";
      out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "b" ? "\b" : escaped;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      out += pendingBlanks;
      pendingBlanks = "";
      continue;
    }

    if (!quoted && (char === "#" || char === ";")) break;

    if (!quoted && isBlank(char)) {
      pendingBlanks += char;
      continue;
    }

    out += pendingBlanks;
    pendingBlanks = "";
    out += char;
  }

  return out;
};

/** 따옴표 안의 `]`는 닫는 괄호가 아니다. `[user "a]b"]`가 실제로 유효하다. */
const closingBracket = (line: string): number => {
  let quoted = false;
  for (let index = 1; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (char === "]" && !quoted) return index;
  }
  return -1;
};

/**
 * 하위섹션이 붙은 `[user "work"]`는 `[user]`와 다른 섹션이다. 우리가 찾는 건 언제나
 * 하위섹션 없는 쪽이라, 붙어 있으면 관심 밖으로 둔다.
 */
const plainSectionName = (inside: string): string | null => {
  const trimmed = inside.trim();
  if (trimmed === "") return null;
  return /^[A-Za-z0-9.-]+$/.test(trimmed) ? trimmed.toLowerCase() : null;
};

const assign = (into: Map<string, string>, section: string | null, text: string): void => {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) return;
  if (section === null) return;

  const equals = trimmed.indexOf("=");
  // `=`가 없으면 git은 불리언 참으로 읽는다. 우리가 찾는 키는 전부 값이 있는 것들이다.
  if (equals === -1) return;

  const key = trimmed.slice(0, equals).trim().toLowerCase();
  if (key === "") return;
  into.set(`${section}.${key}`, parseConfigValue(trimmed.slice(equals + 1)));
};

/**
 * 하위섹션 없는 섹션의 `section.key`(전부 소문자) → 값. 같은 키가 여러 번 나오면
 * git과 같이 마지막 값이 이긴다.
 */
export const readConfigText = (text: string): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  let section: string | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;

    if (!line.startsWith("[")) {
      assign(found, section, line);
      continue;
    }

    const end = closingBracket(line);
    if (end === -1) {
      // 닫히지 않은 헤더는 git이 오류로 본다. 우리는 읽기만 하므로 이후를 버린다.
      section = null;
      continue;
    }

    section = plainSectionName(line.slice(1, end));
    // 헤더 줄에 변수가 같이 오는 표기(`[user] email = x`)가 유효하다.
    assign(found, section, line.slice(end + 1));
  }

  return found;
};
