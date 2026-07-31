# git-user-mapper

Maps directories to git identities using git's own `includeIf "gitdir:"` conditional
includes, and shows the active profile in your shell prompt.

## Commands

| Command | What it does |
|---|---|
| `npm test` | `node --test 'src/**/*.test.ts'` — runs `.ts` tests directly, no build |
| `npm run test:coverage` | c8, fails under 80% line coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome check (lint + format) |
| `npm run build` | `tsc` → `dist/` |

Node 22.18+ is required — that is the first release with unflagged type stripping, so
development has no build step in the inner loop. A bare directory argument does not work
with Node's test runner; keep the glob in the `test` script.

## Architecture

The store (a JSON file managed by `conf`) is the single source of truth. `core/sync.ts`
generates everything else and is idempotent:

- `~/.config/git-user-mapper/profiles/<id>.gitconfig` — one `[user]` block per profile
- `includeIf` entries in `~/.gitconfig` — only those listed in `store.managedConditions`
- `~/.config/git-user-mapper/mapping.tsv` — lookup table the shell snippets read

`git` performs the actual resolution, so mappings work in IDEs and GUI clients too.

`conf` derives its storage location from the package name, so the rename from
`git-user-switch` stranded existing users' data in a sibling directory. `openStore`
imports that file when its own store is empty, and never writes to it.

## Invariants — do not break these

1. **git is called with argv arrays only.** Never interpolate values into a command
   string. Empty values are rejected before reaching git: with argv, `git config <key> ""`
   is a valid write of an empty value, which would silently blank an identity. (The tool
   this was forked from had the same outcome by a different route — string interpolation
   turned the write into a read.)
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
   implementation against real git. Change one, change all three. In particular, an
   unmanaged `[user]` is still a real identity — reporting `no-identity` when git has an
   answer is the exact failure this rule exists to prevent.
7. **`gitOrNull` returns null only when git ran and exited non-zero.** `--get` exits 1
   when a key is unset and `--remove-section`/`--unset` exit 5 when the target is absent;
   both are normal. A missing binary or a rejected argument must surface, or callers
   cannot tell "not configured" from "broken".
8. **Do not turn off `erasableSyntaxOnly`.** Enums, namespaces and parameter properties
   would make the type-stripped dev run differ from the compiled build.
9. **Immutability.** Build new objects; never mutate. Interface fields are `readonly`.

## Testing

Unit tests are pure-function tests. Integration tests use a temporary `HOME` with
`GIT_CONFIG_GLOBAL` and a real `git` binary — they assert what git actually resolves,
not what we wrote to a file. The parity test additionally runs `zsh -f`, and the bash
snippet is exercised through `bash --norc`.
