import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProfileId, StoreV2 } from "../types.ts";
import { emptyStore, legacyStorePath, migrateV1, openStore, parseStore } from "./store.ts";

const id = (value: string): ProfileId => value as ProfileId;

test("parseStore accepts an empty or missing store", () => {
  assert.deepEqual(parseStore(undefined), emptyStore());
  assert.deepEqual(parseStore({}), emptyStore());
  assert.deepEqual(parseStore({ users: [] }), emptyStore());
});

test("parseStore round-trips a valid v2 store", () => {
  const store = {
    version: 2,
    defaultProfile: "work",
    profiles: [
      {
        id: "work",
        name: "soohanpark",
        email: "soohan.park@nexpace.io",
        signingKey: null,
        color: "blue",
        paths: ["/Users/me/dev/msu"],
      },
    ],
    managedConditions: ["gitdir/i:/Users/me/dev/msu/"],
  };
  assert.deepEqual(parseStore(store), store);
});

test("migrateV1 derives ids from emails and keeps signing keys", () => {
  const result = migrateV1({
    users: [
      { name: "soohanpark", email: "soohan.park@nexpace.io" },
      { name: "soohanpark", email: "725psh@gmail.com", signingKey: "ABCD1234" },
    ],
  });
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    ["soohan-park", "725psh"],
  );
  assert.equal(result.profiles[0]?.signingKey, null);
  assert.equal(result.profiles[1]?.signingKey, "ABCD1234");
  assert.deepEqual(result.profiles[0]?.paths, []);
  assert.deepEqual(result.managedConditions, []);
  assert.equal(result.version, 2);
});

test("migrateV1 picks the default from the current global email", () => {
  const v1 = {
    users: [
      { name: "a", email: "a@example.com" },
      { name: "b", email: "b@example.com" },
    ],
  };
  assert.equal(migrateV1(v1, { currentGlobalEmail: "b@example.com" }).defaultProfile, "b");
  assert.equal(migrateV1(v1).defaultProfile, "a");
  assert.equal(migrateV1({ users: [] }).defaultProfile, null);
});

test("migrateV1 resolves id collisions", () => {
  const result = migrateV1({
    users: [
      { name: "a", email: "same@one.com" },
      { name: "b", email: "same@two.com" },
    ],
  });
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    ["same", "same-2"],
  );
});

test("migrateV1 honours an explicit naming function", () => {
  const result = migrateV1(
    { users: [{ name: "a", email: "a@example.com" }] },
    { nameFor: () => "work" },
  );
  assert.equal(result.profiles[0]?.id, "work");
});

test("parseStore reports corruption instead of writing garbage to git", () => {
  assert.throws(() => parseStore({ version: 2, profiles: "nope" }), /store is corrupted/);
});

test("openStore migrates a v1 file on disk and backs it up first", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gum-store-"));
  const handle = openStore({ cwd, now: "2026-07-31T00-00-00" });
  fs.writeFileSync(
    handle.path,
    JSON.stringify({ users: [{ name: "soohanpark", email: "soohan.park@nexpace.io" }] }),
  );

  const migrated = openStore({ cwd, now: "2026-07-31T00-00-00" }).read();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.profiles[0]?.id, "soohan-park");

  const backup = path.join(path.dirname(handle.path), "store.v1.2026-07-31T00-00-00.bak");
  assert.equal(fs.existsSync(backup), true);

  // 마이그레이션은 디스크에 확정되어야 한다. 그래야 id가 유지되고 백업이 쌓이지 않는다.
  assert.equal(JSON.parse(fs.readFileSync(handle.path, "utf8")).version, 2);
});

test("legacyStorePath points at the pre-rename sibling directory", () => {
  assert.equal(
    legacyStorePath("/home/me/.config/git-user-mapper-nodejs/config.json"),
    "/home/me/.config/git-user-switch-nodejs/config.json",
  );
});

test("openStore imports the pre-rename store and leaves the original alone", () => {
  // conf는 패키지 이름으로 저장 위치를 정하므로, 포크하며 이름을 바꾼 순간
  // 기존 사용자의 데이터가 형제 디렉토리에 고립된다.
  const prefs = fs.mkdtempSync(path.join(os.tmpdir(), "gum-legacy-"));
  const legacyDir = path.join(prefs, "git-user-switch-nodejs");
  const currentDir = path.join(prefs, "git-user-mapper-nodejs");
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyFile = path.join(legacyDir, "config.json");
  const legacyContent = JSON.stringify({
    users: [{ name: "soohanpark", email: "soohan.park@nexpace.io" }],
  });
  fs.writeFileSync(legacyFile, legacyContent);

  const imported = openStore({ cwd: currentDir }).read();

  assert.equal(imported.version, 2);
  assert.equal(imported.profiles[0]?.id, "soohan-park");
  assert.equal(fs.readFileSync(legacyFile, "utf8"), legacyContent);
});

test("openStore does not import over a store that already has content", () => {
  const prefs = fs.mkdtempSync(path.join(os.tmpdir(), "gum-legacy-skip-"));
  const legacyDir = path.join(prefs, "git-user-switch-nodejs");
  const currentDir = path.join(prefs, "git-user-mapper-nodejs");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, "config.json"),
    JSON.stringify({ users: [{ name: "old", email: "old@x.com" }] }),
  );

  const mine: StoreV2 = {
    version: 2,
    defaultProfile: id("mine"),
    profiles: [
      { id: id("mine"), name: "n", email: "mine@x.com", signingKey: null, color: "blue", paths: [] },
    ],
    managedConditions: [],
  };
  openStore({ cwd: currentDir }).write(mine);

  assert.deepEqual(openStore({ cwd: currentDir }).read(), mine);
});

test("openStore persists what it writes", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gum-store-rw-"));
  const next: StoreV2 = {
    version: 2,
    defaultProfile: id("work"),
    profiles: [
      { id: id("work"), name: "n", email: "e@x.com", signingKey: null, color: "blue", paths: [] },
    ],
    managedConditions: [],
  };
  openStore({ cwd }).write(next);
  assert.deepEqual(openStore({ cwd }).read(), next);
});
