import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import type { Profile, ProfileId } from "../../types.ts";
import {
  profileFilePath,
  pruneProfileFiles,
  renderProfile,
  writeProfileFile,
} from "./profileFiles.ts";

const id = (value: string): ProfileId => value as ProfileId;

const profile: Profile = {
  id: id("personal"),
  name: "soohanpark",
  email: "725psh@gmail.com",
  signingKey: null,
  color: "magenta",
  paths: [],
};

test("profileFilePath is derived from the profile id", () => {
  assert.equal(profileFilePath(id("work"), "/cfg/profiles"), "/cfg/profiles/work.gitconfig");
});

test("git can read the rendered profile file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-"));
  const file = writeProfileFile(profile, dir);
  const email = await execa("git", ["config", "--file", file, "user.email"]);
  const name = await execa("git", ["config", "--file", file, "user.name"]);
  assert.equal(email.stdout.trim(), "725psh@gmail.com");
  assert.equal(name.stdout.trim(), "soohanpark");
});

test("the rendered file omits signingKey when there is none and includes it when there is", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-key-"));
  assert.equal(renderProfile(profile).includes("signingKey"), false);

  const signed = writeProfileFile({ ...profile, id: id("signed"), signingKey: "ABCD 1234" }, dir);
  const key = await execa("git", ["config", "--file", signed, "user.signingKey"]);
  assert.equal(key.stdout.trim(), "ABCD 1234");
});

test("the rendered file warns that it is generated", () => {
  assert.match(renderProfile(profile), /^# Managed by git-user-mapper/);
});

test("pruneProfileFiles deletes files for profiles that no longer exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prune-"));
  writeProfileFile(profile, dir);
  writeProfileFile({ ...profile, id: id("gone") }, dir);
  fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep me");

  const removed = pruneProfileFiles([id("personal")], dir);

  assert.deepEqual(removed, [path.join(dir, "gone.gitconfig")]);
  assert.equal(fs.existsSync(path.join(dir, "personal.gitconfig")), true);
  assert.equal(fs.existsSync(path.join(dir, "unrelated.txt")), true);
});
