import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import { toAbsolutePath } from "../core/paths.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId, StoreV2 } from "../types.ts";
import { zshSnippet } from "./zsh.ts";

const id = (value: string): ProfileId => value as ProfileId;

const hasZsh = async (): Promise<boolean> => {
  try {
    await execa("zsh", ["-f", "-c", "exit 0"]);
    return true;
  } catch {
    return false;
  }
};

const zshAvailable = await hasZsh();

interface Harness {
  readonly base: string;
  readonly env: NodeJS.ProcessEnv;
  readonly snippet: string;
  readonly emailOf: ReadonlyMap<string, string>;
}

const setup = async (): Promise<Harness> => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-parity-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  const configDir = path.join(base, "config");

  for (const dir of ["personal", "personal-old", "msu", "oss/deep"]) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
  }

  const store: StoreV2 = {
    version: 2,
    defaultProfile: id("work"),
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
    snippet: zshSnippet({
      mappingFile: path.join(configDir, "mapping.tsv"),
      caseInsensitive: false,
    }),
    emailOf: new Map(store.profiles.map((profile) => [profile.id as string, profile.email])),
  };
};

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

const zshResolve = async (
  snippet: string,
  dir: string,
): Promise<{ readonly profile: string; readonly state: string }> => {
  const script = [
    snippet,
    `cd ${JSON.stringify(dir)}`,
    "_git_mapper_resolve",
    'print -r -- "$GIT_MAPPER_PROFILE"',
    'print -r -- "$GIT_MAPPER_STATE"',
  ].join("\n");
  const result = await execa("zsh", ["-f", "-c", script]);
  const lines = result.stdout.split("\n");
  return { profile: lines[0] ?? "", state: lines[1] ?? "" };
};

test("the zsh matcher and git agree on every fixture", { skip: !zshAvailable }, async () => {
  const h = await setup();

  const cases = [
    { dir: path.join(h.base, "personal", "mar"), profile: "personal", state: "mapped" },
    { dir: path.join(h.base, "personal", "a", "b"), profile: "personal", state: "mapped" },
    { dir: path.join(h.base, "oss", "deep", "lib"), profile: "oss", state: "mapped" },
    { dir: path.join(h.base, "msu", "backend"), profile: "work", state: "default" },
    // 문자열 접두사만 같은 형제 디렉토리는 매치되면 안 된다
    { dir: path.join(h.base, "personal-old", "thing"), profile: "work", state: "default" },
  ];

  for (const testCase of cases) {
    const repo = await makeRepo(testCase.dir);
    const shell = await zshResolve(h.snippet, repo);
    const actual = await gitEmail(repo, h.env);

    assert.equal(shell.profile, testCase.profile, `zsh profile for ${repo}`);
    assert.equal(shell.state, testCase.state, `zsh state for ${repo}`);
    assert.equal(
      h.emailOf.get(shell.profile),
      actual,
      `zsh says ${shell.profile} (${h.emailOf.get(shell.profile)}) but git says ${actual} in ${repo}`,
    );
  }
});

test(
  "the zsh matcher reports a local override that beats the mapping",
  { skip: !zshAvailable },
  async () => {
    const h = await setup();
    const repo = await makeRepo(path.join(h.base, "personal", "overridden"));
    await execa("git", ["config", "user.email", "local@example.com"], { cwd: repo, env: h.env });

    const shell = await zshResolve(h.snippet, repo);
    assert.equal(shell.state, "local-override");
    assert.equal(shell.profile, "local@example.com");
    assert.equal(await gitEmail(repo, h.env), "local@example.com");
  },
);

test("the zsh matcher stays quiet outside a repository", { skip: !zshAvailable }, async () => {
  const h = await setup();
  const shell = await zshResolve(h.snippet, h.base);
  assert.equal(shell.state, "");
  assert.equal(shell.profile, "");
});
