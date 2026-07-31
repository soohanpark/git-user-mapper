import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId } from "../types.ts";

export const runRemove = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles to remove.\n");
    return;
  }

  const target: ProfileId | null =
    requested === undefined
      ? await select<ProfileId | null>({
          message: "Remove which profile?",
          choices: [
            ...store.profiles.map((profile) => ({
              name: `${profile.id}  ${profile.name} <${profile.email}>`,
              value: profile.id,
            })),
            { name: "Cancel", value: null },
          ],
        })
      : (requested as ProfileId);

  if (target === null) {
    process.stdout.write("Cancelled.\n");
    return;
  }
  if (!store.profiles.some((profile) => profile.id === target)) {
    process.stdout.write(chalk.red(`No profile named ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  // 기본 프로파일을 지워도 ~/.gitconfig의 [user]는 남긴다.
  // identity를 없애면 커밋이 실패하므로 마지막 값이 남는 편이 안전하다.
  const next = {
    ...store,
    defaultProfile: store.defaultProfile === target ? null : store.defaultProfile,
    profiles: store.profiles.filter((profile) => profile.id !== target),
  };
  context.store.write(await applySync(next, context.sync));

  process.stdout.write(chalk.green(`✓ Removed ${target}\n`));
  if (store.defaultProfile === target) {
    process.stdout.write(
      chalk.dim("It was the default profile. ~/.gitconfig [user] was left as it is.\n"),
    );
  }
};
