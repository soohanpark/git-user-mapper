import { execa } from "execa";

export class GitError extends Error {
  readonly exitCode: number | undefined;
  readonly stderr: string;

  constructor(message: string, exitCode?: number, stderr = "") {
    super(message);
    this.name = "GitError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface GitOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface ExecaFailure {
  readonly shortMessage?: string;
  readonly message?: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

/**
 * 스토어는 사용자가 직접 편집할 수 있는 파일이므로, 타입만 믿지 않고 git에 넘기기
 * 직전에 한 번 더 확인한다.
 *
 * 빈 값을 막는 이유: argv로 넘기면 `git config <key> ""`는 빈 문자열을 그대로 기록하는
 * 정상적인 쓰기가 되어, identity가 조용히 빈 값이 된다. 포크한 원본에서는 같은 입력이
 * 문자열 보간 때문에 아예 읽기 명령으로 퇴화했다. 메커니즘은 다르지만 결과는 같다 —
 * "성공했다고 말하면서 identity는 틀린" 상태다.
 */
const validateArgs = (args: readonly string[]): void => {
  for (const [index, arg] of args.entries()) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new GitError(`refusing to run git: argument ${index} is empty or not a string`);
    }
  }
};

export const git = async (args: readonly string[], options: GitOptions = {}): Promise<string> => {
  validateArgs(args);
  try {
    const result = await execa("git", args, options);
    return result.stdout.trim();
  } catch (error) {
    const failure = error as ExecaFailure;
    throw new GitError(
      failure.shortMessage ?? failure.message ?? "git failed",
      failure.exitCode,
      failure.stderr ?? "",
    );
  }
};

/**
 * 값이 없는 상태를 오류가 아니라 값으로 다룬다. `git config --get`은 키가 없으면 1로,
 * `--remove-section`·`--unset`은 대상이 없으면 5로 끝난다. 둘 다 정상 경로다.
 *
 * 다만 git이 **실행조차 되지 않은** 경우(바이너리 없음, 권한 문제)와 우리 인자 검증이
 * 막은 경우는 호출자 버그거나 환경 문제다. 그것까지 null로 뭉개면 "설정이 없음"과
 * "무언가 고장남"을 호출자가 구분할 수 없으므로 그대로 던진다.
 */
export const gitOrNull = async (
  args: readonly string[],
  options: GitOptions = {},
): Promise<string | null> => {
  try {
    return await git(args, options);
  } catch (error) {
    if (error instanceof GitError && error.exitCode !== undefined) return null;
    throw error;
  }
};

export const gitVersion = async (): Promise<{ readonly major: number; readonly minor: number }> => {
  const output = await git(["--version"]);
  const match = /(\d+)\.(\d+)/.exec(output);
  if (!match) throw new GitError(`could not parse git version from ${JSON.stringify(output)}`);
  return { major: Number(match[1]), minor: Number(match[2]) };
};

/** `includeIf "gitdir:"`는 git 2.13에서 도입됐다. */
export const supportsIncludeIf = (v: { readonly major: number; readonly minor: number }): boolean =>
  v.major > 2 || (v.major === 2 && v.minor >= 13);
