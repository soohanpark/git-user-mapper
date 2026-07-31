# git-user-mapper 설계

- 날짜: 2026-07-31
- 상태: 설계 확정, 구현 계획 대기
- 대상 저장소: `soohanpark/git-user-mapper` (`geongeorge/Git-User-Switch` 포크)

## 1. 배경과 목표

기존 `git-user-switch`는 대화형으로 고른 identity를 **현재 저장소의 `.git/config`에 기록**한다. 저장소마다 수동으로 한 번씩 눌러줘야 하고, 누르는 걸 잊으면 잘못된 identity로 커밋된다. 실제로 이 프로젝트의 `selectUser.js`에는 빈 값이 저장돼 있을 때 쓰기 명령이 읽기 명령으로 퇴화해 **아무것도 바꾸지 않고 `Done!`을 출력하는** 버그가 있었다(2026-07-31 수정).

목표는 **경로를 등록해 두면 그 아래 저장소는 자동으로 올바른 identity를 쓰게 만드는 것**이다. 수단은 git 자체 기능인 `includeIf "gitdir:"` 조건부 include이며, 참고 자료는 [bgauduch/06a8c4ec2fec8fef6354afe94358c89e](https://gist.github.com/bgauduch/06a8c4ec2fec8fef6354afe94358c89e)이다.

여기에 더해, 지금 어떤 프로파일이 적용 중인지 **셸 프롬프트에 상시 표시**해서 잘못된 identity로 커밋하는 사고 자체를 눈으로 막는다.

### 성공 기준

1. `~/dev/personal` 아래 아무 저장소에서 `git config user.email`이 개인 주소를 돌려준다. 도구를 다시 실행하지 않아도, 새로 클론한 저장소에서도.
2. 터미널뿐 아니라 IDE·GUI 클라이언트·CI에서도 동일하게 동작한다.
3. 프롬프트가 표시하는 프로파일과 git이 실제로 쓰는 identity가 **항상 일치**한다. 불일치가 가능한 경우에는 불일치라고 표시한다.
4. 프롬프트 세그먼트가 외부 프로세스를 띄우지 않는다.
5. `~/.gitconfig`의 기존 내용(특히 자격증명이 든 `url.*.insteadOf`)이 도구에 의해 변형되지 않는다.

## 2. 비목표

- 저장소별 `.git/config`를 쓰지 않는다. 로컬 override는 **읽어서 경고만** 한다.
- 리모트 URL 기준 매칭(`includeIf "hasconfig:remote.*.url:"`)은 이번 범위 밖이다. 매칭 규칙을 나중에 추가할 수 있게 `mapping.js`를 분리해 둔다.
- SSH 키·GPG 키 자체를 관리하지 않는다. `signingKey`는 키 ID 문자열로만 다룬다.
- glob 패턴 매핑을 지원하지 않는다(3.3 참고).

## 3. 아키텍처

### 3.1 단일 진실 원천

스토어(JSON) 하나가 진실이고 나머지는 전부 파생물이다. 파생물이 깨지면 `git-mapper sync` 한 번으로 복구된다.

```
스토어 (conf JSON)
  │
  ├─ sync ─▶ ~/.config/git-user-mapper/profiles/<id>.gitconfig   (프로파일 정의)
  ├─ sync ─▶ ~/.gitconfig 의 includeIf 항목                       (도구 소유분만)
  └─ sync ─▶ ~/.config/git-user-mapper/mapping.tsv               (프롬프트용 조회 테이블)
```

`sync()`는 모든 변경 명령 뒤에 자동 실행되며 멱등하다.

### 3.2 모듈 구성

```
src/
  cli.ts                     commander 배선만. 로직 없음
  types.ts                   공용 타입 · branded type 정의
  commands/
    map.ts                   기본 동작: 현재 경로에 프로파일 매핑
    status.ts                여기 적용되는 프로파일 + 검증 + 경고
    list.ts                  프로파일·매핑 목록
    add.ts  remove.ts        프로파일 추가·삭제
    unmap.ts                 경로 매핑 해제
    default.ts               fallback 프로파일 지정
    sync.ts                  파생물 재생성 (--dry-run)
    shellInit.ts             셸 스니펫 출력
    reset.ts                 스토어 초기화
  core/
    store.ts                 conf 래퍼 · 스키마 v2 · v1 마이그레이션 · zod 검증
    profile.ts               프로파일 모델 · id 규칙 · 검증
    mapping.ts               경로 정규화 · 조건 문자열 생성 · 최장 접두사 해석
    gitconfig/
      globalConfig.ts        ~/.gitconfig includeIf 항목 관리
      profileFiles.ts        프로파일 gitconfig 파일 입출력
      backup.ts              변경 전 백업 (권한 0600)
    git.ts                   execa argv 전용 래퍼
    paths.ts                 XDG 경로 · ~ 확장 · realpath · win32 정규화
  shell/
    zsh.ts  bash.ts  fish.ts 스니펫 템플릿
    resolve.md               셸 해석 알고리즘 명세 (테스트가 참조)
```

파일당 200~400줄을 넘기지 않는다. `cli.ts`는 배선만 담당하고 모든 명령은 `commands/` 아래 독립 모듈로 둔다. 배포 시 `tsc`가 같은 구조로 `dist/`에 방출한다(11절).

### 3.3 매핑 패턴 제약 (중요)

매핑 경로는 **절대경로 디렉토리 접두사만** 허용하고 glob(`**`, `*`)을 받지 않는다.

이유: 같은 질문("이 경로에 어떤 프로파일이 적용되나")에 대해 git과 셸 프롬프트가 **각각 독립적으로** 답을 계산한다. 두 구현이 정확히 같은 답을 내야 프롬프트가 거짓말하지 않는다. glob을 허용하면 셸에서 git의 `wildmatch` 시맨틱을 재구현해야 하고, 미묘하게 어긋나는 순간 프롬프트는 조용히 틀린 값을 보여준다. 접두사 매칭으로 제한하면 양쪽 구현이 자명하게 동치다.

## 4. 데이터 모델

### 4.1 스토어 스키마 v2

```json
{
  "version": 2,
  "defaultProfile": "work",
  "profiles": [
    {
      "id": "work",
      "name": "soohanpark",
      "email": "soohan.park@nexpace.io",
      "signingKey": null,
      "color": "blue",
      "paths": []
    },
    {
      "id": "personal",
      "name": "soohanpark",
      "email": "725psh@gmail.com",
      "signingKey": null,
      "color": "magenta",
      "paths": ["/Users/soohanpark/dev/personal"]
    }
  ],
  "managedConditions": ["gitdir/i:/Users/soohanpark/dev/personal/"]
}
```

- `id` — `^[a-z0-9][a-z0-9-]{0,31}$`, 유일. 프롬프트에 표시되는 이름이다.
- `paths` — 절대경로, `realpath` 해석 완료, 후행 슬래시 없음. 매핑 시점에 실존하는 디렉토리여야 한다.
- `color` — 프롬프트 세그먼트 색. 미지정 시 팔레트에서 순환 배정.
- `defaultProfile` — 선택. 지정하면 `sync`가 `~/.gitconfig`의 `[user]`에 해당 값을 쓴다. `null`이면 `[user]`를 건드리지 않고 기존 내용을 그대로 fallback으로 취급한다.
- `managedConditions` — 도구가 만든 `includeIf` 조건 문자열 목록. **이 목록에 없는 `includeIf`는 읽지도 지우지도 않는다.**

`defaultProfile`로 지정된 프로파일을 `remove`하면 `defaultProfile`은 `null`이 되고 `~/.gitconfig`의 `[user]`는 **지우지 않고 그대로 둔다.** identity를 없애는 쪽이 커밋 실패로 이어지므로, 마지막에 쓴 값이 남는 편이 안전하다.

### 4.2 v1 → v2 마이그레이션

v1은 `{ "users": [{ name, email, signingKey }] }` 형태로 프로파일 이름이 없다.

- 스토어 로드 시 자동 감지·변환하고, 변환 전 파일을 `store.v1.<ISO>.bak`으로 백업한다.
- 대화형 TTY면 각 항목의 `id`를 물어본다(기본 제안값: 이메일 로컬파트 슬러그).
- 비대화형이면 슬러그를 자동 배정하고 충돌 시 `-2`, `-3`을 붙인다.
- `~/.gitconfig`의 현재 `[user].email`과 일치하는 항목을 `defaultProfile`로 잡는다. 없으면 첫 항목.
- `paths`는 빈 배열로 시작한다. 마이그레이션이 매핑을 추측하지 않는다.

## 5. 매핑 해석 규칙

두 구현(git / 셸)이 공통으로 따르는 규칙이며, 패리티 테스트가 이 절을 검증한다.

1. 기준 경로는 **저장소 루트**의 realpath다. (git은 `.git` 디렉토리 경로로 매칭하고, 셸은 루트를 찾아 올라간다. 두 경로의 접두사 판정 결과는 같다.)
2. 매핑 후보 중 **가장 긴 `path`가 이긴다.** `path`가 기준 경로와 같거나, 기준 경로가 `path + "/"`로 시작하면 매치다.
3. 매치가 없으면 `defaultProfile`(= `~/.gitconfig`의 `[user]`)이 적용된다.
4. 대소문자: darwin·win32는 무시, linux는 구분. git 조건 문자열도 같은 규칙으로 `gitdir/i:` / `gitdir:`를 쓴다.
5. 저장소가 아니면 해석하지 않는다.

### 5.1 조건 문자열 생성

```
darwin, win32 →  gitdir/i:<path>/
linux         →  gitdir:<path>/
```

경로는 항상 슬래시로 정규화한다(win32의 `C:\foo` → `C:/foo`). 후행 슬래시는 git이 `**`를 자동으로 덧붙이게 만들어 하위 전체에 재귀 적용시킨다.

## 6. 동기화 알고리즘

`sync()`는 아래 순서로 수행하며 멱등하다. `--dry-run`은 각 단계에서 수행할 변경을 출력만 한다.

1. `~/.gitconfig` 백업 (실행당 1회, 첫 쓰기 직전)
2. `managedConditions`의 각 조건에 대해 `git config --global --remove-section "includeIf.<cond>"` — 없으면 무시
3. `paths`가 있는 프로파일마다
   a. `~/.config/git-user-mapper/profiles/<id>.gitconfig` 생성
   b. `git config --global "includeIf.<cond>.path" <파일경로>`
4. `defaultProfile`이 있으면 `git config --global user.name|user.email` 기록, `signingKey`가 `null`이면 `--unset user.signingKey`
5. 스토어의 `managedConditions` 갱신
6. `mapping.tsv` 생성

2→3 순서가 중요하다. `git config --global`은 없는 섹션을 **파일 끝에 추가**하므로, 매번 제거 후 재추가하면 우리 `includeIf` 항목이 항상 `[user]`보다 뒤에 놓인다. include는 등장 위치에서 처리되고 나중 값이 이기므로, 이 순서가 곧 "매핑이 fallback을 이긴다"는 보장이다.

### 6.1 mapping.tsv

```
*	work	blue	soohan.park@nexpace.io
/Users/soohanpark/dev/personal	personal	magenta	725psh@gmail.com
```

- 열: `경로 ⇥ 프로파일 id ⇥ 색상 ⇥ 이메일`
- 경로 `*`인 줄은 fallback이다. `defaultProfile`이 없으면 이 줄도 없다.
- 나머지는 **경로 길이 내림차순** 정렬이라 셸이 첫 매치에서 멈출 수 있다.
- 이메일을 함께 실어 셸이 로컬 override와 비교할 때 추가 조회를 하지 않게 한다.

## 7. CLI 표면

```
git-mapper                        현재 경로에 적용할 프로파일 선택 → 매핑 (기본 동작)
git-mapper status [--porcelain]   여기 적용되는 프로파일 · 검증 · 경고
git-mapper list                   프로파일과 매핑 전체
git-mapper add                    프로파일 추가
git-mapper remove [id]            프로파일 삭제 (매핑도 함께 제거)
git-mapper unmap [path]           경로 매핑 해제
git-mapper default [id]           fallback 프로파일 지정
git-mapper sync [--dry-run]       파생물 재생성
git-mapper shell-init <zsh|bash|fish>
git-mapper reset                  스토어 초기화
```

`reset`은 스토어를 비우기 전에 `managedConditions`의 `includeIf` 항목과 프로파일 파일을 먼저 제거해서 고아 설정을 남기지 않는다. `~/.gitconfig`의 `[user]`는 남긴다.

`status --porcelain`은 프롬프트·스크립트가 쓰는 출력이다. 한 줄로 `<프로파일 id> ⇥ <상태> ⇥ <이메일>`를 내보내며 상태는 `mapped` · `default` · `local-override` · `no-identity` 중 하나다. 저장소가 아니면 아무것도 출력하지 않고 exit 1이다.

기본 동작은 두 단계다.

```
$ git-mapper                        # cwd: ~/dev/cowork/foo
? 프로파일       ❯ work / personal / + 새 프로파일
? 적용 범위      ❯ ~/dev/cowork/foo   (이 저장소만)
                   ~/dev/cowork        (상위 폴더 전체)
                   직접 입력
✓ ~/dev/cowork → work
```

현재 경로가 이미 매핑돼 있으면 첫 목록에 "이 매핑 해제"가 추가된다.

`status`는 **우리 해석과 git의 실제 답을 나란히 비교**해서 출력한다. 이것이 3번 성공 기준의 런타임 검증이다.

```
$ git-mapper status
  경로       ~/dev/personal/mar
  프로파일   personal   ← ~/dev/personal 매핑
  git 실제   soohanpark <725psh@gmail.com>   ✓ 일치
```

## 8. 셸·프롬프트 연동

### 8.1 해석 알고리즘 (외부 프로세스 없음)

1. `${PWD:A}`에서 위로 올라가며 `.git`(디렉토리 또는 파일)을 찾아 저장소 루트를 구한다. 없으면 세그먼트를 숨긴다.
2. `$(<mapping.tsv)`로 테이블을 읽는다. zsh·bash 모두 이 형태는 fork하지 않는다. 파일이 작아 매 프롬프트마다 읽어도 부담이 없고, 그 덕에 **캐시 무효화 문제가 존재하지 않는다.**
3. 5절 규칙으로 첫 매치를 찾는다. 없으면 `*` 줄.
4. `.git`이 디렉토리면 `<root>/.git/config`를 읽어 `[user].email`이 있는지 본다. 있고 해석된 이메일과 다르면 로컬 override 상태다.
5. 렌더링.

`.git`이 파일인 경우(worktree·submodule)는 로컬 config가 다른 위치에 있으므로 4단계를 건너뛴다. 문서화된 한계다.

### 8.2 표시 규칙

| 상황 | 표시 |
|---|---|
| 매핑됨 | `👤 personal` |
| 매핑 없음 → fallback 적용 | `👤 work` + 흐린 `(default)` |
| 로컬 `[user]`가 적용값과 다름 | `⚠ local: 725psh@…` |
| 로컬 `[user]`가 적용값과 같음 | 정상 표시 (중복일 뿐 무해) |
| 로컬 `[user]`에 이메일이 없음 | override 아님으로 취급 (비교는 이메일 기준) |
| fallback `[user]`조차 없음 | `⚠ no identity` |
| git 저장소 아님 | 숨김 |

경고는 "매핑이 없음"이 아니라 **"실제 커밋될 identity가 예상과 다름"**일 때만 쓴다. 매핑이 없는 건 정상 상태이고, fallback이 적용되는 것뿐이다.

### 8.3 셸별 출력

- **zsh + Powerlevel10k** — `prompt_git_mapper`와 `instant_prompt_git_mapper`를 정의하고, `POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS`에 `git_mapper`를 추가하도록 안내한다. 색상은 프로파일의 `color`를 쓰고 `(default)` 접미사는 `p10k segment -e`로 흐리게 처리한다.
- **zsh (기타 테마)** — `precmd`에서 `$GIT_MAPPER_PROFILE`, `$GIT_MAPPER_STATE`를 채워 어떤 테마에서든 쓸 수 있게 한다.
- **bash** — `PROMPT_COMMAND`에서 같은 변수를 채운다. `${PWD:A}`가 없으므로 `pwd -P`(내장) 결과를 쓴다.
- **fish** — `__git_mapper_profile` 헬퍼 함수를 제공한다.

## 9. 안전장치와 에러 처리

`~/.gitconfig`에 평문 자격증명이 들어 있는 환경을 전제로 설계한다.

- **텍스트 편집 금지.** `~/.gitconfig`에 대한 모든 쓰기는 `git config --global` argv 호출로만 한다. git이 직접 파싱·직렬화하므로 우리 코드가 기존 줄을 재작성할 일이 없다.
- **백업.** 실행당 첫 변경 직전에 `~/.config/git-user-mapper/backups/gitconfig.<ISO>.bak`으로 복사하고 최근 10개만 보관한다. **백업 파일에는 자격증명이 그대로 들어가므로 디렉토리는 `0700`, 파일은 `0600`으로 만든다.**
- **소유 범위 한정.** `managedConditions`에 없는 `includeIf`는 건드리지 않는다.
- **git 호출 규약.** 모든 호출은 argv 배열이다. 셸 문자열 보간을 쓰지 않는다. 빈 문자열 값도 인자로 보존되므로 쓰기가 읽기로 퇴화하지 않는다. 값이 비었거나 `undefined`면 git을 호출하기 전에 거부한다.
- **`--dry-run`.** `sync`가 무엇을 바꿀지 미리 보여준다.

`status`가 경고하는 상태:

| 경고 | 의미 |
|---|---|
| git 2.13 미만 | `includeIf` 미지원. 기능 자체가 동작하지 않음 |
| 우리 항목 뒤의 관리 밖 `[user]` | 매핑이 fallback에 지는 상태. `sync`로 복구 가능 |
| 프로파일 파일 누락 | `includeIf`가 없는 파일을 가리킴. git은 조용히 무시함 |
| 존재하지 않는 매핑 경로 | 디렉토리가 삭제·이동됨 |
| 서로 포함 관계인 매핑 | 동작은 하지만(최장 승리) 의도 확인 필요 |
| 매핑 경로가 저장소 **내부** | 아무 효과가 없음. `gitdir`는 저장소 루트의 `.git` 경로와 매칭되므로 하위 디렉토리를 매핑하면 조용히 무시된다. 매핑 시점에도 경고한다 |
| 해석값 ≠ git 실제값 | 로컬 override 등. 가장 중요한 경고 |

## 10. 테스트 전략

현재 테스트가 0이다. 러너부터 세운다. 목표 커버리지 80%.

- 러너: **`node --test` 내장 러너 + `c8`**. 테스트 러너 의존성을 추가하지 않는다.
- 테스트는 `.ts` 그대로 실행한다. Node의 타입 스트리핑은 타입을 **공백으로 치환**하므로 줄 번호가 원본과 1:1로 보존되고, 커버리지 리포트가 소스맵 없이도 정확하다. 빌드 없이 테스트가 돈다.
- **단위** — 매핑 해석(최장 접두사·대소문자·`~` 확장·심볼릭 링크), v1→v2 마이그레이션, 조건 문자열 생성, 프로파일 검증, 셸 스니펫 스냅샷.
- **통합** — 임시 `HOME`과 실제 `git` 바이너리로 저장소를 만들고 `sync` 후 `git -C <dir> config user.email`을 확인한다. 파일을 잘 썼는지가 아니라 **`includeIf`가 실제로 먹는지**를 검증한다. `[user]`와 `includeIf`의 순서 보장, `sync` 멱등성, 매핑 제거 후 fallback 복귀도 여기서 본다.
- **패리티** — 픽스처 경로 집합에 대해 ⑴ git이 고른 identity와 ⑵ 생성된 zsh 매처가 고른 프로파일이 항상 일치하는지 검사한다. 3번 성공 기준을 직접 지키는 테스트다. zsh가 없는 환경에서는 skip한다.
- **회귀** — 빈 값·`undefined` 프로파일이 git 호출에 도달하지 않는지. 2026-07-31에 고친 버그의 재발 방지.

## 11. 언어와 툴체인

TypeScript 7.0으로 작성한다(`typescript@latest` = 7.0.2 확인). 모듈은 ESM이고 의존성은 최신을 쓴다.

이 전환의 비용이 낮은 이유는, 설계상 `src/` 거의 전부를 새로 쓰기 때문이다. 기존 JS를 변환하는 작업이 아니라 처음부터 TS로 쓰는 작업이다.

### 11.1 빌드와 실행

- **개발·테스트는 빌드하지 않는다.** Node의 내장 타입 스트리핑으로 `.ts`를 직접 실행한다(로컬 `v24.14.0`, `process.features.typescript === 'strip'` 확인). `node --test`가 `.ts` 테스트 파일을 그대로 돌린다.
- **배포물만 컴파일한다.** `tsc`가 `dist/`에 JS와 `.d.ts`를 방출하고, `files`는 `["dist"]`, `bin`은 `dist/bin/index.js`를 가리킨다. 소비자는 TS를 몰라도 되고 Node 버전 요구도 의존성 수준에 머문다.
- **`erasableSyntaxOnly: true`** — enum, parameter property, namespace를 금지한다. 이게 켜져 있어야 "Node가 스트리핑해 실행한 결과"와 "tsc가 컴파일한 결과"가 항상 같다고 보장된다. 상수는 `as const` 객체로 표현한다.
- **`rewriteRelativeImportExtensions: true`** — 소스에서는 `./mapping.ts`로 import하고 방출 시 `./mapping.js`로 바뀐다. 직접 실행(확장자 필요)과 빌드 결과(확장자 변환) 양쪽이 동시에 성립한다.
- tsconfig는 `strict` 위에 `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module`/`moduleResolution: nodenext`를 켠다.

### 11.2 타입으로 지키는 설계 불변식

타입을 문서가 아니라 **강제 수단**으로 쓴다.

- `ProfileId`와 `AbsolutePath`를 branded type으로 둔다. 정규화되지 않은 경로 문자열은 매핑에 들어갈 수 없고, 검증을 통과한 값만 그 타입을 얻는다. 3.3의 "glob 없는 절대경로" 제약이 타입 수준에서 지켜진다.
- 스토어를 `version`으로 판별하는 유니온(`StoreV1 | StoreV2`)으로 정의한다. v3가 생기는 날 마이그레이션을 빠뜨리면 컴파일이 깨진다.
- 프롬프트 상태를 `mapped | default | local-override | no-identity` 판별 유니온으로 둔다. 8.2 표에 상태를 추가하고 렌더링 분기를 빠뜨리면 컴파일이 깨진다.

### 11.3 경계 검증

타입은 컴파일 타임에만 존재하므로, **사용자가 직접 편집할 수 있는 입력**은 런타임에 검증한다. 스토어 JSON과 `mapping.tsv` 파싱에 zod 4를 쓴다. 손상된 스토어는 "이상한 값으로 git config를 쓴다"가 아니라 "무엇이 잘못됐는지 말하고 멈춘다"로 이어져야 한다.

### 11.4 의존성

| 패키지 | 버전 | 용도 |
|---|---|---|
| `commander` | 15 | CLI 파싱 |
| `@inquirer/prompts` | 8 | 대화형 프롬프트 (구 `inquirer`의 후속) |
| `execa` | 10 | git 호출 (argv 전용) |
| `conf` | 15 | 스토어 |
| `chalk` | 6 | 출력 색상 |
| `zod` | 4 | 경계 검증 |

devDependencies는 `typescript` 7, `c8`, `@biomejs/biome` 2.

### 11.5 린터를 Biome으로 교체하는 이유

TS 7은 구 JS 컴파일러 API를 더 이상 노출하지 않는다. 패키지의 `exports`는 `./lib/version.cjs`와 `./unstable/*`뿐이고, `import ts from "typescript"`로 쓰던 API가 사라졌다. 이 API에 의존하던 도구들이 아직 따라오지 못했다.

**`typescript-eslint`는 TS 7에서 쓸 수 없다.** `8.65.0`(latest)과 `8.65.1-alpha.19`(canary) 모두 peer가 `typescript >=4.8.4 <6.1.0`이다. 기존 `eslint` + `typescript-eslint` + `prettier` 조합은 TS 7과 공존하지 않는다.

그래서 린트와 포맷을 **Biome**으로 일원화한다. Biome은 자체 파서를 쓰므로 TS 컴파일러 API에 묶이지 않고, 린터와 포매터를 devDependency 하나로 대체한다. 지금 설정된 `eslint` 6 + `prettier` 2도 이미 교체 대상이라 실질 손실이 적다.

**감수하는 비용:** 타입 추론이 필요한 규칙(`no-floating-promises` 등)을 잃는다. 이 CLI는 async가 많아 실제 손실이다. 대신 `tsconfig`의 `strict` 계열 플래그와 `tsc --noEmit` 타입체크를 CI 게이트로 두고, 통합 테스트가 "명령이 끝났는데 git 호출이 안 끝난" 류의 실수를 잡는다. `typescript-eslint`가 TS 7을 지원하면 그때 재검토한다.

**0단계에서 실제로 검증할 것:** `tsc`의 `.d.ts` 선언 방출이 의도대로 동작하는지, Biome 규칙 세트가 이 코드베이스에서 쓸 만한지. 여기서 막히면 툴체인 결정을 되돌린다.

`engines.node`는 **`>=22.18.0`**이다. 의존성이 요구하는 값은 `>=22.12`(commander 15)이지만, Node의 무플래그 타입 스트리핑이 22.18.0부터라 그 아래에서는 `npm test`가 `.ts`에서 죽는다. 소비자와 기여자에게 같은 하나의 floor를 제시한다.

## 12. 패키지와 문서

| 항목 | 값 |
|---|---|
| 패키지명 | `git-user-mapper` (npm 미등록 확인) |
| 실행파일 | `git-mapper` → `dist/bin/index.js`. git이 디스패치해 `git mapper status`로도 쓸 수 있다 |
| 버전 | `1.0.0` (동작이 바뀐 새 패키지) |
| 모듈 | `"type": "module"` (ESM) |
| `files` | `["dist"]` — 소스가 아니라 컴파일 결과만 배포 |
| `engines.node` | `>=22.18.0` |
| 스크립트 | `build`(tsc) · `test`(node --test) · `test:coverage`(c8, 80% 기준) · `lint`(biome) · `typecheck`(tsc --noEmit) · `prepublishOnly`(build) |
| author | `Soohan Park <725psh@gmail.com> (https://github.com/soohanpark)` |
| LICENSE | MIT 유지. `Copyright (c) 2020 Geon George` 보존 + `Copyright (c) 2026 Soohan Park` 추가 |
| README | 상단에 `geongeorge/Git-User-Switch` 포크임을 명시 |

`AGENTS.md`(영문)에 구조 지도, 명령어, 그리고 **깨뜨리면 안 되는 불변식**을 적는다.

1. git 호출은 argv 배열 전용. 셸 문자열 보간 금지.
2. `~/.gitconfig`를 텍스트로 편집하지 않는다. `git config --global`만 쓴다.
3. 변경 전 백업하고, 백업은 `0600`이다.
4. 매핑 패턴에 glob을 허용하지 않는다(3.3).
5. 프롬프트 해석과 git 해석은 항상 같은 답을 내야 한다. 5절을 바꾸면 셸 구현과 패리티 테스트를 함께 고친다.
6. `erasableSyntaxOnly`를 끄지 않는다. enum·namespace·parameter property를 쓰는 순간 개발 중 직접 실행한 결과와 배포 빌드 결과가 갈라진다.

`CLAUDE.md`는 `@AGENTS.md` 한 줄만 둔다.

## 13. 이 머신 초기 세팅

구현 후 별도 단계로 적용한다.

1. 스토어 v1 → v2 마이그레이션, 기존 항목을 `work`로 명명
2. `personal` 프로파일 추가 — `soohanpark` / `725psh@gmail.com`
3. `~/dev/personal` → `personal` 매핑
4. `defaultProfile = work` (현재 `[user]` 값과 동일하므로 실질 변경 없음)
5. `sync`
6. `.zshrc`에 `eval "$(git-mapper shell-init zsh)"`, `.p10k.zsh`의 `POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS`에 `git_mapper` 추가. `p10k configure`를 다시 돌리면 `.p10k.zsh`가 덮어써지므로 그때는 이 줄을 다시 넣어야 한다
7. `~/dev/personal/soohan-skills`의 로컬 `[user]`는 매핑과 값이 같아 무해하다. 제거 여부는 확인 후 결정한다.

`~/dev/msu`, `~/dev/nexpace`는 fallback으로 `work`가 되므로 명시 매핑 없이도 올바르다.

## 14. 구현 순서

각 단계가 끝날 때마다 동작하는 상태를 유지한다.

0. **툴체인** — TS 7 + ESM 전환, tsconfig, 의존성 교체, `node --test` 러너와 c8, Biome. 기존 JS 소스와 `.eslintrc.json`을 걷어낸다. 11.5의 검증 항목을 여기서 통과시킨다.
1. **기반** — `paths.ts`, `git.ts`(argv 래퍼), `store.ts`(v2 + 마이그레이션 + zod), `profile.ts`, `types.ts`의 branded type.
2. **핵심 동기화** — `mapping.js`, `gitconfig/*`, `sync` 명령. 통합 테스트로 `includeIf`가 실제로 먹는 것까지 확인한다. 이 시점에 기능의 본체가 완성된다.
3. **CLI** — `map`(기본) · `status` · `list` · `add` · `remove` · `unmap` · `default` · `reset`.
4. **셸 연동** — `shell-init`과 zsh·bash·fish 스니펫, 패리티 테스트.
5. **패키지·문서** — 이름 변경, `AGENTS.md`, `CLAUDE.md`, README, LICENSE.
6. **이 머신 적용** — 13절.

## 15. 위험과 열린 항목

- **npm 배포** — `npm whoami`가 미인증 상태다. 배포 전 `npm login`이 필요하다. (사용자 작업)
- **GitHub 커밋 연결** — `725psh@gmail.com`이 GitHub 계정에 인증된 이메일이어야 커밋이 프로필에 연결된다. `gh api user/emails`는 `user` 스코프가 없어 확인하지 못했다. (사용자 확인 필요)
- **`~/.gitconfig` 자격증명** — `url."https://<user>:<token>@gitlab.nexon.com/"` 항목 2건이 평문이다. 도구가 이 파일을 백업하므로 백업 권한을 조인다(9절). 토큰 로테이션과 credential helper 이전은 이 프로젝트 범위 밖이지만 권장한다.
- **바이너리 이름 충돌** — upstream `git-user-switch`가 설치돼 있으면 `git-user`가 남는다. 이름이 달라 충돌하지 않지만, 혼동을 막으려면 기존 패키지를 제거하는 편이 낫다.
- **TS 7 생태계 지연** — `typescript-eslint`가 아직 TS 7을 지원하지 않는다(11.5). 다른 TS 컴파일러 API 의존 도구도 같은 문제를 겪을 수 있다. 0단계에서 막히면 툴체인 결정을 되돌린다.
- **Node 요구 상승** — `engines.node >= 22.18`로 올라간다. upstream은 훨씬 낮은 버전까지 지원했지만, 새 패키지이고 최신 의존성이 요구하는 값이라 수용한다.
- **프롬프트 UX 변화** — `inquirer` 7 → `@inquirer/prompts` 8로 바뀌면서 목록 렌더링과 키 조작이 미세하게 달라진다. 기능 손실은 없다.
