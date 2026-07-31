import assert from "node:assert/strict";
import { test } from "node:test";
import { zshSnippet } from "./zsh.ts";

const codeOnly = (snippet: string): string =>
  snippet
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

test("zshSnippet bakes in the mapping file path", () => {
  const snippet = zshSnippet({ mappingFile: "/cfg/mapping.tsv", caseInsensitive: false });
  assert.match(snippet, /_git_mapper_file='\/cfg\/mapping\.tsv'/);
});

test("zshSnippet lowercases paths only on case-insensitive platforms", () => {
  assert.match(zshSnippet({ mappingFile: "/m", caseInsensitive: true }), /\$\{root:l\}/);
  assert.doesNotMatch(zshSnippet({ mappingFile: "/m", caseInsensitive: false }), /\$\{root:l\}/);
});

test("zshSnippet spawns no external process", () => {
  // 주석에는 `git-mapper shell-init` 같은 문구가 들어가므로 코드 줄만 검사한다.
  // `$(<file)`는 fork하지 않는 zsh 내장 형태라 허용된다.
  const code = codeOnly(zshSnippet({ mappingFile: "/m", caseInsensitive: false }));
  for (const forbidden of ["$(git", "$(cat", "$(grep", "$(awk", "$(sed", "git config"]) {
    assert.equal(code.includes(forbidden), false, `snippet must not call ${forbidden}`);
  }
});

test("zshSnippet renders every resolution state", () => {
  const snippet = zshSnippet({ mappingFile: "/m", caseInsensitive: false });
  for (const state of ["mapped", "default", "local-override", "no-identity"]) {
    assert.ok(snippet.includes(state), `missing branch for ${state}`);
  }
});

test("zshSnippet quotes the mapping path so glob characters stay literal", () => {
  const snippet = zshSnippet({ mappingFile: "/m", caseInsensitive: false });
  assert.match(snippet, /== "\$cand" \|\| \$target == "\$cand"\/\*/);
});
