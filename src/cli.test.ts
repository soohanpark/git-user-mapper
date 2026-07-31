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
  assert.match(result.stderr, /zsh, bash, fish/);
  assert.equal(result.exitCode, 1);
});

test("shell-init emits a snippet for every supported shell", async () => {
  for (const shell of ["zsh", "bash", "fish"]) {
    const result = await runCli(["shell-init", shell]);
    assert.equal(result.exitCode, 0, `shell-init ${shell} failed`);
    assert.match(result.stdout, /_git_mapper_resolve/, `shell-init ${shell} produced nothing`);
  }
});
