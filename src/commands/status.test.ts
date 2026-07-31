import assert from "node:assert/strict";
import { test } from "node:test";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { type StatusEnvironment, computeStatus } from "./status.ts";

const p = (value: string): AbsolutePath => value as AbsolutePath;
const id = (value: string): ProfileId => value as ProfileId;

const store: StoreV2 = {
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    { id: id("work"), name: "n", email: "work@x.com", signingKey: null, color: "blue", paths: [] },
    {
      id: id("personal"),
      name: "n",
      email: "me@x.com",
      signingKey: null,
      color: "magenta",
      paths: [p("/home/me/dev/personal")],
    },
  ],
  managedConditions: ["gitdir:/home/me/dev/personal/"],
};

const env = (overrides: Partial<StatusEnvironment> = {}): StatusEnvironment => ({
  gitVersion: { major: 2, minor: 50 },
  keysInOrder: ["user.name", "user.email", "includeif.gitdir:/home/me/dev/personal/.path"],
  gitEmail: "me@x.com",
  localEmail: null,
  repoRoot: p("/home/me/dev/personal/mar"),
  missingProfileFiles: [],
  missingPaths: [],
  pathsInsideRepos: [],
  ...overrides,
});

test("computeStatus reports the mapped profile with no warnings", () => {
  const result = computeStatus(store, env(), false);
  assert.equal(result.state, "mapped");
  assert.equal(result.profileId, "personal");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus reports the fallback as default, not as a problem", () => {
  const result = computeStatus(
    store,
    env({ repoRoot: p("/home/me/dev/msu"), gitEmail: "work@x.com" }),
    false,
  );
  assert.equal(result.state, "default");
  assert.equal(result.profileId, "work");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus reports not-a-repo outside a repository", () => {
  assert.equal(computeStatus(store, env({ repoRoot: null }), false).state, "not-a-repo");
});

test("computeStatus reports a local override and names the email that will actually be used", () => {
  const result = computeStatus(
    store,
    env({ localEmail: "other@x.com", gitEmail: "other@x.com" }),
    false,
  );
  assert.equal(result.state, "local-override");
  assert.equal(result.email, "other@x.com");
});

test("computeStatus ignores a local override that agrees with the mapping", () => {
  const result = computeStatus(store, env({ localEmail: "me@x.com" }), false);
  assert.equal(result.state, "mapped");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus reports no-identity only when git has no answer either", () => {
  const result = computeStatus(
    { ...store, defaultProfile: null },
    env({ repoRoot: p("/tmp/x"), gitEmail: null }),
    false,
  );
  assert.equal(result.state, "no-identity");
});

test("computeStatus treats an unmanaged [user] as the fallback rather than no-identity", () => {
  // 스토어에 기본 프로파일이 없어도 git이 이메일을 답하면 그게 실제로 커밋될 identity다.
  // 여기서 no-identity라고 말하면 프롬프트가 거짓말하게 된다.
  const result = computeStatus(
    { ...store, defaultProfile: null },
    env({ repoRoot: p("/tmp/x"), gitEmail: "unmanaged@x.com" }),
    false,
  );
  assert.equal(result.state, "default");
  assert.equal(result.profileId, null);
  assert.equal(result.email, "unmanaged@x.com");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus warns when git is too old for includeIf", () => {
  const result = computeStatus(store, env({ gitVersion: { major: 2, minor: 12 } }), false);
  assert.ok(
    result.warnings.some((w) => /2\.13/.test(w)),
    result.warnings.join("|"),
  );
});

test("computeStatus warns when [user] comes after the includeIf entries", () => {
  const result = computeStatus(
    store,
    env({ keysInOrder: ["includeif.gitdir:/home/me/dev/personal/.path", "user.email"] }),
    false,
  );
  assert.ok(
    result.warnings.some((w) => /\[user\]/.test(w)),
    result.warnings.join("|"),
  );
});

test("computeStatus warns about missing profile files, missing paths and paths inside repos", () => {
  const result = computeStatus(
    store,
    env({
      missingProfileFiles: [id("personal")],
      missingPaths: [p("/home/me/dev/personal")],
      pathsInsideRepos: [p("/home/me/dev/personal")],
    }),
    false,
  );
  assert.equal(result.warnings.length, 3);
});

test("computeStatus warns when our answer disagrees with what git actually reports", () => {
  const result = computeStatus(store, env({ gitEmail: "surprise@x.com" }), false);
  assert.ok(
    result.warnings.some((w) => /surprise@x\.com/.test(w)),
    result.warnings.join("|"),
  );
});

test("computeStatus warns about overlapping mappings", () => {
  const overlapping: StoreV2 = {
    ...store,
    profiles: store.profiles.map((profile) =>
      profile.id === id("work") ? { ...profile, paths: [p("/home/me/dev")] } : profile,
    ),
  };
  const result = computeStatus(overlapping, env(), false);
  assert.ok(
    result.warnings.some((w) => /overlap/i.test(w)),
    result.warnings.join("|"),
  );
});
