import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { tableWithGlobalFallback } from "../core/fallback.ts";
import { gitOrNull, gitVersion, supportsIncludeIf } from "../core/git.ts";
import {
  globalEntriesInOrder,
  hasUserAfterIncludeIf,
  includeIfConditions,
} from "../core/gitconfig/globalConfig.ts";
import { readLocalEmail } from "../core/gitconfig/localUser.ts";
import { profileFilePath } from "../core/gitconfig/profileFiles.ts";
import { gitContextFor } from "../core/gitdir.ts";
import { resolve } from "../core/mapping.ts";
import { findRepoRoot, isCaseInsensitive, toAbsolutePath } from "../core/paths.ts";
import type { AbsolutePath, ProfileId, ResolutionState, StoreV2 } from "../types.ts";

export interface StatusEnvironment {
  readonly gitVersion: { readonly major: number; readonly minor: number };
  readonly keysInOrder: readonly string[];
  readonly gitEmail: string | null;
  /** `~/.gitconfig`의 `[user] email`. 표의 fallback을 `sync`와 같게 만드는 데 쓴다. */
  readonly globalEmail: string | null;
  readonly localEmail: string | null;
  readonly repoRoot: AbsolutePath | null;
  /** git이 `includeIf "gitdir:"`를 맞춰 보는 경로. 매핑 판정은 이걸로 한다. */
  readonly gitDir: AbsolutePath | null;
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
    // `sync`는 자기가 관리하는 조건만 걷어냈다 되달 수 있다. 남의 includeIf가 섞여 있으면
    // "sync를 돌려라"는 안내가 영원히 고쳐지지 않는 지시가 된다. 실제로 그랬다.
    const managed = new Set(store.managedConditions);
    const foreign = includeIfConditions(env.keysInOrder).filter(
      (condition) => !managed.has(condition),
    );
    warnings.push(
      foreign.length === 0
        ? "A [user] section appears after the managed includeIf entries in ~/.gitconfig, so it beats every mapping. Run `git-mapper sync` to restore the order."
        : `A [user] section appears after includeIf entries in ~/.gitconfig, so it beats every mapping. \`git-mapper sync\` moves the entries it manages, and will also restore these it does not manage: ${foreign.join(", ")}.`,
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

  if (env.repoRoot === null || env.gitDir === null) {
    return { state: "not-a-repo", profileId: null, email: null, repoRoot: null, warnings };
  }

  // 표는 `sync`가 쓰는 것과 같아야 한다. 관리 대상이 아닌 전역 `[user]`도 실제 fallback이라
  // 여기서 빠뜨리면 셸은 `default`, `status`는 `local-override`라고 답하게 된다.
  // 맞춰 보는 대상은 작업 트리가 아니라 GIT_DIR이다 — git이 그렇게 한다.
  const matched = resolve(
    tableWithGlobalFallback(store, env.globalEmail),
    env.gitDir,
    caseInsensitive,
  );

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

export const inspect = async (store: StoreV2, configDir: string): Promise<StatusEnvironment> => {
  const context = gitContextFor(toAbsolutePath(process.cwd()));
  const repoRoot = context?.repoRoot ?? null;
  const profilesDir = path.join(configDir, "profiles");

  // 전부 읽기라 서로 기다릴 이유가 없다. 순서에 의미가 있는 건 `computeStatus` 안쪽이지
  // 여기가 아니다(불변조건 6의 "로컬 [user]를 먼저 읽는다"는 판정 순서 이야기다).
  const [version, entries, gitEmail] = await Promise.all([
    gitVersion(),
    globalEntriesInOrder(),
    repoRoot === null
      ? Promise.resolve(null)
      : gitOrNull(["config", "user.email"], { cwd: repoRoot }),
  ]);

  return {
    gitVersion: version,
    keysInOrder: entries.map((entry) => entry.key),
    gitEmail,
    globalEmail: entries.findLast((entry) => entry.key === "user.email")?.value ?? null,
    localEmail: readLocalEmail(context),
    repoRoot,
    gitDir: context?.gitDir ?? null,
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
