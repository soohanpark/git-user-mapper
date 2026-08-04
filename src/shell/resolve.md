# Shell resolution contract

The shell snippets and `src/core/mapping.ts` must always produce the same answer.
`src/shell/parity.test.ts` enforces this against real git.

1. Start from the physical (symlink-resolved) working directory.
2. Walk up until a `.git` entry exists — file or directory. If none, produce nothing.
3. Resolve the **git directory**, because that is what git matches `includeIf "gitdir:"`
   against — not the working tree. If `<root>/.git` is a directory, that is it. If it is a
   file (linked worktrees, submodules) it holds one `gitdir: <path>` line to follow;
   a relative path is joined to `<root>`. Then read `<gitdir>/commondir` if present — that
   is where the repository config lives. For an ordinary repository all three collapse to
   `<root>/.git`; for a linked worktree they are three different places:

       worktree  /a/personal/wt   gitdir  /a/work/repo/.git/worktrees/wt
                                  common  /a/work/repo/.git

   Matching the working tree instead made the prompt name a profile git would never use in
   every linked worktree. See `src/core/gitdir.ts`.
4. Read the repository-local `[user] email` from `<commondir>/config`, and from
   `<gitdir>/config.worktree` when `extensions.worktreeConfig` is on. **This happens before
   any decision about the table.** Whatever the mapping says, that local value is what git
   will actually commit with, so a snippet that reports `no-identity` without looking here
   is lying in the one direction this contract exists to prevent.
5. Parse that config the way git does, not by stripping blanks and comparing literals:
   section and variable names are case-insensitive; a variable may sit on the section
   header line (`[user] email = x`); a subsection (`[user "work"]`) is a *different*
   section; `#` and `;` outside quotes start a comment; a `"…"` wrapper is removed and
   `\"` `\\` `\n` `\t` `\b` are unescaped. git writes values quoted whenever they contain
   `#`, `;`, a quote or edge whitespace, so this is not a corner case — it is what git's
   own writer produces. See `src/core/gitconfig/configText.ts`.
6. Read `mapping.tsv`. Columns: `path`, `profile id`, `color`, `email`. A `*` path is the
   fallback. When the store has no default profile, `sync` writes the fallback from
   `~/.gitconfig`'s own `[user]` under the label `global`, because that identity still
   applies even though the tool does not manage it. A missing or unreadable table is not
   an error — it just means nothing resolves from the table.
7. Pick the longest `path` that equals the git directory or is a prefix of it followed by
   `/`. Compare case-insensitively on darwin and win32, case-sensitively on linux. The
   comparison rule is baked into the generated snippet at `shell-init` time, so the
   snippet never has to detect the platform itself. **The comparison is literal**: a
   directory named `star*dir` must not match `starOTHERdir`, which rules out glob-pattern
   matching (`[[ $x == $p/* ]]` with `$p` unquoted, `string match`'s default mode).
   **Folding is ASCII-only** — `A`–`Z` and nothing else. git's wildmatch `gitdir/i:` folds
   bytes, while `toLowerCase()`, zsh's `${p:l}` and bash's `nocasematch` all fold Unicode
   too; that gap made a mapping on a non-ASCII directory report `mapped` while git ignored
   it entirely. See `src/core/caseFold.ts`.
8. Resolve: longest match → `mapped`; otherwise a fallback exists → `default`; otherwise
   nothing resolved.
9. A local email that differs from the resolved email — including the case where nothing
   resolved — → state `local-override`, reporting that email.
10. Nothing resolved and no local email → state `no-identity`.

Changing any rule here means changing `mapping.ts`, `commands/status.ts`, every snippet,
and the parity test together.

## Subprocess budget

No snippet executes an external binary.

- **zsh** spawns nothing at all: `$(<file)` and `read` are internal, `[[ -e … ]]` is a
  builtin, and every comparison is a parameter expansion.
- **bash** runs one command substitution, `$(pwd -P)`, to get the physical directory.
  `pwd` is a builtin, so this forks a subshell but execs nothing. bash has no fork-free
  equivalent of zsh's `${PWD:A}`, and dropping the symlink resolution would break parity
  with git. Its stderr is discarded and `$PWD` is the fallback, because a deleted working
  directory otherwise printed a `getcwd` error before every prompt.

Steps 3–5 add file reads, not processes: `.git`, `commondir` and the repository config are
read with `read`/`$(<…)`. The parity tests run the snippet with `PATH` emptied, so an
accidental external command fails the suite rather than slipping through.

## Supported shells

zsh and bash. A fish snippet existed but was removed before the first release: it could
not be run here, and `parity.test.ts` is the only thing that makes the equivalence claim
above meaningful. Adding a shell means adding it to that test — a snippet no test has ever
executed is a claim, not a feature.
