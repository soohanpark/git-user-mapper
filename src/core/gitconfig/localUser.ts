import fs from "node:fs";
import path from "node:path";
import type { GitContext } from "../gitdir.ts";
import { readConfigText } from "./configText.ts";

const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    // 없거나 못 읽으면 로컬 설정이 없는 것과 같게 다룬다. 여기서 던지면 프롬프트가 죽는다.
    return null;
  }
};

/**
 * 저장소 로컬 `[user] email`. git이 이 저장소에서 읽을 파일을 그대로 본다.
 *
 * linked worktree의 GIT_DIR에는 `config`가 없다 — 저장소 설정은 주 저장소의 `.git`에
 * 하나만 있고 워크트리들이 공유한다. 그래서 GIT_DIR이 아니라 common dir를 봐야 한다.
 *
 * `extensions.worktreeConfig`를 켠 저장소만 워크트리별 `config.worktree`를 갖고,
 * 그 파일의 값이 공유 설정을 이긴다. 확장이 꺼져 있으면 git은 파일이 있어도 무시하므로
 * 플래그를 먼저 확인한다.
 */
export const readLocalEmail = (context: GitContext | null): string | null => {
  if (context === null) return null;

  const shared = readOrNull(path.join(context.commonDir, "config"));
  const sharedKeys = shared === null ? null : readConfigText(shared);

  if (sharedKeys?.get("extensions.worktreeconfig")?.toLowerCase() === "true") {
    const perWorktree = readOrNull(path.join(context.gitDir, "config.worktree"));
    const overridden =
      perWorktree === null ? undefined : readConfigText(perWorktree).get("user.email");
    if (overridden !== undefined) return overridden;
  }

  return sharedKeys?.get("user.email") ?? null;
};
