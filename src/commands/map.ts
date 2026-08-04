import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { gitContextFor } from "../core/gitdir.ts";
import { covers } from "../core/mapping.ts";
import { findRepoRoot, toAbsolutePath, unsafeAbsolutePath } from "../core/paths.ts";
import { input, select } from "../core/prompt.ts";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { promptForProfile } from "./add.ts";

export const unassignPath = (store: StoreV2, target: AbsolutePath): StoreV2 => ({
  ...store,
  profiles: store.profiles.map((profile) => ({
    ...profile,
    paths: profile.paths.filter((existing) => existing !== target),
  })),
});

export const assignPath = (store: StoreV2, profileId: ProfileId, target: AbsolutePath): StoreV2 => {
  const cleared = unassignPath(store, target);
  return {
    ...cleared,
    profiles: cleared.profiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, paths: [...profile.paths, target].toSorted() }
        : profile,
    ),
  };
};

export interface ScopeChoice {
  readonly label: string;
  readonly value: AbsolutePath;
}

export const scopeChoices = (
  cwd: AbsolutePath,
  repoRoot: AbsolutePath | null,
): readonly ScopeChoice[] => {
  const primary = repoRoot ?? cwd;
  const parent = unsafeAbsolutePath(path.dirname(primary).replaceAll("\\", "/"));
  const choices: ScopeChoice[] = [{ label: `${primary}  (this repository only)`, value: primary }];
  if (parent !== primary) {
    choices.push({ label: `${parent}  (the whole parent folder)`, value: parent });
  }
  return choices;
};

// 프로파일 id 정규식이 밑줄을 허용하지 않으므로 실제 id와 절대 충돌하지 않는다.
const NEW_PROFILE = "__new__";
const UNMAP = "__unmap__";
const CANCEL = "__cancel__";
const CUSTOM = "__custom__";

export const runMap = async (): Promise<void> => {
  const context = await createContext();
  let store = context.store.read();

  const cwd = toAbsolutePath(process.cwd());
  const gitContext = gitContextFor(cwd);
  const repoRoot = gitContext?.repoRoot ?? null;
  const here = repoRoot ?? cwd;
  const alreadyMapped = store.profiles.find((profile) => profile.paths.includes(here));

  const selection = await select<string>({
    message: `Profile for ${here}`,
    choices: [
      ...store.profiles.map((profile) => ({
        name: `${profile.id}  ${profile.email}${profile.paths.length > 0 ? chalk.dim(`  [${profile.paths.length}]`) : ""}`,
        value: profile.id as string,
      })),
      { name: "+ Add a new profile", value: NEW_PROFILE },
      ...(alreadyMapped ? [{ name: "Remove this mapping", value: UNMAP }] : []),
      { name: "Cancel", value: CANCEL },
    ],
  });

  if (selection === CANCEL) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  if (selection === UNMAP) {
    await syncAndPersist(context, unassignPath(store, here));
    process.stdout.write(chalk.green(`✓ Removed the mapping for ${here}\n`));
    return;
  }

  let profileId: ProfileId;
  if (selection === NEW_PROFILE) {
    const profile = await promptForProfile(store);
    store = { ...store, profiles: [...store.profiles, profile] };
    profileId = profile.id;
  } else {
    profileId = selection as ProfileId;
  }

  const choices = scopeChoices(cwd, repoRoot);
  const scope = await select<string>({
    message: "Apply to",
    choices: [
      ...choices.map((choice) => ({ name: choice.label, value: choice.value as string })),
      { name: "Enter a path…", value: CUSTOM },
    ],
  });

  // 직접 입력한 경로는 실존하는 디렉토리여야 한다(스펙 4.1). 오타를 그대로 받으면
  // 절대 발동하지 않는 includeIf가 생기고, status는 "경로가 사라졌다"고 엉뚱하게 설명한다.
  const target =
    scope === CUSTOM
      ? toAbsolutePath(
          await input({
            message: "Directory",
            validate: (value: string) => {
              const trimmed = value.trim();
              if (trimmed === "") return "Please enter a directory.";
              const resolved = toAbsolutePath(trimmed);
              if (!fs.existsSync(resolved)) return `${resolved} does not exist.`;
              if (!fs.statSync(resolved).isDirectory()) return `${resolved} is not a directory.`;
              return true;
            },
          }),
        )
      : unsafeAbsolutePath(scope);

  const targetRepo = findRepoRoot(target);
  if (targetRepo !== null && targetRepo !== target) {
    process.stdout.write(
      chalk.yellow(
        `! ${target} is inside the repository ${targetRepo}. git matches includeIf against the repository root, so this mapping would have no effect.\n`,
      ),
    );
  }

  // git은 `includeIf "gitdir:"`를 작업 트리가 아니라 GIT_DIR로 맞춘다. linked worktree의
  // GIT_DIR은 주 저장소의 `.git/worktrees/<이름>` 아래라, 워크트리 디렉토리를 매핑하면
  // 조건은 만들어지지만 git이 절대 고르지 않는다. 여기서 말해 주지 않으면 사용자는
  // 매핑이 걸린 줄 알고 다른 identity로 커밋한다.
  if (
    gitContext !== null &&
    (cwd === target || cwd.startsWith(`${target}/`)) &&
    !covers(target, gitContext.gitDir)
  ) {
    process.stdout.write(
      chalk.yellow(
        `! git resolves identities for this checkout through ${gitContext.gitDir}, which is outside ${target}.\n` +
          `  Map ${path.dirname(gitContext.commonDir)} (the main repository) or a directory above it instead.\n`,
      ),
    );
  }

  store = assignPath(store, profileId, target);
  await syncAndPersist(context, store);

  process.stdout.write(chalk.green(`✓ ${target} → ${profileId}\n`));
};
