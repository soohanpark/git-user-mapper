import assert from "node:assert/strict";
import { test } from "node:test";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { assignPath, scopeChoices, unassignPath } from "./map.ts";

const p = (value: string): AbsolutePath => value as AbsolutePath;
const id = (value: string): ProfileId => value as ProfileId;

const store: StoreV2 = {
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    {
      id: id("work"),
      name: "n",
      email: "w@x.com",
      signingKey: null,
      color: "blue",
      paths: [p("/a/msu")],
    },
    {
      id: id("personal"),
      name: "n",
      email: "m@x.com",
      signingKey: null,
      color: "magenta",
      paths: [],
    },
  ],
  managedConditions: [],
};

test("assignPath adds the path to the chosen profile", () => {
  const next = assignPath(store, id("personal"), p("/a/personal"));
  assert.deepEqual(next.profiles.find((x) => x.id === id("personal"))?.paths, ["/a/personal"]);
});

test("assignPath moves a path that was mapped to another profile", () => {
  const next = assignPath(store, id("personal"), p("/a/msu"));
  assert.deepEqual(next.profiles.find((x) => x.id === id("work"))?.paths, []);
  assert.deepEqual(next.profiles.find((x) => x.id === id("personal"))?.paths, ["/a/msu"]);
});

test("assignPath is idempotent and keeps paths sorted", () => {
  const once = assignPath(store, id("personal"), p("/a/b"));
  const twice = assignPath(once, id("personal"), p("/a/b"));
  assert.deepEqual(twice, once);

  const many = assignPath(assignPath(store, id("personal"), p("/a/z")), id("personal"), p("/a/a"));
  assert.deepEqual(many.profiles.find((x) => x.id === id("personal"))?.paths, ["/a/a", "/a/z"]);
});

test("assignPath does not mutate the input store", () => {
  const snapshot = JSON.stringify(store);
  assignPath(store, id("personal"), p("/a/personal"));
  assert.equal(JSON.stringify(store), snapshot);
});

test("unassignPath removes the path from wherever it was", () => {
  const next = unassignPath(store, p("/a/msu"));
  assert.deepEqual(next.profiles.find((x) => x.id === id("work"))?.paths, []);
});

test("scopeChoices offers the repo root and its parent, deduplicated", () => {
  const choices = scopeChoices(p("/a/b/repo/src"), p("/a/b/repo"));
  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["/a/b/repo", "/a/b"],
  );
});

test("scopeChoices outside a repo offers the current directory and its parent", () => {
  const choices = scopeChoices(p("/a/b/c"), null);
  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["/a/b/c", "/a/b"],
  );
});

test("scopeChoices never offers the filesystem root twice", () => {
  const choices = scopeChoices(p("/"), null);
  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["/"],
  );
});
