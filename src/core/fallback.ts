import type { StoreV2 } from "../types.ts";
import { buildTable, type MappingTable, withFallback } from "./mapping.ts";
import { toProfileId } from "./profile.ts";

/** 관리 대상이 아닌 전역 identity를 표에 실을 때 쓰는 이름. 스니펫에도 이대로 나간다. */
export const GLOBAL_FALLBACK_ID = "global";
const GLOBAL_FALLBACK_COLOR = "yellow";

/**
 * 스토어에 기본 프로파일이 없어도 `~/.gitconfig`의 `[user]`는 여전히 실제 fallback이다.
 * 관리 대상이 아닐 뿐 identity가 없는 게 아니다(resolve.md 4).
 *
 * `sync`와 `status`가 **같은 표**를 봐야 한다. 예전에는 `sync`만 이 fallback을 실었고
 * `status`는 `buildTable`만 썼다. 그래서 전역 `[user]`와 똑같은 이메일을 저장소에 로컬로
 * 박아 둔 흔한 설정에서 셸은 `default`, `status`는 `local-override`라고 답했다.
 */
export const tableWithGlobalFallback = (
  store: StoreV2,
  globalEmail: string | null,
): MappingTable => {
  const table = buildTable(store);
  if (table.fallback !== null || globalEmail === null) return table;
  return withFallback(table, {
    profileId: toProfileId(GLOBAL_FALLBACK_ID),
    color: GLOBAL_FALLBACK_COLOR,
    email: globalEmail,
  });
};
