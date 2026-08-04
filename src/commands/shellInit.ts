import { isCaseInsensitive, mappingFilePath } from "../core/paths.ts";
import { bashSnippet } from "../shell/bash.ts";
import { zshSnippet } from "../shell/zsh.ts";

const GENERATORS = { zsh: zshSnippet, bash: bashSnippet } as const;

export const runShellInit = async (shell: string): Promise<void> => {
  // `in`이나 첨자 접근은 프로토타입 체인을 탄다. `shell-init toString`이 함수를 찾아내
  // 종료 코드 0으로 `[object Undefined]`를 출력했고, rc 파일의 `eval "$(…)"`에 그대로
  // 들어갔다. hasOwn은 자기 속성만 본다.
  if (!Object.hasOwn(GENERATORS, shell)) {
    process.stderr.write(
      `Unsupported shell ${shell}. Supported: ${Object.keys(GENERATORS).join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const generate = GENERATORS[shell as keyof typeof GENERATORS];
  if (generate === undefined) {
    process.stderr.write(
      `Unsupported shell ${shell}. Supported: ${Object.keys(GENERATORS).join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    generate({ mappingFile: mappingFilePath(), caseInsensitive: isCaseInsensitive() }),
  );
};
