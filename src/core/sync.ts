import fs from "node:fs";
import path from "node:path";
import type { ProfileId, StoreV2 } from "../types.ts";
import type { GitOptions } from "./git.ts";
import { backupFile } from "./gitconfig/backup.ts";
import type { GlobalUser } from "./gitconfig/globalConfig.ts";
import {
  getGlobalUser,
  removeIncludeIf,
  setGlobalUser,
  setIncludeIf,
} from "./gitconfig/globalConfig.ts";
import { profileFilePath, pruneProfileFiles, writeProfileFile } from "./gitconfig/profileFiles.ts";
import { buildTable, conditionFor, serializeTable, withFallback } from "./mapping.ts";
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

export const applySync = async (store: StoreV2, options: SyncOptions): Promise<StoreV2> => {
  const plan = planSync(store, options);
  const profilesDir = profilesDirOf(options);

  backupFile({ source: options.globalConfigPath, dir: backupsDirOf(options), now: options.now });

  // [user]를 먼저 쓴다. 섹션이 없으면 git이 파일 끝에 새로 만드는데,
  // 그 뒤에 includeIf를 붙여야 매핑이 fallback을 이긴다.
  if (plan.defaultUser) await setGlobalUser(plan.defaultUser, options.git);

  for (const condition of plan.removeConditions) {
    await removeIncludeIf(condition, options.git);
  }

  for (const id of plan.writeProfiles) {
    const profile = store.profiles.find((candidate) => candidate.id === id);
    if (profile) writeProfileFile(profile, profilesDir);
  }

  for (const entry of plan.addConditions) {
    await setIncludeIf(entry.condition, entry.file, options.git);
  }

  pruneProfileFiles(plan.writeProfiles, profilesDir);

  fs.mkdirSync(options.configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(plan.mappingFile, serializeTable(await mappingTableFor(store, options)));

  return { ...store, managedConditions: plan.addConditions.map((entry) => entry.condition) };
};
