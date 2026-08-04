import type { StoreV2 } from "../types.ts";
import { getGlobalUser } from "./gitconfig/globalConfig.ts";
import { withStoreLock } from "./lock.ts";
import { configDir, globalGitConfigPath } from "./paths.ts";
import { migrationPossible, openStore, type StoreHandle } from "./store.ts";
import { applySync, type SyncOptions } from "./sync.ts";

export interface Context {
  readonly store: StoreHandle;
  readonly sync: SyncOptions;
}

export const timestamp = (date: Date = new Date()): string =>
  date.toISOString().replaceAll(":", "-");

/**
 * 모든 명령이 스토어 핸들과 SyncOptions를 같은 방식으로 얻는 단일 진입점.
 * 마이그레이션이 기본 프로파일을 고를 수 있도록 현재 전역 identity를 함께 넘긴다.
 */
export interface ContextOptions {
  /** 아무것도 쓰지 않는다. `sync --dry-run`이 마이그레이션까지 미루게 하는 데 쓴다. */
  readonly readOnly?: boolean;
}

export const createContext = async (options: ContextOptions = {}): Promise<Context> => {
  // 이 값은 마이그레이션만 읽는다. 그런데 예전에는 모든 명령이 시작할 때마다 git을 두 번
  // 띄워서 가져왔다 — `list`처럼 아무것도 안 바꾸는 명령까지. 마이그레이션이 실제로
  // 가능할 때만 부른다.
  const globalUser = migrationPossible() ? await getGlobalUser() : { name: null, email: null };
  return {
    store: openStore({
      migrate: { currentGlobalEmail: globalUser.email },
      ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
    }),
    sync: {
      configDir: configDir(),
      globalConfigPath: globalGitConfigPath(),
      now: timestamp(),
    },
  };
};

/**
 * 스토어를 바꾸는 명령은 전부 이걸 부른다. `applySync`에 persist 콜백을 넘기는 일을
 * 호출자마다 반복하면 언젠가 한 곳이 빠지고, 그 명령만 중간 실패 시 고아 includeIf를
 * 남긴다. 여기 한 군데로 모아 두면 빠뜨릴 자리가 없다.
 */
export const syncAndPersist = async (context: Context, next: StoreV2): Promise<StoreV2> =>
  withStoreLock(context.sync.configDir, async () => {
    // 잠금을 잡은 **뒤에** 디스크를 다시 읽는다. 우리가 질문을 던지는 동안 다른 실행이
    // 조건을 추가했을 수 있고, 그걸 목록에 합치지 않으면 그 항목은 어느 스토어에도
    // 기록되지 않은 채 사용자의 `~/.gitconfig`에 영원히 남는다.
    const current = context.store.read();
    const merged: StoreV2 = {
      ...next,
      managedConditions: [...new Set([...current.managedConditions, ...next.managedConditions])],
    };
    const applied = await applySync(merged, context.sync, context.store.write);
    context.store.write(applied);
    return applied;
  });
