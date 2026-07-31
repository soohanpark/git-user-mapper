import { fishSingleQuote } from "./quote.ts";
import type { ShellInitOptions } from "./zsh.ts";

export const fishSnippet = (options: ShellInitOptions): string => {
  // 비교 규칙은 생성 시점에 굳힌다. 스니펫이 플랫폼을 다시 판별할 필요가 없다.
  const foldTarget = options.caseInsensitive
    ? "set -l target (string lower -- $root)"
    : "set -l target $root";
  const foldCand = options.caseInsensitive ? "set -l cand (string lower -- $p)" : "set -l cand $p";

  return `# git-user-mapper shell integration (fish)
# 외부 바이너리는 쓰지 않는다. read/string/path 는 모두 fish 내장이다.
set -g _git_mapper_file ${fishSingleQuote(options.mappingFile)}

function _git_mapper_resolve --description 'Resolve the git identity that applies here'
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
        set d (string replace -r '/[^/]*$' '' -- $d)
        test -z "$d"; and set d /
    end
    test -n "$root"; or return 1

    # 저장소의 로컬 [user]를 먼저 읽는다. 표가 답을 못 내도 이 값이 있으면 git은 그걸로
    # 커밋하므로, 이걸 건너뛰면 프롬프트가 "identity 없음"이라고 거짓말한다.
    set -l local_email ''
    if test -d $root/.git; and test -r $root/.git/config
        set -l section ''
        while read -l cfg_line
            set cfg_line (string replace -ra '[ \\t]' '' -- $cfg_line)
            switch $cfg_line
                case '[user]'
                    set section user
                case '\\[*'
                    set section ''
                case 'email=*'
                    test "$section" = user; and set local_email (string replace 'email=' '' -- $cfg_line)
            end
        end <$root/.git/config
    end

    set -l best_id ''; set -l best_color ''; set -l best_email ''; set -l best_len -1
    set -l fb_id ''; set -l fb_color ''; set -l fb_email ''

    if test -r $_git_mapper_file
        ${foldTarget}
        while read -l line
            set -l parts (string split -m 3 \\t -- $line)
            set -l p $parts[1]
            test -z "$p"; and continue
            if test "$p" = '*'
                set fb_id $parts[2]; set fb_color $parts[3]; set fb_email $parts[4]
                continue
            end

            # 글롭이 아니라 리터럴 접두어로 비교한다. \`string match\`의 패턴을 쓰면
            # 이름에 * 가 든 디렉토리가 남의 저장소까지 먹는다.
            ${foldCand}
            set -l clen (string length -- $cand)
            if test (string sub -l $clen -- $target) = "$cand"
                set -l sep (string sub -s (math $clen + 1) -l 1 -- $target)
                if test -z "$sep"; or test "$sep" = /
                    if test $clen -gt $best_len
                        set best_id $parts[2]; set best_color $parts[3]; set best_email $parts[4]
                        set best_len $clen
                    end
                end
            end
        end <$_git_mapper_file
    end

    set -l applied_id ''; set -l applied_email ''; set -l applied_color ''; set -l state ''
    if test $best_len -ge 0
        set applied_id $best_id; set applied_email $best_email; set applied_color $best_color
        set state mapped
    else if test -n "$fb_id"
        set applied_id $fb_id; set applied_email $fb_email; set applied_color $fb_color
        set state default
    end

    if test -n "$local_email"; and test "$local_email" != "$applied_email"
        set -g GIT_MAPPER_STATE local-override
        set -g GIT_MAPPER_PROFILE $local_email
        set -g GIT_MAPPER_COLOR yellow
    else if test -z "$state"
        set -g GIT_MAPPER_STATE no-identity
    else
        set -g GIT_MAPPER_STATE $state
        set -g GIT_MAPPER_PROFILE $applied_id
        set -g GIT_MAPPER_COLOR $applied_color
    end
    return 0
end

# 훅을 걸지 않으면 함수가 정의만 되고 아무도 부르지 않아 변수가 영영 비어 있다.
# $GIT_MAPPER_PROFILE 과 $GIT_MAPPER_STATE 를 fish_prompt 안에서 그대로 쓰면 된다.
function _git_mapper_prompt_hook --on-event fish_prompt
    _git_mapper_resolve
end
`;
};
