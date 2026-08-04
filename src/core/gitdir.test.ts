import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gitContextFor, isLinkedWorktree } from "./gitdir.ts";
import { toAbsolutePath } from "./paths.ts";

const setup = (): { base: string; env: NodeJS.ProcessEnv } => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-gitdir-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  return { base, env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfigPath } };
};

const git = (args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): string =>
  execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

test("gitContextFor points at .git for an ordinary repository", () => {
  const { base, env } = setup();
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  git(["init", "-q"], repo, env);

  const context = gitContextFor(toAbsolutePath(repo));
  assert.notEqual(context, null);
  assert.equal(context?.repoRoot, repo);
  assert.equal(context?.gitDir, path.join(repo, ".git"));
  assert.equal(context?.commonDir, path.join(repo, ".git"));
  assert.equal(isLinkedWorktree(context as never), false);
});

test("gitContextFor works from a subdirectory", () => {
  const { base, env } = setup();
  const repo = path.join(base, "repo");
  fs.mkdirSync(path.join(repo, "a", "b"), { recursive: true });
  git(["init", "-q"], repo, env);

  const context = gitContextFor(toAbsolutePath(path.join(repo, "a", "b")));
  assert.equal(context?.repoRoot, repo);
  assert.equal(context?.gitDir, path.join(repo, ".git"));
});

/**
 * 여기가 핵심이다. git은 `includeIf "gitdir:"`를 GIT_DIR로 맞추는데, linked worktree의
 * GIT_DIR은 주 저장소 아래에 있다. 그래서 워크트리 디렉토리로 판정하면 git이 절대
 * 고르지 않을 프로파일이 나온다. `git rev-parse --absolute-git-dir`와 대조해 확인한다.
 */
test("gitContextFor follows a linked worktree back to the main repository", () => {
  const { base, env } = setup();
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  git(["init", "-q"], main, env);
  git(["commit", "-q", "--allow-empty", "-m", "x"], main, env);

  const worktree = path.join(base, "elsewhere", "wt");
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(["worktree", "add", "-q", worktree], main, env);

  const context = gitContextFor(toAbsolutePath(worktree));
  assert.notEqual(context, null);
  assert.equal(context?.repoRoot, worktree);

  // git이 스스로 답하는 값과 같아야 한다.
  assert.equal(context?.gitDir, git(["rev-parse", "--absolute-git-dir"], worktree, env));
  assert.equal(context?.gitDir, path.join(main, ".git", "worktrees", "wt"));

  // 설정은 주 저장소 쪽에 하나뿐이다. 여기를 못 찾으면 로컬 [user]를 통째로 놓친다.
  assert.equal(context?.commonDir, path.join(main, ".git"));
  assert.equal(isLinkedWorktree(context as never), true);
});

test("gitContextFor resolves a relative gitdir pointer", () => {
  const { base, env } = setup();
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  git(["init", "-q"], repo, env);

  // 서브모듈이 쓰는 모양이다: `.git` 파일에 상대경로가 들어간다.
  const real = path.join(base, "store", "modules", "sub");
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.renameSync(path.join(repo, ".git"), real);
  fs.writeFileSync(path.join(repo, ".git"), "gitdir: ../store/modules/sub\n");

  const context = gitContextFor(toAbsolutePath(repo));
  assert.equal(context?.gitDir, real);
  assert.equal(context?.commonDir, real);
});

test("gitContextFor returns null outside a repository", () => {
  const { base } = setup();
  assert.equal(gitContextFor(toAbsolutePath(base)), null);
});

test("gitContextFor rejects a .git file that is not a gitdir pointer", () => {
  const { base } = setup();
  const repo = path.join(base, "broken");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, ".git"), "not a pointer\n");
  assert.equal(gitContextFor(toAbsolutePath(repo)), null);
});
