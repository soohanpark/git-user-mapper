import fs from "node:fs";
import path from "node:path";
import type { Profile, ProfileId } from "../../types.ts";

const EXTENSION = ".gitconfig";

export const profileFilePath = (id: ProfileId, dir: string): string =>
  path.join(dir, `${id}${EXTENSION}`);

export const renderProfile = (profile: Profile): string => {
  const lines = [
    "# Managed by git-user-mapper. Edits are overwritten by `git-mapper sync`.",
    "[user]",
    `\tname = ${profile.name}`,
    `\temail = ${profile.email}`,
  ];
  if (profile.signingKey !== null) lines.push(`\tsigningKey = ${profile.signingKey}`);
  return `${lines.join("\n")}\n`;
};

export const writeProfileFile = (profile: Profile, dir: string): string => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = profileFilePath(profile.id, dir);
  fs.writeFileSync(target, renderProfile(profile), { mode: 0o600 });
  return target;
};

/** 스토어에 없는 프로파일의 파일만 지운다. 다른 파일은 건드리지 않는다. */
export const pruneProfileFiles = (keep: readonly ProfileId[], dir: string): readonly string[] => {
  if (!fs.existsSync(dir)) return [];
  const kept = new Set(keep.map((id) => `${id}${EXTENSION}`));
  const removed: string[] = [];
  for (const name of fs.readdirSync(dir).toSorted()) {
    if (!name.endsWith(EXTENSION) || kept.has(name)) continue;
    const target = path.join(dir, name);
    fs.rmSync(target, { force: true });
    removed.push(target);
  }
  return removed;
};
