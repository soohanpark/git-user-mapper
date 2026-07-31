import fs from "node:fs";
import path from "node:path";
import type { Profile, ProfileId } from "../../types.ts";
import { type GitOptions, git } from "../git.ts";

const EXTENSION = ".gitconfig";
const HEADER = "# Managed by git-user-mapper. Edits are overwritten by `git-mapper sync`.\n";

export const profileFilePath = (id: ProfileId, dir: string): string =>
  path.join(dir, `${id}${EXTENSION}`);

/**
 * 값은 git이 직접 쓰게 한다. 불변조건 2는 `~/.gitconfig`에만 걸린 규칙이 아니다 —
 * git은 이 파일도 똑같이 파싱하므로 같은 규칙이 그대로 적용된다.
 *
 * 문자열로 조립하면 실제로 이렇게 깨진다(git 2.50에서 확인):
 *   `Soo"han Park`   -> `fatal: bad config line` — 매핑된 트리의 모든 git 명령이 죽는다
 *   `Soo "Han" Park` -> 따옴표가 먹혀 `Soo Han Park`으로 조용히 커밋된다
 *   `ABC # note`     -> `#` 뒤가 잘린다
 *   개행 포함        -> 섹션이 주입된다(`core.sshCommand` 같은 것이 심어진다)
 * git에게 맡기면 위 값들이 전부 바이트 단위로 왕복한다.
 */
export const writeProfileFile = async (
  profile: Profile,
  dir: string,
  options: GitOptions = {},
): Promise<string> => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = profileFilePath(profile.id, dir);

  // 헤더만 남기고 매번 새로 만든다. 이어 쓰면 지워진 signingKey가 살아남는다.
  fs.writeFileSync(target, HEADER, { mode: 0o600 });
  fs.chmodSync(target, 0o600);

  await git(["config", "--file", target, "user.name", profile.name], options);
  await git(["config", "--file", target, "user.email", profile.email], options);
  if (profile.signingKey !== null) {
    await git(["config", "--file", target, "user.signingKey", profile.signingKey], options);
  }
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
