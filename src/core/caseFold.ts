/**
 * git의 `gitdir/i:`는 wildmatch의 `WM_CASEFOLD`로 맞춰 보고, 그건 바이트 단위 ASCII
 * `tolower`다. 유니코드는 접지 않는다.
 *
 * 반면 우리가 쓰던 세 구현은 전부 유니코드까지 접었다(git 2.50.1 / zsh 5.9 / bash 3.2에서 실측):
 *
 *   JS `"PROJEKTÄ".toLowerCase()`  -> `projektä`
 *   zsh `${p:l}`                   -> `projektä`
 *   bash `shopt -s nocasematch`    -> `Ä`와 `ä`가 같다고 답한다
 *   git  `gitdir/i:…/projektä/`    -> `…/PROJEKTÄ/.git`에 **매칭되지 않는다**
 *
 * 그래서 비ASCII 디렉토리에서는 매핑이 실제로는 적용되지 않는데 프롬프트와 `status`는
 * 적용됐다고 답했다. 불변조건 6이 막으려는 바로 그 거짓말이라, 접는 규칙을 git에 맞춘다.
 *
 * `[A-Z]` 범위 표기를 쓰지 않는 이유는 셸 쪽과 같다 — 범위는 로케일 collation에 따라
 * 달라질 수 있고, 26자를 그대로 적으면 어디서도 흔들리지 않는다.
 */
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/** git의 wildmatch와 같은 규칙으로 접는다. ASCII `A-Z`만 내린다. */
export const asciiFold = (value: string): string => {
  let out = "";
  for (const char of value) {
    const index = UPPER.indexOf(char);
    out += index === -1 ? char : LOWER[index];
  }
  return out;
};

/** 셸 스니펫이 같은 규칙을 쓰도록, 접기 표를 생성기에 그대로 넘긴다. */
export const ASCII_FOLD_PAIRS: readonly (readonly [string, string])[] = Array.from(
  UPPER,
  (upper, index) => [upper, LOWER[index] as string] as const,
);
