import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import { bashSnippet } from "./bash.ts";

/**
 * 생성된 문자열을 grep하면 목록에 없는 명령을 놓친다. PATH를 비우고 실제로 돌린다 —
 * 외부 바이너리를 부르는 순간 실패하므로 동작 자체가 증거가 된다. `pwd`는 내장이라
 * 서브셸을 하나 뜨긴 해도 exec은 하지 않고, 그래서 이 검사를 통과한다.
 */
test("the bash matcher runs with an empty PATH — it uses only builtins", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-bash-path-")));
  const mappingFile = path.join(base, "mapping.tsv");
  fs.writeFileSync(mappingFile, `${base}/personal\tpersonal\tmagenta\tme@x.com\n`);
  const repo = path.join(base, "personal", "mar");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });

  const script = [
    bashSnippet({ mappingFile, caseInsensitive: false }),
    `cd ${JSON.stringify(repo)}`,
    "_git_mapper_resolve",
    'printf "%s:%s\\n" "$GIT_MAPPER_PROFILE" "$GIT_MAPPER_STATE"',
  ].join("\n");

  const result = await execa("/bin/bash", ["--norc", "--noprofile", "-c", script], {
    env: { PATH: "" },
    extendEnv: false,
  });
  assert.equal(result.stdout.trim(), "personal:mapped");
});

test("bashSnippet escapes an apostrophe in the mapping path", () => {
  const snippet = bashSnippet({ mappingFile: "/home/o'brien/m.tsv", caseInsensitive: false });
  assert.match(snippet, /_git_mapper_file='\/home\/o'\\''brien\/m\.tsv'/);
});

test("bashSnippet uses nocasematch only on case-insensitive platforms", () => {
  assert.match(bashSnippet({ mappingFile: "/m", caseInsensitive: true }), /shopt -s nocasematch/);
  assert.doesNotMatch(bashSnippet({ mappingFile: "/m", caseInsensitive: false }), /nocasematch/);
});

test("the bash matcher resolves the longest prefix", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-bash-")));
  const mappingFile = path.join(base, "mapping.tsv");
  fs.writeFileSync(
    mappingFile,
    ["*\twork\tblue\twork@x.com", `${base}/personal\tpersonal\tmagenta\tme@x.com`, ""].join("\n"),
  );
  const repo = path.join(base, "personal", "mar");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });

  const script = [
    bashSnippet({ mappingFile, caseInsensitive: false }),
    `cd ${JSON.stringify(repo)}`,
    "_git_mapper_resolve",
    'printf "%s\\n%s\\n" "$GIT_MAPPER_PROFILE" "$GIT_MAPPER_STATE"',
  ].join("\n");

  const result = await execa("bash", ["--norc", "--noprofile", "-c", script]);
  assert.deepEqual(result.stdout.split("\n").slice(0, 2), ["personal", "mapped"]);
});

test("the bash matcher falls back and stays quiet outside a repository", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-bash-fb-")));
  const mappingFile = path.join(base, "mapping.tsv");
  fs.writeFileSync(mappingFile, "*\twork\tblue\twork@x.com\n");
  const repo = path.join(base, "elsewhere");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });

  const run = async (dir: string): Promise<string> => {
    const script = [
      bashSnippet({ mappingFile, caseInsensitive: false }),
      `cd ${JSON.stringify(dir)}`,
      "_git_mapper_resolve",
      'printf "%s|%s\\n" "$GIT_MAPPER_PROFILE" "$GIT_MAPPER_STATE"',
    ].join("\n");
    return (await execa("bash", ["--norc", "--noprofile", "-c", script])).stdout.trim();
  };

  assert.equal(await run(repo), "work|default");
  assert.equal(await run(base), "|");
});
