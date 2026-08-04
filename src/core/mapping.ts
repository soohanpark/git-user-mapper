import type { AbsolutePath, ProfileId, ResolutionState, StoreV2 } from "../types.ts";
import { asciiFold } from "./caseFold.ts";
import { isCaseInsensitive } from "./paths.ts";

export interface MappingEntry {
  readonly path: AbsolutePath;
  readonly profileId: ProfileId;
  readonly color: string;
  readonly email: string;
}

export interface FallbackEntry {
  readonly profileId: ProfileId;
  readonly color: string;
  readonly email: string;
}

export interface MappingTable {
  /** 경로 길이 내림차순. 첫 매치가 곧 최장 매치다. */
  readonly entries: readonly MappingEntry[];
  readonly fallback: FallbackEntry | null;
}

/**
 * `local-override`는 순수 해석기가 낼 수 없는 상태다 — 저장소의 로컬 `[user]`를 읽어야
 * 알 수 있고, 그건 셸 스니펫과 `status`의 몫이다. 그래도 `ResolutionState`에서 빼내는
 * 방식으로 적어 두면 상태를 하나 추가할 때 여기도 같이 걸린다.
 */
export interface Resolved {
  readonly state: Exclude<ResolutionState, "local-override">;
  readonly profileId: ProfileId | null;
  readonly color: string | null;
  readonly email: string | null;
}

/**
 * git은 `gitdir:` 패턴을 wildmatch로 해석한다. 디렉토리 이름에 들어 있는 `*` `?` `[` `]`가
 * 리터럴이 아니라 와일드카드가 된다는 뜻이다. git 2.50에서 실측한 결과:
 *
 *   `star*dir`   -> 남남인 `starOTHERdir`까지 매칭된다(엉뚱한 identity로 커밋된다)
 *   `proj [old]` -> 문자 클래스로 읽혀 아무것도 매칭되지 않는다
 *
 * 어느 쪽이든 `matches()`의 리터럴 접두어 비교와 답이 갈리므로 불변조건 5와 6이 동시에
 * 깨진다. 게다가 평범하게 이름 붙인 디렉토리 하나로 재현된다. wildmatch는 백슬래시
 * 이스케이프를 지원하고, 평범한 문자를 이스케이프해도 결과가 달라지지 않는다.
 */
const escapeWildmatch = (target: string): string => target.replaceAll(/[*?[\]\\]/g, "\\$&");

/** 후행 슬래시가 git에게 `**`를 덧붙이게 만들어 하위 전체에 재귀 적용된다. */
export const conditionFor = (
  target: AbsolutePath,
  caseInsensitive: boolean = isCaseInsensitive(),
): string => `${caseInsensitive ? "gitdir/i" : "gitdir"}:${escapeWildmatch(target)}/`;

export const buildTable = (store: StoreV2): MappingTable => {
  const entries = store.profiles
    .flatMap((profile) =>
      profile.paths.map(
        (target): MappingEntry => ({
          path: target,
          profileId: profile.id,
          color: profile.color,
          email: profile.email,
        }),
      ),
    )
    .toSorted((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path));

  const defaultProfile = store.profiles.find((profile) => profile.id === store.defaultProfile);

  return {
    entries,
    fallback: defaultProfile
      ? {
          profileId: defaultProfile.id,
          color: defaultProfile.color,
          email: defaultProfile.email,
        }
      : null,
  };
};

/**
 * 스토어에 기본 프로파일이 없어도 `~/.gitconfig`의 `[user]`가 여전히 적용된다(스펙 4.1).
 * 그 경우를 fallback으로 채워 넣어야 셸이 "identity 없음"이라고 거짓말하지 않는다.
 * 이미 관리 중인 fallback이 있으면 건드리지 않는다.
 */
export const withFallback = (table: MappingTable, fallback: FallbackEntry): MappingTable =>
  table.fallback === null ? { entries: table.entries, fallback } : table;

/**
 * `toLowerCase()`는 유니코드까지 접지만 git의 wildmatch는 ASCII만 접는다. 그 차이 하나로
 * 비ASCII 디렉토리에서 우리 답과 git의 답이 갈렸다 — `asciiFold`가 그 규칙을 맞춘 것이다.
 */
const matches = (entryPath: string, target: string, caseInsensitive: boolean): boolean => {
  const a = caseInsensitive ? asciiFold(entryPath) : entryPath;
  const b = caseInsensitive ? asciiFold(target) : target;
  return b === a || b.startsWith(`${a}/`);
};

/** 이 매핑 경로가 저 GIT_DIR을 덮는가. `map`이 발동하지 않을 매핑을 미리 알아채는 데 쓴다. */
export const covers = (
  entryPath: string,
  gitDir: string,
  caseInsensitive: boolean = isCaseInsensitive(),
): boolean => matches(entryPath, gitDir, caseInsensitive);

/**
 * `gitDir`을 받는다 — 작업 트리가 아니다. git이 `includeIf "gitdir:"`를 맞춰 보는 대상이
 * `$GIT_DIR`이라서다. linked worktree에서는 둘이 아예 다른 서브트리에 있고, 작업 트리로
 * 맞춰 보면 git이 절대 고르지 않을 프로파일을 답하게 된다(`core/gitdir.ts` 참고).
 */
export const resolve = (
  table: MappingTable,
  gitDir: AbsolutePath,
  caseInsensitive: boolean = isCaseInsensitive(),
): Resolved => {
  const hit = table.entries.find((entry) => matches(entry.path, gitDir, caseInsensitive));
  if (hit) {
    return { state: "mapped", profileId: hit.profileId, color: hit.color, email: hit.email };
  }
  if (table.fallback) {
    return {
      state: "default",
      profileId: table.fallback.profileId,
      color: table.fallback.color,
      email: table.fallback.email,
    };
  }
  return { state: "no-identity", profileId: null, color: null, email: null };
};

/**
 * TSV는 탭으로 칸을, 개행으로 줄을 나눈다. 그 두 글자가 값에 들어 있으면 셸이 읽는 표가
 * 조용히 다른 뜻이 된다. 쓰기 직전이 아니라 **계획 단계에서** 부르는 이유는 sync가
 * `~/.gitconfig`를 이미 고쳐 놓은 뒤에 여기서 던지면 반쯤 적용된 상태가 남기 때문이다.
 */
export const assertSerializable = (values: readonly string[]): void => {
  for (const value of values) {
    if (value.includes("\t") || value.includes("\n")) {
      throw new Error(
        `Cannot write mapping table: ${JSON.stringify(value)} contains a tab or newline.`,
      );
    }
  }
};

/** 표에 실릴 모든 값을 미리 검사한다. 한 군데라도 걸리면 아무것도 건드리지 않고 멈춘다. */
export const assertTableSerializable = (table: MappingTable): void => {
  if (table.fallback) {
    assertSerializable([table.fallback.profileId, table.fallback.color, table.fallback.email]);
  }
  for (const entry of table.entries) {
    assertSerializable([entry.path, entry.profileId, entry.color, entry.email]);
  }
};

export const serializeTable = (table: MappingTable): string => {
  assertTableSerializable(table);
  const lines: string[] = [];
  if (table.fallback) {
    lines.push(
      ["*", table.fallback.profileId, table.fallback.color, table.fallback.email].join("\t"),
    );
  }
  for (const entry of table.entries) {
    lines.push([entry.path, entry.profileId, entry.color, entry.email].join("\t"));
  }
  return `${lines.join("\n")}\n`;
};
