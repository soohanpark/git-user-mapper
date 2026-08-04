import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { withStoreLock } from "./lock.ts";

const tempDir = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-lock-")));

test("withStoreLock returns the value and cleans the lock up", async () => {
  const dir = tempDir();
  const result = await withStoreLock(dir, async () => "done");

  assert.equal(result, "done");
  assert.equal(fs.existsSync(path.join(dir, "sync.lock")), false);
});

test("withStoreLock releases the lock even when the body throws", async () => {
  const dir = tempDir();
  await assert.rejects(
    withStoreLock(dir, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(fs.existsSync(path.join(dir, "sync.lock")), false);
});

test("withStoreLock creates the directory it locks in", async () => {
  const dir = path.join(tempDir(), "not", "there", "yet");
  await withStoreLock(dir, async () => undefined);
  assert.equal(fs.existsSync(dir), true);
});

/**
 * 잠금이 없으면 두 실행이 각자 읽은 `managedConditions`만 기록하고, 진 쪽의 includeIf는
 * 어느 목록에도 없는 채 사용자의 `~/.gitconfig`에 영구히 남는다. 여기서는 두 번째가
 * 첫 번째의 임계 구역 **안으로** 들어오지 않는다는 것만 확인한다.
 */
test("withStoreLock serialises overlapping runs", async () => {
  const dir = tempDir();
  const events: string[] = [];

  const run = (name: string) =>
    withStoreLock(dir, async () => {
      events.push(`${name}:enter`);
      await sleep(60);
      events.push(`${name}:leave`);
    });

  await Promise.all([run("a"), run("b")]);

  assert.equal(events.length, 4);
  // 겹쳤다면 enter가 연달아 나온다.
  assert.equal(events[1]?.endsWith(":leave"), true, events.join(" "));
  assert.equal(events[0]?.split(":")[0], events[1]?.split(":")[0], events.join(" "));
});

/** 죽은 프로세스가 남긴 잠금 때문에 도구를 영영 못 쓰게 되면 안 된다. */
test("withStoreLock breaks a lock left behind by a dead process", async () => {
  const dir = tempDir();
  const lockPath = path.join(dir, "sync.lock");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, "999999\n");

  // 만료 기준보다 확실히 오래된 것으로 만든다.
  const ancient = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lockPath, ancient, ancient);

  assert.equal(await withStoreLock(dir, async () => "recovered"), "recovered");
  assert.equal(fs.existsSync(lockPath), false);
});
