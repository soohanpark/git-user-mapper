# git-user-mapper

Maps directories to git identities using git's own `includeIf "gitdir:"` conditional
includes, and shows the active profile in your shell prompt.

## Commands

| Command | What it does |
|---|---|
| `npm test` | `node --test "src/**/*.test.ts"` — runs `.ts` tests directly, no build |
| `npm run test:coverage` | c8, fails under 80% line coverage |
| `npm run typecheck` | `tsc --noEmit`, covering tests as well as sources |
| `npm run lint` | Biome check (lint + format) |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` |

Node 22.18+ is required — that is the first release with unflagged type stripping, so
development has no build step in the inner loop. A bare directory argument does not work
with Node's test runner; keep the glob in the `test` script.

`tsconfig.json` covers everything so `typecheck` sees the tests; `tsconfig.build.json`
excludes `*.test.ts` and is what `build` uses. Excluding tests from both is how a deleted
export once went unnoticed.

## Architecture

The store (a JSON file managed by `conf`) is the single source of truth. `core/sync.ts`
generates everything else and is idempotent:

- `~/.config/git-user-mapper/profiles/<id>.gitconfig` — one `[user]` block per profile
- `includeIf` entries in the global gitconfig — only those listed in `store.managedConditions`
- `~/.config/git-user-mapper/mapping.tsv` — lookup table the shell snippets read

`git` performs the actual resolution, so mappings work in IDEs and GUI clients too.

Three small modules exist because the prompt path cannot spawn a process and therefore has
to reimplement what git does. Each is the single TypeScript copy of a rule the shell
snippets also carry, and `parity.test.ts` is what keeps the copies honest:

- `core/gitdir.ts` — resolves `$GIT_DIR` and the common dir from a directory
- `core/gitconfig/configText.ts` — reads git config text (reads only; writes still go
  through `git config`)
- `core/caseFold.ts` — ASCII-only case folding, matching git's wildmatch

`core/fallback.ts` is shared by `sync` and `status` so both build the same table, and
`core/lock.ts` serialises the read → sync → write section across processes.

`conf` derives its storage location from the package name, so the rename from
`git-user-switch` stranded existing users' data in a sibling directory. `openStore`
imports that file when its own store is empty, and never writes to it.

## Invariants — do not break these

1. **git is called with argv arrays only.** Never interpolate values into a command
   string. Empty values are rejected before reaching git: with argv, `git config <key> ""`
   is a valid write of an empty value, which would silently blank an identity. (The tool
   this was forked from had the same outcome by a different route — string interpolation
   turned the write into a read.)
2. **Never assemble git config text. Ever — not `~/.gitconfig`, not the profile files it
   includes.** Every write goes through `git config` (`--global` or `--file`) so git owns
   parsing, quoting and escaping. This rule was once read as being about `~/.gitconfig`
   alone, and the profile files were built with template literals; git parses both the
   same way, so a `"` in a display name silently changed the committed identity, a `#`
   truncated the signing key, and a newline injected a `[core] sshCommand`.
3. **Back up the global config before changing it.** Backups are `0600` in a `0700`
   directory because they may contain credentials. Back up the file git will actually
   write to — `git config --global` targets `$XDG_CONFIG_HOME/git/config` when
   `~/.gitconfig` does not exist, and backing up the wrong path is the same as not
   backing up at all. `core/paths.ts` `globalGitConfigPath` encodes git's precedence.
4. **`[user]` must end up before every `includeIf` entry.** `git config --global` appends
   a new section at the end of the file, so writing `[user]` last would place it after
   the mappings and it would win every time. Writing it *first* is not enough on its own:
   when the file has no `[user]` at all, git creates it at the end — behind any `includeIf`
   the user wrote by hand, silently killing mappings that were working. Someone who
   already uses `includeIf` manually is exactly this tool's audience, so `planOperations`
   detects that case (and the already-broken ordering) and lifts the entries back out and
   in again around the write. Entries it did not create are never recorded in
   `managedConditions` — recording them would make the next sync delete them.
5. **Mapping patterns are absolute directory prefixes with no glob semantics, matched
   against `$GIT_DIR`.** `mapping.ts` and the shell snippets each answer "which profile
   applies here" independently, and restricting the pattern language is what keeps them
   provably equivalent. git matches `gitdir:` with wildmatch, so `conditionFor` escapes
   `* ? [ ]` and every snippet compares literally. Unescaped, a directory named `star*dir`
   also matched `starOTHERdir` and one named `proj [old]` matched nothing. Case folding is
   ASCII-only for the same reason: wildmatch folds bytes, so a mapping on a non-ASCII
   directory reported `mapped` while git ignored the entry completely.
6. **The prompt must never lie.** `src/shell/resolve.md` is the contract shared by
   `core/mapping.ts`, `commands/status.ts` and every snippet. `src/shell/parity.test.ts`
   checks all three shells against real git. Change one, change all of them. Four specific
   traps, all of which have already happened: an unmanaged `[user]` is still a real
   identity; a repository's local `[user]` must be read *before* deciding there is no
   identity; that local `[user]` lives in the **common dir**, and the mapping is matched
   against the **git dir**, which for a linked worktree are two different places from the
   working tree; and the config must be parsed the way git parses it, because the spellings
   git's own writer produces (quoted values) and accepts (`[USER]`, `[user] email = x`)
   are not the one spelling a naive reader expects.
7. **`gitOrNull`'s allowed exit codes are per call site.** Measured on git 2.50: `--get`
   exits 1 for a missing key, `--unset` exits 5 for a missing target, `--remove-section`
   exits **128** for a missing section, and `--list` exits 0 on an empty config — while a
   malformed config file exits 128 for all of them. Swallow everything and "broken file"
   hides behind "not set"; narrow to `[1, 5]` and `removeIncludeIf` breaks. `applySync`
   proves the config is readable before its first write, which is what makes the 128 from
   `--remove-section` unambiguous.
8. **Validate the whole plan before the first mutation, record what you are about to add
   before adding it, and hold the lock while you do.** An `includeIf` that is not in
   `store.managedConditions` is never removed by any later sync, so a failure part way
   through leaves an entry in the user's config forever. Crash-safety is what the
   pre-mutation `persist` callback buys; the lock buys the same guarantee against a *lost
   update*, which two overlapping runs reached without anything failing at all. Every
   command goes through `syncAndPersist` — including `reset`, whose empty store makes the
   guarantee vacuous today and would have quietly stopped being vacuous later.
   `applySync` has exactly one non-test caller.
9. **Do not turn off `erasableSyntaxOnly`.** Enums, namespaces and parameter properties
   would make the type-stripped dev run differ from the compiled build.
10. **Immutability.** Build new objects; never mutate. Interface fields are `readonly`.

## Testing

Unit tests are pure-function tests. Integration tests use a temporary `HOME` with
`GIT_CONFIG_GLOBAL` and a real `git` binary — they assert what git actually resolves,
not what we wrote to a file.

`parity.test.ts` runs the generated snippet for zsh and bash under `zsh -f` and
`bash --norc`, and skips any shell that is not installed — so a green run does not mean
every shell was exercised. Check the skip count. The "uses only builtins" tests run the
snippet with `PATH` emptied rather than grepping the generated string for a list of
command names, because the list is what let `$(pwd` slip through.

Every fixture there compares against what git actually resolves, never against an expected
constant alone. The suite once ran only the case-*sensitive* branch, which is the branch
macOS and Windows users never take; it now runs both. It also covers linked worktrees and
each config spelling git accepts, because those were the two shapes where the three
implementations agreed with each other and all three were wrong.

Only add a shell you can actually run here. A fish snippet was written and then removed
before the first release for exactly this reason: every fish case skipped, so the parity
guarantee — the thing that makes invariant 6 more than a wish — never covered it.
