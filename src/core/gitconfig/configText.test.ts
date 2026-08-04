import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfigValue, readConfigText } from "./configText.ts";

const email = (text: string): string | undefined => readConfigText(text).get("user.email");

test("readConfigText reads the ordinary spelling", () => {
  assert.equal(email("[user]\n\temail = a@x.com\n"), "a@x.com");
  assert.equal(email("[user]\nemail=a@x.com\n"), "a@x.com");
});

/**
 * 아래 셋은 예전 파서가 통째로 놓치던 표기다. 로컬 identity가 있는데 없다고 답하면
 * 프롬프트는 매핑된 프로파일을 보여 주고 git은 다른 값으로 커밋한다 — 불변조건 6이
 * 막으려는 실패다. 실제 git 2.50.1이 셋 다 받아들이는 것을 확인했다.
 */
test("readConfigText accepts a variable on the section header line", () => {
  assert.equal(email("[user] email = same-line@x.com\n"), "same-line@x.com");
});

test("readConfigText ignores case in section and key names", () => {
  assert.equal(email("[USER]\n\temail = upper@x.com\n"), "upper@x.com");
  assert.equal(email("[user]\n\tEMAIL = upkey@x.com\n"), "upkey@x.com");
  assert.equal(email("[UsEr]\n\tEmAiL = mixed@x.com\n"), "mixed@x.com");
});

test("readConfigText treats a subsection as a different section", () => {
  // `[user "work"]`는 `[user]`가 아니다. git도 그렇게 읽는다.
  assert.equal(email('[user "work"]\n\temail = sub@x.com\n'), undefined);
});

test("readConfigText keeps the last value when a key repeats", () => {
  assert.equal(email("[user]\n\temail = first@x.com\n\temail = second@x.com\n"), "second@x.com");
});

test("readConfigText skips comment lines", () => {
  assert.equal(email("# [user]\n#\temail = nope@x.com\n"), undefined);
  assert.equal(email("; [user]\n[user]\n\temail = yes@x.com\n"), "yes@x.com");
});

test("readConfigText reads extensions.worktreeConfig for the worktree override", () => {
  const keys = readConfigText("[extensions]\n\tworktreeConfig = true\n");
  assert.equal(keys.get("extensions.worktreeconfig"), "true");
});

test("parseConfigValue drops the whitespace around the value but keeps it inside quotes", () => {
  assert.equal(parseConfigValue("  a@x.com  "), "a@x.com");
  assert.equal(parseConfigValue('  "  spaced  "  '), "  spaced  ");
  assert.equal(parseConfigValue("Soo Han"), "Soo Han");
});

/** git은 값에 `#`이나 `;`가 있으면 따옴표로 감싸서 쓴다. 벗기지 않으면 값이 달라진다. */
test("parseConfigValue unwraps quotes and honours escapes", () => {
  assert.equal(parseConfigValue('"a#b@x.com"'), "a#b@x.com");
  assert.equal(parseConfigValue('"a;b@x.com"'), "a;b@x.com");
  assert.equal(parseConfigValue('"say \\"hi\\""'), 'say "hi"');
  assert.equal(parseConfigValue('"back\\\\slash"'), "back\\slash");
  assert.equal(parseConfigValue('"tab\\there"'), "tab\there");
});

test("parseConfigValue stops at an unquoted comment", () => {
  assert.equal(parseConfigValue("a@x.com ; work"), "a@x.com");
  assert.equal(parseConfigValue("a@x.com # work"), "a@x.com");
  assert.equal(parseConfigValue("a@x.com#work"), "a@x.com");
});
