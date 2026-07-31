import chalk from "chalk";
import { createContext } from "../core/context.ts";

export const runList = async (): Promise<void> => {
  const store = (await createContext()).store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles yet. Run `git-mapper add`.\n");
    return;
  }

  for (const profile of store.profiles) {
    const isDefault = profile.id === store.defaultProfile ? chalk.dim(" (default)") : "";
    process.stdout.write(
      `${chalk.bold(profile.id)}${isDefault}  ${profile.name} <${profile.email}>\n`,
    );
    if (profile.signingKey !== null) {
      process.stdout.write(`  ${chalk.yellow(`key ${profile.signingKey}`)}\n`);
    }
    for (const target of profile.paths) process.stdout.write(`  ${target}\n`);
    if (profile.paths.length === 0) process.stdout.write(chalk.dim("  (no mappings)\n"));
  }
};
