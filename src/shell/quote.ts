/**
 * 스니펫은 사용자의 대화형 셸에 그대로 `eval`된다. 경로 하나를 잘못 끼워 넣으면 문법
 * 오류로 스니펫 전체가 버려지고, 그러면 함수가 하나도 정의되지 않은 채 프롬프트 테마가
 * 알 수 없는 세그먼트를 참조하게 된다. 홈 디렉토리에 아포스트로피가 들어 있는 것만으로
 * 재현된다(유닉스에서 합법적인 이름이다).
 */

/** POSIX sh/bash/zsh. 작은따옴표를 닫고 이스케이프한 뒤 다시 연다. */
export const posixSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** fish는 작은따옴표 안에서 `\'`와 `\\`만 이스케이프로 인정한다. */
export const fishSingleQuote = (value: string): string =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
