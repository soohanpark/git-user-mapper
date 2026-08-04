import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_FILE = "sync.lock";
/** 이보다 오래된 잠금은 죽은 프로세스가 남긴 것으로 본다. */
const STALE_MS = 60_000;
const TIMEOUT_MS = 10_000;
const RETRY_MS = 50;

const staleAgeMs = (lockPath: string): number => {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    // 그 사이에 사라졌으면 다시 잡아 보면 된다.
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * 스토어 읽기 → sync → 쓰기를 한 덩어리로 묶는다.
 *
 * 이게 없으면 두 번의 실행이 겹칠 때 각자 읽은 `managedConditions`만 기록하고, 진 쪽의
 * `includeIf`는 어느 스토어의 목록에도 없는 채 `~/.gitconfig`에 남는다. 목록에 없는 항목은
 * 이후 어떤 sync도 지우지 않으므로 영구히 남는다 — 불변조건 8이 막으려는 상태에
 * 중간 실패가 아니라 갱신 유실로 도달하는 경로다. `map`은 스토어를 읽고 대화형 질문을
 * 세 번 던진 뒤에 sync하므로 그 창이 사람 단위로 넓었다.
 *
 * 잠금은 대화형 질문 **바깥**에서만 잡는다. 질문을 감싸면 사용자가 자리를 뜬 동안
 * 다른 실행이 10초를 기다리다 실패한다.
 */
export const withStoreLock = async <T>(configDir: string, run: () => Promise<T>): Promise<T> => {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(configDir, LOCK_FILE);
  const deadline = Date.now() + TIMEOUT_MS;

  for (;;) {
    try {
      // `wx`는 이미 있으면 EEXIST로 실패한다. 검사와 생성이 한 번의 syscall이라
      // 그 사이에 다른 프로세스가 끼어들 틈이 없다.
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (staleAgeMs(lockPath) > STALE_MS) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Another git-mapper is already writing (${lockPath}). ` +
            "Wait for it to finish, or delete that file if no git-mapper is running.",
        );
      }
      await sleep(RETRY_MS);
    }
  }

  try {
    return await run();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
};
