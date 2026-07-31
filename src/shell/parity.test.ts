import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import { toAbsolutePath } from "../core/paths.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId, StoreV2 } from "../types.ts";
import { bashSnippet } from "./bash.ts";
import { fishSnippet } from "./fish.ts";
import { type ShellInitOptions, zshSnippet } from "./zsh.ts";

const id = (value: string): ProfileId => value as ProfileId;

interface Shell {
  readonly name: string;
  readonly snippet: (options: ShellInitOptions) => string;
  /** 사용자 설정을 읽지 않고 스크립트를 실행하는 인자. */
  readonly argv: (script: string) => readonly string[];
  readonly print: (variable: string) => string;
}

const SHELLS: readonly Shell[] = [
  {
    name: "zsh",
    snippet: zshSnippet,
    argv: (script) => ["-f", "-c", script],
    print: (v) => `print -r -- "$${v}"`,
  },
  {
    name: "bash",
    snippet: bashSnippet,
    argv: (script) => ["--norc", "--noprofile", "-c", script],
    print: (v) => `printf '%s\\n' "$${v}"`,
  },
  {
    name: "fish",
    snippet: fishSnippet,
    argv: (script) => ["--no-config", "-c", script],
    print: (v) => `echo $${v}`,
  },
];

const isAvailable = async (name: string): Promise<boolean> => {
  try {
    await execa(name, name === "fish" ? ["--no-config", "-c", "true"] : ["-c", "exit 0"]);
    return true;
  } catch {
    return false;
  }
};

const available = new Map(
  await Promise.all(SHELLS.map(async (s) => [s.name, await isAvailable(s.name)] as const)),
);

interface Harness {
  readonly base: string;
  readonly env: NodeJS.ProcessEnv;
  readonly mappingFile: string;
  readonly emailOf: ReadonlyMap<string, string>;
}

const makeRepo = async (dir: string): Promise<string> => {
  fs.mkdirSync(dir, { recursive: true });
  await execa("git", ["init", "-q"], { cwd: dir });
  return dir;
};

const gitEmail = async (dir: string, env: NodeJS.ProcessEnv): Promise<string | null> => {
  try {
    return (await execa("git", ["config", "user.email"], { cwd: dir, env })).stdout.trim();
  } catch {
    return null;
  }
};

/** @param prefix mkdtemp 접두사. 홈 경로에 특수문자가 든 경우를 만들 때 쓴다. */
const setup = async (
  options: { readonly withDefault?: boolean; readonly prefix?: string } = {},
): Promise<Harness> => {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? "gum-parity-")),
  );
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  const configDir = path.join(base, "config");

  for (const dir of ["personal", "personal-old", "msu", "oss/deep", "star*dir", "starOTHERdir"]) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
  }

  const store: StoreV2 = {
    version: 2,
    defaultProfile: options.withDefault === false ? null : id("work"),
    profiles: [
      {
        id: id("work"),
        name: "n",
        email: "work@nexpace.io",
        signingKey: null,
        color: "blue",
        paths: [],
      },
      {
        id: id("personal"),
        name: "n",
        email: "me@gmail.com",
        signingKey: null,
        color: "magenta",
        paths: [toAbsolutePath(path.join(base, "personal"))],
      },
      {
        id: id("oss"),
        name: "n",
        email: "oss@example.com",
        signingKey: null,
        color: "green",
        paths: [toAbsolutePath(path.join(base, "oss", "deep"))],
      },
      {
        id: id("starred"),
        name: "n",
        email: "star@example.com",
        signingKey: null,
        color: "cyan",
        paths: [toAbsolutePath(path.join(base, "star*dir"))],
      },
    ],
    managedConditions: [],
  };

  await applySync(store, {
    configDir,
    globalConfigPath,
    now: "t0",
    caseInsensitive: false,
    git: { env },
  });

  return {
    base,
    env,
    mappingFile: path.join(configDir, "mapping.tsv"),
    emailOf: new Map(store.profiles.map((profile) => [profile.id as string, profile.email])),
  };
};

const resolveIn = async (
  shell: Shell,
  mappingFile: string,
  dir: string,
): Promise<{ readonly profile: string; readonly state: string }> => {
  const script = [
    shell.snippet({ mappingFile, caseInsensitive: false }),
    `cd ${JSON.stringify(dir)}`,
    "_git_mapper_resolve",
    shell.print("GIT_MAPPER_PROFILE"),
    shell.print("GIT_MAPPER_STATE"),
  ].join("\n");
  const result = await execa(shell.name, shell.argv(script));
  const lines = result.stdout.split("\n");
  return { profile: lines[0] ?? "", state: lines[1] ?? "" };
};

for (const shell of SHELLS) {
  const skip = !available.get(shell.name);

  test(`${shell.name}: the matcher and git agree on every fixture`, { skip }, async () => {
    const h = await setup();

    const cases = [
      { dir: path.join(h.base, "personal", "mar"), profile: "personal", state: "mapped" },
      { dir: path.join(h.base, "personal", "a", "b"), profile: "personal", state: "mapped" },
      { dir: path.join(h.base, "oss", "deep", "lib"), profile: "oss", state: "mapped" },
      { dir: path.join(h.base, "msu", "backend"), profile: "work", state: "default" },
      // 문자열 접두사만 같은 형제 디렉토리는 매치되면 안 된다
      { dir: path.join(h.base, "personal-old", "thing"), profile: "work", state: "default" },
      // 글롭 메타문자는 리터럴로 다뤄야 한다
      { dir: path.join(h.base, "star*dir", "repo"), profile: "starred", state: "mapped" },
      { dir: path.join(h.base, "starOTHERdir", "repo"), profile: "work", state: "default" },
    ];

    for (const testCase of cases) {
      const repo = await makeRepo(testCase.dir);
      const shellResult = await resolveIn(shell, h.mappingFile, repo);
      const actual = await gitEmail(repo, h.env);

      assert.equal(shellResult.profile, testCase.profile, `${shell.name} profile for ${repo}`);
      assert.equal(shellResult.state, testCase.state, `${shell.name} state for ${repo}`);
      assert.equal(
        h.emailOf.get(shellResult.profile),
        actual,
        `${shell.name} says ${shellResult.profile} but git says ${actual} in ${repo}`,
      );
    }
  });

  test(`${shell.name}: reports a local override that beats the mapping`, { skip }, async () => {
    const h = await setup();
    const repo = await makeRepo(path.join(h.base, "personal", "overridden"));
    await execa("git", ["config", "user.email", "local@example.com"], { cwd: repo, env: h.env });

    const result = await resolveIn(shell, h.mappingFile, repo);
    assert.equal(result.state, "local-override");
    assert.equal(result.profile, "local@example.com");
    assert.equal(await gitEmail(repo, h.env), "local@example.com");
  });

  /**
   * 전역 identity가 없는 사용자(저장소마다 직접 지정하는 사람)에게 이 도구를 깔면
   * 표에 `*` 줄이 없다. 그때 로컬 [user]를 보지 않고 먼저 결론을 내면 프롬프트가
   * "identity 없음"이라고 하는데 git은 멀쩡히 커밋한다 — 불변조건 6이 금지한 바로 그것.
   */
  test(
    `${shell.name}: a repo-local identity is never reported as no-identity`,
    { skip },
    async () => {
      const h = await setup({ withDefault: false });
      const repo = await makeRepo(path.join(h.base, "msu", "only-local"));
      await execa("git", ["config", "user.email", "solo@example.com"], { cwd: repo, env: h.env });

      const result = await resolveIn(shell, h.mappingFile, repo);
      assert.equal(await gitEmail(repo, h.env), "solo@example.com");
      assert.notEqual(result.state, "no-identity");
      assert.equal(result.state, "local-override");
      assert.equal(result.profile, "solo@example.com");
    },
  );

  test(`${shell.name}: says no-identity only when git has none either`, { skip }, async () => {
    const h = await setup({ withDefault: false });
    const repo = await makeRepo(path.join(h.base, "msu", "truly-none"));

    const result = await resolveIn(shell, h.mappingFile, repo);
    assert.equal(await gitEmail(repo, h.env), null);
    assert.equal(result.state, "no-identity");
  });

  test(`${shell.name}: stays quiet outside a repository`, { skip }, async () => {
    const h = await setup();
    const result = await resolveIn(shell, h.mappingFile, h.base);
    assert.equal(result.state, "");
    assert.equal(result.profile, "");
  });

  /**
   * 스니펫은 사용자의 대화형 셸에 그대로 eval된다. 경로에 아포스트로피가 있을 때
   * 이스케이프하지 않으면 문법 오류로 스니펫 전체가 버려진다.
   */
  test(`${shell.name}: survives an apostrophe in the mapping path`, { skip }, async () => {
    const h = await setup({ prefix: "gum-o'brien-" });
    const repo = await makeRepo(path.join(h.base, "personal", "quoted"));

    const result = await resolveIn(shell, h.mappingFile, repo);
    assert.equal(result.state, "mapped");
    assert.equal(result.profile, "personal");
  });

  test(`${shell.name}: works when the mapping file does not exist`, { skip }, async () => {
    const h = await setup();
    fs.rmSync(h.mappingFile);
    const repo = await makeRepo(path.join(h.base, "msu", "no-table"));

    const result = await resolveIn(shell, h.mappingFile, repo);
    assert.equal(result.state, "no-identity");
  });
}

/** zsh 함수는 사용자의 setopt 아래에서 돌아간다. globsubst는 표의 각 줄을 글롭으로 만든다. */
test(
  "zsh: the matcher is immune to the user's setopt",
  { skip: !available.get("zsh") },
  async () => {
    const h = await setup();
    const repo = await makeRepo(path.join(h.base, "personal", "opts"));
    const snippet = zshSnippet({ mappingFile: h.mappingFile, caseInsensitive: false });

    for (const option of ["globsubst", "shwordsplit", "nullglob", "extendedglob", "ksharrays"]) {
      const script = [
        `setopt ${option}`,
        snippet,
        `cd ${JSON.stringify(repo)}`,
        "_git_mapper_resolve",
        'print -r -- "$GIT_MAPPER_STATE"',
      ].join("\n");
      const result = await execa("zsh", ["-f", "-c", script]);
      assert.equal(result.stdout.trim(), "mapped", `broken under setopt ${option}`);
    }
  },
);

/** 프롬프트마다 도는 코드가 사용자의 shopt를 영구히 바꿔 버리면 안 된다. */
test(
  "bash: the matcher restores nocasematch to what the user had",
  { skip: !available.get("bash") },
  async () => {
    const h = await setup();
    const repo = await makeRepo(path.join(h.base, "personal", "shopt"));
    const snippet = bashSnippet({ mappingFile: h.mappingFile, caseInsensitive: true });

    const script = [
      snippet,
      `cd ${JSON.stringify(repo)}`,
      "shopt -s nocasematch",
      "_git_mapper_resolve",
      'shopt -q nocasematch && echo "on" || echo "off"',
      "shopt -u nocasematch",
      "_git_mapper_resolve",
      'shopt -q nocasematch && echo "on" || echo "off"',
    ].join("\n");
    const result = await execa("bash", ["--norc", "--noprofile", "-c", script]);
    assert.deepEqual(result.stdout.split("\n"), ["on", "off"]);
  },
);

/** 두 파일에서 source되어도 훅이 쌓이면 안 된다. */
test(
  "bash: sourcing the snippet twice registers the hook once",
  { skip: !available.get("bash") },
  async () => {
    const h = await setup();
    const snippet = bashSnippet({ mappingFile: h.mappingFile, caseInsensitive: false });
    const script = [snippet, snippet, snippet, 'printf "%s\\n" "$PROMPT_COMMAND"'].join("\n");
    const result = await execa("bash", ["--norc", "--noprofile", "-c", script]);

    const occurrences = result.stdout.split("_git_mapper_resolve").length - 1;
    assert.equal(occurrences, 1, `PROMPT_COMMAND accumulated: ${result.stdout}`);
  },
);
