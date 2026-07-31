import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { applySync, describePlan, planSync } from "../core/sync.ts";

export const runSync = async (options: { readonly dryRun: boolean }): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (options.dryRun) {
    process.stdout.write(`${describePlan(planSync(store, context.sync))}\n`);
    return;
  }

  context.store.write(await applySync(store, context.sync));
  process.stdout.write(chalk.green("✓ Synced\n"));
};
