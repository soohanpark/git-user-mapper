import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProfile } from "./add.ts";

test("buildProfile trims input and normalises an empty signing key to null", () => {
  const profile = buildProfile({
    id: "personal",
    name: "  soohanpark  ",
    email: " 725psh@gmail.com ",
    signingKey: "   ",
    index: 1,
  });
  assert.equal(profile.name, "soohanpark");
  assert.equal(profile.email, "725psh@gmail.com");
  assert.equal(profile.signingKey, null);
  assert.deepEqual(profile.paths, []);
  assert.equal(typeof profile.color, "string");
});

test("buildProfile keeps a signing key that has content", () => {
  const profile = buildProfile({
    id: "signed",
    name: "n",
    email: "e@x.com",
    signingKey: " ABCD 1234 ",
    index: 0,
  });
  assert.equal(profile.signingKey, "ABCD 1234");
});

test("buildProfile rejects an invalid id", () => {
  assert.throws(
    () => buildProfile({ id: "Bad Id", name: "n", email: "e@x.com", signingKey: "", index: 0 }),
    /Invalid profile id/,
  );
});

test("buildProfile rejects empty name or email so they never reach git", () => {
  assert.throws(
    () => buildProfile({ id: "x", name: "  ", email: "e@x.com", signingKey: "", index: 0 }),
    /name/,
  );
  assert.throws(
    () => buildProfile({ id: "x", name: "n", email: " ", signingKey: "", index: 0 }),
    /email/,
  );
});

/** 탭과 개행은 mapping.tsv의 구분자다. sync가 거부하기 전에 입력에서 막는다. */
test("buildProfile rejects values containing a tab or a line break", () => {
  const base = { id: "a", name: "n", email: "e@x.com", signingKey: "", index: 0 };
  assert.throws(() => buildProfile({ ...base, name: "a\tb" }), /tab or a line break/);
  assert.throws(() => buildProfile({ ...base, email: "a\nb@x.com" }), /tab or a line break/);
  assert.throws(() => buildProfile({ ...base, signingKey: "K\rY" }), /tab or a line break/);
});
