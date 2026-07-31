import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import type { ProfileId, StoreV2 } from "../types.ts";
import { toAbsolutePath } from "./paths.ts";
import { type SyncOptions, applySync, describePlan, planSync } from "./sync.ts";

const id = (value: string): ProfileId => value as ProfileId;

interface Fixture {
  readonly base: string;
  readonly env: NodeJS.ProcessEnv;
  readonly options: SyncOptions;
}

const fixture = (): Fixture => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-sync-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  return {
    base,
    env,
    options: {
      configDir: path.join(base, "config"),
      globalConfigPath,
      now: "t0",
      caseInsensitive: false,
      git: { env },
    },
  };
};

const storeFor = (f: Fixture, mapped: readonly string[] = ["personal"]): StoreV2 => ({
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    {
      id: id("work"),
      name: "soohanpark",
      email: "work@nexpace.io",
      signingKey: null,
      color: "blue",
      paths: [],
    },
    {
      id: id("personal"),
      name: "soohanpark",
      email: "me@gmail.com",
      signingKey: null,
      color: "magenta",
      paths: mapped.map((dir) => toAbsolutePath(path.join(f.base, dir))),
    },
  ],
  managedConditions: [],
});

const makeRepo = async (dir: string): Promise<string> => {
  fs.mkdirSync(dir, { recursive: true });
  await execa("git", ["init", "-q"], { cwd: dir });
  return dir;
};

const emailIn = async (dir: string, env: NodeJS.ProcessEnv): Promise<string | null> => {
  try {
    return (await execa("git", ["config", "user.email"], { cwd: dir, env })).stdout.trim();
  } catch {
    return null;
  }
};

test("git resolves the mapped identity inside mapped directories", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });

  const next = await applySync(storeFor(f), f.options);

  const mapped = await makeRepo(path.join(f.base, "personal", "mar"));
  const other = await makeRepo(path.join(f.base, "msu", "backend"));

  assert.equal(await emailIn(mapped, f.env), "me@gmail.com");
  assert.equal(await emailIn(other, f.env), "work@nexpace.io");
  assert.deepEqual(next.managedConditions, [
    `gitdir:${toAbsolutePath(path.join(f.base, "personal"))}/`,
  ]);
});

test("the [user] section is written before the includeIf sections", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  const text = fs.readFileSync(f.options.globalConfigPath, "utf8");
  assert.ok(text.includes("[user]"), text);
  assert.ok(text.indexOf("[user]") < text.indexOf("[includeIf"), text);
});

test("applySync is idempotent", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });

  const once = await applySync(storeFor(f), f.options);
  const textOnce = fs.readFileSync(f.options.globalConfigPath, "utf8");
  const twice = await applySync(once, f.options);
  const textTwice = fs.readFileSync(f.options.globalConfigPath, "utf8");

  assert.equal(textTwice, textOnce);
  assert.deepEqual(twice.managedConditions, once.managedConditions);
});

test("removing a mapping falls back to the default profile", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  const repo = await makeRepo(path.join(f.base, "personal", "mar"));

  const mappedStore = await applySync(storeFor(f), f.options);
  assert.equal(await emailIn(repo, f.env), "me@gmail.com");

  const unmapped: StoreV2 = {
    ...mappedStore,
    profiles: mappedStore.profiles.map((profile) => ({ ...profile, paths: [] })),
  };
  await applySync(unmapped, f.options);

  assert.equal(await emailIn(repo, f.env), "work@nexpace.io");
});

test("profile files for deleted profiles are pruned", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  const store = await applySync(storeFor(f), f.options);
  const profilesDir = path.join(f.options.configDir, "profiles");
  assert.equal(fs.existsSync(path.join(profilesDir, "personal.gitconfig")), true);

  await applySync(
    { ...store, profiles: store.profiles.filter((profile) => profile.id !== id("personal")) },
    f.options,
  );
  assert.equal(fs.existsSync(path.join(profilesDir, "personal.gitconfig")), false);
});

test("planSync describes the change without touching the filesystem", () => {
  const f = fixture();
  const plan = planSync(storeFor(f), f.options);

  assert.equal(plan.addConditions.length, 1);
  assert.equal(plan.defaultUser?.email, "work@nexpace.io");
  assert.deepEqual(plan.writeProfiles, [id("personal")]);
  assert.equal(fs.existsSync(f.options.configDir), false);
  assert.match(describePlan(plan), /includeIf/);
});

test("the mapping table is written for the shell to read", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  const table = fs.readFileSync(path.join(f.options.configDir, "mapping.tsv"), "utf8");
  assert.match(table, /^\*\twork\tblue\twork@nexpace\.io$/m);
  assert.match(table, /\tpersonal\tmagenta\tme@gmail\.com$/m);
});

test("the mapping table falls back to an unmanaged [user] so the prompt does not lie", async () => {
  const f = fixture();
  await execa("git", ["config", "--global", "user.email", "unmanaged@x.com"], { env: f.env });
  await execa("git", ["config", "--global", "user.name", "unmanaged"], { env: f.env });

  const store: StoreV2 = {
    version: 2,
    defaultProfile: null,
    profiles: [],
    managedConditions: [],
  };
  await applySync(store, f.options);

  const table = fs.readFileSync(path.join(f.options.configDir, "mapping.tsv"), "utf8");
  assert.match(table, /^\*\tglobal\tyellow\tunmanaged@x\.com$/m);
});
