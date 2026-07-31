import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import type { Profile, ProfileId } from "../../types.ts";
import { profileFilePath, pruneProfileFiles, writeProfileFile } from "./profileFiles.ts";

const id = (value: string): ProfileId => value as ProfileId;

const profile: Profile = {
  id: id("personal"),
  name: "soohanpark",
  email: "725psh@gmail.com",
  signingKey: null,
  color: "magenta",
  paths: [],
};

const readKey = async (file: string, key: string): Promise<string> =>
  (await execa("git", ["config", "--file", file, key])).stdout;

test("profileFilePath is derived from the profile id", () => {
  assert.equal(profileFilePath(id("work"), "/cfg/profiles"), "/cfg/profiles/work.gitconfig");
});

test("git can read the written profile file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-"));
  const file = await writeProfileFile(profile, dir);
  assert.equal(await readKey(file, "user.email"), "725psh@gmail.com");
  assert.equal(await readKey(file, "user.name"), "soohanpark");
});

test("the file omits signingKey when there is none and includes it when there is", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-key-"));
  const plain = await writeProfileFile(profile, dir);
  assert.equal(fs.readFileSync(plain, "utf8").includes("signingKey"), false);

  const signed = await writeProfileFile(
    { ...profile, id: id("signed"), signingKey: "ABCD 1234" },
    dir,
  );
  assert.equal(await readKey(signed, "user.signingKey"), "ABCD 1234");
});

test("the file warns that it is generated", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-header-"));
  const file = await writeProfileFile(profile, dir);
  assert.match(fs.readFileSync(file, "utf8"), /^# Managed by git-user-mapper/);
});

/**
 * 이 도구의 존재 이유가 "올바른 identity로 커밋한다"이므로, 값이 조금이라도 변형되면
 * 기능 자체가 무너진다. 문자열 보간으로 만들면 아래 값들이 전부 다르게 읽힌다.
 */
test("values that break hand-written config survive git's own escaping", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-hostile-"));
  const hostile = [
    'Soo"han Park',
    'Soo "Han" Park',
    "trailing backslash \\",
    "hash # and semicolon ; inside",
    "[section] looking value",
  ];

  for (const [index, name] of hostile.entries()) {
    const file = await writeProfileFile(
      { ...profile, id: id(`hostile-${index}`), name, signingKey: "KEY # not a comment" },
      dir,
    );
    assert.equal(await readKey(file, "user.name"), name, `name ${JSON.stringify(name)} changed`);
    assert.equal(await readKey(file, "user.signingKey"), "KEY # not a comment");
  }
});

test("a newline in a value cannot inject a config section", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-inject-"));
  const name = "Evil\n[core]\n\tsshCommand = /tmp/pwn.sh";
  const file = await writeProfileFile({ ...profile, id: id("evil"), name }, dir);

  assert.equal(await readKey(file, "user.name"), name);
  await assert.rejects(
    () => readKey(file, "core.sshCommand"),
    "a newline in user.name injected a [core] section",
  );
});

test("rewriting a profile drops a signingKey that was removed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-rewrite-"));
  await writeProfileFile({ ...profile, signingKey: "OLDKEY" }, dir);
  const file = await writeProfileFile(profile, dir);

  assert.equal(fs.readFileSync(file, "utf8").includes("OLDKEY"), false);
  assert.equal(await readKey(file, "user.email"), "725psh@gmail.com");
});

test("the profile file is written 0600 in a 0700 directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-mode-"));
  const nested = path.join(dir, "profiles");
  const file = await writeProfileFile(profile, nested);

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(nested).mode & 0o777, 0o700);
});

test("pruneProfileFiles deletes files for profiles that no longer exist", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prune-"));
  await writeProfileFile(profile, dir);
  await writeProfileFile({ ...profile, id: id("gone") }, dir);
  fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep me");

  const removed = pruneProfileFiles([id("personal")], dir);

  assert.deepEqual(removed, [path.join(dir, "gone.gitconfig")]);
  assert.equal(fs.existsSync(path.join(dir, "personal.gitconfig")), true);
  assert.equal(fs.existsSync(path.join(dir, "unrelated.txt")), true);
});
