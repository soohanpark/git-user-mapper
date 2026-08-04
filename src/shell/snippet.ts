/**
 * zsh·bash 스니펫이 글자 그대로 공유하는 조각들.
 *
 * 두 셸에서 문법이 같은 부분은 여기서 한 번만 쓴다. `resolve.md`의 규칙 하나가 바뀔 때
 * 한쪽만 고치는 일을 줄이려는 것이다 — 그게 불변조건 6이 깨지던 전형적인 경로였다.
 * 문법이 갈리는 곳(`${PWD:A}` 대 `pwd -P`, 표를 읽는 방식)만 각 생성기에 남긴다.
 */

/**
 * ASCII 전용 소문자화. git의 wildmatch가 `gitdir/i:`에서 하는 일과 같다.
 *
 * zsh의 `${p:l}`도 bash의 `shopt -s nocasematch`도 유니코드를 접는다(실측). git은 접지
 * 않으므로, 그대로 두면 비ASCII 디렉토리에서 우리만 매칭에 성공하고 git은 실패한다.
 * 26자를 직접 도는 이유는 `[A-Z]` 범위가 로케일 collation에 흔들릴 수 있어서다.
 */
export const LOWER_FN = `_git_mapper_lower() {
  local s=$1 i
  local up=ABCDEFGHIJKLMNOPQRSTUVWXYZ lo=abcdefghijklmnopqrstuvwxyz
  for (( i = 0; i < 26; i++ )); do
    s=\${s//\${up:$i:1}/\${lo:$i:1}}
  done
  REPLY=$s
}`;

/**
 * `.`과 `..`만 정리하는 어휘적 정규화. 심볼릭 링크는 풀지 않는다 — 여기에 들어오는 값은
 * 이미 물리 경로에서 출발했거나(작업 디렉토리) git이 해석해 적어 둔 절대경로다.
 */
export const NORMALIZE_FN = `_git_mapper_norm() {
  local p=$1 out='' comp rest
  rest=\${p#/}
  while [[ -n $rest ]]; do
    comp=\${rest%%/*}
    if [[ $rest == */* ]]; then rest=\${rest#*/}; else rest=''; fi
    case $comp in
      ''|.) ;;
      ..) out=\${out%/*} ;;
      *) out=$out/$comp ;;
    esac
  done
  REPLY=\${out:-/}
}`;

/**
 * git이 `includeIf "gitdir:"`를 맞춰 보는 `$GIT_DIR`과, 저장소 설정이 있는 common dir를
 * 찾는다. `.git`이 파일이면(linked worktree·서브모듈) 그 안의 `gitdir:` 줄을 따라간다.
 *
 * 이걸 하기 전에는 워크트리 디렉토리로 표를 맞춰 봤고, git은 주 저장소의 GIT_DIR로 맞춰
 * 보므로 두 답이 아예 무관했다. 워크트리에서 프롬프트는 늘 틀린 프로파일을 보여 줬다.
 */
export const GITDIR_FN = `_git_mapper_gitdir() {
  local root=$1 g='' c=''
  if [[ -d $root/.git ]]; then
    _gm_gitdir=$root/.git
  else
    [[ -r "$root/.git" ]] || return 1
    IFS= read -r g < "$root/.git"
    while [[ $g == [[:blank:]]* ]]; do g=\${g#?}; done
    _git_mapper_lower "\${g%%:*}"
    [[ $REPLY == gitdir ]] || return 1
    g=\${g#*:}
    while [[ $g == [[:blank:]]* ]]; do g=\${g#?}; done
    while [[ $g == *[[:blank:]] ]]; do g=\${g%?}; done
    [[ -n $g ]] || return 1
    [[ $g == /* ]] || g=$root/$g
    _git_mapper_norm "$g"
    _gm_gitdir=$REPLY
  fi

  _gm_commondir=$_gm_gitdir
  if [[ -r "$_gm_gitdir/commondir" ]]; then
    IFS= read -r c < "$_gm_gitdir/commondir"
    while [[ $c == [[:blank:]]* ]]; do c=\${c#?}; done
    while [[ $c == *[[:blank:]] ]]; do c=\${c%?}; done
    if [[ -n $c ]]; then
      [[ $c == /* ]] || c=$_gm_gitdir/$c
      _git_mapper_norm "$c"
      _gm_commondir=$REPLY
    fi
  fi
  return 0
}`;

/**
 * git config의 값 부분을 git과 같은 규칙으로 읽는다. 따옴표 밖의 `#`·`;`부터는 주석,
 * 따옴표 밖 뒤쪽 공백은 버림, `\` 다음 한 글자는 그대로.
 *
 * `git config user.email 'a#b@x.com'`을 하면 git은 값을 따옴표로 감싸서 저장한다.
 * 그 따옴표를 벗기지 않아 프롬프트에 `"a#b@x.com"`이 그대로 찍혔다.
 */
export const VALUE_FN = `_git_mapper_value() {
  local raw=$1 out='' pend='' q=0 i c n
  local bs='\\'
  # \`=\` 뒤의 공백은 값의 일부가 아니다. 여는 따옴표보다 앞에 오므로 따옴표 안은 안 건드린다.
  while [[ $raw == [[:blank:]]* ]]; do raw=\${raw#?}; done
  for (( i = 0; i < \${#raw}; i++ )); do
    c=\${raw:$i:1}
    if [[ $c == "$bs" ]]; then
      i=$(( i + 1 )); n=\${raw:$i:1}
      [[ -n $n ]] || break
      out=$out$pend; pend=''
      case $n in
        n) out=$out$'\\n' ;;
        t) out=$out$'\\t' ;;
        b) out=$out$'\\b' ;;
        *) out=$out$n ;;
      esac
      continue
    fi
    if [[ $c == '"' ]]; then
      q=$(( 1 - q )); out=$out$pend; pend=''; continue
    fi
    if (( q == 0 )) && [[ $c == '#' || $c == ';' ]]; then break; fi
    if (( q == 0 )) && [[ $c == ' ' || $c == $'\\t' ]]; then pend=$pend$c; continue; fi
    out=$out$pend; pend=''
    out=$out$c
  done
  REPLY=$out
}`;

/**
 * 설정 파일 하나를 읽어 `user.email`과 `extensions.worktreeConfig`를 꺼낸다.
 *
 * 섹션·키 이름은 대소문자를 안 가리고, 헤더 줄에 변수가 같이 올 수 있고(`[user] email = x`),
 * 하위섹션이 붙은 `[user "work"]`는 `[user]`와 다른 섹션이다. 이 셋을 놓쳐서 로컬
 * identity가 있는 저장소를 "매핑대로"라고 답한 적이 있다.
 */
export const CONFIG_FN = `_git_mapper_config() {
  [[ -r "$1" ]] || return 1
  local line rest head key sect=''
  while IFS= read -r line || [[ -n $line ]]; do
    while [[ $line == [[:blank:]]* ]]; do line=\${line#?}; done
    while [[ $line == *[[:blank:]] ]]; do line=\${line%?}; done
    case $line in ''|'#'*|';'*) continue ;; esac

    if [[ $line == '['* ]]; then
      head=\${line%%]*}
      rest=\${line#*]}
      head=\${head#\\[}
      while [[ $head == [[:blank:]]* ]]; do head=\${head#?}; done
      while [[ $head == *[[:blank:]] ]]; do head=\${head%?}; done
      sect=''
      if [[ -n $head && $head != *[^A-Za-z0-9.-]* ]]; then
        _git_mapper_lower "$head"
        sect=$REPLY
      fi
      line=$rest
      while [[ $line == [[:blank:]]* ]]; do line=\${line#?}; done
      case $line in ''|'#'*|';'*) continue ;; esac
    fi

    [[ $sect == user || $sect == extensions ]] || continue
    [[ $line == *=* ]] || continue
    key=\${line%%=*}
    while [[ $key == *[[:blank:]] ]]; do key=\${key%?}; done
    _git_mapper_lower "$key"
    key=$REPLY

    if [[ $sect == user && $key == email ]]; then
      _git_mapper_value "\${line#*=}"
      _gm_email=$REPLY
    elif [[ $sect == extensions && $key == worktreeconfig ]]; then
      _git_mapper_value "\${line#*=}"
      _git_mapper_lower "$REPLY"
      _gm_worktree_config=$REPLY
    fi
  done < "$1"
  return 0
}`;

/**
 * git이 이 저장소에서 실제로 읽을 설정 파일들을 순서대로 본다. 공유 설정은 common dir에
 * 하나뿐이고, `extensions.worktreeConfig`를 켠 저장소만 워크트리별 파일을 덧쓴다.
 */
export const LOCAL_EMAIL_FN = `_git_mapper_local_email() {
  _gm_email='' _gm_worktree_config=''
  _git_mapper_config "$_gm_commondir/config"
  if [[ $_gm_worktree_config == true && -r $_gm_gitdir/config.worktree ]]; then
    local shared=$_gm_email
    _gm_email=''
    _git_mapper_config "$_gm_gitdir/config.worktree"
    [[ -n $_gm_email ]] || _gm_email=$shared
  fi
}`;
