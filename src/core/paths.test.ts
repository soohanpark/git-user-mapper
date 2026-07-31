import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  configDir,
  expandTilde,
  findRepoRoot,
  isCaseInsensitive,
  mappingFilePath,
  toAbsolutePath,
  unsafeAbsolutePath,
} from "./paths.ts";

test("expandTilde expands a leading ~ only", () => {
  assert.equal(expandTilde("~/dev", "/home/me"), "/home/me/dev");
  assert.equal(expandTilde("~", "/home/me"), "/home/me");
  assert.equal(expandTilde("/tmp/~/x", "/home/me"), "/tmp/~/x");
  assert.equal(expandTilde("~notauser/x", "/home/me"), "~notauser/x");
});

test("toAbsolutePath strips trailing slashes and normalizes separators", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-paths-"));
  const result = toAbsolutePath(`${dir}/`);
  assert.ok(!result.endsWith("/"), `expected no trailing slash, got ${result}`);
  assert.ok(!result.includes("\\"), `expected forward slashes, got ${result}`);
});

test("toAbsolutePath resolves symlinks so git and the shell agree", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-link-")));
  const real = path.join(base, "real");
  const link = path.join(base, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link);
  assert.equal(toAbsolutePath(link), toAbsolutePath(real));
});

test("toAbsolutePath keeps non-existent paths absolute instead of throwing", () => {
  const result = toAbsolutePath("/definitely/not/here/xyz");
  assert.equal(result, "/definitely/not/here/xyz");
});

test("toAbsolutePath rethrows a realpath failure that is not ENOENT", () => {
  // 심볼릭 링크 순환은 이식성 있게 ELOOP를 만든다. 이걸 삼키면 링크가 풀리지 않은
  // 경로가 브랜딩되어 git과 답이 갈라지므로, 조용히 넘어가면 안 된다.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-loop-")));
  const a = path.join(base, "a");
  const b = path.join(base, "b");
  fs.symlinkSync(b, a);
  fs.symlinkSync(a, b);

  assert.throws(
    () => toAbsolutePath(a),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ELOOP",
  );
});

test("isCaseInsensitive follows the platform", () => {
  assert.equal(isCaseInsensitive("darwin"), true);
  assert.equal(isCaseInsensitive("win32"), true);
  assert.equal(isCaseInsensitive("linux"), false);
});

test("configDir honours XDG_CONFIG_HOME", () => {
  assert.equal(configDir({ XDG_CONFIG_HOME: "/x/cfg" }, "/home/me"), "/x/cfg/git-user-mapper");
  assert.equal(configDir({}, "/home/me"), "/home/me/.config/git-user-mapper");
  assert.equal(mappingFilePath({}, "/home/me"), "/home/me/.config/git-user-mapper/mapping.tsv");
});

test("findRepoRoot walks up to the nearest .git and returns null outside a repo", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-root-")));
  const repo = path.join(base, "repo");
  const nested = path.join(repo, "a", "b");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(repo, ".git"));

  assert.equal(findRepoRoot(unsafeAbsolutePath(nested)), unsafeAbsolutePath(repo));
  assert.equal(findRepoRoot(unsafeAbsolutePath(repo)), unsafeAbsolutePath(repo));
  assert.equal(findRepoRoot(unsafeAbsolutePath(base)), null);
});

test("findRepoRoot treats a .git file as a repo root (worktrees, submodules)", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-wt-")));
  const repo = path.join(base, "wt");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  assert.equal(findRepoRoot(unsafeAbsolutePath(repo)), unsafeAbsolutePath(repo));
});
