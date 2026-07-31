import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import type { ProfileId, StoreV2 } from "../types.ts";
import { toAbsolutePath } from "./paths.ts";
import { applySync, describePlan, planSync, type SyncOptions } from "./sync.ts";

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

/**
 * git은 `gitdir:` 패턴을 wildmatch로 해석하므로, 디렉토리 이름에 든 `*`나 `[`가
 * 이스케이프되지 않으면 매핑이 남의 저장소까지 먹거나 아무 데도 붙지 않는다.
 * 어느 쪽이든 `resolve()`의 리터럴 비교와 답이 갈린다(불변조건 5·6).
 */
test("a directory whose name contains glob metacharacters maps exactly and only itself", async () => {
  const f = fixture();
  const store = storeFor(f, ["star*dir"]);
  await applySync(store, f.options);

  const target = await makeRepo(path.join(f.base, "star*dir", "repo"));
  const sibling = await makeRepo(path.join(f.base, "starOTHERdir", "repo"));

  assert.equal(await emailIn(target, f.env), "me@gmail.com");
  assert.equal(
    await emailIn(sibling, f.env),
    "work@nexpace.io",
    "the pattern leaked onto a sibling",
  );
});

test("a directory name containing brackets still maps", async () => {
  const f = fixture();
  await applySync(storeFor(f, ["proj [old]"]), f.options);

  const target = await makeRepo(path.join(f.base, "proj [old]", "repo"));
  assert.equal(await emailIn(target, f.env), "me@gmail.com");
});

/**
 * 검증이 변경보다 뒤에 있으면 `~/.gitconfig`를 이미 고쳐 놓고 던지게 되고,
 * 관리 목록에 없는 includeIf가 남아 다음 sync가 영영 회수하지 못한다.
 */
test("an unserializable value stops the sync before anything is written", async () => {
  const f = fixture();
  const store = storeFor(f);
  const poisoned: StoreV2 = {
    ...store,
    profiles: store.profiles.map((profile) =>
      profile.id === id("personal") ? { ...profile, email: "a\tb@x.com" } : profile,
    ),
  };

  await assert.rejects(() => applySync(poisoned, f.options), /tab or newline/);
  assert.equal(fs.readFileSync(f.options.globalConfigPath, "utf8"), "");
  assert.equal(fs.existsSync(path.join(f.options.configDir, "mapping.tsv")), false);
});

test("applySync records the conditions it is about to add before it touches git", async () => {
  const f = fixture();
  const seen: StoreV2[] = [];
  const store = storeFor(f);

  await applySync(store, f.options, (next) => seen.push(next));

  const staged = seen.at(0);
  assert.ok(staged, "persist was never called before mutating");
  // 스테이징 시점에 이미 새 조건이 들어 있어야, 중간에 죽어도 다음 sync가 회수한다.
  assert.equal(staged.managedConditions.length, 1);
  const config = fs.readFileSync(f.options.globalConfigPath, "utf8");
  assert.ok(config.includes(staged.managedConditions[0] as string));
});

test("a mid-sync failure leaves no includeIf outside the recorded conditions", async () => {
  const f = fixture();
  let recorded: StoreV2 | null = null;
  const store = storeFor(f, ["one", "two"]);

  await applySync(store, f.options, (next) => {
    recorded = next;
  });

  const config = fs.readFileSync(f.options.globalConfigPath, "utf8");
  const written = [...config.matchAll(/\[includeIf "([^"]+)"\]/g)].map((m) => m[1] as string);
  const known = new Set((recorded as StoreV2 | null)?.managedConditions ?? []);
  for (const condition of written) {
    assert.ok(known.has(condition), `${condition} was written but never recorded`);
  }
});

test("a broken global config stops the sync instead of being read as empty", async () => {
  const f = fixture();
  fs.writeFileSync(f.options.globalConfigPath, "[user\n\tname = broken\n");

  await assert.rejects(() => applySync(storeFor(f), f.options));
  assert.equal(fs.existsSync(path.join(f.options.configDir, "mapping.tsv")), false);
});

test("mapping.tsv is written 0600 because it carries the same emails", async () => {
  const f = fixture();
  await applySync(storeFor(f), f.options);
  const file = path.join(f.options.configDir, "mapping.tsv");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
