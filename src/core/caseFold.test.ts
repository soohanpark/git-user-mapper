import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiFold } from "./caseFold.ts";

test("asciiFold lowercases A-Z", () => {
  assert.equal(asciiFold("/Users/Me/Dev/PROJECT"), "/users/me/dev/project");
  assert.equal(asciiFold("already-lower"), "already-lower");
});

/**
 * git의 wildmatch(`gitdir/i:`)는 바이트 단위 ASCII `tolower`다. `toLowerCase()`도
 * zsh의 `${p:l}`도 bash의 `nocasematch`도 유니코드까지 접어서, 비ASCII 디렉토리에서만
 * 우리 답과 git의 답이 갈렸다. 접는 규칙을 git에 맞춘 것을 여기서 고정한다.
 */
test("asciiFold leaves non-ASCII alone, exactly as git's wildmatch does", () => {
  assert.equal(asciiFold("PROJEKTÄ"), "projektÄ");
  assert.notEqual(asciiFold("PROJEKTÄ"), "PROJEKTÄ".toLowerCase());
  assert.equal(asciiFold("İSTANBUL"), "İstanbul");
  assert.equal(asciiFold("ΑΘΗΝΑ"), "ΑΘΗΝΑ");
});

test("asciiFold leaves digits and punctuation untouched", () => {
  assert.equal(asciiFold("A1-B2_c3.D"), "a1-b2_c3.d");
});
