import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import { zshSnippet } from "./zsh.ts";

test("zshSnippet bakes in the mapping file path", () => {
  const snippet = zshSnippet({ mappingFile: "/cfg/mapping.tsv", caseInsensitive: false });
  assert.match(snippet, /_git_mapper_file='\/cfg\/mapping\.tsv'/);
});

test("zshSnippet escapes an apostrophe in the mapping path", () => {
  const snippet = zshSnippet({ mappingFile: "/home/o'brien/m.tsv", caseInsensitive: false });
  assert.match(snippet, /_git_mapper_file='\/home\/o'\\''brien\/m\.tsv'/);
});

test("zshSnippet lowercases paths only on case-insensitive platforms", () => {
  assert.match(zshSnippet({ mappingFile: "/m", caseInsensitive: true }), /\$\{root:l\}/);
  assert.doesNotMatch(zshSnippet({ mappingFile: "/m", caseInsensitive: false }), /\$\{root:l\}/);
});

/**
 * 생성된 문자열을 grep하는 검사는 목록에 없는 명령을 놓친다(실제로 `$(pwd`가 그렇게
 * 빠져나갔다). PATH를 비우고 돌리면 외부 바이너리를 부르는 순간 실패하므로,
 * 문자열이 아니라 동작을 확인하게 된다.
 */
test("the zsh matcher runs with an empty PATH — it uses only builtins", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-zsh-path-")));
  const mappingFile = path.join(base, "mapping.tsv");
  fs.writeFileSync(mappingFile, `${base}/personal\tpersonal\tmagenta\tme@x.com\n`);
  const repo = path.join(base, "personal", "mar");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });

  const script = [
    zshSnippet({ mappingFile, caseInsensitive: false }),
    `cd ${JSON.stringify(repo)}`,
    "_git_mapper_resolve",
    'print -r -- "$GIT_MAPPER_PROFILE:$GIT_MAPPER_STATE"',
  ].join("\n");

  const result = await execa("/bin/zsh", ["-f", "-c", script], {
    env: { PATH: "" },
    extendEnv: false,
  });
  assert.equal(result.stdout.trim(), "personal:mapped");
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
