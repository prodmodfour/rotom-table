#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/refactor-loop.sh [cycles]

Runs fresh pi print-mode refactor cycles until either:
  - REFACTOR_NOTES.md contains a line: AUTOMATION_STATUS: DONE
  - the requested cycle count is reached
  - a safety check fails

Default cycles: 7

Optional environment variables:
  PI_REFACTOR_MODEL       Passes --model to pi, e.g. anthropic/claude-sonnet-4-5
  PI_REFACTOR_THINKING    Passes --thinking to pi, e.g. high
  PI_REFACTOR_NO_PULL=1   Skip git pull --ff-only before each cycle
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

MAX_CYCLES="${1:-7}"
if ! [[ "$MAX_CYCLES" =~ ^[0-9]+$ ]] || [[ "$MAX_CYCLES" -lt 1 ]]; then
  echo "cycles must be a positive integer" >&2
  usage >&2
  exit 2
fi

REQUIRED_FILES=(original_refactor_prompt.md REFACTOR_NOTES.md)
DONE_RE='^AUTOMATION_STATUS:[[:space:]]*DONE[[:space:]]*$'
LOG_DIR='.pi/logs/refactor-loop'

PROMPT=$(cat <<'PROMPT_EOF'
Read original_refactor_prompt.md and REFACTOR_NOTES.md, then do exactly one next refactor phase.

Automation rules:
- Work in one bounded phase only. Do not attempt multiple phases in this run.
- If no refactor phase remains, add or update a standalone line near the top of REFACTOR_NOTES.md to exactly:
  AUTOMATION_STATUS: DONE
  Then commit and push that notes update if it changed, and stop.
- Otherwise complete the next phase, update REFACTOR_NOTES.md with what was done, quality gates run, and the next remaining phase.
- Run the relevant tests/checks for the phase. Prefer targeted tests first, then broader checks when appropriate.
- Commit the completed phase and push it.
- Leave the working tree clean.
- Do not modify scripts/refactor-loop.sh, package.json, or .gitignore unless the automation itself is the requested phase.
- If you cannot complete, commit, or push safely, explain the blocker in REFACTOR_NOTES.md only when useful, leave the tree clean if possible, and do not mark AUTOMATION_STATUS: DONE.
PROMPT_EOF
)

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 127
  fi
}

is_done() {
  grep -Eq "$DONE_RE" REFACTOR_NOTES.md
}

git_upstream() {
  git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
}

git_ahead_behind() {
  local upstream="$1"
  git rev-list --left-right --count "HEAD...$upstream"
}

require_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty; refusing to start/continue automation." >&2
    git status --short >&2
    echo >&2
    echo "Commit, stash, or discard these changes before running the loop." >&2
    exit 1
  fi
}

require_synced_or_pull() {
  local upstream
  upstream="$(git_upstream)"
  if [[ -z "$upstream" ]]; then
    echo "No upstream configured; skipping pull/push sync checks."
    return
  fi

  if [[ "${PI_REFACTOR_NO_PULL:-}" != "1" ]]; then
    git pull --ff-only
  fi

  local counts ahead behind
  counts="$(git_ahead_behind "$upstream")"
  ahead="${counts%%[[:space:]]*}"
  behind="${counts##*[[:space:]]}"

  if (( behind > 0 )); then
    echo "Branch is still behind $upstream by $behind commit(s); refusing to continue." >&2
    exit 1
  fi

  if (( ahead > 0 )); then
    echo "Branch is ahead of $upstream by $ahead commit(s) before the cycle starts." >&2
    echo "Push or reset those commits manually before automation." >&2
    exit 1
  fi
}

push_if_needed_after_cycle() {
  local upstream
  upstream="$(git_upstream)"
  if [[ -z "$upstream" ]]; then
    return
  fi

  local counts ahead behind
  counts="$(git_ahead_behind "$upstream")"
  ahead="${counts%%[[:space:]]*}"
  behind="${counts##*[[:space:]]}"

  if (( behind > 0 )); then
    echo "Remote advanced during the cycle; run git pull --ff-only and inspect manually." >&2
    exit 1
  fi

  if (( ahead > 0 )); then
    echo "Cycle left $ahead unpushed commit(s); pushing now."
    git push
  fi
}

require_command git
require_command pi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git work tree." >&2
  exit 1
fi

for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Required file missing: $file" >&2
    exit 1
  fi
done

mkdir -p "$LOG_DIR"

if is_done; then
  echo "REFACTOR_NOTES.md is already marked done."
  exit 0
fi

for cycle in $(seq 1 "$MAX_CYCLES"); do
  if is_done; then
    echo "Refactor is marked done."
    exit 0
  fi

  echo "=== pi refactor cycle $cycle/$MAX_CYCLES ==="
  require_clean_tree
  require_synced_or_pull

  before_head="$(git rev-parse HEAD)"
  log_file="$LOG_DIR/cycle-$(date +%Y%m%d-%H%M%S)-$cycle.log"

  pi_args=(--no-session -p)
  if [[ -n "${PI_REFACTOR_MODEL:-}" ]]; then
    pi_args=(--model "$PI_REFACTOR_MODEL" "${pi_args[@]}")
  fi
  if [[ -n "${PI_REFACTOR_THINKING:-}" ]]; then
    pi_args=(--thinking "$PI_REFACTOR_THINKING" "${pi_args[@]}")
  fi

  echo "Logging to $log_file"
  pi "${pi_args[@]}" @original_refactor_prompt.md @REFACTOR_NOTES.md "$PROMPT" 2>&1 | tee "$log_file"

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "pi left a dirty working tree; stopping for manual review." >&2
    git status --short >&2
    exit 1
  fi

  push_if_needed_after_cycle

  after_head="$(git rev-parse HEAD)"
  if [[ "$after_head" == "$before_head" ]] && ! is_done; then
    echo "Cycle completed without a new commit and without AUTOMATION_STATUS: DONE; stopping to avoid a loop." >&2
    exit 1
  fi

done

if is_done; then
  echo "Refactor is marked done."
  exit 0
fi

echo "Reached max cycles ($MAX_CYCLES) without AUTOMATION_STATUS: DONE."
exit 1
