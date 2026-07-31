import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { type Context, createContext } from "../core/context.ts";
import { emptyStore } from "../core/store.ts";
import { type SyncOptions, applySync } from "../core/sync.ts";
import type { StoreV2 } from "../types.ts";

/**
 * 파생물을 직접 하나씩 지우지 않고, 빈 스토어로 sync를 한 번 돌린다. 손으로 지우면
 * 언젠가 하나를 빠뜨리고 — 실제로 mapping.tsv가 빠져서 reset 뒤에도 프롬프트가 사라진
 * 프로파일을 계속 보여 줬다 — 그건 정리하라고 만든 명령이 불변조건 6을 깨는 꼴이다.
 * 관리 조건 목록만 넘겨 주면 sync가 나머지를 전부 회수한다.
 *
 * `defaultProfile`이 null이므로 `~/.gitconfig`의 `[user]`는 건드리지 않는다.
 */
export const clearManaged = async (store: StoreV2, options: SyncOptions): Promise<void> => {
  await applySync({ ...emptyStore(), managedConditions: store.managedConditions }, options);
};

export const runReset = async (): Promise<void> => {
  const context: Context = await createContext();
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
