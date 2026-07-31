import { getGlobalUser } from "./gitconfig/globalConfig.ts";
import { configDir, globalGitConfigPath } from "./paths.ts";
import { type StoreHandle, openStore } from "./store.ts";
import type { SyncOptions } from "./sync.ts";

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
export const createContext = async (): Promise<Context> => {
  const globalUser = await getGlobalUser();
  return {
    store: openStore({ migrate: { currentGlobalEmail: globalUser.email } }),
    sync: {
      configDir: configDir(),
      globalConfigPath: globalGitConfigPath(),
      now: timestamp(),
    },
  };
};
