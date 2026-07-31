import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { gitOrNull, gitVersion, supportsIncludeIf } from "../core/git.ts";
import { globalKeysInOrder, hasUserAfterIncludeIf } from "../core/gitconfig/globalConfig.ts";
import { profileFilePath } from "../core/gitconfig/profileFiles.ts";
import { buildTable, resolve } from "../core/mapping.ts";
import { findRepoRoot, isCaseInsensitive, toAbsolutePath } from "../core/paths.ts";
import type { AbsolutePath, ProfileId, ResolutionState, StoreV2 } from "../types.ts";

export interface StatusEnvironment {
  readonly gitVersion: { readonly major: number; readonly minor: number };
  readonly keysInOrder: readonly string[];
  readonly gitEmail: string | null;
  readonly localEmail: string | null;
  readonly repoRoot: AbsolutePath | null;
  readonly missingProfileFiles: readonly ProfileId[];
  readonly missingPaths: readonly AbsolutePath[];
  readonly pathsInsideRepos: readonly AbsolutePath[];
}

export interface StatusResult {
  readonly state: ResolutionState | "not-a-repo";
  readonly profileId: string | null;
  readonly email: string | null;
  readonly repoRoot: string | null;
  readonly warnings: readonly string[];
}

const overlaps = (store: StoreV2): readonly string[] => {
  const all = store.profiles.flatMap((profile) =>
    profile.paths.map((target) => ({ target, id: profile.id })),
  );
  const found: string[] = [];
  for (const a of all) {
    for (const b of all) {
      if (a.target === b.target || !b.target.startsWith(`${a.target}/`)) continue;
      found.push(
        `Mappings overlap: ${b.target} (${b.id}) sits inside ${a.target} (${a.id}). The longer path wins.`,
      );
    }
  }
  return found;
};

export const computeStatus = (
  store: StoreV2,
  env: StatusEnvironment,
  caseInsensitive: boolean,
): StatusResult => {
  const warnings: string[] = [];

  if (!supportsIncludeIf(env.gitVersion)) {
    warnings.push(
      `git ${env.gitVersion.major}.${env.gitVersion.minor} does not support includeIf. Upgrade to git 2.13 or newer.`,
    );
  }
  if (hasUserAfterIncludeIf(env.keysInOrder)) {
    warnings.push(
      "A [user] section appears after the managed includeIf entries in ~/.gitconfig, so it beats every mapping. Run `git-mapper sync` to restore the order.",
    );
  }
  for (const id of env.missingProfileFiles) {
    warnings.push(
      `The profile file for ${id} is missing. git silently ignores a missing include. Run \`git-mapper sync\`.`,
    );
  }
  for (const target of env.missingPaths) {
    warnings.push(`Mapped path ${target} no longer exists.`);
  }
  for (const target of env.pathsInsideRepos) {
    warnings.push(
      `Mapped path ${target} is inside a git repository, so it has no effect. Map the repository root or a directory above it.`,
    );
  }
  warnings.push(...overlaps(store));

  if (env.repoRoot === null) {
    return { state: "not-a-repo", profileId: null, email: null, repoRoot: null, warnings };
  }

  const matched = resolve(buildTable(store), env.repoRoot, caseInsensitive);

  // 로컬 [user]가 표의 답과 다르면 실제로 커밋에 쓰이는 건 로컬 쪽이다. 표에 답이 아예
  // 없을 때도 마찬가지다 — 셸 스니펫과 같은 순서로 판단해야 둘이 갈리지 않는다
  // (resolve.md 7). 여기서 `matched.email`이 아니라 아래 `resolved.email`과 비교하면,
  // 전역 [user]가 없고 로컬만 있는 저장소에서 셸은 local-override, status는 default라고
  // 답하게 된다.
  const overridden = env.localEmail !== null && env.localEmail !== matched.email;

  if (overridden) {
    const owner = store.profiles.find((profile) => profile.email === env.localEmail);
    return {
      state: "local-override",
      profileId: owner?.id ?? null,
      email: env.localEmail,
      repoRoot: env.repoRoot,
      warnings,
    };
  }

  // 스토어에 기본 프로파일이 없어도 ~/.gitconfig의 [user]는 여전히 fallback이다(스펙 4.1).
  // git이 이메일을 답한다면 그게 실제로 커밋에 쓰일 identity이므로, 관리 대상이 아닐 뿐
  // "identity 없음"이 아니다. no-identity는 git조차 답이 없을 때만 쓴다.
  const resolved =
    matched.state === "no-identity" && env.gitEmail !== null
      ? { state: "default" as const, profileId: null, color: null, email: env.gitEmail }
      : matched;

  if (env.gitEmail !== null && resolved.email !== null && env.gitEmail !== resolved.email) {
    warnings.push(
      `git reports ${env.gitEmail} here but the mapping resolves to ${resolved.email}. Something outside git-user-mapper is overriding it.`,
    );
  }

  return {
    state: resolved.state,
    profileId: resolved.profileId,
    email: resolved.email,
    repoRoot: env.repoRoot,
    warnings,
  };
};

/**
 * 저장소 로컬 `[user].email`을 읽는다. `.git`이 파일인 경우(worktree·submodule)는
 * 설정이 다른 위치에 있으므로 건너뛴다 — 문서화된 한계다.
 */
const readLocalEmail = (repoRoot: AbsolutePath | null): string | null => {
  if (repoRoot === null) return null;
  const gitPath = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitPath) || !fs.statSync(gitPath).isDirectory()) return null;
  const configPath = path.join(gitPath, "config");
  if (!fs.existsSync(configPath)) return null;

  let section = "";
  for (const raw of fs.readFileSync(configPath, "utf8").split("\n")) {
    const line = raw.replaceAll(/[ \t]/g, "");
    if (line === "[user]") section = "user";
    else if (line.startsWith("[")) section = "";
    else if (section === "user" && line.startsWith("email=")) return line.slice("email=".length);
  }
  return null;
};

export const inspect = async (store: StoreV2, configDir: string): Promise<StatusEnvironment> => {
  const repoRoot = findRepoRoot(toAbsolutePath(process.cwd()));
  const profilesDir = path.join(configDir, "profiles");
  return {
    gitVersion: await gitVersion(),
    keysInOrder: await globalKeysInOrder(),
    gitEmail:
      repoRoot === null ? null : await gitOrNull(["config", "user.email"], { cwd: repoRoot }),
    localEmail: readLocalEmail(repoRoot),
    repoRoot,
    missingProfileFiles: store.profiles
      .filter((profile) => profile.paths.length > 0)
      .filter((profile) => !fs.existsSync(profileFilePath(profile.id, profilesDir)))
      .map((profile) => profile.id),
    missingPaths: store.profiles
      .flatMap((profile) => profile.paths)
      .filter((target) => !fs.existsSync(target)),
    pathsInsideRepos: store.profiles
      .flatMap((profile) => profile.paths)
      .filter((target) => {
        const root = findRepoRoot(target);
        return root !== null && root !== target;
      }),
  };
};

export const runStatus = async (options: { readonly porcelain: boolean }): Promise<number> => {
  const context = await createContext();
  const store = context.store.read();
  const result = computeStatus(
    store,
    await inspect(store, context.sync.configDir),
    isCaseInsensitive(),
  );

  if (options.porcelain) {
    if (result.state === "not-a-repo") return 1;
    process.stdout.write(`${result.profileId ?? ""}\t${result.state}\t${result.email ?? ""}\n`);
    return 0;
  }

  if (result.state === "not-a-repo") {
    process.stdout.write(chalk.dim("Not inside a git repository.\n"));
  } else {
    process.stdout.write(`  repository  ${result.repoRoot}\n`);
    process.stdout.write(`  profile     ${result.profileId ?? "-"} (${result.state})\n`);
    process.stdout.write(`  email       ${result.email ?? "-"}\n`);
  }
  for (const warning of result.warnings) {
    process.stdout.write(chalk.yellow(`  ! ${warning}\n`));
  }
  return result.warnings.length > 0 ? 2 : 0;
};
