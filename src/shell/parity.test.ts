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
];

const isAvailable = async (name: string): Promise<boolean> => {
  try {
    await execa(name, ["-c", "exit 0"]);
    return true;
  } catch {
    return false;
  }
};

const available = new Map(
  await Promise.all(SHELLS.map(async (s) => [s.name, await isAvailable(s.name)] as const)),
);

/**
 * 설치되지 않은 셸은 건너뛴다. 개발자 기계에서는 그게 맞지만, CI에서는 그 관대함이
 * 위험하다 — 러너에 zsh가 없으면 zsh 케이스가 전부 skip되고 실행은 초록불이 되며,
 * "프롬프트가 git과 같은 답을 낸다"는 주장의 절반이 검증되지 않은 채 배포까지 간다.
 * `GIT_MAPPER_REQUIRE_SHELLS=1`이면 건너뛰는 대신 실패한다.
 */
const requireShells = process.env.GIT_MAPPER_REQUIRE_SHELLS === "1";

const missing = SHELLS.filter((s) => !available.get(s.name)).map((s) => s.name);
if (requireShells && missing.length > 0) {
  throw new Error(
    `GIT_MAPPER_REQUIRE_SHELLS=1 but these shells are not installed: ${missing.join(", ")}`,
  );
}

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
  options: {
    readonly withDefault?: boolean;
    readonly prefix?: string;
    readonly caseInsensitive?: boolean;
  } = {},
): Promise<Harness> => {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? "gum-parity-")),
  );
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  const configDir = path.join(base, "config");

  for (const dir of [
    "personal",
    "personal-old",
    "msu",
    "oss/deep",
    "star*dir",
    "starOTHERdir",
    "CaseDir",
    "casedir-other",
  ]) {
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
      {
        id: id("cased"),
        name: "n",
        email: "cased@example.com",
        signingKey: null,
        color: "red",
        paths: [toAbsolutePath(path.join(base, "CaseDir"))],
      },
    ],
    managedConditions: [],
  };

  await applySync(store, {
    configDir,
    globalConfigPath,
    now: "t0",
    caseInsensitive: options.caseInsensitive === true,
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
  caseInsensitive = false,
): Promise<{ readonly profile: string; readonly state: string }> => {
  const script = [
    shell.snippet({ mappingFile, caseInsensitive }),
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
  test(`${shell.name}: a repo-local identity is never reported as no-identity`, {
    skip,
  }, async () => {
    const h = await setup({ withDefault: false });
    const repo = await makeRepo(path.join(h.base, "msu", "only-local"));
    await execa("git", ["config", "user.email", "solo@example.com"], { cwd: repo, env: h.env });

    const result = await resolveIn(shell, h.mappingFile, repo);
    assert.equal(await gitEmail(repo, h.env), "solo@example.com");
    assert.notEqual(result.state, "no-identity");
    assert.equal(result.state, "local-override");
    assert.equal(result.profile, "solo@example.com");
  });

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

  /**
   * git은 `includeIf "gitdir:"`를 작업 트리가 아니라 GIT_DIR로 맞춘다. linked worktree의
   * GIT_DIR은 주 저장소의 `.git/worktrees/<이름>`이라 두 경로가 아예 다른 서브트리에 있다.
   * 작업 트리로 맞춰 보면 매핑되지 않은 곳에 만든 워크트리에서 git은 주 저장소의
   * 프로파일을 쓰는데 프롬프트는 아무것도 없다고(또는 다른 것을) 답한다.
   */
  test(`${shell.name}: a linked worktree resolves through the main repository`, {
    skip,
  }, async () => {
    const h = await setup();
    const main = await makeRepo(path.join(h.base, "personal", "main"));
    await execa("git", ["commit", "-q", "--allow-empty", "-m", "x"], { cwd: main, env: h.env });

    // 워크트리는 매핑되지 않은 `msu` 아래에 만든다. 작업 트리로 판정하면 `work/default`가 나온다.
    const worktree = path.join(h.base, "msu", "wt");
    await execa("git", ["worktree", "add", "-q", worktree], { cwd: main, env: h.env });

    assert.equal(fs.statSync(path.join(worktree, ".git")).isFile(), true);

    const result = await resolveIn(shell, h.mappingFile, worktree);
    assert.equal(result.state, "mapped");
    assert.equal(result.profile, "personal");
    assert.equal(await gitEmail(worktree, h.env), h.emailOf.get("personal"));
  });

  /**
   * 워크트리의 GIT_DIR에는 `config`가 없다. 저장소 설정은 주 저장소 쪽에 하나뿐이라
   * common dir를 보지 않으면 로컬 `[user]`를 통째로 놓친다.
   */
  test(`${shell.name}: a worktree sees the shared repository [user]`, { skip }, async () => {
    const h = await setup();
    const main = await makeRepo(path.join(h.base, "personal", "shared-cfg"));
    await execa("git", ["commit", "-q", "--allow-empty", "-m", "x"], { cwd: main, env: h.env });
    await execa("git", ["config", "user.email", "shared@example.com"], { cwd: main, env: h.env });

    const worktree = path.join(h.base, "msu", "wt-cfg");
    await execa("git", ["worktree", "add", "-q", worktree], { cwd: main, env: h.env });

    const result = await resolveIn(shell, h.mappingFile, worktree);
    assert.equal(await gitEmail(worktree, h.env), "shared@example.com");
    assert.equal(result.state, "local-override");
    assert.equal(result.profile, "shared@example.com");
  });

  /**
   * git이 받아들이는 `.git/config` 표기들. 앞의 셋은 로컬 identity를 통째로 놓치게 만들고
   * (프롬프트는 매핑된 프로파일을 보여 주는데 git은 다른 값으로 커밋한다), 뒤의 둘은
   * 값을 망가뜨린다. 마지막 항목은 **git 자신이** 그렇게 써 넣는 모양이다.
   */
  test(`${shell.name}: reads every config spelling git accepts`, { skip }, async () => {
    const spellings: readonly (readonly [string, string, string])[] = [
      ["header and key on one line", "[user] email = same-line@x.com\n", "same-line@x.com"],
      ["uppercase section", "[USER]\n\temail = upper@x.com\n", "upper@x.com"],
      ["uppercase key", "[user]\n\tEMAIL = upkey@x.com\n", "upkey@x.com"],
      ["trailing comment", "[user]\n\temail = comment@x.com ; note\n", "comment@x.com"],
      ["quoted value", '[user]\n\temail = "quoted@x.com"\n', "quoted@x.com"],
      ["no space around =", "[user]\n\temail=nospace@x.com\n", "nospace@x.com"],
    ];

    for (const [label, text, expected] of spellings) {
      const h = await setup();
      const repo = await makeRepo(path.join(h.base, "personal", "spelling"));
      fs.appendFileSync(path.join(repo, ".git", "config"), text);

      assert.equal(await gitEmail(repo, h.env), expected, `git disagrees for ${label}`);
      const result = await resolveIn(shell, h.mappingFile, repo);
      assert.equal(result.state, "local-override", `${shell.name} state for ${label}`);
      assert.equal(result.profile, expected, `${shell.name} email for ${label}`);
    }
  });

  /** git 자신이 값에 `#`이 있으면 따옴표로 감싸 쓴다. 벗기지 않으면 따옴표가 그대로 찍힌다. */
  test(`${shell.name}: unwraps a value git quoted for us`, { skip }, async () => {
    const h = await setup();
    const repo = await makeRepo(path.join(h.base, "personal", "hashed"));
    await execa("git", ["config", "user.email", "a#b@x.com"], { cwd: repo, env: h.env });

    assert.match(fs.readFileSync(path.join(repo, ".git", "config"), "utf8"), /"a#b@x\.com"/);
    const result = await resolveIn(shell, h.mappingFile, repo);
    assert.equal(await gitEmail(repo, h.env), "a#b@x.com");
    assert.equal(result.profile, "a#b@x.com");
  });

  /**
   * darwin·win32에서 실제로 도는 분기다. 예전에는 parity 전체가 `caseInsensitive: false`로만
   * 돌아서, 사용자 대부분이 쓰는 경로를 어떤 테스트도 실행한 적이 없었다.
   */
  test(`${shell.name}: agrees with git when folding case`, { skip }, async () => {
    const h = await setup({ caseInsensitive: true });
    for (const dir of ["CaseDir/repo", "casedir-other/repo"]) {
      const repo = await makeRepo(path.join(h.base, dir));
      const result = await resolveIn(shell, h.mappingFile, repo, true);
      const actual = await gitEmail(repo, h.env);
      assert.equal(
        h.emailOf.get(result.profile),
        actual,
        `${shell.name} says ${result.profile} but git says ${actual} in ${repo}`,
      );
    }
  });
}

/** zsh 함수는 사용자의 setopt 아래에서 돌아간다. globsubst는 표의 각 줄을 글롭으로 만든다. */
test("zsh: the matcher is immune to the user's setopt", {
  skip: !available.get("zsh"),
}, async () => {
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
});

/** 프롬프트마다 도는 코드가 사용자의 shopt를 영구히 바꿔 버리면 안 된다. */
test("bash: the matcher restores nocasematch to what the user had", {
  skip: !available.get("bash"),
}, async () => {
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
});

/** 두 파일에서 source되어도 훅이 쌓이면 안 된다. */
test("bash: sourcing the snippet twice registers the hook once", {
  skip: !available.get("bash"),
}, async () => {
  const h = await setup();
  const snippet = bashSnippet({ mappingFile: h.mappingFile, caseInsensitive: false });
  const script = [snippet, snippet, snippet, 'printf "%s\\n" "$PROMPT_COMMAND"'].join("\n");
  const result = await execa("bash", ["--norc", "--noprofile", "-c", script]);

  const occurrences = result.stdout.split("_git_mapper_resolve").length - 1;
  assert.equal(occurrences, 1, `PROMPT_COMMAND accumulated: ${result.stdout}`);
});
