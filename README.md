# git-user-mapper

Map directories to git identities, and see which one is active in your shell prompt.

Register `~/dev/personal` once and every repository under it commits with your personal
identity — in the terminal, in your IDE, and in GUI clients. There is nothing to remember
and nothing to run per repository.

> Forked from [geongeorge/Git-User-Switch](https://github.com/geongeorge/Git-User-Switch) (MIT).
> That tool writes the selected identity into the current repository's `.git/config`.
> This one manages `includeIf` mappings in `~/.gitconfig` instead and never touches a
> repository's local config. On first run it imports the profiles you had there.

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
other theme, use `$GIT_MAPPER_PROFILE` and `$GIT_MAPPER_STATE` in your own prompt. `bash`
and `fish` are supported too.

The segment reads a small generated table with no subprocess, so it costs nothing per
prompt. It shows the mapped profile, marks the fallback as `(default)`, and warns when a
repository's local `[user]` overrides the mapping. A test runs the generated matcher
against real git to make sure the two never disagree.

## What it writes

    ~/.gitconfig                                     includeIf entries (only its own)
    ~/.config/git-user-mapper/profiles/<id>.gitconfig
    ~/.config/git-user-mapper/mapping.tsv
    ~/.config/git-user-mapper/backups/               ~/.gitconfig backups, mode 0600

It never edits `~/.gitconfig` as text — all writes go through `git config --global` — and
it never touches a repository's `.git/config`.

## License

MIT. See [LICENSE](LICENSE), which retains the original copyright.
