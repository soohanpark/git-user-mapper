import fs from "node:fs";
import path from "node:path";
import type { Profile, ProfileId } from "../../types.ts";
import { type GitOptions, git } from "../git.ts";
import { readConfigText } from "./configText.ts";

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
/**
 * 파일이 이미 정확히 이 프로파일인가. **읽기**만 하므로 불변조건 2와 무관하다 — 쓰기는
 * 여전히 git이 한다.
 *
 * 이 검사가 없으면 아무것도 바뀌지 않은 sync도 프로파일마다 git을 두 번씩 띄운다.
 * 매핑 50개 기준 실측으로 104번의 spawn 중 100번이 여기였다.
 *
 * 키 집합까지 함께 비교한다. 값만 보면 지워진 signingKey가 파일에 남아 있어도
 * "같다"고 판단해 버린다.
 */
const alreadyWritten = (target: string, profile: Profile): boolean => {
  let text: string;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch {
    return false;
  }
  if (!text.startsWith(HEADER)) return false;

  const expected = new Map<string, string>([
    ["user.name", profile.name],
    ["user.email", profile.email],
  ]);
  if (profile.signingKey !== null) expected.set("user.signingkey", profile.signingKey);

  const found = readConfigText(text);
  if (found.size !== expected.size) return false;
  for (const [key, value] of expected) {
    if (found.get(key) !== value) return false;
  }
  return true;
};

export const writeProfileFile = async (
  profile: Profile,
  dir: string,
  options: GitOptions = {},
): Promise<string> => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = profileFilePath(profile.id, dir);

  if (alreadyWritten(target, profile)) {
    fs.chmodSync(target, 0o600);
    return target;
  }

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
