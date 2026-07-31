import { isCaseInsensitive, mappingFilePath } from "../core/paths.ts";
import { bashSnippet } from "../shell/bash.ts";
import { zshSnippet } from "../shell/zsh.ts";

const GENERATORS = { zsh: zshSnippet, bash: bashSnippet } as const;

export const runShellInit = async (shell: string): Promise<void> => {
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
