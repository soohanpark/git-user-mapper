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
 * 값이 없는 상태를 오류가 아니라 값으로 다룬다. 다만 **어떤 종료 코드가 정상인지는
 * 호출하는 하위 명령마다 다르므로** 호출자가 직접 정한다. git 2.50에서 실측한 값:
 *
 *   `--get` 키 없음                1
 *   `--unset` 대상 없음            5
 *   `--remove-section` 섹션 없음   128
 *   `--list` 설정이 비어 있음      0
 *   위 전부, 설정 파일이 깨졌을 때 128
 *
 * 그래서 모든 0이 아닌 코드를 뭉뚱그리면 "설정이 없음"과 "설정 파일이 깨짐"을 구분할 수
 * 없다 — 불변조건 7이 막으려던 바로 그 혼동이다. 반대로 [1,5]로 좁히면
 * `--remove-section`이 정상 경로에서 던진다. 목록을 호출 지점에 두는 이유다.
 *
 * git이 **실행조차 되지 않은** 경우(바이너리 없음)와 인자 검증에 걸린 경우는 exitCode가
 * 없으므로 언제나 그대로 던진다.
 */
export const gitOrNull = async (
  args: readonly string[],
  options: GitOptions = {},
  allowedExitCodes: readonly number[] = [1],
): Promise<string | null> => {
  try {
    return await git(args, options);
  } catch (error) {
    if (
      error instanceof GitError &&
      error.exitCode !== undefined &&
      allowedExitCodes.includes(error.exitCode)
    ) {
      return null;
    }
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
