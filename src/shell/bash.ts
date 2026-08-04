import { posixSingleQuote } from "./quote.ts";
import {
  CONFIG_FN,
  GITDIR_FN,
  LOCAL_EMAIL_FN,
  LOWER_FN,
  NORMALIZE_FN,
  VALUE_FN,
} from "./snippet.ts";
import type { ShellInitOptions } from "./zsh.ts";

export const bashSnippet = (options: ShellInitOptions): string => {
  const fold = options.caseInsensitive;
  const target = fold
    ? '_git_mapper_lower "$_gm_gitdir"\n  target="$REPLY"'
    : 'target="$_gm_gitdir"';
  const cand = fold ? '_git_mapper_lower "$p"; cand="$REPLY"' : 'cand="$p"';

  return `# git-user-mapper shell integration (bash)
_git_mapper_file=${posixSingleQuote(options.mappingFile)}

${LOWER_FN}

${NORMALIZE_FN}

${GITDIR_FN}

${VALUE_FN}

${CONFIG_FN}

${LOCAL_EMAIL_FN}

_git_mapper_resolve() {
  GIT_MAPPER_PROFILE=''; GIT_MAPPER_STATE=''; GIT_MAPPER_COLOR=''

  # 보조 함수들이 값을 돌려주는 자리. local이라 사용자 환경에 남지 않는다.
  local REPLY='' _gm_gitdir='' _gm_commondir='' _gm_email='' _gm_worktree_config=''

  local root='' d
  # 현재 디렉토리가 지워지면 pwd가 stderr로 getcwd 오류를 뱉는다. PROMPT_COMMAND의
  # 첫 자리라 사용자가 cd로 빠져나갈 때까지 프롬프트마다 그 줄이 찍혔다.
  d="$(pwd -P 2>/dev/null)" || d="$PWD"
  [[ -n "$d" ]] || d="$PWD"
  while :; do
    if [[ -e "$d/.git" ]]; then root="$d"; break; fi
    [[ "$d" == / ]] && break
    d="\${d%/*}"
    [[ -z "$d" ]] && d=/
  done
  [[ -n "$root" ]] || return 1

  # git이 실제로 보는 GIT_DIR을 먼저 찾는다. 매핑 판정은 작업 트리가 아니라 이걸로 한다.
  _git_mapper_gitdir "$root" || return 1

  # 저장소의 로컬 [user]를 먼저 읽는다. 표가 아무 답을 못 내도 이 값이 있으면
  # git은 그걸로 커밋하므로, 여기서 "identity 없음"이라고 단정하면 거짓말이 된다.
  _git_mapper_local_email
  local local_email="$_gm_email"

  local p pid color email cand target
  local best_id='' best_color='' best_email='' best_len=-1
  local fb_id='' fb_color='' fb_email=''
  ${target}

  if [[ -r "$_git_mapper_file" ]]; then
    while IFS=$'\\t' read -r p pid color email; do
      [[ -z "$p" ]] && continue
      if [[ "$p" == '*' ]]; then
        fb_id="$pid"; fb_color="$color"; fb_email="$email"
        continue
      fi
      ${cand}
      if [[ "$target" == "$cand" || "$target" == "$cand"/* ]] && (( \${#p} > best_len )); then
        best_id="$pid"; best_color="$color"; best_email="$email"; best_len=\${#p}
      fi
    done < "$_git_mapper_file"
  fi

  local applied_id='' applied_email='' applied_color='' state=''
  if (( best_len >= 0 )); then
    applied_id="$best_id"; applied_email="$best_email"; applied_color="$best_color"; state=mapped
  elif [[ -n "$fb_id" ]]; then
    applied_id="$fb_id"; applied_email="$fb_email"; applied_color="$fb_color"; state=default
  fi

  if [[ -n "$local_email" && "$local_email" != "$applied_email" ]]; then
    GIT_MAPPER_STATE='local-override'; GIT_MAPPER_PROFILE="$local_email"; GIT_MAPPER_COLOR=yellow
  elif [[ -z "$state" ]]; then
    GIT_MAPPER_STATE='no-identity'
  else
    GIT_MAPPER_STATE="$state"; GIT_MAPPER_PROFILE="$applied_id"; GIT_MAPPER_COLOR="$applied_color"
  fi
  return 0
}

# Interpolate $GIT_MAPPER_PROFILE and $GIT_MAPPER_STATE into your own PS1.
# .bashrc와 .bash_profile 양쪽에서 source되어도 훅이 쌓이지 않게 한 번만 붙인다.
case "\${PROMPT_COMMAND:-}" in
  *_git_mapper_resolve*) ;;
  *) PROMPT_COMMAND="_git_mapper_resolve\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
`;
};
