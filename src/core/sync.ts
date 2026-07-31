import fs from "node:fs";
import path from "node:path";
import type { ProfileId, StoreV2 } from "../types.ts";
import type { GitOptions } from "./git.ts";
import { backupFile } from "./gitconfig/backup.ts";
import type { GlobalUser } from "./gitconfig/globalConfig.ts";
import {
  assertGlobalConfigReadable,
  getGlobalUser,
  removeIncludeIf,
  setGlobalUser,
  setIncludeIf,
} from "./gitconfig/globalConfig.ts";
import { profileFilePath, pruneProfileFiles, writeProfileFile } from "./gitconfig/profileFiles.ts";
import {
  assertTableSerializable,
  buildTable,
  conditionFor,
  serializeTable,
  withFallback,
} from "./mapping.ts";
import { isCaseInsensitive } from "./paths.ts";
import { toProfileId } from "./profile.ts";

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
 */
const mappingTableFor = async (store: StoreV2, options: SyncOptions) => {
  const table = buildTable(store);
  if (table.fallback !== null) return table;

  const globalUser = await getGlobalUser(options.git);
  if (globalUser.email === null) return table;

  return withFallback(table, {
    profileId: toProfileId("global"),
    color: "yellow",
    email: globalUser.email,
  });
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
  // "섹션이 이미 없다"로만 읽을 수 있다.
  await assertGlobalConfigReadable(options.git);

  // 표에 실릴 값을 전부 확인한다. fallback은 git에서 읽어 오므로 계획 단계에서는 못 본다.
  const table = await mappingTableFor(store, options);
  assertTableSerializable(table);

  // 앞으로 만들 조건까지 미리 관리 목록에 넣어 둔다. 중간에 실패해도 다음 sync가 회수한다.
  persist?.({
    ...store,
    managedConditions: [...new Set([...store.managedConditions, ...nextConditions])],
  });

  // --- 여기부터 변경을 시작한다.

  backupFile({ source: options.globalConfigPath, dir: backupsDirOf(options), now: options.now });

  // [user]를 먼저 쓴다. 섹션이 없으면 git이 파일 끝에 새로 만드는데,
  // 그 뒤에 includeIf를 붙여야 매핑이 fallback을 이긴다.
  if (plan.defaultUser) await setGlobalUser(plan.defaultUser, options.git);

  for (const condition of plan.removeConditions) {
    await removeIncludeIf(condition, options.git);
  }

  for (const id of plan.writeProfiles) {
    const profile = store.profiles.find((candidate) => candidate.id === id);
    if (profile) await writeProfileFile(profile, profilesDir, options.git);
  }

  for (const entry of plan.addConditions) {
    await setIncludeIf(entry.condition, entry.file, options.git);
  }

  pruneProfileFiles(plan.writeProfiles, profilesDir);

  fs.mkdirSync(options.configDir, { recursive: true, mode: 0o700 });
  // 프로파일 파일과 같은 이메일이 실리므로 권한도 같게 준다.
  fs.writeFileSync(plan.mappingFile, serializeTable(table), { mode: 0o600 });
  fs.chmodSync(plan.mappingFile, 0o600);

  return { ...store, managedConditions: nextConditions };
};
