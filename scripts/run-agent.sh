#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/pretty-print.sh
source "$SCRIPT_DIR/lib/pretty-print.sh"

if [[ $# -ne 1 ]]; then
  pp_error "Usage: scripts/run-agent.sh '<prompt>'"
  exit 2
fi

PROMPT="$1"
AGENT_COMMAND="${PI_AGENT_COMMAND:-pi-dan-rinse}"

if ! command -v "$AGENT_COMMAND" >/dev/null 2>&1; then
  pp_error "Required command not found: $AGENT_COMMAND"
  pp_hint "Set PI_AGENT_COMMAND or edit scripts/run-agent.sh if this project should use a different agent command."
  exit 127
fi

# Intentionally no model or thinking-level flags.
# This relies on the selected local agent command configuration.

pp_step "Launching agent via $AGENT_COMMAND."
pp_cmd "$AGENT_COMMAND --no-session -p @AGENTS.md @PROJECT_BRIEF.md @BUILD_TICKETS.md '<prompt>'"

"$AGENT_COMMAND" --no-session -p @AGENTS.md @PROJECT_BRIEF.md @BUILD_TICKETS.md "$PROMPT"
