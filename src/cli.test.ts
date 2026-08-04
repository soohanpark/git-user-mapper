import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const entry = fileURLToPath(new URL("../bin/index.ts", import.meta.url));

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** 실제 홈을 건드리지 않도록 임시 HOME과 전역 설정으로 격리해서 부른다. */
const runCli = async (args: readonly string[]): Promise<Run> => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-cli-")));
  const globalConfig = path.join(home, ".gitconfig");
  fs.writeFileSync(globalConfig, "[user]\n\temail = home@example.com\n");

  const result = await execa("node", [entry, ...args], {
    env: {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: "1",
    },
    cwd: home,
    reject: false,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0,
  };
};

test("--version reports the version from package.json", async () => {
  const pkg = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { readonly version: string };

  const result = await runCli(["--version"]);
  assert.equal(result.stdout.trim(), pkg.version);
});

test("a mistyped subcommand is named and a correction suggested", async () => {
  const result = await runCli(["stauts"]);
  assert.match(result.stderr, /unknown command 'stauts'/);
  assert.match(result.stderr, /status/);
  assert.notEqual(result.exitCode, 0);
});

test("--help lists every command", async () => {
  const result = await runCli(["--help"]);
  for (const command of ["map", "status", "list", "add", "remove", "unmap", "default", "sync"]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`), `--help omits ${command}`);
  }
});

test("status outside a repository says so instead of failing", async () => {
  const result = await runCli(["status"]);
  assert.match(result.stdout, /Not inside a git repository/);
});

/**
 * 최상위 catch가 없으면 여기서 node 내부 프레임이 줄줄이 붙는다. 사용자에게 보여 주려고
 * 쓴 문장이 스택 트레이스에 묻히면 쓸모가 없다. `map`은 매핑되지 않은 곳에서도 대화형
 * 프롬프트를 띄우므로, 비대화형 stdin에서 inquirer가 던지는 오류로 이 경로를 탄다.
 */
test("a user-facing error prints a message, not a stack trace", async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-cli-bad-")));
  fs.writeFileSync(path.join(home, ".gitconfig"), "");

  const result = await execa("node", [entry, "map"], {
    env: {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
    cwd: home,
    stdin: "ignore",
    reject: false,
  });

  const stderr = result.stderr ?? "";
  assert.doesNotMatch(stderr, /\n\s+at .*\n\s+at /, `a stack trace leaked: ${stderr}`);
  assert.notEqual(result.exitCode, 0);
});

test("an unsupported shell is reported plainly", async () => {
  const result = await runCli(["shell-init", "tcsh"]);
  assert.match(result.stderr, /Unsupported shell tcsh/);
  assert.match(result.stderr, /zsh, bash/);
  assert.equal(result.exitCode, 1);
});

test("shell-init emits a snippet for every supported shell", async () => {
  for (const shell of ["zsh", "bash"]) {
    const result = await runCli(["shell-init", shell]);
    assert.equal(result.exitCode, 0, `shell-init ${shell} failed`);
    assert.match(result.stdout, /_git_mapper_resolve/, `shell-init ${shell} produced nothing`);
  }
});

/**
 * 첨자 접근은 프로토타입 체인을 탄다. `shell-init toString`은 함수를 찾아내 종료 코드 0으로
 * `[object Undefined]`를 출력했고, rc 파일의 `eval "$(git-mapper shell-init …)"`에 그대로
 * 흘러들어갔다. 나머지 셋은 같은 이유로 엉뚱한 내부 오류 메시지를 냈다.
 */
test("an inherited Object property is not mistaken for a shell", async () => {
  for (const key of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
    const result = await runCli(["shell-init", key]);
    assert.equal(result.exitCode, 1, `shell-init ${key} exited ${result.exitCode}`);
    assert.match(result.stderr, /Unsupported shell/, `shell-init ${key} said: ${result.stderr}`);
    assert.equal(result.stdout, "", `shell-init ${key} wrote to stdout: ${result.stdout}`);
  }
});

/**
 * stdin이 EOF인 스트림이면 inquirer의 프라미스가 끝내 결정되지 않는다. 이벤트 루프가 비면
 * signal-exit이 정리 단계에서 `ExitPromptError`를 던지고, 프로세스는 사용자가 Ctrl-C를
 * 누른 것과 같은 **130**으로 끝나면서 `Detected unsettled top-level await` 경고를 남겼다.
 * `stdin: "ignore"`(fd가 닫힌 경우)는 다른 경로라 이 상황을 덮지 못했다.
 */
test("an interactive command without a terminal fails with a sentence, not exit 130", async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-cli-tty-")));
  fs.writeFileSync(path.join(home, ".gitconfig"), "");

  for (const command of ["add", "map", "reset"]) {
    const result = await execa("node", [entry, command], {
      env: {
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
      },
      cwd: home,
      input: "",
      reject: false,
    });

    const stderr = result.stderr ?? "";
    assert.equal(result.exitCode, 1, `${command} exited ${result.exitCode}: ${stderr}`);
    assert.match(stderr, /interactive terminal/, `${command} said: ${stderr}`);
    assert.doesNotMatch(stderr, /unsettled top-level await/, `${command} leaked: ${stderr}`);
  }
});
