import assert from "node:assert/strict";
import { test } from "node:test";
import { isProfileId, pickColor, slugify, toProfileId, uniqueId } from "./profile.ts";

test("isProfileId accepts lowercase slugs and rejects everything else", () => {
  assert.equal(isProfileId("work"), true);
  assert.equal(isProfileId("personal-2"), true);
  assert.equal(isProfileId("a"), true);
  assert.equal(isProfileId("Work"), false);
  assert.equal(isProfileId("-work"), false);
  assert.equal(isProfileId("work profile"), false);
  assert.equal(isProfileId(""), false);
  assert.equal(isProfileId("a".repeat(33)), false);
});

test("toProfileId throws with an actionable message", () => {
  assert.throws(() => toProfileId("Work"), /Invalid profile id/);
});

test("slugify derives an id from an email local part", () => {
  assert.equal(slugify("soohan.park@nexpace.io"), "soohan-park");
  assert.equal(slugify("725psh@gmail.com"), "725psh");
  assert.equal(slugify("Work Account"), "work-account");
});

test("slugify never produces an invalid id", () => {
  assert.equal(slugify("@@@"), "profile");
  assert.equal(slugify(""), "profile");
  assert.equal(isProfileId(slugify("a".repeat(60))), true);
  assert.equal(isProfileId(slugify("...trailing...")), true);
});

test("uniqueId suffixes collisions", () => {
  const taken = new Set(["work"]);
  assert.equal(uniqueId("work", taken), "work-2");
  assert.equal(uniqueId("work", new Set(["work", "work-2"])), "work-3");
  assert.equal(uniqueId("fresh", taken), "fresh");
});

test("pickColor cycles through the palette", () => {
  assert.equal(typeof pickColor(0), "string");
  assert.notEqual(pickColor(0), pickColor(1));
  assert.equal(pickColor(0), pickColor(6));
});
