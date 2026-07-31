import path from "node:path";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { removeIncludeIf } from "../core/gitconfig/globalConfig.ts";
import { pruneProfileFiles } from "../core/gitconfig/profileFiles.ts";
import { emptyStore } from "../core/store.ts";
import type { SyncOptions } from "../core/sync.ts";
import type { StoreV2 } from "../types.ts";

/** 스토어를 비우기 전에 파생물을 먼저 지워 고아 설정을 남기지 않는다. */
export const clearManaged = async (store: StoreV2, options: SyncOptions): Promise<void> => {
  for (const condition of store.managedConditions) {
    await removeIncludeIf(condition, options.git);
  }
  pruneProfileFiles([], path.join(options.configDir, "profiles"));
};

export const runReset = async (): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  const proceed = await confirm({
    message: `Remove ${store.profiles.length} profile(s) and all mappings? ~/.gitconfig [user] is kept.`,
    default: false,
  });
  if (!proceed) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  await clearManaged(store, context.sync);
  context.store.write(emptyStore());
  process.stdout.write(chalk.green("✓ Reset. ~/.gitconfig [user] was left as it is.\n"));
};
