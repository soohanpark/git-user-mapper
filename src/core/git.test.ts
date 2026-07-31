import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GitError, git, gitOrNull, gitVersion, supportsIncludeIf } from "./git.ts";

const tempConfig = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-git-"));
  return path.join(dir, "config");
};

test("git returns trimmed stdout", async () => {
  const out = await git(["--version"]);
  assert.match(out, /^git version /);
});

test("git passes values as argv so shell metacharacters stay literal", async () => {
  const cfg = tempConfig();
  // 테스트 전용 임시 디렉토리 안을 노린다. 고정된 /tmp 경로를 쓰면 이전 실행이 남긴
  // 파일 때문에 멀쩡한 코드가 빨개진다(거짓 통과는 불가능하지만 거짓 실패는 가능하다).
  const pwned = path.join(path.dirname(cfg), "pwned");
  const hostile = `Soo han; touch ${pwned} $(id) \`id\` && ls`;
  await git(["config", "--file", cfg, "user.name", hostile]);
  assert.equal(await git(["config", "--file", cfg, "user.name"]), hostile);
  assert.equal(fs.existsSync(pwned), false);
});

test("git refuses an empty argument instead of silently degrading to a read", async () => {
  const cfg = tempConfig();
  await git(["config", "--file", cfg, "user.name", "before"]);
  await assert.rejects(
    () => git(["config", "--file", cfg, "user.name", ""]),
    (error: unknown) => error instanceof GitError && /empty/.test((error as GitError).message),
  );
  assert.equal(await git(["config", "--file", cfg, "user.name"]), "before");
});

test("git throws GitError carrying the exit code", async () => {
  const cfg = tempConfig();
  await assert.rejects(
    () => git(["config", "--file", cfg, "--get", "nope.missing"]),
    (error: unknown) => error instanceof GitError && (error as GitError).exitCode === 1,
  );
});

test("gitOrNull turns a non-zero git exit into null", async () => {
  const cfg = tempConfig();
  assert.equal(await gitOrNull(["config", "--file", cfg, "--get", "nope.missing"]), null);
});

test("gitOrNull rethrows when git never ran, so 'unset' stays distinct from 'broken'", async () => {
  const cfg = tempConfig();
  await assert.rejects(
    () => gitOrNull(["config", "--file", cfg, "user.name", ""]),
    (error: unknown) => error instanceof GitError && error.exitCode === undefined,
  );
});

test("gitVersion parses major and minor", async () => {
  const version = await gitVersion();
  assert.ok(version.major >= 2, `unexpected major ${version.major}`);
  assert.equal(typeof version.minor, "number");
});

test("supportsIncludeIf requires git 2.13", () => {
  assert.equal(supportsIncludeIf({ major: 2, minor: 13 }), true);
  assert.equal(supportsIncludeIf({ major: 2, minor: 12 }), false);
  assert.equal(supportsIncludeIf({ major: 3, minor: 0 }), true);
});

/**
 * 어떤 종료 코드가 "정상"인지는 하위 명령마다 다르다(git 2.50 실측):
 * `--get` 1, `--unset` 5, `--remove-section` 128, `--list` 0.
 * 전부 뭉뚱그리면 "설정이 없음"과 "설정 파일이 깨짐"을 구분할 수 없고,
 * [1,5]로만 좁히면 `--remove-section`이 정상 경로에서 던진다.
 */
test("gitOrNull only swallows the exit codes the caller declared", async () => {
  const file = tempConfig();

  // --get: 키 없음은 1
  assert.equal(await gitOrNull(["config", "--file", file, "--get", "user.nope"], {}, [1]), null);
  // 같은 호출도 1을 허용하지 않으면 던진다
  await assert.rejects(() => gitOrNull(["config", "--file", file, "--get", "user.nope"], {}, [5]));

  // --remove-section: 없는 섹션은 128이지 5가 아니다
  await assert.rejects(
    () => gitOrNull(["config", "--file", file, "--remove-section", "nope"], {}, [1, 5]),
    "a [1,5] allowlist would break removeIncludeIf",
  );
  assert.equal(
    await gitOrNull(["config", "--file", file, "--remove-section", "nope"], {}, [128]),
    null,
  );
});

test("gitOrNull surfaces a broken config file instead of reporting 'not set'", async () => {
  const file = tempConfig();
  fs.writeFileSync(file, "[user\n\tname = broken\n");

  await assert.rejects(
    () => gitOrNull(["config", "--file", file, "--get", "user.name"], {}, [1]),
    /GitError|fatal/,
  );
});

test("gitOrNull rethrows when git itself could not run", async () => {
  await assert.rejects(
    () => gitOrNull(["--version"], { env: { PATH: "/nonexistent" } }, [1, 5, 128]),
    "a missing git binary must not look like 'not configured'",
  );
});
