# git-user-mapper

Map directories to git identities, and see which one is active in your shell prompt.

Register `~/dev/personal` once and every repository under it commits with your personal
identity — in the terminal, in your IDE, and in GUI clients. There is nothing to remember
and nothing to run per repository.

> Forked from [geongeorge/Git-User-Switch](https://github.com/geongeorge/Git-User-Switch) (MIT).
> That tool writes the selected identity into the current repository's `.git/config`.
> This one manages `includeIf` mappings in `~/.gitconfig` instead and never touches a
> repository's local config. See [Upgrading](#upgrading-from-git-user-switch) below.

## Install

    npm i -g git-user-mapper

Requires git 2.13+ and Node 22.18+.

## Use

    git-mapper              # map the current directory to a profile
    git-mapper status       # what applies here, cross-checked against git
    git-mapper list         # profiles and mappings
    git-mapper add          # add a profile
    git-mapper remove [id]  # remove a profile and its mappings
    git-mapper unmap [path] # remove a directory mapping
    git-mapper default [id] # set the fallback identity
    git-mapper sync         # regenerate everything (--dry-run to preview)
    git-mapper reset        # remove all profiles and mappings

The binary is `git-mapper`, so `git mapper status` works too.

`status` exits 0 when everything is consistent, 2 when it printed a warning, and 1 outside
a repository with `--porcelain`.

## Prompt

    # ~/.zshrc
    eval "$(git-mapper shell-init zsh)"

With Powerlevel10k, add `git_mapper` to `POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS`. With any
other theme, use `$GIT_MAPPER_PROFILE` and `$GIT_MAPPER_STATE` in your own prompt. `bash`
is supported too.

The segment reads a small generated table and runs no external command, so it is cheap per
prompt — zsh spawns nothing at all, bash forks one subshell for `pwd -P`. It shows the
mapped profile, marks the fallback as `(default)`, and warns when a repository's local
`[user]` overrides the mapping. A parity test runs the generated matcher for both shells
against real git to make sure the two never disagree.

## Upgrading from git-user-switch

Two things carry over from the old tool, and one of them will bite you:

1. **Identities it wrote into repositories stay there.** The old tool set `user.email` in
   each repository's `.git/config`, and local config beats `includeIf`. So every repository
   it ever touched keeps its old identity and ignores your new mappings. `git-mapper
   status` reports this as `local-override`; clear it per repository with:

       git config --unset user.email && git config --unset user.name

2. **Your profiles are imported automatically.** They come from the old tool's own store
   (`conf` derives its location from the package name, so the rename moved it). The
   original file is read once and never written to, so `git-user-switch` keeps working.

## What it writes

    ~/.gitconfig                                     includeIf entries (only its own)
    ~/.config/git-user-mapper/profiles/<id>.gitconfig
    ~/.config/git-user-mapper/mapping.tsv
    ~/.config/git-user-mapper/backups/               ~/.gitconfig backups, mode 0600

Every write goes through `git config`, so git owns the escaping — it never assembles config
text itself, and it never touches a repository's `.git/config`. If `~/.gitconfig` does not
exist but `~/.config/git/config` does, git writes to the latter and so does this tool.

## License

MIT. See [LICENSE](LICENSE), which retains the original copyright.
