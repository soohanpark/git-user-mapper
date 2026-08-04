import fs from "node:fs";
import path from "node:path";
import type { ProfileId, StoreV2 } from "../types.ts";
import { tableWithGlobalFallback } from "./fallback.ts";
import type { GitOptions } from "./git.ts";
import { backupFile } from "./gitconfig/backup.ts";
import type { GlobalEntry, GlobalUser } from "./gitconfig/globalConfig.ts";
import {
  getGlobalUser,
  globalEntriesInOrder,
  hasUserAfterIncludeIf,
  hasUserSection,
  includeIfConditions,
  removeIncludeIf,
  setGlobalUser,
  setIncludeIf,
} from "./gitconfig/globalConfig.ts";
import { profileFilePath, pruneProfileFiles, writeProfileFile } from "./gitconfig/profileFiles.ts";
import { assertTableSerializable, buildTable, conditionFor, serializeTable } from "./mapping.ts";
import { isCaseInsensitive } from "./paths.ts";

export interface SyncOptions {
  readonly configDir: string;
  readonly globalConfigPath: string;
  readonly now: string;
  readonly caseInsensitive?: boolean;
  readonly git?: GitOptions;
}

export interface ConditionPlan {
  readonly condition: string;
  readonly file: string;
}

export interface SyncPlan {
  readonly removeConditions: readonly string[];
  readonly addConditions: readonly ConditionPlan[];
  readonly writeProfiles: readonly ProfileId[];
  readonly defaultUser: GlobalUser | null;
  readonly mappingFile: string;
}

const profilesDirOf = (options: SyncOptions): string => path.join(options.configDir, "profiles");
const backupsDirOf = (options: SyncOptions): string => path.join(options.configDir, "backups");

export const planSync = (store: StoreV2, options: SyncOptions): SyncPlan => {
  const caseInsensitive = options.caseInsensitive ?? isCaseInsensitive();
  const profilesDir = profilesDirOf(options);
  const withPaths = store.profiles.filter((profile) => profile.paths.length > 0);
  const defaultProfile = store.profiles.find((profile) => profile.id === store.defaultProfile);

  // 계획을 세우는 단계에서 미리 걸러 낸다. 쓰기 직전에 검사하면 `~/.gitconfig`를 이미
  // 고쳐 놓은 뒤에 던지게 되고, 그러면 관리 목록에 없는 includeIf가 남는다.
  assertTableSerializable(buildTable(store));

  return {
    removeConditions: store.managedConditions,
    addConditions: withPaths.flatMap((profile) =>
      profile.paths.map((target) => ({
        condition: conditionFor(target, caseInsensitive),
        file: profileFilePath(profile.id, profilesDir),
      })),
    ),
    writeProfiles: withPaths.map((profile) => profile.id),
    defaultUser: defaultProfile
      ? {
          name: defaultProfile.name,
          email: defaultProfile.email,
          signingKey: defaultProfile.signingKey,
        }
      : null,
    mappingFile: path.join(options.configDir, "mapping.tsv"),
  };
};

export const describePlan = (plan: SyncPlan): string => {
  const lines: string[] = [];
  if (plan.defaultUser) {
    lines.push(`set [user] to ${plan.defaultUser.name} <${plan.defaultUser.email}>`);
  }
  for (const condition of plan.removeConditions) lines.push(`remove includeIf "${condition}"`);
  for (const entry of plan.addConditions) {
    lines.push(`add    includeIf "${entry.condition}" -> ${entry.file}`);
  }
  for (const id of plan.writeProfiles) lines.push(`write  profile file for ${id}`);
  lines.push(`write  ${plan.mappingFile}`);
  return lines.join("\n");
};

/**
 * 기본 프로파일이 없으면 `~/.gitconfig`의 `[user]`가 실제 fallback이다. 그 값을 테이블에
 * 실어야 프롬프트가 git과 같은 답을 낸다 — 관리 대상이 아닐 뿐 identity가 없는 게 아니다.
 * `status`도 같은 함수를 쓴다(`core/fallback.ts`).
 */
const mappingTableFor = async (store: StoreV2, options: SyncOptions) => {
  if (buildTable(store).fallback !== null) return buildTable(store);
  const globalUser = await getGlobalUser(options.git);
  return tableWithGlobalFallback(store, globalUser.email);
};

interface Operations {
  /** 실제로 지워야 하는 조건. 그대로 둘 조건은 건드리지 않는다. */
  readonly removeConditions: readonly string[];
  /** 실제로 써야 하는 조건. 이미 같은 파일을 가리키면 뺀다. */
  readonly addConditions: readonly ConditionPlan[];
  /** 순서를 고치느라 잠시 걷어낸, 우리가 관리하지 않는 항목. 원래 순서대로 되돌린다. */
  readonly restoreUnmanaged: readonly ConditionPlan[];
  readonly reordering: boolean;
}

/**
 * 무엇을 실제로 건드릴지 고른다.
 *
 * 예전에는 관리 조건을 **전부** 지웠다가 그대로 다시 달았다. 두 가지가 걸렸다:
 *
 * 1. 지운 뒤 다시 달기 전까지 매핑이 하나도 없는 창이 생긴다. 그 사이 다른 터미널이나
 *    IDE에서 커밋하면 기본 프로파일로 커밋된다. 매핑 50개 기준 5.5초 중 68%가 그 창이었다.
 * 2. 바뀐 게 없어도 매번 git을 조건 수만큼 두 번씩 띄웠다.
 *
 * 그대로 둘 조건은 건드리지 않으면 둘 다 사라진다.
 *
 * 다만 `[user]`를 새로 만들어야 하거나 이미 includeIf 뒤에 있으면 이야기가 다르다.
 * `git config --global user.name`은 섹션이 없을 때 파일 **끝에** 만들고, 그러면 사용자가
 * 직접 써 둔 includeIf가 전부 그 앞에 놓여 조용히 죽는다 — 직접 includeIf를 쓰던 사람이
 * 바로 이 도구의 주 사용자층이라 그냥 두면 안 된다. 그 경우에만 전부 걷어냈다가
 * `[user]`를 쓴 뒤 원래 순서대로 되돌린다.
 */
export const planOperations = (
  plan: SyncPlan,
  store: StoreV2,
  entries: readonly GlobalEntry[],
): Operations => {
  const keys = entries.map((entry) => entry.key);
  const existing = includeIfConditions(keys);
  const existingPath = new Map(
    entries
      .filter((entry) => entry.key.startsWith("includeif.") && entry.value !== null)
      .map((entry) => [
        entry.key.slice("includeif.".length, -".path".length),
        entry.value as string,
      ]),
  );

  const wanted = new Map(plan.addConditions.map((entry) => [entry.condition, entry.file]));
  const managed = new Set(store.managedConditions);

  const reordering =
    plan.defaultUser !== null &&
    existing.length > 0 &&
    (!hasUserSection(keys) || hasUserAfterIncludeIf(keys));

  if (reordering) {
    return {
      removeConditions: existing,
      addConditions: plan.addConditions,
      restoreUnmanaged: existing
        .filter((condition) => !wanted.has(condition) && !managed.has(condition))
        .flatMap((condition) => {
          const file = existingPath.get(condition);
          return file === undefined ? [] : [{ condition, file }];
        }),
      reordering,
    };
  }

  return {
    removeConditions: store.managedConditions.filter((condition) => !wanted.has(condition)),
    addConditions: plan.addConditions.filter(
      (entry) => existingPath.get(entry.condition) !== entry.file,
    ),
    restoreUnmanaged: [],
    reordering,
  };
};

/**
 * `persist`는 변경을 시작하기 **전에** 관리 조건 목록을 확정하는 데 쓴다. 이걸 넘기지 않으면
 * 중간에 실패했을 때 이미 추가된 includeIf가 스토어의 목록에 없는 채로 남고, 목록에 없는
 * 항목은 다음 sync가 절대 지우지 않으므로 사용자의 `~/.gitconfig`에 영원히 남는다.
 */
export const applySync = async (
  store: StoreV2,
  options: SyncOptions,
  persist?: (next: StoreV2) => void,
): Promise<StoreV2> => {
  const plan = planSync(store, options);
  const profilesDir = profilesDirOf(options);
  const nextConditions = plan.addConditions.map((entry) => entry.condition);

  // --- 여기부터 아래 backupFile 전까지는 아무것도 바꾸지 않는다. 실패하면 원상태 그대로다.

  // 깨진 설정 파일이면 여기서 멈춘다. 이 관문 덕분에 이후 `--remove-section`의 128을
  // "섹션이 이미 없다"로만 읽을 수 있다. 같은 호출로 현재 상태까지 받아 온다.
  const entries = await globalEntriesInOrder(options.git);
  const operations = planOperations(plan, store, entries);

  // 표에 실릴 값을 전부 확인한다. fallback은 git에서 읽어 오므로 계획 단계에서는 못 본다.
  const table = await mappingTableFor(store, options);
  assertTableSerializable(table);

  // 앞으로 만들 조건까지 미리 관리 목록에 넣어 둔다. 중간에 실패해도 다음 sync가 회수한다.
  // 순서를 고치느라 걷어낸 남의 항목은 여기 넣지 않는다 — 넣으면 다음 sync가 지워 버린다.
  persist?.({
    ...store,
    managedConditions: [...new Set([...store.managedConditions, ...nextConditions])],
  });

  // --- 여기부터 변경을 시작한다.

  backupFile({ source: options.globalConfigPath, dir: backupsDirOf(options), now: options.now });

  if (operations.reordering) {
    // 전부 걷어내고 `[user]`를 쓴 다음 되돌린다. 이 순서라야 `[user]`가 맨 앞에 온다.
    for (const condition of operations.removeConditions) {
      await removeIncludeIf(condition, options.git);
    }
    if (plan.defaultUser) await setGlobalUser(plan.defaultUser, options.git);
    for (const entry of operations.restoreUnmanaged) {
      await setIncludeIf(entry.condition, entry.file, options.git);
    }
  } else {
    // [user]를 먼저 쓴다. 섹션이 없으면 git이 파일 끝에 새로 만드는데,
    // 그 뒤에 includeIf를 붙여야 매핑이 fallback을 이긴다.
    if (plan.defaultUser) await setGlobalUser(plan.defaultUser, options.git);
    for (const condition of operations.removeConditions) {
      await removeIncludeIf(condition, options.git);
    }
  }

  // 프로파일마다 자기 파일에만 쓰므로 서로 기다릴 이유가 없다. 한 파일 안의 두 번의
  // `git config --file`은 같은 잠금을 다투므로 그 둘만 순서를 지킨다.
  await Promise.all(
    plan.writeProfiles.map(async (id) => {
      const profile = store.profiles.find((candidate) => candidate.id === id);
      if (profile) await writeProfileFile(profile, profilesDir, options.git);
    }),
  );

  for (const entry of operations.addConditions) {
    await setIncludeIf(entry.condition, entry.file, options.git);
  }

  pruneProfileFiles(plan.writeProfiles, profilesDir);

  fs.mkdirSync(options.configDir, { recursive: true, mode: 0o700 });
  // 잘라 쓰면(O_TRUNC) 그 순간 표를 읽는 프롬프트가 빈 파일을 본다. 실측으로 8줄짜리
  // 표에서 8899번 중 379번이 빈 읽기였고, 그때 프롬프트는 git이 답을 갖고 있는데도
  // `no-identity`를 표시한다 — 불변조건 6이 막으려는 거짓말이다. 임시 파일에 쓰고
  // rename하면 읽는 쪽은 언제나 완결된 세대를 본다.
  const staging = `${plan.mappingFile}.tmp`;
  fs.writeFileSync(staging, serializeTable(table), { mode: 0o600 });
  fs.chmodSync(staging, 0o600);
  fs.renameSync(staging, plan.mappingFile);

  return { ...store, managedConditions: nextConditions };
};
