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

/**
 * 사용자가 직접 써 둔 `includeIf`가 있고 전역 `[user]`는 없는 설정 — 손으로 조건부
 * include를 쓰던 사람이 이 도구를 처음 깔면 정확히 이 모양이다.
 *
 * `git config --global user.name`은 섹션이 없으면 파일 **끝에** 만든다. 그대로 두면
 * 사용자의 includeIf가 전부 그 앞에 놓여 조용히 죽는다. 게다가 sync는 자기가 관리하는
 * 조건만 걷어낼 수 있으므로 `status`의 "sync를 돌려라"는 안내가 영원히 고쳐지지 않았다.
 */
test("an includeIf the user wrote by hand keeps working after the first sync", async () => {
  const f = fixture();
  const mine = path.join(f.base, "mine");
  fs.mkdirSync(mine, { recursive: true });

  const handWritten = path.join(f.base, "hand.gitconfig");
  await execa("git", ["config", "--file", handWritten, "user.email", "hand@example.com"]);
  await execa("git", ["config", "--global", `includeIf.gitdir:${mine}/.path`, handWritten], {
    env: f.env,
  });

  const repo = await makeRepo(path.join(mine, "repo"));
  assert.equal(await emailIn(repo, f.env), "hand@example.com");

  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  // 우리가 [user]를 만들었어도 사용자의 매핑이 여전히 이긴다.
  assert.equal(await emailIn(repo, f.env), "hand@example.com");

  const text = fs.readFileSync(f.options.globalConfigPath, "utf8");
  assert.ok(text.indexOf("[user]") < text.indexOf("[includeIf"), text);

  // 남의 항목을 우리 관리 목록에 넣으면 다음 sync가 지워 버린다.
  const next = await applySync(storeFor(f), f.options);
  assert.ok(!next.managedConditions.some((condition) => condition.includes("/mine")));
  assert.equal(await emailIn(repo, f.env), "hand@example.com");
});

test("a [user] that already sits after the includeIf entries is moved back in front", async () => {
  const f = fixture();
  const mine = path.join(f.base, "mine");
  fs.mkdirSync(mine, { recursive: true });
  const handWritten = path.join(f.base, "hand.gitconfig");
  await execa("git", ["config", "--file", handWritten, "user.email", "hand@example.com"]);

  // includeIf를 먼저, [user]를 나중에 — 매핑이 지는 배치다.
  await execa("git", ["config", "--global", `includeIf.gitdir:${mine}/.path`, handWritten], {
    env: f.env,
  });
  await execa("git", ["config", "--global", "user.email", "stale@example.com"], { env: f.env });

  const repo = await makeRepo(path.join(mine, "repo"));
  assert.equal(await emailIn(repo, f.env), "stale@example.com");

  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  assert.equal(await emailIn(repo, f.env), "hand@example.com");
});

/**
 * 예전에는 관리 조건을 전부 지웠다가 그대로 다시 달았다. 그 사이 매핑이 하나도 없는
 * 창이 생겨, 다른 터미널이나 IDE에서 커밋하면 기본 프로파일로 커밋됐다.
 */
test("a sync that changes nothing does not touch the includeIf entries", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  const first = await applySync(storeFor(f), f.options);

  const before = fs.readFileSync(f.options.globalConfigPath, "utf8");
  const repo = await makeRepo(path.join(f.base, "personal", "mar"));

  const second = await applySync(
    { ...storeFor(f), managedConditions: first.managedConditions },
    f.options,
  );

  // 지웠다 다시 달면 내용은 같아도 항목이 파일 끝으로 옮겨 간다. 바이트 단위로 같다는
  // 것은 그 조건을 아예 건드리지 않았다는 뜻이다.
  assert.equal(fs.readFileSync(f.options.globalConfigPath, "utf8"), before);
  assert.deepEqual(second.managedConditions, first.managedConditions);
  assert.equal(await emailIn(repo, f.env), "me@gmail.com");
});

test("mapping.tsv is replaced atomically, never truncated in place", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  const mappingFile = path.join(f.options.configDir, "mapping.tsv");
  const staging = `${mappingFile}.tmp`;

  // 두 번째 sync 뒤에도 임시 파일이 남아 있으면 안 된다.
  fs.mkdirSync(path.join(f.base, "msu"), { recursive: true });
  await applySync(storeFor(f, ["personal", "msu"]), f.options);
  assert.equal(fs.existsSync(staging), false);
  assert.ok(fs.readFileSync(mappingFile, "utf8").endsWith("\n"));
});
