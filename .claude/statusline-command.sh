#!/usr/bin/env bash
# Claude Code status line — compact, readable in PowerShell terminals.
# Receives session JSON on stdin from Claude Code.

input=$(cat)

# --- CWD: shorten to last 2 path segments, replace home with ~ ---
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
# Normalise Windows backslashes to forward slashes
cwd="${cwd//\\//}"
# Substitute common home prefixes with ~
for home_candidate in "$HOME" "$USERPROFILE"; do
  home_candidate="${home_candidate//\\//}"
  if [[ -n "$home_candidate" && "$cwd" == "$home_candidate"* ]]; then
    cwd="~${cwd#"$home_candidate"}"
    break
  fi
done
# Keep last 2 path segments (e.g. "foo/bar" from "/very/long/foo/bar")
short_cwd=$(printf '%s' "$cwd" | awk -F'/' '{
  if (NF >= 3) { print $(NF-1) "/" $NF }
  else          { print $0 }
}')

# --- Git branch (silent when not in a repo) ---
git_branch=""
# Resolve ~ back to real path for git -C
real_cwd="${cwd/#\~/$HOME}"
real_cwd="${real_cwd//\\//}"
branch=$(git --no-optional-locks -C "$real_cwd" branch --show-current 2>/dev/null)
if [[ -n "$branch" ]]; then
  git_branch="$branch"
fi

# --- Model display name ---
model=$(echo "$input" | jq -r '.model.display_name // ""')

# --- Context used percentage (only shown after first API call) ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_part=""
ctx_colour="\033[32m"   # green default
if [[ -n "$used_pct" ]]; then
  ctx_int=$(printf '%.0f' "$used_pct")
  ctx_part="ctx:${ctx_int}%"
  if   (( ctx_int >= 90 )); then ctx_colour="\033[31m"   # red
  elif (( ctx_int >= 75 )); then ctx_colour="\033[33m"   # yellow
  fi
fi

# --- ANSI helpers ---
reset="\033[0m"
bold="\033[1m"
cyan="\033[36m"
yellow="\033[33m"

# --- Build line ---
# Example output:  cleaningsolutions/nexxus-cleaning-platform  master  Claude Sonnet 4.5  ctx:12%
parts=()
parts+=("${bold}${short_cwd}${reset}")
[[ -n "$git_branch" ]] && parts+=("${cyan}${git_branch}${reset}")
[[ -n "$model"      ]] && parts+=("${yellow}${model}${reset}")
[[ -n "$ctx_part"   ]] && parts+=("${ctx_colour}${ctx_part}${reset}")

# Join with two-space separator
line=""
for part in "${parts[@]}"; do
  [[ -n "$line" ]] && line+="  "
  line+="$part"
done

printf "%b\n" "$line"
