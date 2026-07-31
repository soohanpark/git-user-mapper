# Shell resolution contract

The shell snippets and `src/core/mapping.ts` must always produce the same answer.
`src/shell/parity.test.ts` enforces this against real git.

1. Start from the physical (symlink-resolved) working directory.
2. Walk up until a `.git` entry exists — file or directory. If none, produce nothing.
3. Read `mapping.tsv`. Columns: `path`, `profile id`, `color`, `email`. A `*` path is the
   fallback. When the store has no default profile, `sync` writes the fallback from
   `~/.gitconfig`'s own `[user]` under the label `global`, because that identity still
   applies even though the tool does not manage it.
4. Pick the longest `path` that equals the repo root or is a prefix of it followed by `/`.
   Compare case-insensitively on darwin and win32, case-sensitively on linux. The
   comparison rule is baked into the generated snippet at `shell-init` time, so the
   snippet never has to detect the platform itself.
5. No match and a fallback exists → state `default`. No match and no fallback → state
   `no-identity`.
6. If `<root>/.git` is a directory and its `config` has a `[user] email` different from the
   resolved email → state `local-override`, and report that email. `.git` as a file
   (worktrees, submodules) skips this check, because the config lives elsewhere.

Changing any rule here means changing `mapping.ts`, every snippet, and the parity test
together.

## Subprocess budget

zsh and bash spawn nothing: `$(<file)` is read internally by both shells, `[[ -e … ]]` is
a builtin, and the comparisons are parameter expansions. fish has no fork-free file read,
so its snippet uses `cat` — a documented exception, since fish prompts already pay for
several commands.
