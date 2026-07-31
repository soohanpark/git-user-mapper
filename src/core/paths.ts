import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AbsolutePath } from "../types.ts";

const APP_DIR = "git-user-mapper";

export const isCaseInsensitive = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === "darwin" || platform === "win32";

export const expandTilde = (input: string, home: string = os.homedir()): string => {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
};

const normalizeSeparators = (value: string): string => value.replaceAll("\\", "/");

const stripTrailingSlash = (value: string): string =>
  value.length > 1 && value.endsWith("/") ? value.replace(/\/+$/, "") : value;

/** 검증 없이 브랜딩만 한다. 이미 정규화된 값(스토어에서 읽은 값)에만 쓴다. */
export const unsafeAbsolutePath = (value: string): AbsolutePath => value as AbsolutePath;

export const toAbsolutePath = (input: string, cwd: string = process.cwd()): AbsolutePath => {
  const resolved = path.resolve(cwd, expandTilde(input));
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch (error) {
    // 존재하지 않는 경로는 해석하지 않고 그대로 쓴다. 호출자가 존재 여부를 판단한다.
    // 권한·순환 같은 다른 실패까지 삼키면 심볼릭 링크가 풀리지 않은 경로가
    // 그대로 브랜딩되어 git이 해석한 경로와 조용히 갈라진다.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return unsafeAbsolutePath(stripTrailingSlash(normalizeSeparators(real)));
};

export const configDir = (
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string => path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), APP_DIR);

export const profilesDir = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "profiles");

export const backupsDir = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "backups");

export const mappingFilePath = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "mapping.tsv");

export const globalGitConfigPath = (home: string = os.homedir()): string =>
  path.join(home, ".gitconfig");

/** `.git`이 디렉토리든 파일이든 저장소 루트로 본다(worktree·submodule 포함). */
export const findRepoRoot = (start: AbsolutePath): AbsolutePath | null => {
  let current = start;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = unsafeAbsolutePath(normalizeSeparators(path.dirname(current)));
    if (parent === current) return null;
    current = parent;
  }
};
