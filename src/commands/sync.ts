import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { describePlan, planSync } from "../core/sync.ts";

export const runSync = async (options: { readonly dryRun: boolean }): Promise<void> => {
  // --dry-run은 정말로 아무것도 쓰지 않는다. 스토어 마이그레이션도 예외가 아니다.
  const context = await createContext({ readOnly: options.dryRun });
  const store = context.store.read();

  if (options.dryRun) {
    process.stdout.write(`${describePlan(planSync(store, context.sync))}\n`);
    return;
  }

  await syncAndPersist(context, store);
  process.stdout.write(chalk.green("✓ Synced\n"));
};
