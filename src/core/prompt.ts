import {
  confirm as baseConfirm,
  input as baseInput,
  select as baseSelect,
} from "@inquirer/prompts";

/**
 * 대화형 질문을 던지기 직전에 단말인지 확인한다.
 *
 * stdin이 EOF인 스트림이면(`git-mapper add < /dev/null`, `echo y | git-mapper reset`)
 * inquirer의 프라미스가 끝내 결정되지 않는다. 이벤트 루프가 비면 signal-exit이 정리
 * 단계에서 `ExitPromptError`를 던지고, 프로세스는 **130**으로 끝난다 — 사용자가 Ctrl-C를
 * 누른 것과 같은 코드다. 거기에 `Detected unsettled top-level await` 경고까지 붙는다.
 * 최상위 catch가 막으려던 "문장 대신 내부 잡음"이 정확히 그 모습으로 다시 나온 것이다.
 *
 * 질문을 감싸는 자리에 두는 이유는, `remove <id>`나 `default <id>`처럼 인자가 있으면
 * 질문하지 않는 경로가 있어서다. 함수 첫 줄에서 막으면 단말이 필요 없는 실행까지 막힌다.
 */
const assertInteractive = (): void => {
  if (process.stdin.isTTY === true) return;
  throw new Error(
    "This needs an interactive terminal, but stdin is not one. " +
      "Run it from a terminal, or pass the value as an argument (`git-mapper --help`).",
  );
};

export const select: typeof baseSelect = (...args) => {
  assertInteractive();
  return baseSelect(...args);
};

export const input: typeof baseInput = (...args) => {
  assertInteractive();
  return baseInput(...args);
};

export const confirm: typeof baseConfirm = (...args) => {
  assertInteractive();
  return baseConfirm(...args);
};
