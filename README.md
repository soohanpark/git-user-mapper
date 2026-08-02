# git-user-mapper

Use the right Git identity automatically based on where a repository lives, and show the
active profile in your shell prompt.

Map `~/dev/work` once and every repository below it uses your work name, email, and
optional signing key. Map `~/dev/personal` to another profile and Git switches identities
when you change directories—without rewriting each repository's local config or relying
on a terminal-only wrapper.

`git-user-mapper` uses Git's own conditional includes, so the same identity applies in
the terminal, IDEs, and GUI clients.

## Requirements

- Git 2.13 or newer
- Node.js 22.18 or newer
- zsh or bash for the optional prompt integration

## Install

```sh
npm install --global git-user-mapper
git-mapper --version
```

The npm package is named `git-user-mapper`; the installed command is `git-mapper`.
Because it is a Git-style command, `git mapper status` works too.

## Quick start

### 1. Add a profile

```sh
git-mapper add
```

Enter the Git user name, email, optional GPG signing key, and a short profile id such as
`work` or `personal`. The id is what appears in the prompt.

### 2. Map a directory

From a repository below the directory you want to map, run:

```sh
cd ~/dev/work/my-project
git-mapper
```

Choose a profile, then choose whether it should apply only to this repository, to the
whole parent directory, or to another directory. Running `git-mapper` with no subcommand
is the same as `git-mapper map`.

A parent-directory mapping covers repositories below it. For example, mapping
`~/dev/work` once covers both `~/dev/work/api` and `~/dev/work/web`.

### 3. Set a fallback identity (optional)

```sh
git-mapper default personal
```

The default profile is used when no directory mapping matches. If you do not set one,
Git's existing global `[user]` identity remains the fallback when present.

### 4. Verify the result

```sh
git-mapper status
git config user.name
git config user.email
```

`status` shows the repository root, resolved profile, state, email, and any configuration
warnings. The `git config` commands show the identity Git will actually use.

## Prompt integration

The prompt integration reads a generated mapping table and does not run Git on every
prompt. It supports zsh and bash.

### zsh with Powerlevel10k

Add this to `~/.zshrc`:

```zsh
eval "$(git-mapper shell-init zsh)"
```

Then add `git_mapper` to `POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS` in `~/.p10k.zsh`:

```zsh
typeset -g POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS=(
  # ...your existing segments...
  git_mapper
)
```

### Other zsh themes

Add the same initialization command to `~/.zshrc`:

```zsh
eval "$(git-mapper shell-init zsh)"
```

The snippet refreshes `GIT_MAPPER_PROFILE`, `GIT_MAPPER_STATE`, and
`GIT_MAPPER_COLOR` before every prompt. Use those variables in your theme.

### bash

Add this to the startup file used by your interactive shell, usually `~/.bashrc`:

```bash
eval "$(git-mapper shell-init bash)"
```

The snippet refreshes the same `GIT_MAPPER_PROFILE`, `GIT_MAPPER_STATE`, and
`GIT_MAPPER_COLOR` variables through `PROMPT_COMMAND`.

After changing a shell startup file, open a new terminal or reload the shell:

```sh
exec zsh  # or: exec bash
```

Existing terminal sessions do not load newly added prompt integration automatically.

### Prompt states

| State | Meaning |
|---|---|
| `mapped` | A directory mapping selected the profile. |
| `default` | No mapping matched, so the fallback identity applies. |
| `local-override` | The repository has a different local `[user]` email, which wins over the mapping. |
| `no-identity` | Neither a mapping, fallback, nor local identity was found. |

Powerlevel10k renders mapped and default profile ids, marks the fallback with `(default)`,
and displays warnings for `local-override` and `no-identity`.

## Commands

| Command | Description |
|---|---|
| `git-mapper` | Map the current repository or directory interactively. |
| `git-mapper map` | Same as running `git-mapper` with no subcommand. |
| `git-mapper status [--porcelain]` | Show what applies here and cross-check it against Git. |
| `git-mapper list` | List profiles and their directory mappings. |
| `git-mapper add` | Add a profile. |
| `git-mapper remove [id]` | Remove a profile and all mappings that use it. |
| `git-mapper unmap [path]` | Remove a mapping; defaults to the current repository or directory. |
| `git-mapper default [id]` | Choose the fallback profile. |
| `git-mapper sync [--dry-run]` | Regenerate managed Git config and prompt data. |
| `git-mapper shell-init <zsh\|bash>` | Print the prompt integration for a supported shell. |
| `git-mapper reset` | Remove all profiles and mappings while keeping the global `[user]`. |

`remove` and `default` prompt for a profile when `[id]` is omitted. Run
`git-mapper <command> --help` for command-specific help.

Human-readable `status` exits with code 2 when it finds configuration warnings and 0
otherwise. `status --porcelain` prints a tab-separated
`<profile>\t<state>\t<email>` line and exits with code 1 outside a repository.

## How identity resolution works

Mappings are stored as absolute directory prefixes (`~` in interactive path input is
expanded). When mappings overlap, the longest matching path wins:

```text
~/dev            → personal
~/dev/client-a   → work
```

A repository under `~/dev/client-a` uses `work`; other repositories under `~/dev` use
`personal`. Paths are matched literally, so characters such as `*`, `?`, `[`, and `]` do
not act as globs.

Git resolves identities in this order:

1. A repository-local `[user]` value in `.git/config` has the highest priority.
2. The longest matching directory mapping applies next.
3. The configured default profile—or an existing unmanaged global `[user]`—is the
   fallback.

Map a repository root or a directory above it. Mapping a subdirectory inside a repository
has no effect because Git evaluates `includeIf "gitdir:"` against the repository's Git
directory.

## Troubleshooting

### The prompt does not appear

Reload the shell after adding `shell-init`. In zsh, confirm that the integration function
is loaded:

```zsh
echo ${+functions[prompt_git_mapper]}
```

It should print `1`. With Powerlevel10k, also confirm that `git_mapper` is present in
`POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS`. Then run `git-mapper status` inside a repository to
check the resolved profile independently of the prompt.

### `local-override` appears

The repository has its own identity, and local Git config takes precedence over directory
mappings. Inspect it with:

```sh
git config --local --get-regexp '^user\.'
```

If those values are stale, remove them from that repository:

```sh
git config --local --unset user.name
git config --local --unset user.email
git config --local --unset user.signingKey
```

The last command may exit nonzero when no signing key exists; that is harmless.

### `no-identity` appears

Map the repository with `git-mapper`, or select a fallback with `git-mapper default`.

### Status reports stale or inconsistent files

Preview the repair, then regenerate all derived files:

```sh
git-mapper sync --dry-run
git-mapper sync
```

In linked worktrees and submodules, `.git` is a file rather than a directory. The prompt
can still resolve directory mappings, but it cannot inspect the repository-local identity
there. Use `git-mapper status` to cross-check the mapping against Git.

## Files and safety

The profile store is the source of truth. `git-mapper sync` derives the following files
from it:

```text
~/.gitconfig                                      managed includeIf entries and fallback user
$XDG_CONFIG_HOME/git-user-mapper/profiles/<id>.gitconfig one [user] block per mapped profile
$XDG_CONFIG_HOME/git-user-mapper/mapping.tsv             prompt lookup table
$XDG_CONFIG_HOME/git-user-mapper/backups/                global Git config backups
```

`$XDG_CONFIG_HOME` defaults to `~/.config`. If `~/.gitconfig` does not exist but
`$XDG_CONFIG_HOME/git/config` does, Git writes to the XDG path and `git-user-mapper` backs
up and updates that file instead.

Safety guarantees:

- Git config files are written through `git config`, not assembled as text.
- An existing global Git config is backed up before it is changed. Backups use a private
  `0700` directory and `0600` files, and up to ten distinct snapshots are retained.
- Only `includeIf` entries recorded as managed by this tool are removed.
- Repository-local `.git/config` files are never modified.
- `reset` removes managed profiles and mappings but intentionally leaves the global
  `[user]` identity in place.

## Migrating from git-user-switch

`git-user-mapper` was forked from
[geongeorge/Git-User-Switch](https://github.com/geongeorge/Git-User-Switch), but it uses a
different mapping model. Two migration details matter:

1. Profiles from the old tool are imported automatically when the new store is empty.
   The original store is read once and never modified, so `git-user-switch` can continue
   to use it.
2. Repository-local identities written by the old tool remain in `.git/config` and take
   precedence over new directory mappings. `git-mapper status` reports these as
   `local-override`; remove the stale local values as described in
   [Troubleshooting](#local-override-appears).

## License

MIT. See [LICENSE](LICENSE), which retains the original copyright.
