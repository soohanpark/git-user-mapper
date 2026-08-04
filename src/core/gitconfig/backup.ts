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

const listBackups = (dir: string): readonly string[] =>
  fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .toSorted();

/**
 * `~/.gitconfig`에는 자격증명이 평문으로 들어 있을 수 있다.
 * 디렉토리 0700, 파일 0600으로 강제한다(umask에 맡기지 않는다).
 *
 * 내용이 직전 백업과 같으면 새로 만들지 않는다. 아무것도 바꾸지 않는 sync를 몇 번
 * 돌리는 것만으로 정작 되돌아갈 만한 예전 스냅샷이 밀려나기 때문이다.
 */
export const backupFile = (options: BackupOptions): string | null => {
  if (!fs.existsSync(options.source)) return null;

  fs.mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(options.dir, 0o700);

  const content = fs.readFileSync(options.source);
  const existing = listBackups(options.dir);
  const latest = existing.at(-1);
  if (latest !== undefined) {
    const latestPath = path.join(options.dir, latest);
    if (fs.readFileSync(latestPath).equals(content)) return latestPath;
  }

  const target = path.join(options.dir, `${PREFIX}${options.now}${SUFFIX}`);
  if (!fs.existsSync(target)) {
    // mode를 open(2)에 실어 만든다. 만든 뒤 chmod하면 그 사이에 0644인 순간이 생긴다.
    fs.writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  }

  // 가장 오래된 하나는 절대 지우지 않는다. 그게 이 도구가 손대기 **전**의 유일한
  // 스냅샷이고, 불변조건 3이 지키려는 것도 결국 그 파일이다. 오래된 것부터 밀어내는
  // 규칙만 두면 평범한 첫 주 사용(add·map·unmap 열 번)으로 원본이 사라진다.
  const keep = options.keep ?? DEFAULT_KEEP;
  const backups = listBackups(options.dir);
  const pristine = backups[0];
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    if (stale === pristine) continue;
    fs.rmSync(path.join(options.dir, stale), { force: true });
  }

  return target;
};
