import fs from "node:fs";
import path from "node:path";
import type { AbsolutePath } from "../types.ts";
import { findRepoRoot, unsafeAbsolutePath } from "./paths.ts";

/**
 * git이 `includeIf "gitdir:"`를 맞춰 보는 대상은 작업 트리가 아니라 **`$GIT_DIR`**다.
 * 보통은 둘이 같이 움직이지만 linked worktree에서는 완전히 갈라진다:
 *
 *   주 저장소  `/a/work/repo`      -> GIT_DIR `/a/work/repo/.git`
 *   워크트리   `/a/personal/wt`    -> GIT_DIR `/a/work/repo/.git/worktrees/wt`
 *   서브모듈   `/a/work/repo/sub`  -> GIT_DIR `/a/work/repo/.git/modules/sub`
 *
 * 그래서 워크트리 디렉토리로 표를 맞춰 보면 git과 다른 답이 나온다. 실측(git 2.50.1)으로
 * `<base>/work`에 매핑된 저장소의 워크트리를 `<base>/personal` 아래 만들면 git은
 * `work@corp.com`을 답하는데 스니펫은 `personal`을 표시했다 — 불변조건 6 위반이다.
 *
 * 표를 GIT_DIR에 맞춰 보면 세 경우가 한 규칙으로 정리되고, 그게 git이 하는 일 그대로다.
 */
export interface GitContext {
  /** `.git` 항목이 있는 디렉토리. 사용자에게 "저장소"로 보여 줄 값이다. */
  readonly repoRoot: AbsolutePath;
  /** git이 `gitdir:` 조건을 맞춰 보는 경로. 매핑 판정은 **이걸로** 한다. */
  readonly gitDir: AbsolutePath;
  /**
   * 저장소 설정(`config`)이 있는 디렉토리. linked worktree면 주 저장소의 `.git`이다.
   * 워크트리의 GIT_DIR에는 `config`가 아예 없으므로, 여기를 보지 않으면 저장소 로컬
   * `[user]`를 통째로 놓친다.
   */
  readonly commonDir: AbsolutePath;
}

const POINTER = "gitdir:";

/** `.git`이 파일이면 `gitdir: <경로>` 한 줄이 들어 있다. 상대경로일 수 있다(서브모듈). */
const readPointer = (file: string, base: string): string | null => {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const line = raw.split("\n").find((candidate) => candidate.trim() !== "");
  if (line === undefined) return null;

  const trimmed = line.trim();
  if (!trimmed.toLowerCase().startsWith(POINTER)) return null;

  const target = trimmed.slice(POINTER.length).trim();
  return target === "" ? null : path.resolve(base, target);
};

/** `commondir`는 GIT_DIR 기준 상대경로로 적히는 게 보통이다(`../..`). */
const readCommonDir = (gitDir: string): string => {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(gitDir, "commondir"), "utf8");
  } catch {
    // 파일이 없으면 이 GIT_DIR 자신이 common dir다. 평범한 저장소가 여기다.
    return gitDir;
  }
  const line = raw.split("\n").find((candidate) => candidate.trim() !== "");
  return line === undefined ? gitDir : path.resolve(gitDir, line.trim());
};

/**
 * `start`에서 위로 올라가며 저장소를 찾고, git이 보는 세 경로를 돌려준다.
 * git을 실행하지 않는다 — 셸 스니펫이 같은 일을 프롬프트마다 해야 하므로, 여기서만
 * 하위 프로세스를 쓰면 두 구현이 구조적으로 달라진다(resolve.md의 subprocess budget).
 */
export const gitContextFor = (start: AbsolutePath): GitContext | null => {
  const repoRoot = findRepoRoot(start);
  if (repoRoot === null) return null;

  const dotGit = path.join(repoRoot, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }

  const gitDir = stat.isDirectory() ? dotGit : readPointer(dotGit, repoRoot);
  if (gitDir === null) return null;

  return {
    repoRoot,
    gitDir: unsafeAbsolutePath(gitDir),
    commonDir: unsafeAbsolutePath(readCommonDir(gitDir)),
  };
};

/** 이 디렉토리가 주 저장소가 아니라 linked worktree인가. `map`이 경고하는 데 쓴다. */
export const isLinkedWorktree = (context: GitContext): boolean =>
  context.commonDir !== context.gitDir;
