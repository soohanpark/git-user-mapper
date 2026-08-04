import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { GitContext } from "../gitdir.ts";
import { unsafeAbsolutePath } from "../paths.ts";
import { readLocalEmail } from "./localUser.ts";

const setup = (): { gitDir: string; commonDir: string } => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-local-")));
  const commonDir = path.join(base, "main", ".git");
  const gitDir = path.join(commonDir, "worktrees", "wt");
  fs.mkdirSync(gitDir, { recursive: true });
  return { gitDir, commonDir };
};

const contextOf = (gitDir: string, commonDir: string): GitContext => ({
  repoRoot: unsafeAbsolutePath(path.dirname(commonDir)),
  gitDir: unsafeAbsolutePath(gitDir),
  commonDir: unsafeAbsolutePath(commonDir),
});

test("readLocalEmail returns null without a context", () => {
  assert.equal(readLocalEmail(null), null);
});

test("readLocalEmail returns null when there is no config file", () => {
  const { gitDir, commonDir } = setup();
  assert.equal(readLocalEmail(contextOf(gitDir, commonDir)), null);
});

/**
 * 워크트리의 GIT_DIR에는 `config`가 없다. 저장소 설정은 common dir에 하나뿐이라,
 * GIT_DIR만 보면 로컬 identity를 통째로 놓치고 프롬프트가 매핑된 프로파일을 보여 준다.
 */
test("readLocalEmail reads the shared config, not the worktree gitdir", () => {
  const { gitDir, commonDir } = setup();
  fs.writeFileSync(path.join(commonDir, "config"), "[user]\n\temail = shared@x.com\n");

  assert.equal(readLocalEmail(contextOf(gitDir, commonDir)), "shared@x.com");
});

test("readLocalEmail ignores config.worktree unless the extension is on", () => {
  const { gitDir, commonDir } = setup();
  fs.writeFileSync(path.join(commonDir, "config"), "[user]\n\temail = shared@x.com\n");
  fs.writeFileSync(path.join(gitDir, "config.worktree"), "[user]\n\temail = per-wt@x.com\n");

  // git도 extensions.worktreeConfig가 꺼져 있으면 이 파일을 읽지 않는다.
  assert.equal(readLocalEmail(contextOf(gitDir, commonDir)), "shared@x.com");
});

test("readLocalEmail lets config.worktree win when the extension is on", () => {
  const { gitDir, commonDir } = setup();
  fs.writeFileSync(
    path.join(commonDir, "config"),
    "[extensions]\n\tworktreeConfig = true\n[user]\n\temail = shared@x.com\n",
  );
  fs.writeFileSync(path.join(gitDir, "config.worktree"), "[user]\n\temail = per-wt@x.com\n");

  assert.equal(readLocalEmail(contextOf(gitDir, commonDir)), "per-wt@x.com");
});

test("readLocalEmail falls back to the shared value when config.worktree sets no email", () => {
  const { gitDir, commonDir } = setup();
  fs.writeFileSync(
    path.join(commonDir, "config"),
    "[extensions]\n\tworktreeConfig = true\n[user]\n\temail = shared@x.com\n",
  );
  fs.writeFileSync(path.join(gitDir, "config.worktree"), "[core]\n\tbare = false\n");

  assert.equal(readLocalEmail(contextOf(gitDir, commonDir)), "shared@x.com");
});
