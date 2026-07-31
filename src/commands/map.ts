import path from "node:path";
import { input, select } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { findRepoRoot, toAbsolutePath, unsafeAbsolutePath } from "../core/paths.ts";
import { uniqueId } from "../core/profile.ts";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { buildProfile } from "./add.ts";

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
  const repoRoot = findRepoRoot(cwd);
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
    const taken = new Set(store.profiles.map((profile) => profile.id as string));
    const name = await input({ message: "Git user name" });
    const email = await input({ message: "Git email" });
    const signingKey = await input({ message: "GPG signing key (optional)" });
    const id = await input({ message: "Profile id", default: uniqueId(email, taken) });
    const profile = buildProfile({ id, name, email, signingKey, index: store.profiles.length });
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

  const target =
    scope === CUSTOM ? toAbsolutePath(await input({ message: "Directory" })) : unsafeAbsolutePath(scope);

  const targetRepo = findRepoRoot(target);
  if (targetRepo !== null && targetRepo !== target) {
    process.stdout.write(
      chalk.yellow(
        `! ${target} is inside the repository ${targetRepo}. git matches includeIf against the repository root, so this mapping would have no effect.\n`,
      ),
    );
  }

  store = assignPath(store, profileId, target);
  await syncAndPersist(context, store);

  process.stdout.write(chalk.green(`✓ ${target} → ${profileId}\n`));
};
