import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  configDir,
  expandTilde,
  findRepoRoot,
  globalGitConfigPath,
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

/**
 * `git config --global`이 항상 `~/.gitconfig`에 쓰는 게 아니다. git 2.50 실측:
 * `~/.gitconfig`가 없고 `~/.config/git/config`가 있으면 쓰기는 XDG 쪽으로 간다.
 * 여기서 파일을 잘못 짚으면 백업 대상과 실제 수정 대상이 어긋난다(불변조건 3).
 */
test("globalGitConfigPath follows git's own precedence", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gum-globalcfg-"));
  const legacy = path.join(home, ".gitconfig");
  const xdgDir = path.join(home, ".config", "git");
  const xdg = path.join(xdgDir, "config");
  fs.mkdirSync(xdgDir, { recursive: true });

  // 둘 다 없으면 git이 새로 만들 ~/.gitconfig
  assert.equal(globalGitConfigPath({}, home), legacy);

  // XDG만 있으면 XDG
  fs.writeFileSync(xdg, "");
  assert.equal(globalGitConfigPath({}, home), xdg);

  // ~/.gitconfig가 있으면 언제나 그쪽이 이긴다
  fs.writeFileSync(legacy, "");
  assert.equal(globalGitConfigPath({}, home), legacy);

  // GIT_CONFIG_GLOBAL이 전부를 이긴다
  assert.equal(globalGitConfigPath({ GIT_CONFIG_GLOBAL: "/tmp/override" }, home), "/tmp/override");
});

test("configDir treats an empty XDG_CONFIG_HOME as unset", () => {
  const dir = configDir({ XDG_CONFIG_HOME: "" }, "/home/me");
  assert.equal(path.isAbsolute(dir), true);
  assert.equal(dir, path.join("/home/me", ".config", "git-user-mapper"));
});

/**
 * 구분자 정규화는 Windows 이야기다. 모든 플랫폼에서 돌리면 POSIX에서 합법적인
 * `back\slash`가 존재하지도 않는 `back/slash`가 되어, 절대 발동하지 않는 매핑이 생기고
 * `status`는 "경로가 사라졌다"고 엉뚱하게 설명한다.
 */
test("toAbsolutePath keeps a backslash that is part of a POSIX directory name", {
  skip: process.platform === "win32",
}, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-bs-")));
  const weird = path.join(base, "back\\slash");
  fs.mkdirSync(weird);

  const resolved = toAbsolutePath(weird);
  assert.equal(resolved, weird);
  assert.ok(fs.existsSync(resolved), `${resolved} should exist`);
});

/**
 * `map`의 "Enter a path…"는 trim한 값으로 검증하고 raw 값을 저장했다. 후행 공백 하나로
 * 절대 발동하지 않는 매핑이 만들어졌다.
 */
test("toAbsolutePath trims the input it was handed", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-trim-")));
  assert.equal(toAbsolutePath(`${base} `), base);
  assert.equal(toAbsolutePath(` ${base}`), base);
  assert.equal(toAbsolutePath(`\t${base}\n`), base);
});

/**
 * macOS의 realpath는 심볼릭 링크만 풀고 대소문자는 사용자가 친 그대로 남긴다. 그러면
 * git이 받는 `gitdir/i:` 패턴이 디스크 철자와 어긋나고, wildmatch는 ASCII만 접으므로
 * 비ASCII가 섞이면 매핑이 아예 발동하지 않는다. 저장 시점에 철자를 맞춘다.
 */
test("toAbsolutePath adopts the on-disk spelling on case-insensitive filesystems", {
  skip: !isCaseInsensitive(),
}, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-case-")));
  const real = path.join(base, "MixedCase");
  fs.mkdirSync(real);

  const typed = path.join(base, "mixedcase");
  if (!fs.existsSync(typed)) return; // 실제로는 대소문자를 가리는 파일시스템이었다
  assert.equal(toAbsolutePath(typed), real);
});
