import type { ShellInitOptions } from "./zsh.ts";

export const bashSnippet = (options: ShellInitOptions): string => {
  // bash 3.2(macOS 기본)에는 ${var,,}가 없다. nocasematch는 내장 옵션이라 fork가 없다.
  const enable = options.caseInsensitive ? "  shopt -s nocasematch\n" : "";
  const restore = options.caseInsensitive ? "  shopt -u nocasematch\n" : "";

  return `# git-user-mapper shell integration (bash)
_git_mapper_file='${options.mappingFile}'

_git_mapper_resolve() {
  GIT_MAPPER_PROFILE=''; GIT_MAPPER_STATE=''; GIT_MAPPER_COLOR=''

  local root='' d
  d="$(pwd -P)"
  while :; do
    if [[ -e "$d/.git" ]]; then root="$d"; break; fi
    [[ "$d" == / ]] && break
    d="\${d%/*}"
    [[ -z "$d" ]] && d=/
  done
  [[ -n "$root" ]] || return 1
  [[ -r "$_git_mapper_file" ]] || return 1

  local p pid color email
  local best_id='' best_color='' best_email='' best_len=-1
  local fb_id='' fb_color='' fb_email=''

${enable}  while IFS=$'\\t' read -r p pid color email; do
    [[ -z "$p" ]] && continue
    if [[ "$p" == '*' ]]; then
      fb_id="$pid"; fb_color="$color"; fb_email="$email"
      continue
    fi
    if [[ "$root" == "$p" || "$root" == "$p"/* ]] && (( \${#p} > best_len )); then
      best_id="$pid"; best_color="$color"; best_email="$email"; best_len=\${#p}
    fi
  done < "$_git_mapper_file"
${restore}
  local applied_id applied_email applied_color state
  if (( best_len >= 0 )); then
    applied_id="$best_id"; applied_email="$best_email"; applied_color="$best_color"; state=mapped
  elif [[ -n "$fb_id" ]]; then
    applied_id="$fb_id"; applied_email="$fb_email"; applied_color="$fb_color"; state=default
  else
    GIT_MAPPER_STATE='no-identity'
    return 0
  fi

  local local_email='' line section=''
  if [[ -d "$root/.git" && -r "$root/.git/config" ]]; then
    while IFS= read -r line; do
      line="\${line//[[:blank:]]/}"
      case "$line" in
        '[user]') section=user ;;
        '['*) section='' ;;
        'email='*) [[ "$section" == user ]] && local_email="\${line#email=}" ;;
      esac
    done < "$root/.git/config"
  fi

  if [[ -n "$local_email" && "$local_email" != "$applied_email" ]]; then
    GIT_MAPPER_STATE='local-override'; GIT_MAPPER_PROFILE="$local_email"; GIT_MAPPER_COLOR=yellow
  else
    GIT_MAPPER_STATE="$state"; GIT_MAPPER_PROFILE="$applied_id"; GIT_MAPPER_COLOR="$applied_color"
  fi
  return 0
}

# Interpolate \$GIT_MAPPER_PROFILE and \$GIT_MAPPER_STATE into your own PS1.
PROMPT_COMMAND="_git_mapper_resolve\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`;
};
