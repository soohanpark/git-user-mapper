import fs from "node:fs";
import { type GitOptions, git, gitOrNull } from "../git.ts";
import { globalGitConfigPath } from "../paths.ts";

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

/** 키가 없을 때의 종료 코드. 그 외(특히 깨진 설정 파일의 128)는 그대로 올라간다. */
const KEY_ABSENT = [1];
/** `--unset` 대상이 없을 때의 종료 코드. */
const UNSET_TARGET_ABSENT = [5];
/** `--remove-section` 대상이 없을 때의 종료 코드. 깨진 파일과 겹치므로 아래 주석 참고. */
const SECTION_ABSENT = [128];

export const setIncludeIf = async (
  condition: string,
  filePath: string,
  options: GitOptions = {},
): Promise<void> => {
  await git(["config", "--global", includeIfKey(condition), filePath], options);
};

export const getIncludeIf = (condition: string, options: GitOptions = {}): Promise<string | null> =>
  gitOrNull(["config", "--global", "--get", includeIfKey(condition)], options, KEY_ABSENT);

/**
 * 없는 섹션을 지우면 git이 128로 끝난다(5가 아니다 — `--unset`과 다르다).
 * 그런데 128은 "설정 파일이 깨졌다"와도 겹친다. 그래서 `applySync`가 변경을 시작하기 전에
 * `assertGlobalConfigReadable`로 파일을 한 번 읽어 본다. 그 관문을 통과했다면 여기의 128은
 * "섹션이 이미 없다"만 뜻한다.
 */
export const removeIncludeIf = async (
  condition: string,
  options: GitOptions = {},
): Promise<void> => {
  await gitOrNull(
    ["config", "--global", "--remove-section", `includeIf.${condition}`],
    options,
    SECTION_ABSENT,
  );
};

export const setGlobalUser = async (user: GlobalUser, options: GitOptions = {}): Promise<void> => {
  await git(["config", "--global", "user.name", user.name], options);
  await git(["config", "--global", "user.email", user.email], options);
  if (user.signingKey === null) {
    await gitOrNull(
      ["config", "--global", "--unset", "user.signingKey"],
      options,
      UNSET_TARGET_ABSENT,
    );
  } else {
    await git(["config", "--global", "user.signingKey", user.signingKey], options);
  }
};

export const getGlobalUser = async (
  options: GitOptions = {},
): Promise<{ readonly name: string | null; readonly email: string | null }> => ({
  name: await gitOrNull(["config", "--global", "--get", "user.name"], options, KEY_ABSENT),
  email: await gitOrNull(["config", "--global", "--get", "user.email"], options, KEY_ABSENT),
});

/**
 * git이 이 호출에서 전역 설정으로 볼 파일. 테스트는 `GIT_CONFIG_GLOBAL`을 `options.env`로
 * 넘기므로 `process.env`가 아니라 그쪽을 봐야 같은 파일을 가리킨다.
 */
const globalPathFor = (options: GitOptions): string =>
  globalGitConfigPath(options.env ?? process.env);

/**
 * `git config --list`는 파일에 적힌 순서대로 출력한다. 순서 판정에 그대로 쓴다.
 *
 * 파일이 아예 없으면 git은 128로 끝난다 — 파일이 망가졌을 때와 **같은 코드**다.
 * 종료 코드만 봐서는 갈라낼 수 없으므로 존재 여부를 먼저 확인한다. 없으면 키도 없는 게
 * 맞고(처음 쓰는 사용자가 여기다), 있는데 실패하면 그건 진짜 고장이므로 던진다.
 */
export const globalKeysInOrder = async (options: GitOptions = {}): Promise<readonly string[]> => {
  if (!fs.existsSync(globalPathFor(options))) return [];
  const output = await git(["config", "--global", "--list", "--name-only"], options);
  return output.split("\n").filter((line) => line !== "");
};

/**
 * 변경을 시작하기 전에 전역 설정을 한 번 읽어 본다. 깨진 파일이면 여기서 던지고,
 * 이후의 128은 "대상이 이미 없다"로만 해석할 수 있게 된다.
 */
export const assertGlobalConfigReadable = async (options: GitOptions = {}): Promise<void> => {
  await globalKeysInOrder(options);
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
