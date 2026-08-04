import chalk from "chalk";
import { type Context, createContext, syncAndPersist } from "../core/context.ts";
import { confirm } from "../core/prompt.ts";
import { emptyStore } from "../core/store.ts";
import { applySync, type SyncOptions } from "../core/sync.ts";
import type { StoreV2 } from "../types.ts";

/**
 * 파생물을 직접 하나씩 지우지 않고, 빈 스토어로 sync를 한 번 돌린다. 손으로 지우면
 * 언젠가 하나를 빠뜨리고 — 실제로 mapping.tsv가 빠져서 reset 뒤에도 프롬프트가 사라진
 * 프로파일을 계속 보여 줬다 — 그건 정리하라고 만든 명령이 불변조건 6을 깨는 꼴이다.
 * 관리 조건 목록만 넘겨 주면 sync가 나머지를 전부 회수한다.
 *
 * `defaultProfile`이 null이므로 `~/.gitconfig`의 `[user]`는 건드리지 않는다.
 */
/** reset이 sync에 넘기는 스토어. 관리 조건만 남겨 두면 sync가 나머지를 전부 회수한다. */
export const clearedStore = (store: StoreV2): StoreV2 => ({
  ...emptyStore(),
  managedConditions: store.managedConditions,
});

/** 테스트에서 sync 옵션을 직접 주입할 때만 쓴다. 실제 명령은 `syncAndPersist`를 지난다. */
export const clearManaged = async (store: StoreV2, options: SyncOptions): Promise<void> => {
  await applySync(clearedStore(store), options);
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

  // 불변조건 8: 스토어를 바꾸는 명령은 예외 없이 syncAndPersist를 지난다. 빈 스토어라
  // 지금은 기록할 추가 조건이 없어 결과가 같지만, 그 보증이 걸려 있지 않은 상태로 두면
  // 나중에 reset이 조건 하나라도 쓰게 되는 순간 고아 includeIf가 조용히 돌아온다.
  await syncAndPersist(context, clearedStore(store));
  process.stdout.write(chalk.green("✓ Reset. ~/.gitconfig [user] was left as it is.\n"));
};
