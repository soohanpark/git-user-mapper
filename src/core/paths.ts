import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AbsolutePath } from "../types.ts";
import { asciiFold } from "./caseFold.ts";

const APP_DIR = "git-user-mapper";

export const isCaseInsensitive = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === "darwin" || platform === "win32";

export const expandTilde = (input: string, home: string = os.homedir()): string => {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
};

/**
 * 구분자 정규화는 Windows 이야기다. 모든 플랫폼에서 돌리면 POSIX에서 합법적인
 * `back\slash`라는 디렉토리 이름이 존재하지도 않는 `back/slash`로 바뀐다. 그러면
 * 절대 발동하지 않는 매핑이 생기고 `status`는 "경로가 사라졌다"고 엉뚱하게 설명한다.
 */
const normalizeSeparators = (
  value: string,
  platform: NodeJS.Platform = process.platform,
): string => (platform === "win32" ? value.replaceAll("\\", "/") : value);

const stripTrailingSlash = (value: string): string =>
  value.length > 1 && value.endsWith("/") ? value.replace(/\/+$/, "") : value;

/** 검증 없이 브랜딩만 한다. 이미 정규화된 값(스토어에서 읽은 값)에만 쓴다. */
export const unsafeAbsolutePath = (value: string): AbsolutePath => value as AbsolutePath;

/**
 * 대소문자를 안 가리는 파일시스템에서 디스크에 적힌 철자로 맞춘다.
 *
 * macOS의 `realpath(3)`는 심볼릭 링크만 풀고 대소문자는 사용자가 친 그대로 남긴다.
 * 그래서 `…/PROJEKTÄ`를 `…/projektä`라고 쳐서 매핑하면 git은 `gitdir/i:…/projektä/`를
 * 받아 들고, wildmatch는 ASCII만 접으므로 `Ä`와 `ä`가 끝내 만나지 않아 매핑이 아예
 * 발동하지 않는다. 저장 시점에 철자를 맞춰 두면 그 상황 자체가 생기지 않는다.
 *
 * 한 조각이라도 못 찾으면 원본을 그대로 돌려준다. 추측해서 고치는 것보다 안전하다.
 */
const canonicalizeCase = (target: string): string => {
  const segments = target.split("/");
  let resolved = segments[0] ?? "";

  for (const segment of segments.slice(1)) {
    if (segment === "") continue;
    const parent = resolved === "" ? "/" : resolved;
    let entries: readonly string[];
    try {
      entries = fs.readdirSync(parent);
    } catch {
      return target;
    }
    const folded = asciiFold(segment);
    const match = entries.find((entry) => asciiFold(entry) === folded);
    if (match === undefined) return target;
    resolved = parent === "/" ? `/${match}` : `${parent}/${match}`;
  }

  return resolved === "" ? target : resolved;
};

export const toAbsolutePath = (input: string, cwd: string = process.cwd()): AbsolutePath => {
  // 앞뒤 공백은 사용자가 붙일 생각이 없던 것이다. 살려 두면 존재하지 않는 경로가 되어
  // 절대 발동하지 않는 includeIf가 만들어진다(`map`의 "Enter a path…"에서 실제로 났다).
  const resolved = path.resolve(cwd, expandTilde(input.trim()));
  let real = resolved;
  let exists = true;
  try {
    real = fs.realpathSync(resolved);
  } catch (error) {
    // 존재하지 않는 경로는 해석하지 않고 그대로 쓴다. 호출자가 존재 여부를 판단한다.
    // 권한·순환 같은 다른 실패까지 삼키면 심볼릭 링크가 풀리지 않은 경로가
    // 그대로 브랜딩되어 git이 해석한 경로와 조용히 갈라진다.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
  }

  const normalized = stripTrailingSlash(normalizeSeparators(real));
  return unsafeAbsolutePath(
    exists && isCaseInsensitive() ? canonicalizeCase(normalized) : normalized,
  );
};

/** 빈 문자열은 설정되지 않은 것으로 본다. git도 그렇게 다루고, 그러지 않으면 상대경로가 나온다. */
const xdgConfigHome = (env: NodeJS.ProcessEnv, home: string): string =>
  env.XDG_CONFIG_HOME === undefined || env.XDG_CONFIG_HOME === ""
    ? path.join(home, ".config")
    : env.XDG_CONFIG_HOME;

export const configDir = (
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string => path.join(xdgConfigHome(env, home), APP_DIR);

export const profilesDir = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "profiles");

export const backupsDir = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "backups");

export const mappingFilePath = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "mapping.tsv");

/**
 * `git config --global`이 실제로 쓰는 파일. `~/.gitconfig`로 단정하면 안 된다 —
 * git 2.50에서 확인한 동작은 이렇다: `~/.gitconfig`가 없고 `~/.config/git/config`가
 * 있으면 쓰기는 XDG 쪽으로 간다. 그 경우 `~/.gitconfig`를 백업하려 들면 대상이 없어
 * 백업이 조용히 건너뛰어지고, 정작 수정되는 파일은 백업 없이 바뀐다(불변조건 3).
 *
 * 우선순위는 git과 같다: `GIT_CONFIG_GLOBAL` → 있으면 `~/.gitconfig` →
 * 있으면 `$XDG_CONFIG_HOME/git/config` → 둘 다 없으면 git이 새로 만들 `~/.gitconfig`.
 */
export const globalGitConfigPath = (
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string => {
  const override = env.GIT_CONFIG_GLOBAL;
  if (override !== undefined && override !== "") return override;

  const legacy = path.join(home, ".gitconfig");
  if (fs.existsSync(legacy)) return legacy;

  const xdg = path.join(xdgConfigHome(env, home), "git", "config");
  if (fs.existsSync(xdg)) return xdg;

  return legacy;
};

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
