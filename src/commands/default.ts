import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId } from "../types.ts";

export const runDefault = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles yet. Run `git-mapper add`.\n");
    process.exitCode = 1;
    return;
  }

  const target =
    requested === undefined
      ? await select<ProfileId>({
          message: "Default profile (used where no mapping matches)",
          choices: store.profiles.map((profile) => ({
            name: `${profile.id}  ${profile.email}`,
            value: profile.id,
          })),
        })
      : (requested as ProfileId);

  if (!store.profiles.some((profile) => profile.id === target)) {
    process.stdout.write(chalk.red(`No profile named ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  context.store.write(await applySync({ ...store, defaultProfile: target }, context.sync));
  process.stdout.write(chalk.green(`✓ Default profile is now ${target}\n`));
};
