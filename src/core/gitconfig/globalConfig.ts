import { type GitOptions, git, gitOrNull } from "../git.ts";

export interface GlobalUser {
  readonly name: string;
  readonly email: string;
  readonly signingKey: string | null;
}

/**
 * git은 첫 점까지를 섹션, 마지막 점 뒤를 키로 읽는다.
 * 그래서 조건 문자열에 점이나 슬래시가 들어 있어도 하나의 subsection으로 유지된다.
 */
const includeIfKey = (condition: string): string => `includeIf.${condition}.path`;

export const setIncludeIf = async (
  condition: string,
  filePath: string,
  options: GitOptions = {},
): Promise<void> => {
  await git(["config", "--global", includeIfKey(condition), filePath], options);
};

export const getIncludeIf = (condition: string, options: GitOptions = {}): Promise<string | null> =>
  gitOrNull(["config", "--global", "--get", includeIfKey(condition)], options);

/** 없는 섹션을 지우면 git이 5로 종료한다. 그건 오류가 아니다. */
export const removeIncludeIf = async (
  condition: string,
  options: GitOptions = {},
): Promise<void> => {
  await gitOrNull(["config", "--global", "--remove-section", `includeIf.${condition}`], options);
};

export const setGlobalUser = async (user: GlobalUser, options: GitOptions = {}): Promise<void> => {
  await git(["config", "--global", "user.name", user.name], options);
  await git(["config", "--global", "user.email", user.email], options);
  if (user.signingKey === null) {
    await gitOrNull(["config", "--global", "--unset", "user.signingKey"], options);
  } else {
    await git(["config", "--global", "user.signingKey", user.signingKey], options);
  }
};

export const getGlobalUser = async (
  options: GitOptions = {},
): Promise<{ readonly name: string | null; readonly email: string | null }> => ({
  name: await gitOrNull(["config", "--global", "--get", "user.name"], options),
  email: await gitOrNull(["config", "--global", "--get", "user.email"], options),
});

/** `git config --list`는 파일에 적힌 순서대로 출력한다. 순서 판정에 그대로 쓴다. */
export const globalKeysInOrder = async (options: GitOptions = {}): Promise<readonly string[]> => {
  const output = await gitOrNull(["config", "--global", "--list", "--name-only"], options);
  return output === null ? [] : output.split("\n").filter((line) => line !== "");
};

/**
 * `[user]`가 우리 includeIf 뒤에 오면 매핑이 fallback에 진다.
 * git은 나중에 읽은 값을 쓰기 때문이다.
 */
export const hasUserAfterIncludeIf = (keys: readonly string[]): boolean => {
  const lastInclude = keys.findLastIndex((key) => key.startsWith("includeif."));
  const lastUser = keys.findLastIndex((key) => key === "user.name" || key === "user.email");
  return lastInclude >= 0 && lastUser > lastInclude;
};
