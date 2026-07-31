# Shell resolution contract

The shell snippets and `src/core/mapping.ts` must always produce the same answer.
`src/shell/parity.test.ts` enforces this against real git.

1. Start from the physical (symlink-resolved) working directory.
2. Walk up until a `.git` entry exists — file or directory. If none, produce nothing.
3. If `<root>/.git` is a directory, read its `config` and remember `[user] email`. **This
   happens before any decision about the table.** Whatever the mapping says, that local
   value is what git will actually commit with, so a snippet that reports `no-identity`
   without looking here is lying in the one direction this contract exists to prevent.
   `.git` as a file (worktrees, submodules) skips the check — the config lives elsewhere.
4. Read `mapping.tsv`. Columns: `path`, `profile id`, `color`, `email`. A `*` path is the
   fallback. When the store has no default profile, `sync` writes the fallback from
   `~/.gitconfig`'s own `[user]` under the label `global`, because that identity still
   applies even though the tool does not manage it. A missing or unreadable table is not
   an error — it just means nothing resolves from the table.
5. Pick the longest `path` that equals the repo root or is a prefix of it followed by `/`.
   Compare case-insensitively on darwin and win32, case-sensitively on linux. The
   comparison rule is baked into the generated snippet at `shell-init` time, so the
   snippet never has to detect the platform itself. **The comparison is literal**: a
   directory named `star*dir` must not match `starOTHERdir`, which rules out glob-pattern
   matching (`[[ $x == $p/* ]]` with `$p` unquoted, `string match`'s default mode).
6. Resolve: longest match → `mapped`; otherwise a fallback exists → `default`; otherwise
   nothing resolved.
7. A local email that differs from the resolved email — including the case where nothing
   resolved — → state `local-override`, reporting that email.
8. Nothing resolved and no local email → state `no-identity`.

Changing any rule here means changing `mapping.ts`, every snippet, and the parity test
together.

## Subprocess budget

No snippet executes an external binary.

- **zsh** spawns nothing at all: `$(<file)` is read internally, `[[ -e … ]]` is a builtin,
  and every comparison is a parameter expansion.
- **bash** runs one command substitution, `$(pwd -P)`, to get the physical directory.
  `pwd` is a builtin, so this forks a subshell but execs nothing. bash has no fork-free
  equivalent of zsh's `${PWD:A}`, and dropping the symlink resolution would break parity
  with git.
- **fish** uses command substitution around builtins (`pwd -P`, `string`, `math`). Earlier
  versions of this snippet called `cat` and `/usr/bin/dirname`, the latter once per
  directory level walked; both are gone.
