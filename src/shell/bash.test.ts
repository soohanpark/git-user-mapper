import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import { bashSnippet } from "./bash.ts";

const codeOnly = (snippet: string): string =>
  snippet
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

test("bashSnippet spawns no external process", () => {
  // `$(pwd -P)`는 내장이라 허용된다.
  const code = codeOnly(bashSnippet({ mappingFile: "/m", caseInsensitive: false }));
  for (const forbidden of ["$(git", "$(cat", "$(grep", "$(awk", "$(sed", "$(tr", "git config"]) {
    assert.equal(code.includes(forbidden), false, `snippet must not call ${forbidden}`);
  }
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
