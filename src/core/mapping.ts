import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { isCaseInsensitive, unsafeAbsolutePath } from "./paths.ts";
import { toProfileId } from "./profile.ts";

export interface MappingEntry {
  readonly path: AbsolutePath;
  readonly profileId: ProfileId;
  readonly color: string;
  readonly email: string;
}

export interface FallbackEntry {
  readonly profileId: ProfileId;
  readonly color: string;
  readonly email: string;
}

export interface MappingTable {
  /** 경로 길이 내림차순. 첫 매치가 곧 최장 매치다. */
  readonly entries: readonly MappingEntry[];
  readonly fallback: FallbackEntry | null;
}

export interface Resolved {
  readonly state: "mapped" | "default" | "no-identity";
  readonly profileId: ProfileId | null;
  readonly color: string | null;
  readonly email: string | null;
}

/** 후행 슬래시가 git에게 `**`를 덧붙이게 만들어 하위 전체에 재귀 적용된다. */
export const conditionFor = (
  target: AbsolutePath,
  caseInsensitive: boolean = isCaseInsensitive(),
): string => `${caseInsensitive ? "gitdir/i" : "gitdir"}:${target}/`;

export const buildTable = (store: StoreV2): MappingTable => {
  const entries = store.profiles
    .flatMap((profile) =>
      profile.paths.map(
        (target): MappingEntry => ({
          path: target,
          profileId: profile.id,
          color: profile.color,
          email: profile.email,
        }),
      ),
    )
    .toSorted((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path));

  const defaultProfile = store.profiles.find((profile) => profile.id === store.defaultProfile);

  return {
    entries,
    fallback: defaultProfile
      ? {
          profileId: defaultProfile.id,
          color: defaultProfile.color,
          email: defaultProfile.email,
        }
      : null,
  };
};

/**
 * 스토어에 기본 프로파일이 없어도 `~/.gitconfig`의 `[user]`가 여전히 적용된다(스펙 4.1).
 * 그 경우를 fallback으로 채워 넣어야 셸이 "identity 없음"이라고 거짓말하지 않는다.
 * 이미 관리 중인 fallback이 있으면 건드리지 않는다.
 */
export const withFallback = (table: MappingTable, fallback: FallbackEntry): MappingTable =>
  table.fallback === null ? { entries: table.entries, fallback } : table;

const matches = (entryPath: string, target: string, caseInsensitive: boolean): boolean => {
  const a = caseInsensitive ? entryPath.toLowerCase() : entryPath;
  const b = caseInsensitive ? target.toLowerCase() : target;
  return b === a || b.startsWith(`${a}/`);
};

export const resolve = (
  table: MappingTable,
  repoRoot: AbsolutePath,
  caseInsensitive: boolean = isCaseInsensitive(),
): Resolved => {
  const hit = table.entries.find((entry) => matches(entry.path, repoRoot, caseInsensitive));
  if (hit) {
    return { state: "mapped", profileId: hit.profileId, color: hit.color, email: hit.email };
  }
  if (table.fallback) {
    return {
      state: "default",
      profileId: table.fallback.profileId,
      color: table.fallback.color,
      email: table.fallback.email,
    };
  }
  return { state: "no-identity", profileId: null, color: null, email: null };
};

const assertSerializable = (values: readonly string[]): void => {
  for (const value of values) {
    if (value.includes("\t") || value.includes("\n")) {
      throw new Error(
        `Cannot write mapping table: ${JSON.stringify(value)} contains a tab or newline.`,
      );
    }
  }
};

export const serializeTable = (table: MappingTable): string => {
  const lines: string[] = [];
  if (table.fallback) {
    const row = [table.fallback.profileId, table.fallback.color, table.fallback.email];
    assertSerializable(row);
    lines.push(["*", ...row].join("\t"));
  }
  for (const entry of table.entries) {
    const row = [entry.path, entry.profileId, entry.color, entry.email];
    assertSerializable(row);
    lines.push(row.join("\t"));
  }
  return `${lines.join("\n")}\n`;
};

export const parseTable = (text: string): MappingTable => {
  const entries: MappingEntry[] = [];
  let fallback: FallbackEntry | null = null;

  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [first, second, third, fourth] = line.split("\t");
    if (first === undefined || second === undefined || third === undefined) continue;
    if (first === "*") {
      fallback = { profileId: toProfileId(second), color: third, email: fourth ?? "" };
      continue;
    }
    if (fourth === undefined) continue;
    entries.push({
      path: unsafeAbsolutePath(first),
      profileId: toProfileId(second),
      color: third,
      email: fourth,
    });
  }

  return { entries, fallback };
};
