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

test("backupFile keeps only the newest N backups", () => {
  const { source, dir } = setup();
  for (const stamp of ["01", "02", "03", "04"]) {
    backupFile({ source, dir, now: stamp, keep: 2 });
  }
  assert.deepEqual(fs.readdirSync(dir).toSorted(), ["gitconfig.03.bak", "gitconfig.04.bak"]);
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
