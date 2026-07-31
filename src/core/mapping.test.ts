import assert from "node:assert/strict";
import { test } from "node:test";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { buildTable, conditionFor, resolve, serializeTable } from "./mapping.ts";

const p = (value: string): AbsolutePath => value as AbsolutePath;
const id = (value: string): ProfileId => value as ProfileId;

const store: StoreV2 = {
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    {
      id: id("work"),
      name: "n",
      email: "work@x.com",
      signingKey: null,
      color: "blue",
      paths: [p("/home/me/dev")],
    },
    {
      id: id("personal"),
      name: "n",
      email: "me@x.com",
      signingKey: null,
      color: "magenta",
      paths: [p("/home/me/dev/personal"), p("/home/me/oss")],
    },
  ],
  managedConditions: [],
};

test("conditionFor is case-insensitive on darwin and windows only", () => {
  assert.equal(conditionFor(p("/home/me/dev"), true), "gitdir/i:/home/me/dev/");
  assert.equal(conditionFor(p("/home/me/dev"), false), "gitdir:/home/me/dev/");
});

test("buildTable sorts entries longest-first and extracts the fallback", () => {
  const table = buildTable(store);
  // /home/me/oss 와 /home/me/dev 는 길이가 같으므로 localeCompare 오름차순이 순서를
  // 정한다. 동률의 상대 순서는 해석 결과를 바꾸지 않지만(같은 길이의 두 경로가 한
  // 대상에 동시에 매치되려면 서로 같아야 한다) 출력이 실행마다 흔들리면 안 된다.
  assert.deepEqual(
    table.entries.map((e) => e.path),
    ["/home/me/dev/personal", "/home/me/dev", "/home/me/oss"],
  );
  assert.equal(table.fallback?.profileId, "work");
  assert.equal(table.fallback?.email, "work@x.com");
});

test("buildTable has no fallback when defaultProfile is null", () => {
  assert.equal(buildTable({ ...store, defaultProfile: null }).fallback, null);
});

test("resolve returns the longest matching prefix", () => {
  const table = buildTable(store);
  assert.equal(resolve(table, p("/home/me/dev/personal/mar"), false).profileId, "personal");
  assert.equal(resolve(table, p("/home/me/dev/msu"), false).profileId, "work");
  assert.equal(resolve(table, p("/home/me/dev/personal"), false).profileId, "personal");
});

test("resolve does not match a sibling that merely shares a prefix string", () => {
  const table = buildTable(store);
  const result = resolve(table, p("/home/me/development"), false);
  assert.equal(result.state, "default");
  assert.equal(result.profileId, "work");
});

test("resolve falls back to the default profile and reports the state", () => {
  const table = buildTable(store);
  const result = resolve(table, p("/tmp/elsewhere"), false);
  assert.equal(result.state, "default");
  assert.equal(result.email, "work@x.com");

  const mapped = resolve(table, p("/home/me/oss/thing"), false);
  assert.equal(mapped.state, "mapped");
  assert.equal(mapped.color, "magenta");
});

test("resolve reports no-identity when nothing matches and there is no fallback", () => {
  const table = buildTable({ ...store, defaultProfile: null });
  const result = resolve(table, p("/tmp/elsewhere"), false);
  assert.equal(result.state, "no-identity");
  assert.equal(result.profileId, null);
});

test("resolve honours the case sensitivity flag", () => {
  const table = buildTable(store);
  assert.equal(resolve(table, p("/home/me/DEV/personal/x"), true).profileId, "personal");
  assert.equal(resolve(table, p("/home/me/DEV/personal/x"), false).state, "default");
});

/**
 * git은 `gitdir:`를 wildmatch로 읽는다. 이스케이프하지 않으면 `star*dir` 매핑이 남남인
 * `starOTHERdir`까지 먹고, `proj [old]`는 아무것도 매치하지 않는다. 어느 쪽이든 아래
 * `resolve`의 리터럴 비교와 답이 갈린다. 실제 git과의 동치는 parity.test.ts가 확인한다.
 */
test("conditionFor escapes wildmatch metacharacters so patterns stay literal", () => {
  assert.equal(conditionFor(p("/home/me/star*dir"), false), "gitdir:/home/me/star\\*dir/");
  assert.equal(conditionFor(p("/home/me/q?dir"), false), "gitdir:/home/me/q\\?dir/");
  assert.equal(conditionFor(p("/home/me/proj [old]"), false), "gitdir:/home/me/proj \\[old\\]/");
  assert.equal(conditionFor(p("/home/me/plain"), false), "gitdir:/home/me/plain/");
});

test("serializeTable puts the fallback on a * line and sorts longest-first", () => {
  const lines = serializeTable(buildTable(store)).trimEnd().split("\n");
  assert.equal(lines[0], "*\twork\tblue\twork@x.com");
  assert.equal(lines[1], "/home/me/dev/personal\tpersonal\tmagenta\tme@x.com");
});

test("serializeTable refuses values containing a tab or newline", () => {
  const broken = buildTable({
    ...store,
    profiles: store.profiles.map((profile) => ({ ...profile, paths: [p("/home/me/we\tird")] })),
  });
  assert.throws(() => serializeTable(broken), /tab or newline/);
});
