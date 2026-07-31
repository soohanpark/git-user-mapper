import fs from "node:fs";
import path from "node:path";
import Conf from "conf";
import { z } from "zod";
import type { AbsolutePath, Profile, StoreV1, StoreV1User, StoreV2 } from "../types.ts";
import { unsafeAbsolutePath } from "./paths.ts";
import { PROFILE_ID_PATTERN, pickColor, toProfileId, uniqueId } from "./profile.ts";

const profileIdSchema = z.string().regex(PROFILE_ID_PATTERN);

const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1),
  email: z.string().min(1),
  signingKey: z.string().min(1).nullable(),
  color: z.string().min(1),
  paths: z.array(z.string().min(1)),
});

const storeV2Schema = z.object({
  version: z.literal(2),
  defaultProfile: profileIdSchema.nullable(),
  profiles: z.array(profileSchema),
  managedConditions: z.array(z.string().min(1)),
});

const storeV1Schema = z.object({
  users: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      signingKey: z.string().nullable().optional(),
    }),
  ),
});

export interface MigrateOptions {
  readonly currentGlobalEmail?: string | null;
  readonly nameFor?: (user: StoreV1User, index: number) => string;
}

export const emptyStore = (): StoreV2 => ({
  version: 2,
  defaultProfile: null,
  profiles: [],
  managedConditions: [],
});

const brandProfile = (raw: z.infer<typeof profileSchema>): Profile => ({
  id: toProfileId(raw.id),
  name: raw.name,
  email: raw.email,
  signingKey: raw.signingKey,
  color: raw.color,
  paths: raw.paths.map(unsafeAbsolutePath) as readonly AbsolutePath[],
});

export const migrateV1 = (v1: StoreV1, options: MigrateOptions = {}): StoreV2 => {
  const taken = new Set<string>();
  const profiles = v1.users.map((user, index): Profile => {
    const id = uniqueId(options.nameFor?.(user, index) ?? user.email, taken);
    taken.add(id);
    return {
      id,
      name: user.name,
      email: user.email,
      signingKey: user.signingKey ?? null,
      color: pickColor(index),
      paths: [],
    };
  });

  const matched = options.currentGlobalEmail
    ? profiles.find((profile) => profile.email === options.currentGlobalEmail)
    : undefined;

  return {
    version: 2,
    defaultProfile: matched?.id ?? profiles[0]?.id ?? null,
    profiles,
    managedConditions: [],
  };
};

export const parseStore = (raw: unknown, options: MigrateOptions = {}): StoreV2 => {
  if (raw === null || raw === undefined) return emptyStore();
  if (typeof raw === "object" && Object.keys(raw).length === 0) return emptyStore();

  const v2 = storeV2Schema.safeParse(raw);
  if (v2.success) {
    return {
      version: 2,
      defaultProfile: v2.data.defaultProfile === null ? null : toProfileId(v2.data.defaultProfile),
      profiles: v2.data.profiles.map(brandProfile),
      managedConditions: v2.data.managedConditions,
    };
  }

  const v1 = storeV1Schema.safeParse(raw);
  if (v1.success) return migrateV1(v1.data, options);

  throw new Error(
    `The git-user-mapper store is corrupted and was not modified.\n${JSON.stringify(v2.error.issues, null, 2)}`,
  );
};

export interface StoreHandle {
  readonly path: string;
  read(): StoreV2;
  write(next: StoreV2): void;
}

export interface OpenStoreOptions {
  readonly cwd?: string;
  readonly now?: string;
  readonly migrate?: MigrateOptions;
  /** 테스트에서 실제 홈 디렉토리의 예전 스토어를 읽지 않도록 끌 수 있다. */
  readonly importLegacy?: boolean;
}

const isV1OnDisk = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && "users" in raw && !("version" in raw);

const isEmptyStore = (raw: unknown): boolean =>
  raw === null || raw === undefined || (typeof raw === "object" && Object.keys(raw).length === 0);

/**
 * 이 패키지는 `git-user-switch`에서 포크되면서 이름이 바뀌었고, `conf`는 패키지 이름으로
 * 저장 위치를 정한다. 그래서 기존 사용자의 데이터는 형제 디렉토리에 남아 있고 우리 쪽에서는
 * 보이지 않는다. 원본 파일은 읽기만 하고 건드리지 않는다 — 예전 도구가 계속 동작해야 한다.
 */
export const legacyStorePath = (currentPath: string): string =>
  path.join(
    path.dirname(path.dirname(currentPath)),
    "git-user-switch-nodejs",
    path.basename(currentPath),
  );

const readLegacyStore = (currentPath: string): unknown => {
  const legacy = legacyStorePath(currentPath);
  if (!fs.existsSync(legacy)) return null;
  try {
    return JSON.parse(fs.readFileSync(legacy, "utf8"));
  } catch {
    // 예전 파일이 깨져 있다고 해서 새 도구를 못 쓰게 만들 이유는 없다.
    return null;
  }
};

export const openStore = (options: OpenStoreOptions = {}): StoreHandle => {
  const conf = new Conf<Record<string, unknown>>({
    projectName: "git-user-mapper",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  const persist = (next: StoreV2): void => {
    conf.store = next as unknown as Record<string, unknown>;
  };

  // 열 때 한 번만 마이그레이션하고 결과를 디스크에 확정한다. read()에서만 변환하면
  // 마이그레이션이 영속되지 않아 대화형으로 정한 프로파일 id가 사라지고,
  // 실행할 때마다 새 백업이 쌓인다.
  const raw = conf.store;

  if (isEmptyStore(raw) && options.importLegacy !== false) {
    // 우리 스토어가 비어 있을 때만 본다. 이미 쓰던 사용자의 데이터를 덮어쓰지 않는다.
    const legacy = readLegacyStore(conf.path);
    if (legacy !== null) persist(parseStore(legacy, options.migrate ?? {}));
  } else if (isV1OnDisk(raw) && fs.existsSync(conf.path)) {
    const stamp = options.now ?? new Date().toISOString().replaceAll(":", "-");
    const backup = path.join(path.dirname(conf.path), `store.v1.${stamp}.bak`);
    if (!fs.existsSync(backup)) fs.copyFileSync(conf.path, backup);
    persist(parseStore(raw, options.migrate ?? {}));
  }

  return {
    path: conf.path,
    read: (): StoreV2 => parseStore(conf.store, options.migrate ?? {}),
    write: persist,
  };
};
