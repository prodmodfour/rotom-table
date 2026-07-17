#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/pretty-print.sh
source "$SCRIPT_DIR/lib/pretty-print.sh"
# shellcheck source=scripts/lib/build-loop-state.sh
source "$SCRIPT_DIR/lib/build-loop-state.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/build-loop-unlock.sh

Removes this repository's stale autonomous build-loop lock. The command refuses
to remove the lock while its recorded process is still active; request a safe
shutdown with `just stop` instead.
USAGE
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      pp_error "Unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
fi

if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pp_error "Run this command from inside the repository."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
if ! state_dir="$(build_loop_resolve_state_dir "$repo_root")"; then
  pp_error "Unable to resolve the build-loop state directory."
  exit 1
fi

lock_dir="$(build_loop_lock_dir "$state_dir")"
if [[ ! -e "$lock_dir" && ! -L "$lock_dir" ]]; then
  pp_info "No build-loop lock was found; nothing needs to be unlocked."
  exit 0
fi

loop_pid="$(build_loop_active_pid "$state_dir" 2>/dev/null || true)"
if [[ -n "$loop_pid" ]]; then
  pp_error "Build loop PID $loop_pid is still active; refusing to remove its lock."
  pp_hint "Request a safe shutdown with: just stop"
  exit 1
fi

recorded_pid="$(build_loop_read_lock_value "$state_dir" pid 2>/dev/null || true)"
if ! rm -rf -- "$lock_dir"; then
  pp_error "Could not remove the stale build-loop lock: $lock_dir"
  exit 1
fi

if [[ -e "$lock_dir" || -L "$lock_dir" ]]; then
  pp_error "The stale build-loop lock still exists: $lock_dir"
  exit 1
fi

pp_success "Removed stale build-loop lock."
pp_kv "Lock" "$lock_dir"
if [[ -n "$recorded_pid" ]]; then
  pp_kv "Inactive PID" "$recorded_pid"
fi
