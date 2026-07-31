import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { toAbsolutePath } from "../core/paths.ts";
import { applySync } from "../core/sync.ts";
import { unassignPath } from "./map.ts";

export const runUnmap = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();
  const target = toAbsolutePath(requested ?? process.cwd());

  const owner = store.profiles.find((profile) => profile.paths.includes(target));
  if (!owner) {
    process.stdout.write(chalk.yellow(`No mapping for ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  context.store.write(await applySync(unassignPath(store, target), context.sync));
  process.stdout.write(chalk.green(`✓ Removed the mapping ${target} → ${owner.id}\n`));
};
