import type { ShellInitOptions } from "./zsh.ts";

export const fishSnippet = (options: ShellInitOptions): string => {
  const flag = options.caseInsensitive ? " -i" : "";

  return `# git-user-mapper shell integration (fish)
# fish has no fork-free file read, so this snippet uses \`cat\` — the one documented
# exception to the no-subprocess rule (see src/shell/resolve.md).
set -g _git_mapper_file '${options.mappingFile}'

function _git_mapper_resolve
    set -g GIT_MAPPER_PROFILE ''
    set -g GIT_MAPPER_STATE ''
    set -g GIT_MAPPER_COLOR ''

    set -l root ''
    set -l d (pwd -P)
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
        set -l p $parts[1]
        if test "$p" = '*'
            set fb_id $parts[2]; set fb_color $parts[3]; set fb_email $parts[4]
            continue
        end
        if string match -q${flag} -- "$p" "$root"; or string match -q${flag} -- "$p/*" "$root"
            if test (string length -- $p) -gt $best_len
                set best_id $parts[2]; set best_color $parts[3]; set best_email $parts[4]
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
