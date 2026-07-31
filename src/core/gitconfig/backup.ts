import fs from "node:fs";
import path from "node:path";

export interface BackupOptions {
  readonly source: string;
  readonly dir: string;
  readonly now: string;
  readonly keep?: number;
}

const PREFIX = "gitconfig.";
const SUFFIX = ".bak";
const DEFAULT_KEEP = 10;

/**
 * `~/.gitconfig`에는 자격증명이 평문으로 들어 있을 수 있다.
 * 디렉토리 0700, 파일 0600으로 강제한다(umask에 맡기지 않는다).
 */
export const backupFile = (options: BackupOptions): string | null => {
  if (!fs.existsSync(options.source)) return null;

  fs.mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(options.dir, 0o700);

  const target = path.join(options.dir, `${PREFIX}${options.now}${SUFFIX}`);
  if (!fs.existsSync(target)) {
    fs.copyFileSync(options.source, target);
    fs.chmodSync(target, 0o600);
  }

  const keep = options.keep ?? DEFAULT_KEEP;
  const backups = fs
    .readdirSync(options.dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .toSorted();
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    fs.rmSync(path.join(options.dir, stale), { force: true });
  }

  return target;
};
