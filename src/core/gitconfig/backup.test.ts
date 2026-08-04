import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { backupFile } from "./backup.ts";

const setup = (): { source: string; dir: string } => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gum-backup-"));
  const source = path.join(base, ".gitconfig");
  fs.writeFileSync(source, "[user]\n\temail = a@b.com\n");
  return { source, dir: path.join(base, "backups") };
};

test("backupFile copies the source and returns the backup path", () => {
  const { source, dir } = setup();
  const created = backupFile({ source, dir, now: "2026-07-31T00-00-00" });
  assert.equal(created, path.join(dir, "gitconfig.2026-07-31T00-00-00.bak"));
  assert.equal(fs.readFileSync(created as string, "utf8"), fs.readFileSync(source, "utf8"));
});

test("backupFile locks down permissions because the source may hold credentials", () => {
  const { source, dir } = setup();
  const created = backupFile({ source, dir, now: "2026-07-31T00-00-00" }) as string;
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(created).mode & 0o777, 0o600);
});

test("backupFile returns null when the source does not exist", () => {
  const { dir } = setup();
  assert.equal(backupFile({ source: "/definitely/missing", dir, now: "x" }), null);
});

test("backupFile keeps the newest N and never drops the pre-tool snapshot", () => {
  const { source, dir } = setup();
  for (const stamp of ["01", "02", "03", "04"]) {
    // 내용이 매번 달라야 한다. 같은 내용이면 새 백업을 만들지 않는 게 정상 동작이다.
    fs.writeFileSync(source, `[user]\n\temail = ${stamp}@b.com\n`);
    backupFile({ source, dir, now: stamp, keep: 2 });
  }
  // 01은 이 도구가 손대기 **전**의 유일한 스냅샷이다. 되돌릴 곳이 거기뿐이라 밀어내지 않는다.
  assert.deepEqual(fs.readdirSync(dir).toSorted(), [
    "gitconfig.01.bak",
    "gitconfig.03.bak",
    "gitconfig.04.bak",
  ]);
});

test("backupFile keeps the pre-tool snapshot readable as it was", () => {
  const { source, dir } = setup();
  const pristine = fs.readFileSync(source, "utf8");

  // 첫 sync가 뜨는 백업이 도구가 손대기 전의 파일이다. 되돌릴 곳은 여기뿐이다.
  backupFile({ source, dir, now: "00", keep: 1 });

  for (const stamp of ["01", "02", "03", "04", "05"]) {
    fs.writeFileSync(source, `[user]\n\temail = ${stamp}@b.com\n`);
    backupFile({ source, dir, now: stamp, keep: 1 });
  }

  assert.equal(fs.readFileSync(path.join(dir, "gitconfig.00.bak"), "utf8"), pristine);
});

/**
 * 아무것도 바꾸지 않는 sync를 열 번 돌리는 것만으로 정작 되돌아갈 만한 스냅샷이
 * 밀려나면 백업이 백업 구실을 못 한다.
 */
test("backupFile does not create a new backup when the content is unchanged", () => {
  const { source, dir } = setup();
  const first = backupFile({ source, dir, now: "01" }) as string;
  const again = backupFile({ source, dir, now: "02" });

  assert.equal(again, first);
  assert.deepEqual(fs.readdirSync(dir), ["gitconfig.01.bak"]);
});

test("backupFile makes a new backup once the content actually changes", () => {
  const { source, dir } = setup();
  backupFile({ source, dir, now: "01" });
  fs.writeFileSync(source, "[user]\n\temail = changed@b.com\n");
  backupFile({ source, dir, now: "02" });

  assert.deepEqual(fs.readdirSync(dir).toSorted(), ["gitconfig.01.bak", "gitconfig.02.bak"]);
  assert.equal(
    fs.readFileSync(path.join(dir, "gitconfig.01.bak"), "utf8"),
    "[user]\n\temail = a@b.com\n",
  );
});

test("backupFile is a no-op when a backup with the same stamp exists", () => {
  const { source, dir } = setup();
  backupFile({ source, dir, now: "same" });
  fs.writeFileSync(source, "changed\n");
  backupFile({ source, dir, now: "same" });
  assert.equal(
    fs.readFileSync(path.join(dir, "gitconfig.same.bak"), "utf8"),
    "[user]\n\temail = a@b.com\n",
  );
});
