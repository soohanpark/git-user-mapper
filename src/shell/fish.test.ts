import assert from "node:assert/strict";
import { test } from "node:test";
import { fishSnippet } from "./fish.ts";

test("fishSnippet bakes in the mapping file path", () => {
  const snippet = fishSnippet({ mappingFile: "/cfg/mapping.tsv", caseInsensitive: false });
  assert.match(snippet, /set -g _git_mapper_file '\/cfg\/mapping\.tsv'/);
});

/** fish는 작은따옴표 안에서 `\'`와 `\\`만 이스케이프로 인정한다. */
test("fishSnippet escapes an apostrophe in the mapping path", () => {
  const snippet = fishSnippet({ mappingFile: "/home/o'brien/m.tsv", caseInsensitive: false });
  assert.match(snippet, /'\/home\/o\\'brien\/m\.tsv'/);
});

test("fishSnippet lowercases paths only on case-insensitive platforms", () => {
  assert.match(fishSnippet({ mappingFile: "/m", caseInsensitive: true }), /string lower/);
  assert.doesNotMatch(fishSnippet({ mappingFile: "/m", caseInsensitive: false }), /string lower/);
});

/**
 * 훅이 없으면 함수가 정의만 되고 아무도 부르지 않아 변수가 영영 비어 있다.
 * zsh는 add-zsh-hook, bash는 PROMPT_COMMAND로 같은 일을 한다.
 */
test("fishSnippet registers a prompt hook so the variables are actually refreshed", () => {
  const snippet = fishSnippet({ mappingFile: "/m", caseInsensitive: false });
  assert.match(snippet, /--on-event fish_prompt/);
});

test("fishSnippet renders the local-override state", () => {
  const snippet = fishSnippet({ mappingFile: "/m", caseInsensitive: false });
  assert.match(snippet, /local-override/);
  // 로컬 [user]를 읽지 않으면 local-override는 절대 나올 수 없다.
  assert.match(snippet, /\$root\/\.git\/config/);
});

/** 외부 바이너리를 부르면 fish 프롬프트마다 exec 비용이 붙는다. */
test("fishSnippet calls no external binary", () => {
  const code = fishSnippet({ mappingFile: "/m", caseInsensitive: false })
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  for (const forbidden of ["cat ", "dirname", "(git ", "grep", "awk", "sed "]) {
    assert.equal(code.includes(forbidden), false, `snippet must not call ${forbidden}`);
  }
});

/** 글롭 패턴으로 비교하면 이름에 `*`가 든 디렉토리가 남의 저장소까지 먹는다. */
test("fishSnippet compares paths literally, not with string match patterns", () => {
  const snippet = fishSnippet({ mappingFile: "/m", caseInsensitive: false });
  assert.doesNotMatch(snippet, /string match -q.*\$p/);
  assert.match(snippet, /string sub -l \$clen/);
});
