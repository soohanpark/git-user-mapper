import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { GitOptions } from "../git.ts";
import {
  getGlobalUser,
  getIncludeIf,
  globalKeysInOrder,
  hasUserAfterIncludeIf,
  removeIncludeIf,
  setGlobalUser,
  setIncludeIf,
} from "./globalConfig.ts";

const scope = (): { options: GitOptions; file: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-global-"));
  const file = path.join(dir, ".gitconfig");
  fs.writeFileSync(file, "");
  return { options: { env: { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: "1" } }, file };
};

test("includeIf entries round-trip", async () => {
  const { options } = scope();
  await setIncludeIf("gitdir:/home/me/dev/", "/cfg/work.gitconfig", options);
  assert.equal(await getIncludeIf("gitdir:/home/me/dev/", options), "/cfg/work.gitconfig");
});

test("a directory containing dots still parses as one subsection", async () => {
  const { options } = scope();
  const condition = "gitdir/i:/home/me/dev/my.project/";
  await setIncludeIf(condition, "/cfg/x.gitconfig", options);
  assert.equal(await getIncludeIf(condition, options), "/cfg/x.gitconfig");
});

test("removeIncludeIf deletes the section and is safe to repeat", async () => {
  const { options } = scope();
  await setIncludeIf("gitdir:/home/me/dev/", "/cfg/work.gitconfig", options);
  await removeIncludeIf("gitdir:/home/me/dev/", options);
  assert.equal(await getIncludeIf("gitdir:/home/me/dev/", options), null);
  await removeIncludeIf("gitdir:/home/me/dev/", options);
});

test("setGlobalUser writes name and email", async () => {
  const { options } = scope();
  await setGlobalUser({ name: "soohanpark", email: "a@b.com", signingKey: null }, options);
  assert.deepEqual(await getGlobalUser(options), { name: "soohanpark", email: "a@b.com" });
});

test("setGlobalUser unsets signingKey when the profile has none", async () => {
  const { options } = scope();
  await setGlobalUser({ name: "n", email: "a@b.com", signingKey: "KEY1" }, options);
  await setGlobalUser({ name: "n", email: "a@b.com", signingKey: null }, options);
  const keys = await globalKeysInOrder(options);
  assert.equal(keys.includes("user.signingkey"), false);
});

test("getGlobalUser returns nulls for an empty config", async () => {
  const { options } = scope();
  assert.deepEqual(await getGlobalUser(options), { name: null, email: null });
});

test("hasUserAfterIncludeIf spots a [user] that would beat the mappings", async () => {
  const { options, file } = scope();

  fs.writeFileSync(
    file,
    ['[includeIf "gitdir:/tmp/x/"]', "\tpath = /tmp/p", "[user]", "\temail = late@x.com", ""].join(
      "\n",
    ),
  );
  assert.equal(hasUserAfterIncludeIf(await globalKeysInOrder(options)), true);

  fs.writeFileSync(
    file,
    ["[user]", "\temail = early@x.com", '[includeIf "gitdir:/tmp/x/"]', "\tpath = /tmp/p", ""].join(
      "\n",
    ),
  );
  assert.equal(hasUserAfterIncludeIf(await globalKeysInOrder(options)), false);
});
