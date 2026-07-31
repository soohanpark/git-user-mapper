import fs from "node:fs";
import path from "node:path";
import Conf from "conf";
import { z } from "zod";
import type { AbsolutePath, Profile, StoreV1, StoreV1User, StoreV2 } from "../types.ts";
import { unsafeAbsolutePath } from "./paths.ts";
import { PROFILE_ID_PATTERN, pickColor, toProfileId, uniqueId } from "./profile.ts";

const profileIdSchema = z.string().regex(PROFILE_ID_PATTERN);

/**
 * 스토어는 사용자가 직접 열어 고칠 수 있는 JSON이고, 예전 도구의 파일에서 옮겨 오기도 한다.
 * `AbsolutePath` 브랜딩은 캐스트일 뿐이라 여기서 막지 않으면 브랜드가 보장한다고 적어 둔
 * 성질이 실제로는 아무것도 보장하지 않는다. 상대경로나 `~/dev`가 들어오면 git은 그 문자열을
 * 그대로 패턴에 쓰고 `matches()`는 realpath와 비교하므로 둘의 답이 갈린다.
 */
const ABSOLUTE_PATH_PATTERN = /^(\/|[A-Za-z]:\/)/;

const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => ABSOLUTE_PATH_PATTERN.test(value), {
    message: "mapping paths must be absolute",
  })
  .refine((value) => !value.includes("\\"), {
    message: "mapping paths must use / as the separator",
  })
  .refine((value) => value.length === 1 || !value.endsWith("/"), {
    message: "mapping paths must not end with /",
  });

const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1),
  email: z.string().min(1),
  signingKey: z.string().min(1).nullable(),
  color: z.string().min(1),
  paths: z.array(absolutePathSchema),
});

const storeV2Schema = z.object({
  version: z.literal(2),
  defaultProfile: profileIdSchema.nullable(),
  /**
   * id가 겹치면 두 프로파일이 같은 `profiles/<id>.gitconfig`를 두고 다투고, 나중에 쓴 쪽이
   * 이긴다. includeIf는 둘 다 그 한 파일을 가리키므로 한쪽 매핑이 조용히 남의 identity를 쓴다.
   */
  profiles: z.array(profileSchema).superRefine((profiles, ctx) => {
    const seen = new Set<string>();
    for (const [index, profile] of profiles.entries()) {
      if (seen.has(profile.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `duplicate profile id ${JSON.stringify(profile.id)}`,
        });
      }
      seen.add(profile.id);
    }
  }),
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

const isV1Shaped = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && "users" in raw && !("version" in raw);

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

  // v1 모양인데 내용이 틀린 경우에 v2 스키마 오류("version이 2가 아님")를 보여 주면
  // 사용자는 자기 파일과 아무 상관 없는 말을 읽게 된다. 더 가까운 쪽의 오류를 고른다.
  const issues = isV1Shaped(raw) ? v1.error.issues : v2.error.issues;

  throw new Error(
    `The git-user-mapper store is corrupted and was not modified.\n${JSON.stringify(issues, null, 2)}`,
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
  /**
   * 마이그레이션 결과를 디스크에 쓰지 않는다. `sync --dry-run`처럼 아무것도 바꾸지 않겠다고
   * 약속한 경로용이다. 결과는 메모리에만 두고 `read()`가 그대로 돌려준다.
   */
  readonly readOnly?: boolean;
}

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
  const migrate = options.migrate ?? {};
  const readOnly = options.readOnly === true;

  /** readOnly일 때 디스크 대신 여기에 담아 둔다. 쓰기가 일어나면 무효가 된다. */
  let pending: StoreV2 | null = null;

  if (isEmptyStore(raw) && options.importLegacy !== false) {
    // 우리 스토어가 비어 있을 때만 본다. 이미 쓰던 사용자의 데이터를 덮어쓰지 않는다.
    const legacy = readLegacyStore(conf.path);
    if (legacy !== null) {
      try {
        const imported = parseStore(legacy, migrate);
        if (readOnly) pending = imported;
        else persist(imported);
      } catch {
        // 스키마가 안 맞아도 마찬가지다. 예전 파일 하나 때문에 모든 명령이 죽으면 안 된다 —
        // openStore는 모든 명령의 첫 관문이고, 사용자는 존재도 모르는 파일 이야기를 듣게 된다.
        // 가져오지 못했을 뿐 새 스토어는 비어 있는 상태로 멀쩡히 쓸 수 있다.
      }
    }
  } else if (isV1Shaped(raw) && fs.existsSync(conf.path)) {
    const migrated = parseStore(raw, migrate);
    if (readOnly) {
      pending = migrated;
    } else {
      const stamp = options.now ?? new Date().toISOString().replaceAll(":", "-");
      const backup = path.join(path.dirname(conf.path), `store.v1.${stamp}.bak`);
      if (!fs.existsSync(backup)) fs.copyFileSync(conf.path, backup);
      persist(migrated);
    }
  }

  return {
    path: conf.path,
    read: (): StoreV2 => pending ?? parseStore(conf.store, migrate),
    write: (next: StoreV2): void => {
      pending = null;
      persist(next);
    },
  };
};
