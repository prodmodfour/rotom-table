#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/refactor-loop.sh [options]

Runs fresh agent print-mode refactor cycles until REFACTOR_NOTES.md contains:
  AUTOMATION_STATUS: DONE

By default there is NO cycle limit. This is intended to run for hours/days inside
`tmux`, `screen`, or `nohup`, stopping only when the whole refactor is marked
done or when a safety check fails.

Options:
  --max-cycles N      Optional safety cap. Omit for unlimited cycles.
  --once              Same as --max-cycles 1.
  --sleep SECONDS     Pause between successful cycles. Default: 0.
  -h, --help          Show this help.

Backward compatibility:
  scripts/refactor-loop.sh 7 is treated as --max-cycles 7.

Optional environment variables:
  PI_REFACTOR_AGENT_COMMAND  Agent command to run. Default: pi-dan-rinse
  PI_REFACTOR_MODEL          Passes --model to the agent command, e.g. anthropic/claude-sonnet-4-5
  PI_REFACTOR_THINKING       Passes --thinking to the agent command, e.g. high
  PI_REFACTOR_MAX_CYCLES     Default max cycle cap if --max-cycles is not provided
  PI_REFACTOR_SLEEP_SECONDS  Default sleep between successful cycles
  PI_REFACTOR_NO_PULL=1      Skip git pull --ff-only before each cycle
USAGE
}

MAX_CYCLES="${PI_REFACTOR_MAX_CYCLES:-}"
SLEEP_SECONDS="${PI_REFACTOR_SLEEP_SECONDS:-0}"
AGENT_COMMAND="${PI_REFACTOR_AGENT_COMMAND:-pi-dan-rinse}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --max-cycles)
      if [[ $# -lt 2 ]]; then
        echo "--max-cycles requires a value" >&2
        exit 2
      fi
      MAX_CYCLES="$2"
      shift 2
      ;;
    --once)
      MAX_CYCLES=1
      shift
      ;;
    --sleep)
      if [[ $# -lt 2 ]]; then
        echo "--sleep requires a value" >&2
        exit 2
      fi
      SLEEP_SECONDS="$2"
      shift 2
      ;;
    [0-9]*)
      # Keep the old `npm run refactor:loop -- 7` form working, but do not make
      # it the default behavior.
      MAX_CYCLES="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "$MAX_CYCLES" ]] && { ! [[ "$MAX_CYCLES" =~ ^[0-9]+$ ]] || [[ "$MAX_CYCLES" -lt 1 ]]; }; then
  echo "--max-cycles must be a positive integer" >&2
  exit 2
fi

if ! [[ "$SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "--sleep must be a non-negative integer number of seconds" >&2
  exit 2
fi

REQUIRED_FILES=(original_refactor_prompt.md REFACTOR_NOTES.md)
DONE_RE='^AUTOMATION_STATUS:[[:space:]]*DONE[[:space:]]*$'
LOG_DIR='.pi/logs/refactor-loop'
LOCK_DIR='.pi/refactor-loop.lock'

PROMPT=$(cat <<'PROMPT_EOF'
Read original_refactor_prompt.md and REFACTOR_NOTES.md, then continue the refactor automation.

Your job in this run:
- Determine whether the whole refactor described by original_refactor_prompt.md is completely finished, using REFACTOR_NOTES.md as the progress log.
- If it is completely finished, add or update a standalone line near the top of REFACTOR_NOTES.md to exactly:
  AUTOMATION_STATUS: DONE
  Then commit and push that notes update if it changed, and stop.
- If any work remains, do exactly one bounded next phase. Do not attempt multiple phases in this run.

Automation rules:
- Update REFACTOR_NOTES.md with what was done, quality gates run, and what remains next.
- Keep REFACTOR_NOTES.md useful for future fresh-context runs; maintain a concise current status/next-step summary near the top when appropriate.
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

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_DIR")" "$LOG_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Another refactor loop appears to be running: $LOCK_DIR" >&2
    if [[ -f "$LOCK_DIR/pid" ]]; then
      echo "Recorded PID: $(cat "$LOCK_DIR/pid")" >&2
    fi
    echo "If this is stale, remove $LOCK_DIR and retry." >&2
    exit 1
  fi
  echo "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
}

require_command git
require_command "$AGENT_COMMAND"

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

acquire_lock

if is_done; then
  echo "REFACTOR_NOTES.md is already marked done."
  exit 0
fi

cycle=0
limit_label="until DONE"
if [[ -n "$MAX_CYCLES" ]]; then
  limit_label="$MAX_CYCLES"
fi

while true; do
  if is_done; then
    echo "Refactor is marked done."
    exit 0
  fi

  if [[ -n "$MAX_CYCLES" ]] && (( cycle >= MAX_CYCLES )); then
    echo "Reached max cycle cap ($MAX_CYCLES) without AUTOMATION_STATUS: DONE."
    exit 1
  fi

  cycle=$((cycle + 1))
  echo "=== $AGENT_COMMAND refactor cycle $cycle/$limit_label ==="
  require_clean_tree
  require_synced_or_pull

  before_head="$(git rev-parse HEAD)"
  log_file="$LOG_DIR/cycle-$(date +%Y%m%d-%H%M%S)-$cycle.log"

  agent_args=(--no-session -p)
  if [[ -n "${PI_REFACTOR_MODEL:-}" ]]; then
    agent_args=(--model "$PI_REFACTOR_MODEL" "${agent_args[@]}")
  fi
  if [[ -n "${PI_REFACTOR_THINKING:-}" ]]; then
    agent_args=(--thinking "$PI_REFACTOR_THINKING" "${agent_args[@]}")
  fi

  echo "Logging to $log_file"
  if ! "$AGENT_COMMAND" "${agent_args[@]}" @original_refactor_prompt.md @REFACTOR_NOTES.md "$PROMPT" 2>&1 | tee "$log_file"; then
    echo "$AGENT_COMMAND failed during cycle $cycle; stopping. See $log_file" >&2
    exit 1
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "$AGENT_COMMAND left a dirty working tree; stopping for manual review." >&2
    git status --short >&2
    exit 1
  fi

  push_if_needed_after_cycle

  after_head="$(git rev-parse HEAD)"
  if [[ "$after_head" == "$before_head" ]] && ! is_done; then
    echo "Cycle completed without a new commit and without AUTOMATION_STATUS: DONE; stopping to avoid a stuck infinite loop." >&2
    exit 1
  fi

  if is_done; then
    echo "Refactor is marked done."
    exit 0
  fi

  if (( SLEEP_SECONDS > 0 )); then
    echo "Sleeping $SLEEP_SECONDS second(s) before next cycle."
    sleep "$SLEEP_SECONDS"
  fi
done
