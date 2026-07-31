# git-user-mapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디렉토리마다 git identity를 자동 적용하고, 지금 어떤 프로파일이 적용 중인지 셸 프롬프트에 표시하는 CLI를 만든다.

**Architecture:** 스토어(JSON) 하나가 진실의 원천이고, `sync()`가 여기서 세 가지 파생물을 생성한다 — 프로파일별 gitconfig 파일, `~/.gitconfig`의 `includeIf` 항목, 프롬프트용 `mapping.tsv`. 적용은 git의 조건부 include가 담당하므로 런타임 비용이 0이고 IDE·GUI에서도 동작한다. 프롬프트는 `mapping.tsv`를 순수 셸로 읽어 외부 프로세스 없이 같은 답을 계산한다.

**Tech Stack:** TypeScript 7.0 · ESM · Node 22.18+ · commander 15 · @inquirer/prompts 8 · execa 10 · conf 15 · chalk 6 · zod 4 · Biome 2 · `node --test` + c8

**설계 문서:** `docs/superpowers/specs/2026-07-31-git-user-mapper-design.md` — 절 번호 참조는 모두 이 문서를 가리킨다.

## Global Constraints

모든 태스크의 요구사항에 아래가 암묵적으로 포함된다.

- **언어/모듈** — TypeScript 7.0.2, ESM(`"type": "module"`). 상대 import는 `./foo.ts`처럼 `.ts` 확장자로 쓴다(`rewriteRelativeImportExtensions`가 방출 시 `.js`로 바꾼다).
- **`erasableSyntaxOnly: true`를 끄지 않는다.** enum·namespace·parameter property 금지. 상수는 `as const` 객체로 표현한다. 이걸 어기면 개발 중 직접 실행한 결과와 배포 빌드 결과가 갈라진다.
- **tsconfig** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module`/`moduleResolution: nodenext`.
- **불변성** — 객체를 변형하지 않는다. 항상 새 객체를 만든다. 인터페이스 필드는 `readonly`로 선언한다.
- **git 호출은 argv 배열 전용.** 셸 문자열 보간을 절대 쓰지 않는다. 빈 문자열 값은 git에 도달하기 전에 거부한다.
- **`~/.gitconfig`를 텍스트로 편집하지 않는다.** 모든 쓰기는 `git config --global` 호출로만 한다.
- **백업** — `~/.gitconfig` 변경 전 백업하고, 백업 디렉토리는 `0700`, 파일은 `0600`이다.
- **매핑 경로** — 절대경로 디렉토리 접두사만. glob 금지.
- **패리티 불변식** — 프롬프트 해석과 git 해석은 항상 같은 답을 내야 한다. 5절 규칙을 바꾸면 셸 구현과 패리티 테스트를 함께 고친다.
- **파일 크기** — 파일당 200~400줄, 최대 800줄.
- **커밋** — 각 태스크 끝에서 커밋한다. 커밋 메시지는 `<type>: <description>` 형식(feat, fix, refactor, docs, test, chore).
- **`engines.node`** — `>=22.18.0`. Node 22.18.0은 무플래그 타입 스트리핑이 들어간 첫 버전이라, 그 아래에서는 `npm test`가 `.ts`에서 죽는다.
- **테스트** — `node --test`로 `.ts`를 직접 실행한다. 커버리지 기준 80%.

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `tsconfig.json` | 컴파일러 설정 |
| `biome.json` | 린트·포맷 설정 |
| `bin/index.ts` | 셔뱅 + `src/cli.ts` 호출만 |
| `src/types.ts` | 공용 타입, branded type |
| `src/cli.ts` | commander 배선만 |
| `src/core/paths.ts` | 경로 정규화·XDG 디렉토리·플랫폼 대소문자 규칙 |
| `src/core/git.ts` | execa argv 전용 래퍼 |
| `src/core/profile.ts` | 프로파일 id 슬러그·검증·색상 배정 |
| `src/core/store.ts` | zod 스키마·conf 래퍼·v1→v2 마이그레이션 |
| `src/core/mapping.ts` | 조건 문자열 생성·매핑 테이블·최장 접두사 해석 |
| `src/core/gitconfig/backup.ts` | `~/.gitconfig` 백업과 보관 개수 제한 |
| `src/core/gitconfig/profileFiles.ts` | 프로파일 gitconfig 파일 입출력 |
| `src/core/gitconfig/globalConfig.ts` | `~/.gitconfig`의 `includeIf`·`[user]` 조작 |
| `src/core/sync.ts` | 동기화 알고리즘(6절). 모든 변경 명령이 호출한다 |
| `src/commands/*.ts` | map·status·list·add·remove·unmap·default·sync·reset·shellInit |
| `src/shell/zsh.ts` `bash.ts` `fish.ts` | 셸 스니펫 생성 |
| `src/shell/resolve.md` | 셸 해석 알고리즘 명세. 패리티 테스트가 참조한다 |
| `AGENTS.md` `CLAUDE.md` | 에이전트용 문서 |

> 스펙 3.2의 트리에는 `core/sync.ts`가 없고 `commands/sync.ts`만 있었다. 동기화 알고리즘은 여러 명령이 공유하므로 core로 올리고, `commands/sync.ts`는 얇은 래퍼로 둔다.

**수정:** `package.json`, `.gitignore`, `README.md`, `LICENSE`
**삭제:** `src/cli.js`, `src/lib/*.js`, `bin/index.js`, `.eslintrc.json`

테스트는 소스 옆에 `*.test.ts`로 둔다. `tsconfig.json`의 `exclude`가 빌드에서 제외한다.

---

## Task 0: 툴체인 부트스트랩

TS 7 + ESM + Biome로 갈아끼우고, 기존 JS 소스를 걷어낸다. 스펙 11.5가 명시한 검증(선언 방출, `node --test`의 `.ts` 인식, c8 줄 번호)을 여기서 통과시킨다. **여기서 막히면 툴체인 결정을 되돌린다.**

**Files:**
- Create: `tsconfig.json`, `biome.json`, `bin/index.ts`, `src/smoke.test.ts`
- Modify: `package.json`, `.gitignore`
- Delete: `src/cli.js`, `src/lib/createUser.js`, `src/lib/deleteUser.js`, `src/lib/fetchUser.js`, `src/lib/initUser.js`, `src/lib/selectUser.js`, `bin/index.js`, `.eslintrc.json`, `yarn.lock`

**Interfaces:**
- Consumes: 없음
- Produces: 동작하는 `npm test` / `npm run typecheck` / `npm run build` / `npm run lint`

- [ ] **Step 1: 기존 JS 소스와 옛 설정 제거**

```bash
git rm -q src/cli.js src/lib/createUser.js src/lib/deleteUser.js \
  src/lib/fetchUser.js src/lib/initUser.js src/lib/selectUser.js \
  bin/index.js .eslintrc.json yarn.lock
```

- [ ] **Step 2: `package.json` 교체**

전체를 아래로 바꾼다. `name`·`bin`·`author`·`type`·`engines`가 모두 바뀐다.

```json
{
  "name": "git-user-mapper",
  "version": "1.0.0",
  "description": "Map directories to git identities and show the active profile in your shell prompt",
  "type": "module",
  "files": ["dist"],
  "bin": { "git-mapper": "dist/bin/index.js" },
  "engines": { "node": ">=22.18.0" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "node --test src/",
    "test:coverage": "c8 --check-coverage --lines 80 node --test src/",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "prepublishOnly": "npm run build"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/soohanpark/git-user-mapper"
  },
  "keywords": ["git", "git-config", "identity", "profile", "includeif", "monorepo"],
  "author": "Soohan Park <725psh@gmail.com> (https://github.com/soohanpark)",
  "license": "MIT",
  "dependencies": {
    "@inquirer/prompts": "^8.5.2",
    "chalk": "^6.0.0",
    "commander": "^15.0.0",
    "conf": "^15.1.0",
    "execa": "^10.0.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.6",
    "c8": "^10.1.3",
    "typescript": "^7.0.2"
  }
}
```

- [ ] **Step 3: `tsconfig.json` 생성**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2023"],
    "types": ["node"],
    "rootDir": ".",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true
  },
  "include": ["bin/**/*.ts", "src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist", "node_modules"]
}
```

- [ ] **Step 4: `biome.json` 생성**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.6/schema.json",
  "files": { "includes": ["**/*.ts", "**/*.json", "!dist/**", "!node_modules/**"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noNonNullAssertion": "error", "useConst": "error" },
      "suspicious": { "noExplicitAny": "error" }
    }
  }
}
```

- [ ] **Step 5: `.gitignore`에 빌드 산출물 추가**

`.gitignore`가 아래가 되도록 한다.

```
node_modules
data.json
.memsearch/
dist
coverage
```

- [ ] **Step 6: `bin/index.ts`와 `src/cli.ts` 스텁 생성**

`bin/index.ts`:

```ts
#!/usr/bin/env node
import { run } from "../src/cli.ts";

await run(process.argv);
```

`src/cli.ts` — Task 8에서 실제 구현으로 교체한다. 지금은 빌드가 성립하도록 최소한만 둔다.

```ts
export const run = async (_argv: readonly string[]): Promise<void> => {
  process.stdout.write("git-mapper: not implemented yet\n");
};
```

- [ ] **Step 7: 스모크 테스트 작성** — `.ts` 테스트가 실제로 발견·실행되는지 확인하는 것이 목적이다

`src/smoke.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

const double = (n: number): number => n * 2;

test("node --test runs TypeScript files directly", () => {
  assert.equal(double(21), 42);
});
```

- [ ] **Step 8: 의존성 설치와 툴체인 검증** — 스펙 11.5의 검증 항목

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
node -e "import('node:fs').then(fs => console.log(fs.existsSync('dist/bin/index.js'), fs.existsSync('dist/src/cli.d.ts')))"
```

기대: `npm test`가 스모크 테스트 1개를 통과시킨다. `npm run build`가 `dist/`에 JS와 `.d.ts`를 방출하고 마지막 명령이 `true true`를 출력한다. 방출된 `dist/bin/index.js`의 import가 `../src/cli.js`로 바뀌어 있어야 한다(`rewriteRelativeImportExtensions` 확인).

**이 단계에서 `tsc`가 선언을 방출하지 못하거나 `node --test`가 `.ts`를 인식하지 못하면 즉시 중단하고 보고한다.** 스펙 15절의 "TS 7 생태계 지연" 위험이 현실화된 경우다.

- [ ] **Step 9: 커버리지 도구가 `.ts` 줄 번호를 맞게 잡는지 확인**

```bash
npx c8 --reporter=text node --test src/smoke.test.ts
```

기대: 리포트에 `smoke.test.ts`가 나타나고 커버리지가 100%에 가깝다. 타입 스트리핑은 타입을 공백으로 치환하므로 줄 번호가 원본과 1:1이다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "chore: migrate toolchain to TypeScript 7 + ESM + Biome"
```

---

## Task 1: 경로 유틸리티와 공용 타입

모든 경로가 지나가는 관문이다. 여기서만 `AbsolutePath` branded type이 만들어지므로, 정규화되지 않은 경로는 타입 수준에서 매핑에 들어갈 수 없다.

**Files:**
- Create: `src/types.ts`, `src/core/paths.ts`, `src/core/paths.test.ts`
- Delete: `src/smoke.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type ProfileId`, `type AbsolutePath` (branded)
  - `interface Profile`, `interface StoreV2`, `interface StoreV1`, `type ResolutionState`
  - `isCaseInsensitive(platform?: NodeJS.Platform): boolean`
  - `expandTilde(input: string, home?: string): string`
  - `toAbsolutePath(input: string, cwd?: string): AbsolutePath`
  - `unsafeAbsolutePath(value: string): AbsolutePath` — 검증된 값을 브랜딩만 하는 용도(스토어 로드 등)
  - `configDir(env?, home?): string`, `profilesDir(...)`, `backupsDir(...)`, `mappingFilePath(...)`
  - `findRepoRoot(start: AbsolutePath): AbsolutePath | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/paths.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  configDir,
  expandTilde,
  findRepoRoot,
  isCaseInsensitive,
  mappingFilePath,
  toAbsolutePath,
  unsafeAbsolutePath,
} from "./paths.ts";

test("expandTilde expands a leading ~ only", () => {
  assert.equal(expandTilde("~/dev", "/home/me"), "/home/me/dev");
  assert.equal(expandTilde("~", "/home/me"), "/home/me");
  assert.equal(expandTilde("/tmp/~/x", "/home/me"), "/tmp/~/x");
  assert.equal(expandTilde("~notauser/x", "/home/me"), "~notauser/x");
});

test("toAbsolutePath strips trailing slashes and normalizes separators", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-paths-"));
  const result = toAbsolutePath(`${dir}/`);
  assert.ok(!result.endsWith("/"), `expected no trailing slash, got ${result}`);
  assert.ok(!result.includes("\\"), `expected forward slashes, got ${result}`);
});

test("toAbsolutePath resolves symlinks so git and the shell agree", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-link-")));
  const real = path.join(base, "real");
  const link = path.join(base, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link);
  assert.equal(toAbsolutePath(link), toAbsolutePath(real));
});

test("toAbsolutePath keeps non-existent paths absolute instead of throwing", () => {
  const result = toAbsolutePath("/definitely/not/here/xyz");
  assert.equal(result, "/definitely/not/here/xyz");
});

test("toAbsolutePath rethrows a realpath failure that is not ENOENT", () => {
  // 심볼릭 링크 순환은 이식성 있게 ELOOP를 만든다. 이걸 삼키면 링크가 풀리지 않은
  // 경로가 브랜딩되어 git과 답이 갈라지므로, 조용히 넘어가면 안 된다.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-loop-")));
  const a = path.join(base, "a");
  const b = path.join(base, "b");
  fs.symlinkSync(b, a);
  fs.symlinkSync(a, b);

  assert.throws(
    () => toAbsolutePath(a),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ELOOP",
  );
});

test("isCaseInsensitive follows the platform", () => {
  assert.equal(isCaseInsensitive("darwin"), true);
  assert.equal(isCaseInsensitive("win32"), true);
  assert.equal(isCaseInsensitive("linux"), false);
});

test("configDir honours XDG_CONFIG_HOME", () => {
  assert.equal(configDir({ XDG_CONFIG_HOME: "/x/cfg" }, "/home/me"), "/x/cfg/git-user-mapper");
  assert.equal(configDir({}, "/home/me"), "/home/me/.config/git-user-mapper");
  assert.equal(mappingFilePath({}, "/home/me"), "/home/me/.config/git-user-mapper/mapping.tsv");
});

test("findRepoRoot walks up to the nearest .git and returns null outside a repo", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-root-")));
  const repo = path.join(base, "repo");
  const nested = path.join(repo, "a", "b");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(repo, ".git"));

  assert.equal(findRepoRoot(unsafeAbsolutePath(nested)), unsafeAbsolutePath(repo));
  assert.equal(findRepoRoot(unsafeAbsolutePath(repo)), unsafeAbsolutePath(repo));
  assert.equal(findRepoRoot(unsafeAbsolutePath(base)), null);
});

test("findRepoRoot treats a .git file as a repo root (worktrees, submodules)", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-wt-")));
  const repo = path.join(base, "wt");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  assert.equal(findRepoRoot(unsafeAbsolutePath(repo)), unsafeAbsolutePath(repo));
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './paths.ts'`

- [ ] **Step 3: `src/types.ts` 작성**

```ts
declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 검증을 통과한 프로파일 식별자. `^[a-z0-9][a-z0-9-]{0,31}$` */
export type ProfileId = Brand<string, "ProfileId">;

/** 정규화·심볼릭 링크 해석이 끝난 절대경로. 후행 슬래시 없음, 구분자는 `/`. */
export type AbsolutePath = Brand<string, "AbsolutePath">;

export interface Profile {
  readonly id: ProfileId;
  readonly name: string;
  readonly email: string;
  readonly signingKey: string | null;
  readonly color: string;
  readonly paths: readonly AbsolutePath[];
}

export interface StoreV2 {
  readonly version: 2;
  readonly defaultProfile: ProfileId | null;
  readonly profiles: readonly Profile[];
  readonly managedConditions: readonly string[];
}

export interface StoreV1User {
  readonly name: string;
  readonly email: string;
  /**
   * `exactOptionalPropertyTypes` 아래에서는 `?: string | null`이 "없거나 string|null"만
   * 뜻하고 `undefined`가 실린 경우를 배제한다. zod의 `.optional()`은
   * `string | null | undefined`로 추론하므로 `| undefined`를 명시해야 검증 결과를
   * 캐스트 없이 그대로 받을 수 있다.
   */
  readonly signingKey?: string | null | undefined;
}

export interface StoreV1 {
  readonly users: readonly StoreV1User[];
}

/**
 * 프롬프트와 `status`가 공유하는 상태.
 * 여기에 값을 추가하면 셸 렌더링 분기(8.2 표)도 함께 고쳐야 한다.
 */
export type ResolutionState = "mapped" | "default" | "local-override" | "no-identity";
```

- [ ] **Step 4: `src/core/paths.ts` 작성**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AbsolutePath } from "../types.ts";

const APP_DIR = "git-user-mapper";

export const isCaseInsensitive = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === "darwin" || platform === "win32";

export const expandTilde = (input: string, home: string = os.homedir()): string => {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
};

const normalizeSeparators = (value: string): string => value.replaceAll("\\", "/");

const stripTrailingSlash = (value: string): string =>
  value.length > 1 && value.endsWith("/") ? value.replace(/\/+$/, "") : value;

/** 검증 없이 브랜딩만 한다. 이미 정규화된 값(스토어에서 읽은 값)에만 쓴다. */
export const unsafeAbsolutePath = (value: string): AbsolutePath => value as AbsolutePath;

export const toAbsolutePath = (input: string, cwd: string = process.cwd()): AbsolutePath => {
  const resolved = path.resolve(cwd, expandTilde(input));
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch (error) {
    // 존재하지 않는 경로는 해석하지 않고 그대로 쓴다. 호출자가 존재 여부를 판단한다.
    // 권한·순환 같은 다른 실패까지 삼키면 심볼릭 링크가 풀리지 않은 경로가
    // 그대로 브랜딩되어 git이 해석한 경로와 조용히 갈라진다.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return unsafeAbsolutePath(stripTrailingSlash(normalizeSeparators(real)));
};

export const configDir = (
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string => path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), APP_DIR);

export const profilesDir = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "profiles");

export const backupsDir = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "backups");

export const mappingFilePath = (env?: NodeJS.ProcessEnv, home?: string): string =>
  path.join(configDir(env, home), "mapping.tsv");

export const globalGitConfigPath = (home: string = os.homedir()): string =>
  path.join(home, ".gitconfig");

/** `.git`이 디렉토리든 파일이든 저장소 루트로 본다(worktree·submodule 포함). */
export const findRepoRoot = (start: AbsolutePath): AbsolutePath | null => {
  let current = start;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = unsafeAbsolutePath(normalizeSeparators(path.dirname(current)));
    if (parent === current) return null;
    current = parent;
  }
};
```

- [ ] **Step 5: 스모크 테스트 제거하고 테스트 통과 확인**

```bash
git rm -q src/smoke.test.ts
npm test
```

Expected: PASS — `paths.test.ts`의 9개 테스트가 모두 통과

- [ ] **Step 6: 타입체크와 린트**

```bash
npm run typecheck && npm run lint
```

Expected: 둘 다 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: add path utilities and branded core types"
```

## Task 2: git 호출 래퍼

모든 git 호출이 지나가는 유일한 통로다. argv 배열만 받고 셸을 거치지 않으며, 빈 인자를 거부한다. 2026-07-31에 고친 "빈 값이 쓰기를 읽기로 퇴화시키는" 버그의 재발 방지가 여기 있다.

**Files:**
- Create: `src/core/git.ts`, `src/core/git.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `class GitError extends Error` — `exitCode: number | undefined`, `stderr: string`
  - `interface GitOptions { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv }`
  - `git(args: readonly string[], options?: GitOptions): Promise<string>` — stdout를 trim해서 반환
  - `gitOrNull(args: readonly string[], options?: GitOptions): Promise<string | null>`
  - `gitVersion(): Promise<{ readonly major: number; readonly minor: number }>`
  - `supportsIncludeIf(v: { major: number; minor: number }): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/git.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GitError, git, gitOrNull, gitVersion, supportsIncludeIf } from "./git.ts";

const tempConfig = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-git-"));
  return path.join(dir, "config");
};

test("git returns trimmed stdout", async () => {
  const out = await git(["--version"]);
  assert.match(out, /^git version /);
});

test("git passes values as argv so shell metacharacters stay literal", async () => {
  const cfg = tempConfig();
  // 테스트 전용 임시 디렉토리 안을 노린다. 고정된 /tmp 경로를 쓰면 이전 실행이 남긴
  // 파일 때문에 멀쩡한 코드가 빨개진다(거짓 통과는 불가능하지만 거짓 실패는 가능하다).
  const pwned = path.join(path.dirname(cfg), "pwned");
  const hostile = `Soo han; touch ${pwned} $(id) \`id\` && ls`;
  await git(["config", "--file", cfg, "user.name", hostile]);
  assert.equal(await git(["config", "--file", cfg, "user.name"]), hostile);
  assert.equal(fs.existsSync(pwned), false);
});

test("git refuses an empty argument instead of silently degrading to a read", async () => {
  const cfg = tempConfig();
  await git(["config", "--file", cfg, "user.name", "before"]);
  await assert.rejects(
    () => git(["config", "--file", cfg, "user.name", ""]),
    (error: unknown) => error instanceof GitError && /empty/.test((error as GitError).message),
  );
  assert.equal(await git(["config", "--file", cfg, "user.name"]), "before");
});

test("git throws GitError carrying the exit code", async () => {
  const cfg = tempConfig();
  await assert.rejects(
    () => git(["config", "--file", cfg, "--get", "nope.missing"]),
    (error: unknown) => error instanceof GitError && (error as GitError).exitCode === 1,
  );
});

test("gitOrNull turns a non-zero git exit into null", async () => {
  const cfg = tempConfig();
  assert.equal(await gitOrNull(["config", "--file", cfg, "--get", "nope.missing"]), null);
});

test("gitOrNull rethrows when git never ran, so unset stays distinct from broken", async () => {
  const cfg = tempConfig();
  await assert.rejects(
    () => gitOrNull(["config", "--file", cfg, "user.name", ""]),
    (error: unknown) => error instanceof GitError && error.exitCode === undefined,
  );
});

test("gitVersion parses major and minor", async () => {
  const version = await gitVersion();
  assert.ok(version.major >= 2, `unexpected major ${version.major}`);
  assert.equal(typeof version.minor, "number");
});

test("supportsIncludeIf requires git 2.13", () => {
  assert.equal(supportsIncludeIf({ major: 2, minor: 13 }), true);
  assert.equal(supportsIncludeIf({ major: 2, minor: 12 }), false);
  assert.equal(supportsIncludeIf({ major: 3, minor: 0 }), true);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './git.ts'`

- [ ] **Step 3: `src/core/git.ts` 작성**

```ts
import { execa } from "execa";

export class GitError extends Error {
  readonly exitCode: number | undefined;
  readonly stderr: string;

  constructor(message: string, exitCode?: number, stderr = "") {
    super(message);
    this.name = "GitError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface GitOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface ExecaFailure {
  readonly shortMessage?: string;
  readonly message?: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

/**
 * 스토어는 사용자가 직접 편집할 수 있는 파일이므로, 타입만 믿지 않고 git에 넘기기
 * 직전에 한 번 더 확인한다.
 *
 * 빈 값을 막는 이유: argv로 넘기면 `git config <key> ""`는 빈 문자열을 그대로 기록하는
 * 정상적인 쓰기가 되어, identity가 조용히 빈 값이 된다. 포크한 원본에서는 같은 입력이
 * 문자열 보간 때문에 아예 읽기 명령으로 퇴화했다. 메커니즘은 다르지만 결과는 같다 —
 * "성공했다고 말하면서 identity는 틀린" 상태다.
 */
const validateArgs = (args: readonly string[]): void => {
  for (const [index, arg] of args.entries()) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new GitError(`refusing to run git: argument ${index} is empty or not a string`);
    }
  }
};

export const git = async (args: readonly string[], options: GitOptions = {}): Promise<string> => {
  validateArgs(args);
  try {
    const result = await execa("git", args, options);
    return result.stdout.trim();
  } catch (error) {
    const failure = error as ExecaFailure;
    throw new GitError(
      failure.shortMessage ?? failure.message ?? "git failed",
      failure.exitCode,
      failure.stderr ?? "",
    );
  }
};

/**
 * 값이 없는 상태를 오류가 아니라 값으로 다룬다. `git config --get`은 키가 없으면 1로,
 * `--remove-section`·`--unset`은 대상이 없으면 5로 끝난다. 둘 다 정상 경로다.
 *
 * 다만 git이 **실행조차 되지 않은** 경우(바이너리 없음, 권한 문제)와 우리 인자 검증이
 * 막은 경우는 호출자 버그거나 환경 문제다. 그것까지 null로 뭉개면 "설정이 없음"과
 * "무언가 고장남"을 호출자가 구분할 수 없으므로 그대로 던진다.
 */
export const gitOrNull = async (
  args: readonly string[],
  options: GitOptions = {},
): Promise<string | null> => {
  try {
    return await git(args, options);
  } catch (error) {
    if (error instanceof GitError && error.exitCode !== undefined) return null;
    throw error;
  }
};

export const gitVersion = async (): Promise<{ readonly major: number; readonly minor: number }> => {
  const output = await git(["--version"]);
  const match = /(\d+)\.(\d+)/.exec(output);
  if (!match) throw new GitError(`could not parse git version from ${JSON.stringify(output)}`);
  return { major: Number(match[1]), minor: Number(match[2]) };
};

/** `includeIf "gitdir:"`는 git 2.13에서 도입됐다. */
export const supportsIncludeIf = (v: { readonly major: number; readonly minor: number }): boolean =>
  v.major > 2 || (v.major === 2 && v.minor >= 13);
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
```

Expected: PASS — 8개 테스트 통과

- [ ] **Step 5: 타입체크·린트하고 커밋**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add argv-only git wrapper that rejects empty arguments"
```

---

## Task 3: 프로파일 규칙과 스토어

프로파일 id 규칙, 색상 배정, zod 경계 검증, v1→v2 마이그레이션을 한 번에 만든다. 마이그레이션이 id 슬러그를 필요로 해서 두 모듈이 함께 움직인다.

**Files:**
- Create: `src/core/profile.ts`, `src/core/profile.test.ts`, `src/core/store.ts`, `src/core/store.test.ts`

**Interfaces:**
- Consumes: `types.ts`의 `Profile`·`ProfileId`·`StoreV1`·`StoreV2`, `paths.ts`의 `unsafeAbsolutePath`
- Produces:
  - `isProfileId(value: string): value is ProfileId`
  - `toProfileId(value: string): ProfileId` — 위반 시 throw
  - `slugify(source: string): string`
  - `uniqueId(desired: string, taken: ReadonlySet<string>): ProfileId`
  - `pickColor(index: number): string`
  - `emptyStore(): StoreV2`
  - `parseStore(raw: unknown, options?: MigrateOptions): StoreV2`
  - `migrateV1(v1: StoreV1, options?: MigrateOptions): StoreV2`
  - `interface MigrateOptions { readonly currentGlobalEmail?: string | null; readonly nameFor?: (user: StoreV1User, index: number) => string }`
  - `interface StoreHandle { readonly path: string; read(): StoreV2; write(next: StoreV2): void }`
  - `openStore(options?: { readonly cwd?: string; readonly now?: string }): StoreHandle`

- [ ] **Step 1: 프로파일 규칙 테스트 작성**

`src/core/profile.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './profile.ts'`

- [ ] **Step 3: `src/core/profile.ts` 작성**

```ts
import type { ProfileId } from "../types.ts";

export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const PALETTE = ["blue", "magenta", "green", "cyan", "yellow", "red"] as const;

export const isProfileId = (value: string): value is ProfileId => PROFILE_ID_PATTERN.test(value);

export const toProfileId = (value: string): ProfileId => {
  if (!isProfileId(value)) {
    throw new Error(
      `Invalid profile id ${JSON.stringify(value)}. ` +
        "Use lowercase letters, digits and hyphens, starting with a letter or digit (max 32 characters).",
    );
  }
  return value;
};

export const slugify = (source: string): string => {
  const localPart = source.split("@")[0] ?? "";
  const trimmed = localPart
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 32)
    .replaceAll(/-+$/g, "");
  return trimmed === "" ? "profile" : trimmed;
};

export const uniqueId = (desired: string, taken: ReadonlySet<string>): ProfileId => {
  const base = slugify(desired);
  if (!taken.has(base)) return toProfileId(base);
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 30)}-${suffix}`;
    if (!taken.has(candidate)) return toProfileId(candidate);
  }
};

export const pickColor = (index: number): string => PALETTE[index % PALETTE.length] ?? "blue";
```

- [ ] **Step 4: 스토어 테스트 작성**

`src/core/store.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProfileId, StoreV2 } from "../types.ts";
import { emptyStore, migrateV1, openStore, parseStore } from "./store.ts";

const id = (value: string): ProfileId => value as ProfileId;

test("parseStore accepts an empty or missing store", () => {
  assert.deepEqual(parseStore(undefined), emptyStore());
  assert.deepEqual(parseStore({}), emptyStore());
  assert.deepEqual(parseStore({ users: [] }), emptyStore());
});

test("parseStore round-trips a valid v2 store", () => {
  const store = {
    version: 2,
    defaultProfile: "work",
    profiles: [
      {
        id: "work",
        name: "soohanpark",
        email: "soohan.park@nexpace.io",
        signingKey: null,
        color: "blue",
        paths: ["/Users/me/dev/msu"],
      },
    ],
    managedConditions: ["gitdir/i:/Users/me/dev/msu/"],
  };
  assert.deepEqual(parseStore(store), store);
});

test("migrateV1 derives ids from emails and keeps signing keys", () => {
  const result = migrateV1({
    users: [
      { name: "soohanpark", email: "soohan.park@nexpace.io" },
      { name: "soohanpark", email: "725psh@gmail.com", signingKey: "ABCD1234" },
    ],
  });
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    ["soohan-park", "725psh"],
  );
  assert.equal(result.profiles[0]?.signingKey, null);
  assert.equal(result.profiles[1]?.signingKey, "ABCD1234");
  assert.deepEqual(result.profiles[0]?.paths, []);
  assert.deepEqual(result.managedConditions, []);
  assert.equal(result.version, 2);
});

test("migrateV1 picks the default from the current global email", () => {
  const v1 = {
    users: [
      { name: "a", email: "a@example.com" },
      { name: "b", email: "b@example.com" },
    ],
  };
  assert.equal(migrateV1(v1, { currentGlobalEmail: "b@example.com" }).defaultProfile, "b");
  assert.equal(migrateV1(v1).defaultProfile, "a");
  assert.equal(migrateV1({ users: [] }).defaultProfile, null);
});

test("migrateV1 resolves id collisions", () => {
  const result = migrateV1({
    users: [
      { name: "a", email: "same@one.com" },
      { name: "b", email: "same@two.com" },
    ],
  });
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    ["same", "same-2"],
  );
});

test("migrateV1 honours an explicit naming function", () => {
  const result = migrateV1(
    { users: [{ name: "a", email: "a@example.com" }] },
    { nameFor: () => "work" },
  );
  assert.equal(result.profiles[0]?.id, "work");
});

test("parseStore reports corruption instead of writing garbage to git", () => {
  assert.throws(() => parseStore({ version: 2, profiles: "nope" }), /store is corrupted/);
});

test("openStore migrates a v1 file on disk and backs it up first", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gum-store-"));
  const handle = openStore({ cwd, now: "2026-07-31T00-00-00" });
  fs.writeFileSync(
    handle.path,
    JSON.stringify({ users: [{ name: "soohanpark", email: "soohan.park@nexpace.io" }] }),
  );

  const migrated = openStore({ cwd, now: "2026-07-31T00-00-00" }).read();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.profiles[0]?.id, "soohan-park");

  const backup = path.join(path.dirname(handle.path), "store.v1.2026-07-31T00-00-00.bak");
  assert.equal(fs.existsSync(backup), true);

  // 마이그레이션은 디스크에 확정되어야 한다. 그래야 id가 유지되고 백업이 쌓이지 않는다.
  assert.equal(JSON.parse(fs.readFileSync(handle.path, "utf8")).version, 2);
});

test("openStore persists what it writes", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gum-store-rw-"));
  const next: StoreV2 = {
    version: 2,
    defaultProfile: id("work"),
    profiles: [
      { id: id("work"), name: "n", email: "e@x.com", signingKey: null, color: "blue", paths: [] },
    ],
    managedConditions: [],
  };
  openStore({ cwd }).write(next);
  assert.deepEqual(openStore({ cwd }).read(), next);
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './store.ts'`

- [ ] **Step 6: `src/core/store.ts` 작성**

```ts
import fs from "node:fs";
import path from "node:path";
import Conf from "conf";
import { z } from "zod";
import type { AbsolutePath, Profile, StoreV1, StoreV1User, StoreV2 } from "../types.ts";
import { unsafeAbsolutePath } from "./paths.ts";
import { PROFILE_ID_PATTERN, pickColor, toProfileId, uniqueId } from "./profile.ts";

const profileIdSchema = z.string().regex(PROFILE_ID_PATTERN);

const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1),
  email: z.string().min(1),
  signingKey: z.string().min(1).nullable(),
  color: z.string().min(1),
  paths: z.array(z.string().min(1)),
});

const storeV2Schema = z.object({
  version: z.literal(2),
  defaultProfile: profileIdSchema.nullable(),
  profiles: z.array(profileSchema),
  managedConditions: z.array(z.string().min(1)),
});

const storeV1Schema = z.object({
  users: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      signingKey: z.string().nullable().optional(),
    }),
  ),
});

export interface MigrateOptions {
  readonly currentGlobalEmail?: string | null;
  readonly nameFor?: (user: StoreV1User, index: number) => string;
}

export const emptyStore = (): StoreV2 => ({
  version: 2,
  defaultProfile: null,
  profiles: [],
  managedConditions: [],
});

const brandProfile = (raw: z.infer<typeof profileSchema>): Profile => ({
  id: toProfileId(raw.id),
  name: raw.name,
  email: raw.email,
  signingKey: raw.signingKey,
  color: raw.color,
  paths: raw.paths.map(unsafeAbsolutePath) as readonly AbsolutePath[],
});

export const migrateV1 = (v1: StoreV1, options: MigrateOptions = {}): StoreV2 => {
  const taken = new Set<string>();
  const profiles = v1.users.map((user, index): Profile => {
    const id = uniqueId(options.nameFor?.(user, index) ?? user.email, taken);
    taken.add(id);
    return {
      id,
      name: user.name,
      email: user.email,
      signingKey: user.signingKey ?? null,
      color: pickColor(index),
      paths: [],
    };
  });

  const matched = options.currentGlobalEmail
    ? profiles.find((profile) => profile.email === options.currentGlobalEmail)
    : undefined;

  return {
    version: 2,
    defaultProfile: matched?.id ?? profiles[0]?.id ?? null,
    profiles,
    managedConditions: [],
  };
};

export const parseStore = (raw: unknown, options: MigrateOptions = {}): StoreV2 => {
  if (raw === null || raw === undefined) return emptyStore();
  if (typeof raw === "object" && Object.keys(raw).length === 0) return emptyStore();

  const v2 = storeV2Schema.safeParse(raw);
  if (v2.success) {
    return {
      version: 2,
      defaultProfile: v2.data.defaultProfile === null ? null : toProfileId(v2.data.defaultProfile),
      profiles: v2.data.profiles.map(brandProfile),
      managedConditions: v2.data.managedConditions,
    };
  }

  const v1 = storeV1Schema.safeParse(raw);
  if (v1.success) return migrateV1(v1.data, options);

  throw new Error(
    `The git-user-mapper store is corrupted and was not modified.\n${JSON.stringify(v2.error.issues, null, 2)}`,
  );
};

export interface StoreHandle {
  readonly path: string;
  read(): StoreV2;
  write(next: StoreV2): void;
}

export interface OpenStoreOptions {
  readonly cwd?: string;
  readonly now?: string;
  readonly migrate?: MigrateOptions;
}

const isV1OnDisk = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && "users" in raw && !("version" in raw);

export const openStore = (options: OpenStoreOptions = {}): StoreHandle => {
  const conf = new Conf<Record<string, unknown>>({
    projectName: "git-user-mapper",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  const persist = (next: StoreV2): void => {
    conf.store = next as unknown as Record<string, unknown>;
  };

  // v1을 발견하면 열 때 한 번만 백업하고 결과를 디스크에 확정한다.
  // read()에서만 변환하면 마이그레이션이 영속되지 않아 대화형으로 정한
  // 프로파일 id가 사라지고, 실행할 때마다 새 백업이 쌓인다.
  const raw = conf.store;
  if (isV1OnDisk(raw) && fs.existsSync(conf.path)) {
    const stamp = options.now ?? new Date().toISOString().replaceAll(":", "-");
    const backup = path.join(path.dirname(conf.path), `store.v1.${stamp}.bak`);
    if (!fs.existsSync(backup)) fs.copyFileSync(conf.path, backup);
    persist(parseStore(raw, options.migrate ?? {}));
  }

  return {
    path: conf.path,
    read: (): StoreV2 => parseStore(conf.store, options.migrate ?? {}),
    write: persist,
  };
};
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — profile 6개 + store 9개 통과

- [ ] **Step 8: 타입체크·린트하고 커밋**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add profile id rules and zod-validated store with v1 migration"
```

## Task 4: 매핑 해석

스펙 5절 규칙의 유일한 구현이다. 셸 스니펫(Task 12)이 이 규칙을 재현하고, 패리티 테스트(Task 13)가 둘이 일치하는지 검사한다. **이 파일을 고치면 그 둘도 함께 고쳐야 한다.**

> 스펙 11.3은 `mapping.tsv` 파싱에도 zod를 쓰라고 했다. 실제로 이 파일을 런타임에 읽는 것은 셸 스니펫이고 `parseTable`은 왕복 테스트에서만 쓰이므로, zod 스키마 대신 `toProfileId` 검증과 형식이 깨진 줄 무시로 처리한다. 사용자 편집 입력에 대한 런타임 검증이라는 11.3의 취지는 지켜진다.

**Files:**
- Create: `src/core/mapping.ts`, `src/core/mapping.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `paths.ts`의 `isCaseInsensitive`
- Produces:
  - `interface MappingEntry { readonly path: AbsolutePath; readonly profileId: ProfileId; readonly color: string; readonly email: string }`
  - `interface FallbackEntry { readonly profileId: ProfileId; readonly color: string; readonly email: string }`
  - `interface MappingTable { readonly entries: readonly MappingEntry[]; readonly fallback: FallbackEntry | null }`
  - `interface Resolved { readonly state: "mapped" | "default" | "no-identity"; readonly profileId: ProfileId | null; readonly color: string | null; readonly email: string | null }`
  - `conditionFor(target: AbsolutePath, caseInsensitive?: boolean): string`
  - `buildTable(store: StoreV2): MappingTable`
  - `resolve(table: MappingTable, repoRoot: AbsolutePath, caseInsensitive?: boolean): Resolved`
  - `serializeTable(table: MappingTable): string`
  - `parseTable(text: string): MappingTable`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/mapping.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { buildTable, conditionFor, parseTable, resolve, serializeTable } from "./mapping.ts";

const p = (value: string): AbsolutePath => value as AbsolutePath;
const id = (value: string): ProfileId => value as ProfileId;

const store: StoreV2 = {
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    {
      id: id("work"),
      name: "n",
      email: "work@x.com",
      signingKey: null,
      color: "blue",
      paths: [p("/home/me/dev")],
    },
    {
      id: id("personal"),
      name: "n",
      email: "me@x.com",
      signingKey: null,
      color: "magenta",
      paths: [p("/home/me/dev/personal"), p("/home/me/oss")],
    },
  ],
  managedConditions: [],
};

test("conditionFor is case-insensitive on darwin and windows only", () => {
  assert.equal(conditionFor(p("/home/me/dev"), true), "gitdir/i:/home/me/dev/");
  assert.equal(conditionFor(p("/home/me/dev"), false), "gitdir:/home/me/dev/");
});

test("buildTable sorts entries longest-first and extracts the fallback", () => {
  const table = buildTable(store);
  // /home/me/oss 와 /home/me/dev 는 길이가 같으므로 localeCompare 오름차순이 순서를
  // 정한다. 동률의 상대 순서는 해석 결과를 바꾸지 않지만(같은 길이의 두 경로가 한
  // 대상에 동시에 매치되려면 서로 같아야 한다) 출력이 실행마다 흔들리면 안 된다.
  assert.deepEqual(
    table.entries.map((e) => e.path),
    ["/home/me/dev/personal", "/home/me/dev", "/home/me/oss"],
  );
  assert.equal(table.fallback?.profileId, "work");
  assert.equal(table.fallback?.email, "work@x.com");
});

test("buildTable has no fallback when defaultProfile is null", () => {
  assert.equal(buildTable({ ...store, defaultProfile: null }).fallback, null);
});

test("resolve returns the longest matching prefix", () => {
  const table = buildTable(store);
  assert.equal(resolve(table, p("/home/me/dev/personal/mar"), false).profileId, "personal");
  assert.equal(resolve(table, p("/home/me/dev/msu"), false).profileId, "work");
  assert.equal(resolve(table, p("/home/me/dev/personal"), false).profileId, "personal");
});

test("resolve does not match a sibling that merely shares a prefix string", () => {
  const table = buildTable(store);
  const result = resolve(table, p("/home/me/development"), false);
  assert.equal(result.state, "default");
  assert.equal(result.profileId, "work");
});

test("resolve falls back to the default profile and reports the state", () => {
  const table = buildTable(store);
  const result = resolve(table, p("/tmp/elsewhere"), false);
  assert.equal(result.state, "default");
  assert.equal(result.email, "work@x.com");

  const mapped = resolve(table, p("/home/me/oss/thing"), false);
  assert.equal(mapped.state, "mapped");
  assert.equal(mapped.color, "magenta");
});

test("resolve reports no-identity when nothing matches and there is no fallback", () => {
  const table = buildTable({ ...store, defaultProfile: null });
  const result = resolve(table, p("/tmp/elsewhere"), false);
  assert.equal(result.state, "no-identity");
  assert.equal(result.profileId, null);
});

test("resolve honours the case sensitivity flag", () => {
  const table = buildTable(store);
  assert.equal(resolve(table, p("/home/me/DEV/personal/x"), true).profileId, "personal");
  assert.equal(resolve(table, p("/home/me/DEV/personal/x"), false).state, "default");
});

test("serializeTable round-trips through parseTable", () => {
  const table = buildTable(store);
  const parsed = parseTable(serializeTable(table));
  assert.deepEqual(parsed, table);
});

test("serializeTable puts the fallback on a * line and sorts longest-first", () => {
  const lines = serializeTable(buildTable(store)).trimEnd().split("\n");
  assert.equal(lines[0], "*\twork\tblue\twork@x.com");
  assert.equal(lines[1], "/home/me/dev/personal\tpersonal\tmagenta\tme@x.com");
});

test("serializeTable refuses values containing a tab or newline", () => {
  const broken = buildTable({
    ...store,
    profiles: store.profiles.map((profile) => ({ ...profile, paths: [p("/home/me/we\tird")] })),
  });
  assert.throws(() => serializeTable(broken), /tab or newline/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './mapping.ts'`

- [ ] **Step 3: `src/core/mapping.ts` 작성**

```ts
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { isCaseInsensitive, unsafeAbsolutePath } from "./paths.ts";
import { toProfileId } from "./profile.ts";

export interface MappingEntry {
  readonly path: AbsolutePath;
  readonly profileId: ProfileId;
  readonly color: string;
  readonly email: string;
}

export interface FallbackEntry {
  readonly profileId: ProfileId;
  readonly color: string;
  readonly email: string;
}

export interface MappingTable {
  /** 경로 길이 내림차순. 첫 매치가 곧 최장 매치다. */
  readonly entries: readonly MappingEntry[];
  readonly fallback: FallbackEntry | null;
}

export interface Resolved {
  readonly state: "mapped" | "default" | "no-identity";
  readonly profileId: ProfileId | null;
  readonly color: string | null;
  readonly email: string | null;
}

/** 후행 슬래시가 git에게 `**`를 덧붙이게 만들어 하위 전체에 재귀 적용된다. */
export const conditionFor = (
  target: AbsolutePath,
  caseInsensitive: boolean = isCaseInsensitive(),
): string => `${caseInsensitive ? "gitdir/i" : "gitdir"}:${target}/`;

export const buildTable = (store: StoreV2): MappingTable => {
  const entries = store.profiles
    .flatMap((profile) =>
      profile.paths.map(
        (target): MappingEntry => ({
          path: target,
          profileId: profile.id,
          color: profile.color,
          email: profile.email,
        }),
      ),
    )
    .toSorted((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path));

  const defaultProfile = store.profiles.find((profile) => profile.id === store.defaultProfile);

  return {
    entries,
    fallback: defaultProfile
      ? {
          profileId: defaultProfile.id,
          color: defaultProfile.color,
          email: defaultProfile.email,
        }
      : null,
  };
};

const matches = (entryPath: string, target: string, caseInsensitive: boolean): boolean => {
  const a = caseInsensitive ? entryPath.toLowerCase() : entryPath;
  const b = caseInsensitive ? target.toLowerCase() : target;
  return b === a || b.startsWith(`${a}/`);
};

export const resolve = (
  table: MappingTable,
  repoRoot: AbsolutePath,
  caseInsensitive: boolean = isCaseInsensitive(),
): Resolved => {
  const hit = table.entries.find((entry) => matches(entry.path, repoRoot, caseInsensitive));
  if (hit) {
    return { state: "mapped", profileId: hit.profileId, color: hit.color, email: hit.email };
  }
  if (table.fallback) {
    return {
      state: "default",
      profileId: table.fallback.profileId,
      color: table.fallback.color,
      email: table.fallback.email,
    };
  }
  return { state: "no-identity", profileId: null, color: null, email: null };
};

const assertSerializable = (values: readonly string[]): void => {
  for (const value of values) {
    if (value.includes("\t") || value.includes("\n")) {
      throw new Error(
        `Cannot write mapping table: ${JSON.stringify(value)} contains a tab or newline.`,
      );
    }
  }
};

export const serializeTable = (table: MappingTable): string => {
  const lines: string[] = [];
  if (table.fallback) {
    const row = [table.fallback.profileId, table.fallback.color, table.fallback.email];
    assertSerializable(row);
    lines.push(["*", ...row].join("\t"));
  }
  for (const entry of table.entries) {
    const row = [entry.path, entry.profileId, entry.color, entry.email];
    assertSerializable(row);
    lines.push(row.join("\t"));
  }
  return `${lines.join("\n")}\n`;
};

export const parseTable = (text: string): MappingTable => {
  const entries: MappingEntry[] = [];
  let fallback: FallbackEntry | null = null;

  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [first, second, third, fourth] = line.split("\t");
    if (first === undefined || second === undefined || third === undefined) continue;
    if (first === "*") {
      fallback = { profileId: toProfileId(second), color: third, email: fourth ?? "" };
      continue;
    }
    if (fourth === undefined) continue;
    entries.push({
      path: unsafeAbsolutePath(first),
      profileId: toProfileId(second),
      color: third,
      email: fourth,
    });
  }

  return { entries, fallback };
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — mapping 11개 통과

- [ ] **Step 5: 타입체크·린트하고 커밋**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add mapping resolution with longest-prefix matching"
```

---

## Task 5: 백업과 프로파일 파일

`~/.gitconfig`에 자격증명이 평문으로 들어 있을 수 있으므로 백업 권한이 보안 요구사항이다(스펙 9절).

**Files:**
- Create: `src/core/gitconfig/backup.ts`, `src/core/gitconfig/backup.test.ts`, `src/core/gitconfig/profileFiles.ts`, `src/core/gitconfig/profileFiles.test.ts`

**Interfaces:**
- Consumes: `types.ts`의 `Profile`·`ProfileId`
- Produces:
  - `backupFile(options: { readonly source: string; readonly dir: string; readonly now: string; readonly keep?: number }): string | null`
  - `profileFilePath(id: ProfileId, dir: string): string`
  - `renderProfile(profile: Profile): string`
  - `writeProfileFile(profile: Profile, dir: string): string`
  - `pruneProfileFiles(keep: readonly ProfileId[], dir: string): readonly string[]`

- [ ] **Step 1: 백업 테스트 작성**

`src/core/gitconfig/backup.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { backupFile } from "./backup.ts";

const setup = (): { source: string; dir: string } => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gum-backup-"));
  const source = path.join(base, ".gitconfig");
  fs.writeFileSync(source, "[user]\n\temail = a@b.com\n");
  return { source, dir: path.join(base, "backups") };
};

test("backupFile copies the source and returns the backup path", () => {
  const { source, dir } = setup();
  const created = backupFile({ source, dir, now: "2026-07-31T00-00-00" });
  assert.equal(created, path.join(dir, "gitconfig.2026-07-31T00-00-00.bak"));
  assert.equal(fs.readFileSync(created as string, "utf8"), fs.readFileSync(source, "utf8"));
});

test("backupFile locks down permissions because the source may hold credentials", () => {
  const { source, dir } = setup();
  const created = backupFile({ source, dir, now: "2026-07-31T00-00-00" }) as string;
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(created).mode & 0o777, 0o600);
});

test("backupFile returns null when the source does not exist", () => {
  const { dir } = setup();
  assert.equal(backupFile({ source: "/definitely/missing", dir, now: "x" }), null);
});

test("backupFile keeps only the newest N backups", () => {
  const { source, dir } = setup();
  for (const stamp of ["01", "02", "03", "04"]) {
    backupFile({ source, dir, now: stamp, keep: 2 });
  }
  assert.deepEqual(fs.readdirSync(dir).toSorted(), [
    "gitconfig.03.bak",
    "gitconfig.04.bak",
  ]);
});

test("backupFile is a no-op when a backup with the same stamp exists", () => {
  const { source, dir } = setup();
  backupFile({ source, dir, now: "same" });
  fs.writeFileSync(source, "changed\n");
  backupFile({ source, dir, now: "same" });
  assert.equal(fs.readFileSync(path.join(dir, "gitconfig.same.bak"), "utf8"), "[user]\n\temail = a@b.com\n");
});
```

- [ ] **Step 2: 프로파일 파일 테스트 작성**

`src/core/gitconfig/profileFiles.test.ts`:

```ts
import assert from "node:assert/strict";
import { execa } from "execa";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Profile, ProfileId } from "../../types.ts";
import { profileFilePath, pruneProfileFiles, renderProfile, writeProfileFile } from "./profileFiles.ts";

const id = (value: string): ProfileId => value as ProfileId;

const profile: Profile = {
  id: id("personal"),
  name: "soohanpark",
  email: "725psh@gmail.com",
  signingKey: null,
  color: "magenta",
  paths: [],
};

test("profileFilePath is derived from the profile id", () => {
  assert.equal(profileFilePath(id("work"), "/cfg/profiles"), "/cfg/profiles/work.gitconfig");
});

test("git can read the rendered profile file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-"));
  const file = writeProfileFile(profile, dir);
  const email = await execa("git", ["config", "--file", file, "user.email"]);
  const name = await execa("git", ["config", "--file", file, "user.name"]);
  assert.equal(email.stdout.trim(), "725psh@gmail.com");
  assert.equal(name.stdout.trim(), "soohanpark");
});

test("the rendered file omits signingKey when there is none and includes it when there is", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prof-key-"));
  assert.equal(renderProfile(profile).includes("signingKey"), false);

  const signed = writeProfileFile({ ...profile, id: id("signed"), signingKey: "ABCD 1234" }, dir);
  const key = await execa("git", ["config", "--file", signed, "user.signingKey"]);
  assert.equal(key.stdout.trim(), "ABCD 1234");
});

test("the rendered file warns that it is generated", () => {
  assert.match(renderProfile(profile), /^# Managed by git-user-mapper/);
});

test("pruneProfileFiles deletes files for profiles that no longer exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prune-"));
  writeProfileFile(profile, dir);
  writeProfileFile({ ...profile, id: id("gone") }, dir);
  fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep me");

  const removed = pruneProfileFiles([id("personal")], dir);

  assert.deepEqual(removed, [path.join(dir, "gone.gitconfig")]);
  assert.equal(fs.existsSync(path.join(dir, "personal.gitconfig")), true);
  assert.equal(fs.existsSync(path.join(dir, "unrelated.txt")), true);
});
```

- [ ] **Step 3: 두 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './backup.ts'`, `'./profileFiles.ts'`

- [ ] **Step 4: `src/core/gitconfig/backup.ts` 작성**

```ts
import fs from "node:fs";
import path from "node:path";

export interface BackupOptions {
  readonly source: string;
  readonly dir: string;
  readonly now: string;
  readonly keep?: number;
}

const PREFIX = "gitconfig.";
const SUFFIX = ".bak";
const DEFAULT_KEEP = 10;

/**
 * `~/.gitconfig`에는 자격증명이 평문으로 들어 있을 수 있다.
 * 디렉토리 0700, 파일 0600으로 강제한다(umask에 맡기지 않는다).
 */
export const backupFile = (options: BackupOptions): string | null => {
  if (!fs.existsSync(options.source)) return null;

  fs.mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(options.dir, 0o700);

  const target = path.join(options.dir, `${PREFIX}${options.now}${SUFFIX}`);
  if (!fs.existsSync(target)) {
    fs.copyFileSync(options.source, target);
    fs.chmodSync(target, 0o600);
  }

  const keep = options.keep ?? DEFAULT_KEEP;
  const backups = fs
    .readdirSync(options.dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .toSorted();
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    fs.rmSync(path.join(options.dir, stale), { force: true });
  }

  return target;
};
```

- [ ] **Step 5: `src/core/gitconfig/profileFiles.ts` 작성**

```ts
import fs from "node:fs";
import path from "node:path";
import type { Profile, ProfileId } from "../../types.ts";

const EXTENSION = ".gitconfig";

export const profileFilePath = (id: ProfileId, dir: string): string =>
  path.join(dir, `${id}${EXTENSION}`);

export const renderProfile = (profile: Profile): string => {
  const lines = [
    "# Managed by git-user-mapper. Edits are overwritten by `git-mapper sync`.",
    "[user]",
    `\tname = ${profile.name}`,
    `\temail = ${profile.email}`,
  ];
  if (profile.signingKey !== null) lines.push(`\tsigningKey = ${profile.signingKey}`);
  return `${lines.join("\n")}\n`;
};

export const writeProfileFile = (profile: Profile, dir: string): string => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = profileFilePath(profile.id, dir);
  fs.writeFileSync(target, renderProfile(profile), { mode: 0o600 });
  return target;
};

/** 스토어에 없는 프로파일의 파일만 지운다. 다른 파일은 건드리지 않는다. */
export const pruneProfileFiles = (keep: readonly ProfileId[], dir: string): readonly string[] => {
  if (!fs.existsSync(dir)) return [];
  const kept = new Set(keep.map((id) => `${id}${EXTENSION}`));
  const removed: string[] = [];
  for (const name of fs.readdirSync(dir).toSorted()) {
    if (!name.endsWith(EXTENSION) || kept.has(name)) continue;
    const target = path.join(dir, name);
    fs.rmSync(target, { force: true });
    removed.push(target);
  }
  return removed;
};
```

- [ ] **Step 6: 테스트 통과 확인하고 커밋**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add gitconfig backup and profile file generation"
```

## Task 6: `~/.gitconfig` 조작

이 파일에는 사용자의 자격증명이 평문으로 들어 있을 수 있다. **텍스트로 편집하지 않는다.** 모든 쓰기는 `git config --global`을 거치므로 git이 파싱·직렬화를 담당하고 기존 줄이 우리 코드에 의해 재작성되지 않는다.

**Files:**
- Create: `src/core/gitconfig/globalConfig.ts`, `src/core/gitconfig/globalConfig.test.ts`

**Interfaces:**
- Consumes: `git.ts`의 `git`·`gitOrNull`·`GitOptions`
- Produces:
  - `setIncludeIf(condition: string, filePath: string, options?: GitOptions): Promise<void>`
  - `getIncludeIf(condition: string, options?: GitOptions): Promise<string | null>`
  - `removeIncludeIf(condition: string, options?: GitOptions): Promise<void>`
  - `setGlobalUser(user: { readonly name: string; readonly email: string; readonly signingKey: string | null }, options?: GitOptions): Promise<void>`
  - `getGlobalUser(options?: GitOptions): Promise<{ readonly name: string | null; readonly email: string | null }>`
  - `globalKeysInOrder(options?: GitOptions): Promise<readonly string[]>`
  - `hasUserAfterIncludeIf(keys: readonly string[]): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/gitconfig/globalConfig.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { GitOptions } from "../git.ts";
import {
  getGlobalUser,
  getIncludeIf,
  globalKeysInOrder,
  hasUserAfterIncludeIf,
  removeIncludeIf,
  setGlobalUser,
  setIncludeIf,
} from "./globalConfig.ts";

const scope = (): { options: GitOptions; file: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-global-"));
  const file = path.join(dir, ".gitconfig");
  fs.writeFileSync(file, "");
  return { options: { env: { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: "1" } }, file };
};

test("includeIf entries round-trip", async () => {
  const { options } = scope();
  await setIncludeIf("gitdir:/home/me/dev/", "/cfg/work.gitconfig", options);
  assert.equal(await getIncludeIf("gitdir:/home/me/dev/", options), "/cfg/work.gitconfig");
});

test("a directory containing dots still parses as one subsection", async () => {
  const { options } = scope();
  const condition = "gitdir/i:/home/me/dev/my.project/";
  await setIncludeIf(condition, "/cfg/x.gitconfig", options);
  assert.equal(await getIncludeIf(condition, options), "/cfg/x.gitconfig");
});

test("removeIncludeIf deletes the section and is safe to repeat", async () => {
  const { options } = scope();
  await setIncludeIf("gitdir:/home/me/dev/", "/cfg/work.gitconfig", options);
  await removeIncludeIf("gitdir:/home/me/dev/", options);
  assert.equal(await getIncludeIf("gitdir:/home/me/dev/", options), null);
  await removeIncludeIf("gitdir:/home/me/dev/", options);
});

test("setGlobalUser writes name and email", async () => {
  const { options } = scope();
  await setGlobalUser({ name: "soohanpark", email: "a@b.com", signingKey: null }, options);
  assert.deepEqual(await getGlobalUser(options), { name: "soohanpark", email: "a@b.com" });
});

test("setGlobalUser unsets signingKey when the profile has none", async () => {
  const { options } = scope();
  await setGlobalUser({ name: "n", email: "a@b.com", signingKey: "KEY1" }, options);
  await setGlobalUser({ name: "n", email: "a@b.com", signingKey: null }, options);
  const keys = await globalKeysInOrder(options);
  assert.equal(keys.includes("user.signingkey"), false);
});

test("getGlobalUser returns nulls for an empty config", async () => {
  const { options } = scope();
  assert.deepEqual(await getGlobalUser(options), { name: null, email: null });
});

test("hasUserAfterIncludeIf spots a [user] that would beat the mappings", async () => {
  const { options, file } = scope();

  fs.writeFileSync(
    file,
    ['[includeIf "gitdir:/tmp/x/"]', "\tpath = /tmp/p", "[user]", "\temail = late@x.com", ""].join("\n"),
  );
  assert.equal(hasUserAfterIncludeIf(await globalKeysInOrder(options)), true);

  fs.writeFileSync(
    file,
    ["[user]", "\temail = early@x.com", '[includeIf "gitdir:/tmp/x/"]', "\tpath = /tmp/p", ""].join("\n"),
  );
  assert.equal(hasUserAfterIncludeIf(await globalKeysInOrder(options)), false);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './globalConfig.ts'`

- [ ] **Step 3: `src/core/gitconfig/globalConfig.ts` 작성**

```ts
import { type GitOptions, git, gitOrNull } from "../git.ts";

export interface GlobalUser {
  readonly name: string;
  readonly email: string;
  readonly signingKey: string | null;
}

/**
 * git은 첫 점까지를 섹션, 마지막 점 뒤를 키로 읽는다.
 * 그래서 조건 문자열에 점이나 슬래시가 들어 있어도 하나의 subsection으로 유지된다.
 */
const includeIfKey = (condition: string): string => `includeIf.${condition}.path`;

export const setIncludeIf = async (
  condition: string,
  filePath: string,
  options: GitOptions = {},
): Promise<void> => {
  await git(["config", "--global", includeIfKey(condition), filePath], options);
};

export const getIncludeIf = (condition: string, options: GitOptions = {}): Promise<string | null> =>
  gitOrNull(["config", "--global", "--get", includeIfKey(condition)], options);

/** 없는 섹션을 지우면 git이 5로 종료한다. 그건 오류가 아니다. */
export const removeIncludeIf = async (
  condition: string,
  options: GitOptions = {},
): Promise<void> => {
  await gitOrNull(["config", "--global", "--remove-section", `includeIf.${condition}`], options);
};

export const setGlobalUser = async (user: GlobalUser, options: GitOptions = {}): Promise<void> => {
  await git(["config", "--global", "user.name", user.name], options);
  await git(["config", "--global", "user.email", user.email], options);
  if (user.signingKey === null) {
    await gitOrNull(["config", "--global", "--unset", "user.signingKey"], options);
  } else {
    await git(["config", "--global", "user.signingKey", user.signingKey], options);
  }
};

export const getGlobalUser = async (
  options: GitOptions = {},
): Promise<{ readonly name: string | null; readonly email: string | null }> => ({
  name: await gitOrNull(["config", "--global", "--get", "user.name"], options),
  email: await gitOrNull(["config", "--global", "--get", "user.email"], options),
});

/** `git config --list`는 파일에 적힌 순서대로 출력한다. 순서 판정에 그대로 쓴다. */
export const globalKeysInOrder = async (options: GitOptions = {}): Promise<readonly string[]> => {
  const output = await gitOrNull(["config", "--global", "--list", "--name-only"], options);
  return output === null ? [] : output.split("\n").filter((line) => line !== "");
};

/**
 * `[user]`가 우리 includeIf 뒤에 오면 매핑이 fallback에 진다.
 * git은 나중에 읽은 값을 쓰기 때문이다.
 */
export const hasUserAfterIncludeIf = (keys: readonly string[]): boolean => {
  const lastInclude = keys.findLastIndex((key) => key.startsWith("includeif."));
  const lastUser = keys.findLastIndex((key) => key === "user.name" || key === "user.email");
  return lastInclude >= 0 && lastUser > lastInclude;
};
```

- [ ] **Step 4: 테스트 통과 확인하고 커밋**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: manage includeIf and global user through git config only"
```

---

## Task 7: 동기화 알고리즘

기능의 본체다. 이 태스크가 끝나면 `includeIf`가 실제로 동작한다.

> **스펙 6절의 순서를 하나 바로잡는다.** 스펙은 `[user]` 쓰기를 4번(includeIf 추가 뒤)에 뒀지만, `~/.gitconfig`에 `[user]` 섹션이 아직 없으면 `git config --global user.name`이 섹션을 **파일 끝에** 새로 만든다. 그러면 `[user]`가 우리 includeIf보다 뒤에 놓여 매핑이 항상 진다. 따라서 **`[user]`를 먼저 쓰고 includeIf를 나중에 추가한다.** Step 1의 두 번째 테스트가 이 순서를 지킨다.

**Files:**
- Create: `src/core/sync.ts`, `src/core/sync.test.ts`

**Interfaces:**
- Consumes: `store.ts`, `mapping.ts`, `gitconfig/*`, `paths.ts`
- Produces:
  - `interface SyncOptions { readonly configDir: string; readonly globalConfigPath: string; readonly now: string; readonly caseInsensitive?: boolean; readonly git?: GitOptions }`
  - `interface SyncPlan { readonly removeConditions: readonly string[]; readonly addConditions: readonly { readonly condition: string; readonly file: string }[]; readonly writeProfiles: readonly ProfileId[]; readonly defaultUser: GlobalUser | null; readonly mappingFile: string }`
  - `planSync(store: StoreV2, options: SyncOptions): SyncPlan` — 순수함수
  - `applySync(store: StoreV2, options: SyncOptions): Promise<StoreV2>` — `managedConditions`가 갱신된 스토어를 반환
  - `describePlan(plan: SyncPlan): string`

- [ ] **Step 1: 통합 테스트 작성**

`src/core/sync.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import type { ProfileId, StoreV2 } from "../types.ts";
import { toAbsolutePath } from "./paths.ts";
import { type SyncOptions, applySync, describePlan, planSync } from "./sync.ts";

const id = (value: string): ProfileId => value as ProfileId;

interface Fixture {
  readonly base: string;
  readonly env: NodeJS.ProcessEnv;
  readonly options: SyncOptions;
}

const fixture = (): Fixture => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-sync-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  return {
    base,
    env,
    options: {
      configDir: path.join(base, "config"),
      globalConfigPath,
      now: "t0",
      caseInsensitive: false,
      git: { env },
    },
  };
};

const storeFor = (f: Fixture, mapped: readonly string[] = ["personal"]): StoreV2 => ({
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    { id: id("work"), name: "soohanpark", email: "work@nexpace.io", signingKey: null, color: "blue", paths: [] },
    {
      id: id("personal"),
      name: "soohanpark",
      email: "me@gmail.com",
      signingKey: null,
      color: "magenta",
      paths: mapped.map((dir) => toAbsolutePath(path.join(f.base, dir))),
    },
  ],
  managedConditions: [],
});

const makeRepo = async (dir: string): Promise<string> => {
  fs.mkdirSync(dir, { recursive: true });
  await execa("git", ["init", "-q"], { cwd: dir });
  return dir;
};

const emailIn = async (dir: string, env: NodeJS.ProcessEnv): Promise<string | null> => {
  try {
    return (await execa("git", ["config", "user.email"], { cwd: dir, env })).stdout.trim();
  } catch {
    return null;
  }
};

test("git resolves the mapped identity inside mapped directories", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });

  const next = await applySync(storeFor(f), f.options);

  const mapped = await makeRepo(path.join(f.base, "personal", "mar"));
  const other = await makeRepo(path.join(f.base, "msu", "backend"));

  assert.equal(await emailIn(mapped, f.env), "me@gmail.com");
  assert.equal(await emailIn(other, f.env), "work@nexpace.io");
  assert.deepEqual(next.managedConditions, [
    `gitdir:${toAbsolutePath(path.join(f.base, "personal"))}/`,
  ]);
});

test("the [user] section is written before the includeIf sections", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  const text = fs.readFileSync(f.options.globalConfigPath, "utf8");
  assert.ok(text.includes("[user]"), text);
  assert.ok(text.indexOf("[user]") < text.indexOf("[includeIf"), text);
});

test("applySync is idempotent", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });

  const once = await applySync(storeFor(f), f.options);
  const textOnce = fs.readFileSync(f.options.globalConfigPath, "utf8");
  const twice = await applySync(once, f.options);
  const textTwice = fs.readFileSync(f.options.globalConfigPath, "utf8");

  assert.equal(textTwice, textOnce);
  assert.deepEqual(twice.managedConditions, once.managedConditions);
});

test("removing a mapping falls back to the default profile", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  const repo = await makeRepo(path.join(f.base, "personal", "mar"));

  const mappedStore = await applySync(storeFor(f), f.options);
  assert.equal(await emailIn(repo, f.env), "me@gmail.com");

  const unmapped: StoreV2 = {
    ...mappedStore,
    profiles: mappedStore.profiles.map((profile) => ({ ...profile, paths: [] })),
  };
  await applySync(unmapped, f.options);

  assert.equal(await emailIn(repo, f.env), "work@nexpace.io");
});

test("profile files for deleted profiles are pruned", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  const store = await applySync(storeFor(f), f.options);
  const profilesDir = path.join(f.options.configDir, "profiles");
  assert.equal(fs.existsSync(path.join(profilesDir, "personal.gitconfig")), true);

  await applySync(
    { ...store, profiles: store.profiles.filter((profile) => profile.id !== id("personal")) },
    f.options,
  );
  assert.equal(fs.existsSync(path.join(profilesDir, "personal.gitconfig")), false);
});

test("planSync describes the change without touching the filesystem", () => {
  const f = fixture();
  const plan = planSync(storeFor(f), f.options);

  assert.equal(plan.addConditions.length, 1);
  assert.equal(plan.defaultUser?.email, "work@nexpace.io");
  assert.deepEqual(plan.writeProfiles, [id("personal")]);
  assert.equal(fs.existsSync(f.options.configDir), false);
  assert.match(describePlan(plan), /includeIf/);
});

test("the mapping table is written for the shell to read", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.base, "personal"), { recursive: true });
  await applySync(storeFor(f), f.options);

  const table = fs.readFileSync(path.join(f.options.configDir, "mapping.tsv"), "utf8");
  assert.match(table, /^\*\twork\tblue\twork@nexpace\.io$/m);
  assert.match(table, /\tpersonal\tmagenta\tme@gmail\.com$/m);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './sync.ts'`

- [ ] **Step 3: `src/core/sync.ts` 작성**

```ts
import fs from "node:fs";
import path from "node:path";
import type { ProfileId, StoreV2 } from "../types.ts";
import type { GitOptions } from "./git.ts";
import { backupFile } from "./gitconfig/backup.ts";
import type { GlobalUser } from "./gitconfig/globalConfig.ts";
import { removeIncludeIf, setGlobalUser, setIncludeIf } from "./gitconfig/globalConfig.ts";
import { profileFilePath, pruneProfileFiles, writeProfileFile } from "./gitconfig/profileFiles.ts";
import { buildTable, conditionFor, serializeTable } from "./mapping.ts";
import { isCaseInsensitive } from "./paths.ts";

export interface SyncOptions {
  readonly configDir: string;
  readonly globalConfigPath: string;
  readonly now: string;
  readonly caseInsensitive?: boolean;
  readonly git?: GitOptions;
}

export interface ConditionPlan {
  readonly condition: string;
  readonly file: string;
}

export interface SyncPlan {
  readonly removeConditions: readonly string[];
  readonly addConditions: readonly ConditionPlan[];
  readonly writeProfiles: readonly ProfileId[];
  readonly defaultUser: GlobalUser | null;
  readonly mappingFile: string;
}

const profilesDirOf = (options: SyncOptions): string => path.join(options.configDir, "profiles");
const backupsDirOf = (options: SyncOptions): string => path.join(options.configDir, "backups");

export const planSync = (store: StoreV2, options: SyncOptions): SyncPlan => {
  const caseInsensitive = options.caseInsensitive ?? isCaseInsensitive();
  const profilesDir = profilesDirOf(options);
  const withPaths = store.profiles.filter((profile) => profile.paths.length > 0);
  const defaultProfile = store.profiles.find((profile) => profile.id === store.defaultProfile);

  return {
    removeConditions: store.managedConditions,
    addConditions: withPaths.flatMap((profile) =>
      profile.paths.map((target) => ({
        condition: conditionFor(target, caseInsensitive),
        file: profileFilePath(profile.id, profilesDir),
      })),
    ),
    writeProfiles: withPaths.map((profile) => profile.id),
    defaultUser: defaultProfile
      ? {
          name: defaultProfile.name,
          email: defaultProfile.email,
          signingKey: defaultProfile.signingKey,
        }
      : null,
    mappingFile: path.join(options.configDir, "mapping.tsv"),
  };
};

export const describePlan = (plan: SyncPlan): string => {
  const lines: string[] = [];
  if (plan.defaultUser) {
    lines.push(`set [user] to ${plan.defaultUser.name} <${plan.defaultUser.email}>`);
  }
  for (const condition of plan.removeConditions) lines.push(`remove includeIf "${condition}"`);
  for (const entry of plan.addConditions) {
    lines.push(`add    includeIf "${entry.condition}" -> ${entry.file}`);
  }
  for (const id of plan.writeProfiles) lines.push(`write  profile file for ${id}`);
  lines.push(`write  ${plan.mappingFile}`);
  return lines.join("\n");
};

export const applySync = async (store: StoreV2, options: SyncOptions): Promise<StoreV2> => {
  const plan = planSync(store, options);
  const profilesDir = profilesDirOf(options);

  backupFile({ source: options.globalConfigPath, dir: backupsDirOf(options), now: options.now });

  // [user]를 먼저 쓴다. 섹션이 없으면 git이 파일 끝에 새로 만드는데,
  // 그 뒤에 includeIf를 붙여야 매핑이 fallback을 이긴다.
  if (plan.defaultUser) await setGlobalUser(plan.defaultUser, options.git);

  for (const condition of plan.removeConditions) {
    await removeIncludeIf(condition, options.git);
  }

  for (const id of plan.writeProfiles) {
    const profile = store.profiles.find((candidate) => candidate.id === id);
    if (profile) writeProfileFile(profile, profilesDir);
  }

  for (const entry of plan.addConditions) {
    await setIncludeIf(entry.condition, entry.file, options.git);
  }

  pruneProfileFiles(plan.writeProfiles, profilesDir);

  fs.mkdirSync(options.configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(plan.mappingFile, serializeTable(buildTable(store)));

  return { ...store, managedConditions: plan.addConditions.map((entry) => entry.condition) };
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — sync 7개 통과. 특히 첫 번째 테스트가 **`includeIf`가 실제로 git에 먹는다**는 증거다.

- [ ] **Step 5: 커버리지 확인**

Run: `npm run test:coverage`
Expected: 라인 커버리지 80% 이상

- [ ] **Step 6: 커밋**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add idempotent sync that makes includeIf mappings take effect"
```

## Task 8: CLI 골격과 `status`

`status`는 **우리 해석과 git의 실제 답을 나란히 비교**한다. 스펙 성공 기준 3번("프롬프트가 거짓말하지 않는다")의 런타임 검증이고, 셸 스니펫이 소비할 `--porcelain` 계약도 여기서 확정된다.

> `src/core/context.ts`를 추가한다. 모든 명령이 스토어 핸들과 `SyncOptions`를 같은 방식으로 만들기 위한 것으로, File Structure 표에 없던 파일이다.

**Files:**
- Create: `src/core/context.ts`, `src/commands/status.ts`, `src/commands/status.test.ts`, `src/cli.ts`

**Interfaces:**
- Consumes: `store.ts`, `mapping.ts`, `paths.ts`, `git.ts`, `gitconfig/globalConfig.ts`
- Produces:
  - `createContext(): Promise<Context>` — `{ readonly store: StoreHandle; readonly sync: SyncOptions }`
  - `interface StatusEnvironment` — 아래 코드 참조
  - `computeStatus(store: StoreV2, env: StatusEnvironment, caseInsensitive: boolean): StatusResult` — 순수함수
  - `interface StatusResult { readonly state: ResolutionState | "not-a-repo"; readonly profileId: string | null; readonly email: string | null; readonly repoRoot: string | null; readonly warnings: readonly string[] }`
  - `inspect(store: StoreV2, configDir: string): Promise<StatusEnvironment>` — I/O 담당
  - `runStatus(options: { readonly porcelain: boolean }): Promise<number>` — 종료 코드. 경고가 있으면 2
  - `run(argv: readonly string[]): Promise<void>` — `cli.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/commands/status.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { type StatusEnvironment, computeStatus } from "./status.ts";

const p = (value: string): AbsolutePath => value as AbsolutePath;
const id = (value: string): ProfileId => value as ProfileId;

const store: StoreV2 = {
  version: 2,
  defaultProfile: id("work"),
  profiles: [
    { id: id("work"), name: "n", email: "work@x.com", signingKey: null, color: "blue", paths: [] },
    {
      id: id("personal"),
      name: "n",
      email: "me@x.com",
      signingKey: null,
      color: "magenta",
      paths: [p("/home/me/dev/personal")],
    },
  ],
  managedConditions: ["gitdir:/home/me/dev/personal/"],
};

const env = (overrides: Partial<StatusEnvironment> = {}): StatusEnvironment => ({
  gitVersion: { major: 2, minor: 50 },
  keysInOrder: ["user.name", "user.email", "includeif.gitdir:/home/me/dev/personal/.path"],
  gitEmail: "me@x.com",
  localEmail: null,
  repoRoot: p("/home/me/dev/personal/mar"),
  missingProfileFiles: [],
  missingPaths: [],
  pathsInsideRepos: [],
  ...overrides,
});

test("computeStatus reports the mapped profile with no warnings", () => {
  const result = computeStatus(store, env(), false);
  assert.equal(result.state, "mapped");
  assert.equal(result.profileId, "personal");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus reports the fallback as default, not as a problem", () => {
  const result = computeStatus(store, env({ repoRoot: p("/home/me/dev/msu"), gitEmail: "work@x.com" }), false);
  assert.equal(result.state, "default");
  assert.equal(result.profileId, "work");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus reports not-a-repo outside a repository", () => {
  assert.equal(computeStatus(store, env({ repoRoot: null }), false).state, "not-a-repo");
});

test("computeStatus reports a local override and names the email that will actually be used", () => {
  const result = computeStatus(store, env({ localEmail: "other@x.com", gitEmail: "other@x.com" }), false);
  assert.equal(result.state, "local-override");
  assert.equal(result.email, "other@x.com");
});

test("computeStatus ignores a local override that agrees with the mapping", () => {
  const result = computeStatus(store, env({ localEmail: "me@x.com" }), false);
  assert.equal(result.state, "mapped");
  assert.deepEqual(result.warnings, []);
});

test("computeStatus reports no-identity when there is no mapping and no default", () => {
  const result = computeStatus(
    { ...store, defaultProfile: null },
    env({ repoRoot: p("/tmp/x"), gitEmail: null }),
    false,
  );
  assert.equal(result.state, "no-identity");
});

test("computeStatus warns when git is too old for includeIf", () => {
  const result = computeStatus(store, env({ gitVersion: { major: 2, minor: 12 } }), false);
  assert.ok(result.warnings.some((w) => /2\.13/.test(w)), result.warnings.join("|"));
});

test("computeStatus warns when [user] comes after the includeIf entries", () => {
  const result = computeStatus(
    store,
    env({ keysInOrder: ["includeif.gitdir:/home/me/dev/personal/.path", "user.email"] }),
    false,
  );
  assert.ok(result.warnings.some((w) => /\[user\]/.test(w)), result.warnings.join("|"));
});

test("computeStatus warns about missing profile files, missing paths and paths inside repos", () => {
  const result = computeStatus(
    store,
    env({
      missingProfileFiles: [id("personal")],
      missingPaths: [p("/home/me/dev/personal")],
      pathsInsideRepos: [p("/home/me/dev/personal")],
    }),
    false,
  );
  assert.equal(result.warnings.length, 3);
});

test("computeStatus warns when our answer disagrees with what git actually reports", () => {
  const result = computeStatus(store, env({ gitEmail: "surprise@x.com" }), false);
  assert.ok(result.warnings.some((w) => /surprise@x\.com/.test(w)), result.warnings.join("|"));
});

test("computeStatus warns about overlapping mappings", () => {
  const overlapping: StoreV2 = {
    ...store,
    profiles: store.profiles.map((profile) =>
      profile.id === id("work")
        ? { ...profile, paths: [p("/home/me/dev")] }
        : profile,
    ),
  };
  const result = computeStatus(overlapping, env(), false);
  assert.ok(result.warnings.some((w) => /overlap/i.test(w)), result.warnings.join("|"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './status.ts'`

- [ ] **Step 3: `src/core/context.ts` 작성**

```ts
import { getGlobalUser } from "./gitconfig/globalConfig.ts";
import { configDir, globalGitConfigPath } from "./paths.ts";
import { type StoreHandle, openStore } from "./store.ts";
import type { SyncOptions } from "./sync.ts";

export interface Context {
  readonly store: StoreHandle;
  readonly sync: SyncOptions;
}

export const timestamp = (date: Date = new Date()): string =>
  date.toISOString().replaceAll(":", "-");

export const createContext = async (): Promise<Context> => {
  const globalUser = await getGlobalUser();
  return {
    store: openStore({ migrate: { currentGlobalEmail: globalUser.email } }),
    sync: {
      configDir: configDir(),
      globalConfigPath: globalGitConfigPath(),
      now: timestamp(),
    },
  };
};
```

- [ ] **Step 4: `src/commands/status.ts` 작성**

```ts
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { gitOrNull, gitVersion, supportsIncludeIf } from "../core/git.ts";
import { globalKeysInOrder, hasUserAfterIncludeIf } from "../core/gitconfig/globalConfig.ts";
import { profileFilePath } from "../core/gitconfig/profileFiles.ts";
import { buildTable, resolve } from "../core/mapping.ts";
import { findRepoRoot, isCaseInsensitive, toAbsolutePath } from "../core/paths.ts";
import type { AbsolutePath, ProfileId, ResolutionState, StoreV2 } from "../types.ts";

export interface StatusEnvironment {
  readonly gitVersion: { readonly major: number; readonly minor: number };
  readonly keysInOrder: readonly string[];
  readonly gitEmail: string | null;
  readonly localEmail: string | null;
  readonly repoRoot: AbsolutePath | null;
  readonly missingProfileFiles: readonly ProfileId[];
  readonly missingPaths: readonly AbsolutePath[];
  readonly pathsInsideRepos: readonly AbsolutePath[];
}

export interface StatusResult {
  readonly state: ResolutionState | "not-a-repo";
  readonly profileId: string | null;
  readonly email: string | null;
  readonly repoRoot: string | null;
  readonly warnings: readonly string[];
}

const overlaps = (store: StoreV2): readonly string[] => {
  const all = store.profiles.flatMap((profile) =>
    profile.paths.map((target) => ({ target, id: profile.id })),
  );
  const found: string[] = [];
  for (const a of all) {
    for (const b of all) {
      if (a.target === b.target || !b.target.startsWith(`${a.target}/`)) continue;
      found.push(`Mappings overlap: ${b.target} (${b.id}) sits inside ${a.target} (${a.id}). The longer path wins.`);
    }
  }
  return found;
};

export const computeStatus = (
  store: StoreV2,
  env: StatusEnvironment,
  caseInsensitive: boolean,
): StatusResult => {
  const warnings: string[] = [];

  if (!supportsIncludeIf(env.gitVersion)) {
    warnings.push(
      `git ${env.gitVersion.major}.${env.gitVersion.minor} does not support includeIf. Upgrade to git 2.13 or newer.`,
    );
  }
  if (hasUserAfterIncludeIf(env.keysInOrder)) {
    warnings.push(
      "A [user] section appears after the managed includeIf entries in ~/.gitconfig, so it beats every mapping. Run `git-mapper sync` to restore the order.",
    );
  }
  for (const id of env.missingProfileFiles) {
    warnings.push(`The profile file for ${id} is missing. git silently ignores a missing include. Run \`git-mapper sync\`.`);
  }
  for (const target of env.missingPaths) {
    warnings.push(`Mapped path ${target} no longer exists.`);
  }
  for (const target of env.pathsInsideRepos) {
    warnings.push(`Mapped path ${target} is inside a git repository, so it has no effect. Map the repository root or a directory above it.`);
  }
  warnings.push(...overlaps(store));

  if (env.repoRoot === null) {
    return { state: "not-a-repo", profileId: null, email: null, repoRoot: null, warnings };
  }

  const resolved = resolve(buildTable(store), env.repoRoot, caseInsensitive);
  const overridden = env.localEmail !== null && env.localEmail !== resolved.email;

  if (env.gitEmail !== null && !overridden && resolved.email !== null && env.gitEmail !== resolved.email) {
    warnings.push(
      `git reports ${env.gitEmail} here but the mapping resolves to ${resolved.email}. Something outside git-user-mapper is overriding it.`,
    );
  }

  if (overridden) {
    const owner = store.profiles.find((profile) => profile.email === env.localEmail);
    return {
      state: "local-override",
      profileId: owner?.id ?? null,
      email: env.localEmail,
      repoRoot: env.repoRoot,
      warnings,
    };
  }

  return {
    state: resolved.state,
    profileId: resolved.profileId,
    email: resolved.email,
    repoRoot: env.repoRoot,
    warnings,
  };
};

const readLocalEmail = (repoRoot: AbsolutePath | null): string | null => {
  if (repoRoot === null) return null;
  const gitPath = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitPath) || !fs.statSync(gitPath).isDirectory()) return null;
  const configPath = path.join(gitPath, "config");
  if (!fs.existsSync(configPath)) return null;

  let section = "";
  for (const raw of fs.readFileSync(configPath, "utf8").split("\n")) {
    const line = raw.replaceAll(/[ \t]/g, "");
    if (line === "[user]") section = "user";
    else if (line.startsWith("[")) section = "";
    else if (section === "user" && line.startsWith("email=")) return line.slice("email=".length);
  }
  return null;
};

export const inspect = async (store: StoreV2, configDir: string): Promise<StatusEnvironment> => {
  const repoRoot = findRepoRoot(toAbsolutePath(process.cwd()));
  const profilesDir = path.join(configDir, "profiles");
  return {
    gitVersion: await gitVersion(),
    keysInOrder: await globalKeysInOrder(),
    gitEmail: repoRoot === null ? null : await gitOrNull(["config", "user.email"], { cwd: repoRoot }),
    localEmail: readLocalEmail(repoRoot),
    repoRoot,
    missingProfileFiles: store.profiles
      .filter((profile) => profile.paths.length > 0)
      .filter((profile) => !fs.existsSync(profileFilePath(profile.id, profilesDir)))
      .map((profile) => profile.id),
    missingPaths: store.profiles
      .flatMap((profile) => profile.paths)
      .filter((target) => !fs.existsSync(target)),
    pathsInsideRepos: store.profiles
      .flatMap((profile) => profile.paths)
      .filter((target) => {
        const root = findRepoRoot(target);
        return root !== null && root !== target;
      }),
  };
};

export const runStatus = async (options: { readonly porcelain: boolean }): Promise<number> => {
  const context = await createContext();
  const store = context.store.read();
  const result = computeStatus(
    store,
    await inspect(store, context.sync.configDir),
    isCaseInsensitive(),
  );

  if (options.porcelain) {
    if (result.state === "not-a-repo") return 1;
    process.stdout.write(`${result.profileId ?? ""}\t${result.state}\t${result.email ?? ""}\n`);
    return 0;
  }

  if (result.state === "not-a-repo") {
    process.stdout.write(chalk.dim("Not inside a git repository.\n"));
  } else {
    process.stdout.write(`  경로       ${result.repoRoot}\n`);
    process.stdout.write(`  프로파일   ${result.profileId ?? "-"} (${result.state})\n`);
    process.stdout.write(`  이메일     ${result.email ?? "-"}\n`);
  }
  for (const warning of result.warnings) {
    process.stdout.write(chalk.yellow(`  ! ${warning}\n`));
  }
  return result.warnings.length > 0 ? 2 : 0;
};
```

- [ ] **Step 5: `src/cli.ts` 작성** — 이후 태스크에서 서브커맨드를 여기에 추가한다

```ts
import { Command } from "commander";
import { runStatus } from "./commands/status.ts";

export const run = async (argv: readonly string[]): Promise<void> => {
  const program = new Command();

  program
    .name("git-mapper")
    .description("Map directories to git identities")
    .version("1.0.0");

  program
    .command("status")
    .description("Show the profile that applies here and verify it against git")
    .option("--porcelain", "machine readable output for shell prompts", false)
    .action(async (options: { porcelain: boolean }) => {
      process.exitCode = await runStatus({ porcelain: options.porcelain });
    });

  await program.parseAsync([...argv]);
};
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — status 11개 통과

- [ ] **Step 7: 실제로 실행해 본다**

```bash
node bin/index.ts status
node bin/index.ts status --porcelain; echo "exit=$?"
```

Expected: 저장소 안이므로 경로·프로파일·이메일이 출력된다. 스토어가 비어 있으면 `no-identity` 또는 `default`가 나온다.

- [ ] **Step 8: 커밋**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add CLI skeleton and status command with git cross-check"
```

---

## Task 9: 프로파일 관리 명령 — `list` · `add` · `remove`

**Files:**
- Create: `src/commands/list.ts`, `src/commands/add.ts`, `src/commands/remove.ts`, `src/commands/add.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `context.ts`, `store.ts`, `profile.ts`, `sync.ts`
- Produces:
  - `buildProfile(input: { readonly id: string; readonly name: string; readonly email: string; readonly signingKey: string; readonly index: number }): Profile` — 순수함수
  - `runList(): Promise<void>`, `runAdd(): Promise<void>`, `runRemove(id?: string): Promise<void>`

- [ ] **Step 1: 순수 부분의 테스트 작성**

`src/commands/add.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './add.ts'`

- [ ] **Step 3: `src/commands/add.ts` 작성**

```ts
import { input } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { pickColor, toProfileId, uniqueId } from "../core/profile.ts";
import { applySync } from "../core/sync.ts";
import type { Profile } from "../types.ts";

export interface ProfileInput {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly signingKey: string;
  readonly index: number;
}

export const buildProfile = (raw: ProfileInput): Profile => {
  const name = raw.name.trim();
  const email = raw.email.trim();
  const signingKey = raw.signingKey.trim();

  if (name === "") throw new Error("A profile needs a name.");
  if (email === "") throw new Error("A profile needs an email.");

  return {
    id: toProfileId(raw.id.trim()),
    name,
    email,
    signingKey: signingKey === "" ? null : signingKey,
    color: pickColor(raw.index),
    paths: [],
  };
};

const required = (label: string) => (value: string) =>
  value.trim() === "" ? `Please enter the ${label}.` : true;

export const runAdd = async (): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();
  const taken = new Set(store.profiles.map((profile) => profile.id as string));

  const name = await input({ message: "Git user name", validate: required("name") });
  const email = await input({ message: "Git email", validate: required("email") });
  const signingKey = await input({ message: "GPG signing key (optional)" });
  const suggested = uniqueId(email, taken);
  const id = await input({
    message: "Profile id (shown in your prompt)",
    default: suggested,
    validate: (value: string) =>
      taken.has(value.trim()) ? "That id is already taken." : required("id")(value),
  });

  const profile = buildProfile({ id, name, email, signingKey, index: store.profiles.length });
  const next = { ...store, profiles: [...store.profiles, profile] };
  context.store.write(await applySync(next, context.sync));

  process.stdout.write(chalk.green(`✓ Added ${profile.id} (${profile.email})\n`));
};
```

- [ ] **Step 4: `src/commands/list.ts` 작성**

```ts
import chalk from "chalk";
import { createContext } from "../core/context.ts";

export const runList = async (): Promise<void> => {
  const store = (await createContext()).store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles yet. Run `git-mapper add`.\n");
    return;
  }

  for (const profile of store.profiles) {
    const isDefault = profile.id === store.defaultProfile ? chalk.dim(" (default)") : "";
    process.stdout.write(`${chalk.bold(profile.id)}${isDefault}  ${profile.name} <${profile.email}>\n`);
    if (profile.signingKey !== null) {
      process.stdout.write(`  ${chalk.yellow(`key ${profile.signingKey}`)}\n`);
    }
    for (const target of profile.paths) process.stdout.write(`  ${target}\n`);
    if (profile.paths.length === 0) process.stdout.write(chalk.dim("  (no mappings)\n"));
  }
};
```

- [ ] **Step 5: `src/commands/remove.ts` 작성**

```ts
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId } from "../types.ts";

export const runRemove = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles to remove.\n");
    return;
  }

  const target: ProfileId | null =
    requested === undefined
      ? await select<ProfileId | null>({
          message: "Remove which profile?",
          choices: [
            ...store.profiles.map((profile) => ({
              name: `${profile.id}  ${profile.name} <${profile.email}>`,
              value: profile.id,
            })),
            { name: "Cancel", value: null },
          ],
        })
      : ((requested as ProfileId) ?? null);

  if (target === null) {
    process.stdout.write("Cancelled.\n");
    return;
  }
  if (!store.profiles.some((profile) => profile.id === target)) {
    process.stdout.write(chalk.red(`No profile named ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  // 기본 프로파일을 지워도 ~/.gitconfig의 [user]는 남긴다.
  // identity를 없애면 커밋이 실패하므로 마지막 값이 남는 편이 안전하다.
  const next = {
    ...store,
    defaultProfile: store.defaultProfile === target ? null : store.defaultProfile,
    profiles: store.profiles.filter((profile) => profile.id !== target),
  };
  context.store.write(await applySync(next, context.sync));

  process.stdout.write(chalk.green(`✓ Removed ${target}\n`));
  if (store.defaultProfile === target) {
    process.stdout.write(
      chalk.dim("It was the default profile. ~/.gitconfig [user] was left as it is.\n"),
    );
  }
};
```

- [ ] **Step 6: `src/cli.ts`에 서브커맨드 등록**

`program.command("status")` 블록 다음에 추가한다.

```ts
  program.command("list").description("List profiles and their mappings").action(runList);
  program.command("add").description("Add a profile").action(runAdd);
  program
    .command("remove")
    .argument("[id]", "profile id")
    .description("Remove a profile and its mappings")
    .action(async (id?: string) => {
      await runRemove(id);
    });
```

import도 함께 추가한다: `import { runAdd } from "./commands/add.ts";` 등 3줄.

- [ ] **Step 7: 테스트 통과 확인하고 수동 확인**

```bash
npm test && npm run typecheck && npm run lint
node bin/index.ts list
```

Expected: 테스트 통과. `list`가 "No profiles yet." 또는 마이그레이션된 기존 프로파일을 출력한다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: add list, add and remove profile commands"
```

## Task 10: 기본 동작 — `map`과 `unmap`

인자 없이 `git-mapper`를 실행했을 때의 동작이다. 프로파일을 고르고, 적용 범위를 고르고, 동기화한다.

**Files:**
- Create: `src/commands/map.ts`, `src/commands/map.test.ts`, `src/commands/unmap.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `context.ts`, `paths.ts`, `sync.ts`, `add.ts`의 `buildProfile`
- Produces:
  - `assignPath(store: StoreV2, profileId: ProfileId, target: AbsolutePath): StoreV2` — 순수함수. 다른 프로파일에 같은 경로가 있으면 떼어낸다
  - `unassignPath(store: StoreV2, target: AbsolutePath): StoreV2` — 순수함수
  - `scopeChoices(cwd: AbsolutePath, repoRoot: AbsolutePath | null): readonly { readonly label: string; readonly value: AbsolutePath }[]`
  - `runMap(): Promise<void>`, `runUnmap(target?: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/commands/map.test.ts`:

```ts
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
    { id: id("work"), name: "n", email: "w@x.com", signingKey: null, color: "blue", paths: [p("/a/msu")] },
    { id: id("personal"), name: "n", email: "m@x.com", signingKey: null, color: "magenta", paths: [] },
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './map.ts'`

- [ ] **Step 3: `src/commands/map.ts` 작성**

```ts
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { findRepoRoot, toAbsolutePath, unsafeAbsolutePath } from "../core/paths.ts";
import { uniqueId } from "../core/profile.ts";
import { applySync } from "../core/sync.ts";
import type { AbsolutePath, ProfileId, StoreV2 } from "../types.ts";
import { buildProfile } from "./add.ts";

export const unassignPath = (store: StoreV2, target: AbsolutePath): StoreV2 => ({
  ...store,
  profiles: store.profiles.map((profile) => ({
    ...profile,
    paths: profile.paths.filter((existing) => existing !== target),
  })),
});

export const assignPath = (
  store: StoreV2,
  profileId: ProfileId,
  target: AbsolutePath,
): StoreV2 => {
  const cleared = unassignPath(store, target);
  return {
    ...cleared,
    profiles: cleared.profiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, paths: [...profile.paths, target].toSorted() }
        : profile,
    ),
  };
};

export interface ScopeChoice {
  readonly label: string;
  readonly value: AbsolutePath;
}

export const scopeChoices = (
  cwd: AbsolutePath,
  repoRoot: AbsolutePath | null,
): readonly ScopeChoice[] => {
  const primary = repoRoot ?? cwd;
  const parent = unsafeAbsolutePath(path.dirname(primary).replaceAll("\\", "/"));
  const choices: ScopeChoice[] = [
    { label: `${primary}  (this repository only)`, value: primary },
  ];
  if (parent !== primary) choices.push({ label: `${parent}  (the whole parent folder)`, value: parent });
  return choices;
};

const NEW_PROFILE = "__new__";
const UNMAP = "__unmap__";
const CANCEL = "__cancel__";
const CUSTOM = "__custom__";

export const runMap = async (): Promise<void> => {
  const context = await createContext();
  let store = context.store.read();

  const cwd = toAbsolutePath(process.cwd());
  const repoRoot = findRepoRoot(cwd);
  const alreadyMapped = store.profiles.find((profile) =>
    profile.paths.some((target) => target === (repoRoot ?? cwd)),
  );

  const selection = await select<string>({
    message: `Profile for ${repoRoot ?? cwd}`,
    choices: [
      ...store.profiles.map((profile) => ({
        name: `${profile.id}  ${profile.email}${profile.paths.length > 0 ? chalk.dim(`  [${profile.paths.length}]`) : ""}`,
        value: profile.id as string,
      })),
      { name: "+ Add a new profile", value: NEW_PROFILE },
      ...(alreadyMapped ? [{ name: "Remove this mapping", value: UNMAP }] : []),
      { name: "Cancel", value: CANCEL },
    ],
  });

  if (selection === CANCEL) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  if (selection === UNMAP) {
    store = unassignPath(store, repoRoot ?? cwd);
    context.store.write(await applySync(store, context.sync));
    process.stdout.write(chalk.green(`✓ Removed the mapping for ${repoRoot ?? cwd}\n`));
    return;
  }

  let profileId: ProfileId;
  if (selection === NEW_PROFILE) {
    const taken = new Set(store.profiles.map((profile) => profile.id as string));
    const name = await input({ message: "Git user name" });
    const email = await input({ message: "Git email" });
    const signingKey = await input({ message: "GPG signing key (optional)" });
    const id = await input({ message: "Profile id", default: uniqueId(email, taken) });
    const profile = buildProfile({ id, name, email, signingKey, index: store.profiles.length });
    store = { ...store, profiles: [...store.profiles, profile] };
    profileId = profile.id;
  } else {
    profileId = selection as ProfileId;
  }

  const choices = scopeChoices(cwd, repoRoot);
  const scope = await select<string>({
    message: "Apply to",
    choices: [
      ...choices.map((choice) => ({ name: choice.label, value: choice.value as string })),
      { name: "Enter a path…", value: CUSTOM },
    ],
  });

  const target =
    scope === CUSTOM
      ? toAbsolutePath(await input({ message: "Directory" }))
      : unsafeAbsolutePath(scope);

  const targetRepo = findRepoRoot(target);
  if (targetRepo !== null && targetRepo !== target) {
    process.stdout.write(
      chalk.yellow(
        `! ${target} is inside the repository ${targetRepo}. git matches includeIf against the repository root, so this mapping would have no effect.\n`,
      ),
    );
  }

  store = assignPath(store, profileId, target);
  context.store.write(await applySync(store, context.sync));

  process.stdout.write(chalk.green(`✓ ${target} → ${profileId}\n`));
};
```

- [ ] **Step 4: `src/commands/unmap.ts` 작성**

```ts
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { toAbsolutePath } from "../core/paths.ts";
import { applySync } from "../core/sync.ts";
import { unassignPath } from "./map.ts";

export const runUnmap = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();
  const target = toAbsolutePath(requested ?? process.cwd());

  const owner = store.profiles.find((profile) => profile.paths.includes(target));
  if (!owner) {
    process.stdout.write(chalk.yellow(`No mapping for ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  context.store.write(await applySync(unassignPath(store, target), context.sync));
  process.stdout.write(chalk.green(`✓ Removed the mapping ${target} → ${owner.id}\n`));
};
```

- [ ] **Step 5: `src/cli.ts`에 등록** — `map`은 기본 동작이므로 인자 없이 실행될 때 호출한다

```ts
  program
    .command("map", { isDefault: true })
    .description("Map the current directory to a profile")
    .action(runMap);

  program
    .command("unmap")
    .argument("[path]", "directory to unmap (defaults to the current directory)")
    .description("Remove a directory mapping")
    .action(async (target?: string) => {
      await runUnmap(target);
    });
```

- [ ] **Step 6: 테스트 통과 확인하고 커밋**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add interactive directory mapping and unmap commands"
```

---

## Task 11: 나머지 명령 — `default` · `sync` · `reset`

**Files:**
- Create: `src/commands/default.ts`, `src/commands/sync.ts`, `src/commands/reset.ts`, `src/commands/reset.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `context.ts`, `sync.ts`, `gitconfig/*`
- Produces:
  - `runDefault(id?: string): Promise<void>`
  - `runSync(options: { readonly dryRun: boolean }): Promise<void>`
  - `clearManaged(store: StoreV2, options: SyncOptions): Promise<void>` — includeIf 항목과 프로파일 파일 제거
  - `runReset(): Promise<void>`

- [ ] **Step 1: `reset` 정리 순서 테스트 작성**

`src/commands/reset.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getIncludeIf } from "../core/gitconfig/globalConfig.ts";
import { toAbsolutePath } from "../core/paths.ts";
import { type SyncOptions, applySync } from "../core/sync.ts";
import type { ProfileId, StoreV2 } from "../types.ts";
import { clearManaged } from "./reset.ts";

const id = (value: string): ProfileId => value as ProfileId;

test("clearManaged removes our includeIf entries and profile files but leaves [user]", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-reset-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  const options: SyncOptions = {
    configDir: path.join(base, "config"),
    globalConfigPath,
    now: "t0",
    caseInsensitive: false,
    git: { env },
  };
  fs.mkdirSync(path.join(base, "personal"), { recursive: true });

  const store: StoreV2 = {
    version: 2,
    defaultProfile: id("work"),
    profiles: [
      { id: id("work"), name: "n", email: "w@x.com", signingKey: null, color: "blue", paths: [] },
      {
        id: id("personal"),
        name: "n",
        email: "m@x.com",
        signingKey: null,
        color: "magenta",
        paths: [toAbsolutePath(path.join(base, "personal"))],
      },
    ],
    managedConditions: [],
  };

  const synced = await applySync(store, options);
  const condition = synced.managedConditions[0] as string;
  assert.notEqual(await getIncludeIf(condition, { env }), null);

  await clearManaged(synced, options);

  assert.equal(await getIncludeIf(condition, { env }), null);
  assert.equal(fs.existsSync(path.join(options.configDir, "profiles", "personal.gitconfig")), false);
  assert.match(fs.readFileSync(globalConfigPath, "utf8"), /\[user\]/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './reset.ts'`

- [ ] **Step 3: `src/commands/reset.ts` 작성**

```ts
import path from "node:path";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { removeIncludeIf } from "../core/gitconfig/globalConfig.ts";
import { pruneProfileFiles } from "../core/gitconfig/profileFiles.ts";
import { emptyStore } from "../core/store.ts";
import type { SyncOptions } from "../core/sync.ts";
import type { StoreV2 } from "../types.ts";

/** 스토어를 비우기 전에 파생물을 먼저 지워 고아 설정을 남기지 않는다. */
export const clearManaged = async (store: StoreV2, options: SyncOptions): Promise<void> => {
  for (const condition of store.managedConditions) {
    await removeIncludeIf(condition, options.git);
  }
  pruneProfileFiles([], path.join(options.configDir, "profiles"));
};

export const runReset = async (): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  const proceed = await confirm({
    message: `Remove ${store.profiles.length} profile(s) and all mappings? ~/.gitconfig [user] is kept.`,
    default: false,
  });
  if (!proceed) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  await clearManaged(store, context.sync);
  context.store.write(emptyStore());
  process.stdout.write(chalk.green("✓ Reset. ~/.gitconfig [user] was left as it is.\n"));
};
```

- [ ] **Step 4: `src/commands/default.ts` 작성**

```ts
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId } from "../types.ts";

export const runDefault = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles yet. Run `git-mapper add`.\n");
    process.exitCode = 1;
    return;
  }

  const target =
    requested === undefined
      ? await select<ProfileId>({
          message: "Default profile (used where no mapping matches)",
          choices: store.profiles.map((profile) => ({
            name: `${profile.id}  ${profile.email}`,
            value: profile.id,
          })),
        })
      : (requested as ProfileId);

  if (!store.profiles.some((profile) => profile.id === target)) {
    process.stdout.write(chalk.red(`No profile named ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  context.store.write(await applySync({ ...store, defaultProfile: target }, context.sync));
  process.stdout.write(chalk.green(`✓ Default profile is now ${target}\n`));
};
```

- [ ] **Step 5: `src/commands/sync.ts` 작성**

```ts
import chalk from "chalk";
import { createContext } from "../core/context.ts";
import { applySync, describePlan, planSync } from "../core/sync.ts";

export const runSync = async (options: { readonly dryRun: boolean }): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (options.dryRun) {
    process.stdout.write(`${describePlan(planSync(store, context.sync))}\n`);
    return;
  }

  context.store.write(await applySync(store, context.sync));
  process.stdout.write(chalk.green("✓ Synced\n"));
};
```

- [ ] **Step 6: `src/cli.ts`에 등록**

```ts
  program
    .command("default")
    .argument("[id]", "profile id")
    .description("Set the fallback profile used where no mapping matches")
    .action(async (id?: string) => {
      await runDefault(id);
    });

  program
    .command("sync")
    .option("--dry-run", "print what would change without changing anything", false)
    .description("Regenerate every derived file")
    .action(async (options: { dryRun: boolean }) => {
      await runSync({ dryRun: options.dryRun });
    });

  program.command("reset").description("Remove all profiles and mappings").action(runReset);
```

- [ ] **Step 7: 테스트 통과 확인하고 커밋**

```bash
npm test && npm run typecheck && npm run lint
node bin/index.ts sync --dry-run
git add -A
git commit -m "feat: add default, sync and reset commands"
```

## Task 12: zsh 프롬프트 연동

외부 프로세스를 하나도 띄우지 않는다. 저장소 루트 탐색은 `[[ -e $d/.git ]]`, 파일 읽기는 `$(<file)`(zsh는 이 형태에서 fork하지 않는다), 경로 비교는 파라미터 확장이다.

**Files:**
- Create: `src/shell/zsh.ts`, `src/shell/zsh.test.ts`, `src/shell/resolve.md`, `src/commands/shellInit.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `paths.ts`
- Produces:
  - `interface ShellInitOptions { readonly mappingFile: string; readonly caseInsensitive: boolean }`
  - `zshSnippet(options: ShellInitOptions): string`
  - `runShellInit(shell: string): Promise<void>`

- [ ] **Step 1: 스니펫 테스트 작성**

`src/shell/zsh.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { zshSnippet } from "./zsh.ts";

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
  const code = zshSnippet({ mappingFile: "/m", caseInsensitive: false })
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  // `$(<file)`는 fork하지 않는 zsh 내장 형태라 허용된다.
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './zsh.ts'`

- [ ] **Step 3: `src/shell/zsh.ts` 작성**

```ts
export interface ShellInitOptions {
  readonly mappingFile: string;
  readonly caseInsensitive: boolean;
}

export const zshSnippet = (options: ShellInitOptions): string => {
  const fold = options.caseInsensitive;
  const target = fold ? "${root:l}" : "$root";
  const cand = fold ? "${p:l}" : "$p";

  return `# git-user-mapper shell integration (zsh)
# Generated by \`git-mapper shell-init zsh\`. Regenerate it after changing mappings
# only if the mapping file path changes; the table itself is read on every prompt.
_git_mapper_file='${options.mappingFile}'

_git_mapper_resolve() {
  typeset -g GIT_MAPPER_PROFILE='' GIT_MAPPER_STATE='' GIT_MAPPER_COLOR=''

  local dir=\${PWD:A} root='' d=\${PWD:A}
  while true; do
    if [[ -e $d/.git ]]; then root=$d; break; fi
    [[ $d == / ]] && break
    d=\${d:h}
  done
  [[ -n $root ]] || return 1
  [[ -r $_git_mapper_file ]] || return 1

  local line p rest pid color email cand
  local best_id='' best_color='' best_email='' best_len=-1
  local fb_id='' fb_color='' fb_email=''
  local target=${target}

  for line in \${(f)"$(<$_git_mapper_file)"}; do
    p=\${line%%$'\\t'*}
    rest=\${line#*$'\\t'}
    pid=\${rest%%$'\\t'*}
    rest=\${rest#*$'\\t'}
    color=\${rest%%$'\\t'*}
    email=\${rest#*$'\\t'}
    if [[ $p == '*' ]]; then
      fb_id=$pid fb_color=$color fb_email=$email
      continue
    fi
    cand=${cand}
    if [[ $target == "$cand" || $target == "$cand"/* ]] && (( $#p > best_len )); then
      best_id=$pid best_color=$color best_email=$email best_len=$#p
    fi
  done

  local applied_id applied_email applied_color state
  if (( best_len >= 0 )); then
    applied_id=$best_id applied_email=$best_email applied_color=$best_color state=mapped
  elif [[ -n $fb_id ]]; then
    applied_id=$fb_id applied_email=$fb_email applied_color=$fb_color state=default
  else
    GIT_MAPPER_STATE='no-identity'
    return 0
  fi

  local local_email='' cfg_line section=''
  if [[ -d $root/.git && -r $root/.git/config ]]; then
    for cfg_line in \${(f)"$(<$root/.git/config)"}; do
      cfg_line=\${cfg_line//[[:blank:]]/}
      case $cfg_line in
        '[user]') section=user ;;
        '['*) section='' ;;
        'email='*) [[ $section == user ]] && local_email=\${cfg_line#email=} ;;
      esac
    done
  fi

  if [[ -n $local_email && $local_email != $applied_email ]]; then
    GIT_MAPPER_STATE='local-override'
    GIT_MAPPER_PROFILE=$local_email
    GIT_MAPPER_COLOR=yellow
  else
    GIT_MAPPER_STATE=$state
    GIT_MAPPER_PROFILE=$applied_id
    GIT_MAPPER_COLOR=$applied_color
  fi
  return 0
}

# Powerlevel10k segment. Add \`git_mapper\` to POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS.
function prompt_git_mapper() {
  _git_mapper_resolve || return
  case $GIT_MAPPER_STATE in
    mapped)         p10k segment -f $GIT_MAPPER_COLOR -i '👤' -t "$GIT_MAPPER_PROFILE" ;;
    default)        p10k segment -e -f $GIT_MAPPER_COLOR -i '👤' -t "$GIT_MAPPER_PROFILE %F{244}(default)%f" ;;
    local-override) p10k segment -f yellow -i '⚠' -t "local: $GIT_MAPPER_PROFILE" ;;
    no-identity)    p10k segment -f red -i '⚠' -t 'no identity' ;;
  esac
}
function instant_prompt_git_mapper() { prompt_git_mapper }

# For themes other than p10k: \$GIT_MAPPER_PROFILE and \$GIT_MAPPER_STATE are refreshed
# before every prompt, so you can interpolate them into your own PROMPT.
_git_mapper_precmd() { _git_mapper_resolve }
autoload -Uz add-zsh-hook
add-zsh-hook precmd _git_mapper_precmd
`;
};
```

- [ ] **Step 4: `src/shell/resolve.md` 작성** — 셸 구현이 따르는 계약을 글로 고정한다

```markdown
# Shell resolution contract

The shell snippets and `src/core/mapping.ts` must always produce the same answer.
`src/shell/parity.test.ts` enforces this against real git.

1. Start from the physical (symlink-resolved) working directory.
2. Walk up until a `.git` entry exists — file or directory. If none, produce nothing.
3. Read `mapping.tsv`. Columns: `path`, `profile id`, `color`, `email`. A `*` path is the fallback.
4. Pick the longest `path` that equals the repo root or is a prefix of it followed by `/`.
   Compare case-insensitively on darwin and win32, case-sensitively on linux.
5. No match and a fallback exists → state `default`. No match and no fallback → state `no-identity`.
6. If `<root>/.git` is a directory and its `config` has a `[user] email` different from the
   resolved email → state `local-override`, and report that email. `.git` as a file
   (worktrees, submodules) skips this check.

Changing any rule here means changing `mapping.ts`, every snippet, and the parity test together.
```

- [ ] **Step 5: `src/commands/shellInit.ts` 작성**

```ts
import { isCaseInsensitive, mappingFilePath } from "../core/paths.ts";
import { zshSnippet } from "../shell/zsh.ts";

const GENERATORS = { zsh: zshSnippet } as const;

export const runShellInit = async (shell: string): Promise<void> => {
  const generate = GENERATORS[shell as keyof typeof GENERATORS];
  if (generate === undefined) {
    process.stderr.write(`Unsupported shell ${shell}. Supported: ${Object.keys(GENERATORS).join(", ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    generate({ mappingFile: mappingFilePath(), caseInsensitive: isCaseInsensitive() }),
  );
};
```

- [ ] **Step 6: `src/cli.ts`에 등록**

```ts
  program
    .command("shell-init")
    .argument("<shell>", "zsh")
    .description("Print the shell snippet that shows the active profile in your prompt")
    .action(async (shell: string) => {
      await runShellInit(shell);
    });
```

- [ ] **Step 7: 테스트 통과 확인하고 커밋**

```bash
npm test && npm run typecheck && npm run lint
node bin/index.ts shell-init zsh | head -5
git add -A
git commit -m "feat: add zsh prompt integration with no subprocess per prompt"
```

---

## Task 13: 패리티 테스트

**스펙 성공 기준 3번을 직접 지키는 테스트다.** 같은 픽스처에 대해 git이 고른 identity와 zsh 스니펫이 고른 프로파일이 항상 일치해야 한다.

**Files:**
- Create: `src/shell/parity.test.ts`

**Interfaces:**
- Consumes: `sync.ts`, `zsh.ts`, `paths.ts`
- Produces: 없음(테스트 전용)

- [ ] **Step 1: 패리티 테스트 작성**

`src/shell/parity.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";
import { toAbsolutePath } from "../core/paths.ts";
import { applySync } from "../core/sync.ts";
import type { ProfileId, StoreV2 } from "../types.ts";
import { zshSnippet } from "./zsh.ts";

const id = (value: string): ProfileId => value as ProfileId;

const hasZsh = async (): Promise<boolean> => {
  try {
    await execa("zsh", ["-f", "-c", "exit 0"]);
    return true;
  } catch {
    return false;
  }
};

const zshAvailable = await hasZsh();

interface Harness {
  readonly base: string;
  readonly env: NodeJS.ProcessEnv;
  readonly snippet: string;
  readonly emailOf: ReadonlyMap<string, string>;
}

const setup = async (): Promise<Harness> => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-parity-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  const configDir = path.join(base, "config");

  for (const dir of ["personal", "personal-old", "msu", "oss/deep"]) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
  }

  const store: StoreV2 = {
    version: 2,
    defaultProfile: id("work"),
    profiles: [
      { id: id("work"), name: "n", email: "work@nexpace.io", signingKey: null, color: "blue", paths: [] },
      {
        id: id("personal"),
        name: "n",
        email: "me@gmail.com",
        signingKey: null,
        color: "magenta",
        paths: [toAbsolutePath(path.join(base, "personal"))],
      },
      {
        id: id("oss"),
        name: "n",
        email: "oss@example.com",
        signingKey: null,
        color: "green",
        paths: [toAbsolutePath(path.join(base, "oss", "deep"))],
      },
    ],
    managedConditions: [],
  };

  await applySync(store, {
    configDir,
    globalConfigPath,
    now: "t0",
    caseInsensitive: false,
    git: { env },
  });

  return {
    base,
    env,
    snippet: zshSnippet({
      mappingFile: path.join(configDir, "mapping.tsv"),
      caseInsensitive: false,
    }),
    emailOf: new Map(store.profiles.map((profile) => [profile.id as string, profile.email])),
  };
};

const makeRepo = async (dir: string): Promise<string> => {
  fs.mkdirSync(dir, { recursive: true });
  await execa("git", ["init", "-q"], { cwd: dir });
  return dir;
};

const gitEmail = async (dir: string, env: NodeJS.ProcessEnv): Promise<string | null> => {
  try {
    return (await execa("git", ["config", "user.email"], { cwd: dir, env })).stdout.trim();
  } catch {
    return null;
  }
};

const zshResolve = async (
  snippet: string,
  dir: string,
): Promise<{ readonly profile: string; readonly state: string }> => {
  const script = [
    snippet,
    `cd ${JSON.stringify(dir)}`,
    "_git_mapper_resolve",
    'print -r -- "$GIT_MAPPER_PROFILE"',
    'print -r -- "$GIT_MAPPER_STATE"',
  ].join("\n");
  const result = await execa("zsh", ["-f", "-c", script]);
  const lines = result.stdout.split("\n");
  return { profile: lines[0] ?? "", state: lines[1] ?? "" };
};

test("the zsh matcher and git agree on every fixture", { skip: !zshAvailable }, async () => {
  const h = await setup();

  const cases = [
    { dir: path.join(h.base, "personal", "mar"), profile: "personal", state: "mapped" },
    { dir: path.join(h.base, "personal", "a", "b"), profile: "personal", state: "mapped" },
    { dir: path.join(h.base, "oss", "deep", "lib"), profile: "oss", state: "mapped" },
    { dir: path.join(h.base, "msu", "backend"), profile: "work", state: "default" },
    // 문자열 접두사만 같은 형제 디렉토리는 매치되면 안 된다
    { dir: path.join(h.base, "personal-old", "thing"), profile: "work", state: "default" },
  ];

  for (const testCase of cases) {
    const repo = await makeRepo(testCase.dir);
    const shell = await zshResolve(h.snippet, repo);
    const actual = await gitEmail(repo, h.env);

    assert.equal(shell.profile, testCase.profile, `zsh profile for ${repo}`);
    assert.equal(shell.state, testCase.state, `zsh state for ${repo}`);
    assert.equal(
      h.emailOf.get(shell.profile),
      actual,
      `zsh says ${shell.profile} (${h.emailOf.get(shell.profile)}) but git says ${actual} in ${repo}`,
    );
  }
});

test("the zsh matcher reports a local override that beats the mapping", { skip: !zshAvailable }, async () => {
  const h = await setup();
  const repo = await makeRepo(path.join(h.base, "personal", "overridden"));
  await execa("git", ["config", "user.email", "local@example.com"], { cwd: repo, env: h.env });

  const shell = await zshResolve(h.snippet, repo);
  assert.equal(shell.state, "local-override");
  assert.equal(shell.profile, "local@example.com");
  assert.equal(await gitEmail(repo, h.env), "local@example.com");
});

test("the zsh matcher stays quiet outside a repository", { skip: !zshAvailable }, async () => {
  const h = await setup();
  const shell = await zshResolve(h.snippet, h.base);
  assert.equal(shell.state, "");
  assert.equal(shell.profile, "");
});
```

- [ ] **Step 2: 테스트 실행**

Run: `npm test`
Expected: PASS. zsh가 없으면 3개가 skip된다.

**실패하면 `mapping.ts`나 `zsh.ts` 중 어느 쪽이 계약(`resolve.md`)을 벗어났는지 판단해 고친다. 테스트를 느슨하게 만들지 않는다.**

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "test: assert the zsh matcher and git always agree"
```

---

## Task 14: bash와 fish

zsh와 같은 계약(`resolve.md`)을 따른다. 셸별 차이는 두 가지뿐이다.

- **bash**에는 `${var:l}`이 없다. macOS 기본 bash는 3.2라 `${var,,}`도 못 쓴다. 대신 내장 옵션 `shopt -s nocasematch`를 비교 구간에서만 켜고 되돌린다.
- **fish**는 `string match -i`로 대소문자 무시 비교를 한다.

**Files:**
- Create: `src/shell/bash.ts`, `src/shell/fish.ts`, `src/shell/bash.test.ts`
- Modify: `src/commands/shellInit.ts`, `src/shell/resolve.md`

**Interfaces:**
- Consumes: `zsh.ts`의 `ShellInitOptions`
- Produces: `bashSnippet(options: ShellInitOptions): string`, `fishSnippet(options: ShellInitOptions): string`

- [ ] **Step 1: bash 스니펫 테스트 작성**

`src/shell/bash.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { execa } from "execa";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bashSnippet } from "./bash.ts";

test("bashSnippet spawns no external process", () => {
  const code = bashSnippet({ mappingFile: "/m", caseInsensitive: false })
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  // `$(pwd -P)`는 내장이라 허용된다.
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
    [
      "*\twork\tblue\twork@x.com",
      `${base}/personal\tpersonal\tmagenta\tme@x.com`,
      "",
    ].join("\n"),
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './bash.ts'`

- [ ] **Step 3: `src/shell/bash.ts` 작성** — `resolve.md`의 6단계를 bash 문법으로 옮긴다

```ts
import type { ShellInitOptions } from "./zsh.ts";

export const bashSnippet = (options: ShellInitOptions): string => {
  const enable = options.caseInsensitive ? "  shopt -s nocasematch\n" : "";
  const restore = options.caseInsensitive ? "  shopt -u nocasematch\n" : "";

  return `# git-user-mapper shell integration (bash)
_git_mapper_file='${options.mappingFile}'

_git_mapper_resolve() {
  GIT_MAPPER_PROFILE=''; GIT_MAPPER_STATE=''; GIT_MAPPER_COLOR=''

  local dir root='' d
  dir="$(pwd -P)"
  d="$dir"
  while :; do
    if [[ -e "$d/.git" ]]; then root="$d"; break; fi
    [[ "$d" == / ]] && break
    d="\${d%/*}"
    [[ -z "$d" ]] && d=/
  done
  [[ -n "$root" ]] || return 1
  [[ -r "$_git_mapper_file" ]] || return 1

  local p pid color email
  local best_id='' best_color='' best_email='' best_len=-1
  local fb_id='' fb_color='' fb_email=''

${enable}  while IFS=$'\\t' read -r p pid color email; do
    [[ -z "$p" ]] && continue
    if [[ "$p" == '*' ]]; then
      fb_id="$pid"; fb_color="$color"; fb_email="$email"
      continue
    fi
    if [[ "$root" == "$p" || "$root" == "$p"/* ]] && (( \${#p} > best_len )); then
      best_id="$pid"; best_color="$color"; best_email="$email"; best_len=\${#p}
    fi
  done < "$_git_mapper_file"
${restore}
  local applied_id applied_email applied_color state
  if (( best_len >= 0 )); then
    applied_id="$best_id"; applied_email="$best_email"; applied_color="$best_color"; state=mapped
  elif [[ -n "$fb_id" ]]; then
    applied_id="$fb_id"; applied_email="$fb_email"; applied_color="$fb_color"; state=default
  else
    GIT_MAPPER_STATE='no-identity'
    return 0
  fi

  local local_email='' line section=''
  if [[ -d "$root/.git" && -r "$root/.git/config" ]]; then
    while IFS= read -r line; do
      line="\${line//[[:blank:]]/}"
      case "$line" in
        '[user]') section=user ;;
        '['*) section='' ;;
        'email='*) [[ "$section" == user ]] && local_email="\${line#email=}" ;;
      esac
    done < "$root/.git/config"
  fi

  if [[ -n "$local_email" && "$local_email" != "$applied_email" ]]; then
    GIT_MAPPER_STATE='local-override'; GIT_MAPPER_PROFILE="$local_email"; GIT_MAPPER_COLOR=yellow
  else
    GIT_MAPPER_STATE="$state"; GIT_MAPPER_PROFILE="$applied_id"; GIT_MAPPER_COLOR="$applied_color"
  fi
  return 0
}

# Interpolate \$GIT_MAPPER_PROFILE and \$GIT_MAPPER_STATE into your own PS1.
PROMPT_COMMAND="_git_mapper_resolve\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`;
};
```

- [ ] **Step 4: `src/shell/fish.ts` 작성**

```ts
import type { ShellInitOptions } from "./zsh.ts";

export const fishSnippet = (options: ShellInitOptions): string => {
  const compare = options.caseInsensitive
    ? 'string match -q -i -- "$p" "$root"; or string match -q -i -- "$p/*" "$root"'
    : 'string match -q -- "$p" "$root"; or string match -q -- "$p/*" "$root"';

  return `# git-user-mapper shell integration (fish)
set -g _git_mapper_file '${options.mappingFile}'

function _git_mapper_resolve
    set -g GIT_MAPPER_PROFILE ''
    set -g GIT_MAPPER_STATE ''
    set -g GIT_MAPPER_COLOR ''

    set -l dir (pwd -P)
    set -l root ''
    set -l d $dir
    while true
        if test -e $d/.git
            set root $d
            break
        end
        if test $d = /
            break
        end
        set d (dirname $d)
    end
    test -n "$root"; or return 1
    test -r $_git_mapper_file; or return 1

    set -l best_id ''; set -l best_color ''; set -l best_email ''; set -l best_len -1
    set -l fb_id ''; set -l fb_color ''; set -l fb_email ''

    for line in (cat $_git_mapper_file)
        set -l parts (string split \\t -- $line)
        set -l p $parts[1]; set -l pid $parts[2]; set -l color $parts[3]; set -l email $parts[4]
        if test "$p" = '*'
            set fb_id $pid; set fb_color $color; set fb_email $email
            continue
        end
        if ${compare}
            if test (string length -- $p) -gt $best_len
                set best_id $pid; set best_color $color; set best_email $email
                set best_len (string length -- $p)
            end
        end
    end

    if test $best_len -ge 0
        set -g GIT_MAPPER_STATE mapped
        set -g GIT_MAPPER_PROFILE $best_id
        set -g GIT_MAPPER_COLOR $best_color
    else if test -n "$fb_id"
        set -g GIT_MAPPER_STATE default
        set -g GIT_MAPPER_PROFILE $fb_id
        set -g GIT_MAPPER_COLOR $fb_color
    else
        set -g GIT_MAPPER_STATE no-identity
    end
    return 0
end
`;
};
```

> fish는 `cat`을 쓴다. fish에는 fork 없이 파일을 읽는 내장 형태가 없다. `resolve.md`에 이 예외를 적어 둔다.

- [ ] **Step 5: `shellInit.ts`의 `GENERATORS`에 추가하고 `resolve.md`에 fish 예외를 기록**

```ts
const GENERATORS = { zsh: zshSnippet, bash: bashSnippet, fish: fishSnippet } as const;
```

- [ ] **Step 6: 테스트 통과 확인하고 커밋**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat: add bash and fish prompt integration"
```

---

## Task 15: 패키지 메타와 문서

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md`
- Modify: `LICENSE`, `README.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: `LICENSE`에 포크 저작권 추가**

`Copyright (c) 2020 Geon George` 줄 **아래에** 한 줄 추가한다. 기존 줄은 지우지 않는다. MIT가 요구하는 것은 원저작권 고지의 유지다.

```
Copyright (c) 2020 Geon George
Copyright (c) 2026 Soohan Park
```

- [ ] **Step 2: `AGENTS.md` 작성**

```markdown
# git-user-mapper

Maps directories to git identities using git's own `includeIf "gitdir:"` conditional
includes, and shows the active profile in your shell prompt.

## Commands

| Command | What it does |
|---|---|
| `npm test` | `node --test src/` — runs `.ts` tests directly, no build |
| `npm run test:coverage` | c8, fails under 80% line coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome check (lint + format) |
| `npm run build` | `tsc` → `dist/` |

Node 22.18+ is required — that is the first release with unflagged type
stripping. Development uses Node's native type stripping, so there is
no build step in the inner loop.

## Architecture

The store (a JSON file managed by `conf`) is the single source of truth. `core/sync.ts`
generates everything else and is idempotent:

- `~/.config/git-user-mapper/profiles/<id>.gitconfig` — one `[user]` block per profile
- `includeIf` entries in `~/.gitconfig` — only those listed in `store.managedConditions`
- `~/.config/git-user-mapper/mapping.tsv` — lookup table the shell snippets read

`git` performs the actual resolution, so mappings work in IDEs and GUI clients too.

## Invariants — do not break these

1. **git is called with argv arrays only.** Never interpolate values into a command
   string. Empty values are rejected before reaching git: `git config <key> ""` and
   `git config <key>` are different commands, and the second one silently reads
   instead of writing.
2. **Never edit `~/.gitconfig` as text.** Every write goes through `git config --global`
   so git owns parsing and serialisation. Users keep credentials in that file.
3. **Back up before changing `~/.gitconfig`.** Backups are `0600` in a `0700` directory
   because they may contain those credentials.
4. **`[user]` is written before the `includeIf` entries.** `git config --global` appends
   a new section at the end of the file, so writing `[user]` last would place it after
   the mappings and it would win every time.
5. **Mapping patterns are absolute directory prefixes. No globs.** `mapping.ts` and the
   shell snippets each answer "which profile applies here" independently; restricting
   the pattern language is what keeps the two implementations provably equivalent.
6. **The prompt must never lie.** `src/shell/resolve.md` is the contract shared by
   `core/mapping.ts` and every snippet. `src/shell/parity.test.ts` checks the zsh
   implementation against real git. Change one, change all three.
7. **Do not turn off `erasableSyntaxOnly`.** Enums, namespaces and parameter properties
   would make the type-stripped dev run differ from the compiled build.
8. **Immutability.** Build new objects; never mutate. Interface fields are `readonly`.

## Testing

Unit tests are pure-function tests. Integration tests use a temporary `HOME` with
`GIT_CONFIG_GLOBAL` and a real `git` binary — they assert what git actually resolves,
not what we wrote to a file. The parity test additionally runs `zsh -f`.
```

- [ ] **Step 3: `CLAUDE.md` 작성**

```markdown
@AGENTS.md
```

- [ ] **Step 4: `README.md` 재작성**

기존 내용을 아래로 교체한다.

```markdown
# git-user-mapper

Map directories to git identities, and see which one is active in your shell prompt.

Register `~/dev/personal` once and every repository under it commits with your personal
identity — in the terminal, in your IDE, and in GUI clients. There is nothing to
remember and nothing to run per repository.

> Forked from [geongeorge/Git-User-Switch](https://github.com/geongeorge/Git-User-Switch) (MIT).
> That tool writes the selected identity into the current repository's `.git/config`.
> This one manages `includeIf` mappings in `~/.gitconfig` instead and never touches
> a repository's local config.

## Install

    npm i -g git-user-mapper

Requires git 2.13+ and Node 22.18+.

## Use

    git-mapper              # map the current directory to a profile
    git-mapper status       # what applies here, cross-checked against git
    git-mapper list         # profiles and mappings
    git-mapper add          # add a profile
    git-mapper default      # set the fallback identity
    git-mapper sync         # regenerate everything (--dry-run to preview)

The binary is `git-mapper`, so `git mapper status` works too.

## Prompt

    # ~/.zshrc
    eval "$(git-mapper shell-init zsh)"

With Powerlevel10k, add `git_mapper` to `POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS`. With any
other theme, use `$GIT_MAPPER_PROFILE` and `$GIT_MAPPER_STATE` in your own prompt.
`bash` and `fish` are supported too.

The segment reads a small generated table with no subprocess, so it costs nothing per
prompt. It shows the mapped profile, marks the fallback as `(default)`, and warns when a
repository's local `[user]` overrides the mapping.

## What it writes

    ~/.gitconfig                                     includeIf entries (only its own)
    ~/.config/git-user-mapper/profiles/<id>.gitconfig
    ~/.config/git-user-mapper/mapping.tsv
    ~/.config/git-user-mapper/backups/               ~/.gitconfig backups, mode 0600

It never edits `~/.gitconfig` as text — all writes go through `git config --global` —
and it never touches a repository's `.git/config`.
```

- [ ] **Step 5: 확인하고 커밋**

```bash
npm run lint && npm run build
git add -A
git commit -m "docs: rewrite README and add AGENTS.md for the fork"
```

---

## Task 16: 이 머신에 적용

구현이 끝난 도구를 실제로 세팅한다. 스펙 13절.

**Files:**
- Modify: `~/.zshrc`, `~/.p10k.zsh` (저장소 밖)

**Interfaces:**
- Consumes: 완성된 CLI
- Produces: 동작하는 로컬 세팅

- [ ] **Step 1: 로컬 링크와 마이그레이션 확인**

```bash
npm run build && npm link
git-mapper list
```

Expected: 기존 스토어(`soohanpark / soohan.park@nexpace.io`)가 v2로 마이그레이션되어 프로파일 하나가 보인다. 프로파일 id를 물으면 `work`로 답한다.

- [ ] **Step 2: 개인 프로파일 추가**

```bash
git-mapper add
```

입력값: name `soohanpark`, email `725psh@gmail.com`, signing key 없음, id `personal`.

- [ ] **Step 3: 기본 프로파일을 work로 지정하고 개인 경로를 매핑**

```bash
git-mapper default work
cd ~/dev/personal && git-mapper
```

프로파일 `personal`, 적용 범위 `~/dev/personal`을 고른다.

- [ ] **Step 4: 실제로 먹는지 확인**

```bash
git -C ~/dev/personal/mar config user.email      # 725psh@gmail.com
git -C ~/dev/msu/... config user.email           # soohan.park@nexpace.io
git-mapper status
```

Expected: 개인 저장소는 개인 이메일, 나머지는 회사 이메일. `status`에 경고가 없다.

- [ ] **Step 5: 백업이 만들어졌고 권한이 잠겨 있는지 확인**

```bash
ls -la ~/.config/git-user-mapper/backups/
```

Expected: `gitconfig.<ISO>.bak`이 `-rw-------`, 디렉토리가 `drwx------`

- [ ] **Step 6: 프롬프트 연동**

`~/.zshrc`에 추가한다.

```bash
eval "$(git-mapper shell-init zsh)"
```

`~/.p10k.zsh`의 `POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS` 목록에 `git_mapper`를 추가한다. `p10k configure`를 다시 돌리면 이 파일이 덮어써지므로 그때는 다시 넣어야 한다.

- [ ] **Step 7: 새 셸에서 눈으로 확인**

```bash
exec zsh
cd ~/dev/personal/mar     # 👤 personal
cd ~/dev/msu              # 👤 work (default)
cd ~                      # 세그먼트 없음
```

- [ ] **Step 8: 기존 로컬 override 처리**

`~/dev/personal/soohan-skills`에 로컬 `[user] email = 725psh@gmail.com`이 있다. 매핑 결과와 값이 같아 무해하고 프롬프트도 `local-override`로 뜨지 않는다. 지울지는 사용자에게 확인한다.

```bash
git -C ~/dev/personal/soohan-skills config --unset user.email   # 확인 후에만
```

- [ ] **Step 9: 마무리**

```bash
npm unlink -g git-user-mapper   # 또는 유지
git status
```

작업 브랜치의 커밋을 확인하고 PR 또는 머지 여부를 사용자에게 묻는다.

