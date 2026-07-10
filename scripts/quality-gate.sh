#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/pretty-print.sh
source "$SCRIPT_DIR/lib/pretty-print.sh"

warn() {
  pp_warn "$*"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

run_cmd() {
  pp_cmd "$*"
  "$@"
}

use_project_node() {
  if [[ ! -f .nvmrc ]]; then
    return 0
  fi

  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    pp_step "nvm use $(tr -d '[:space:]' < .nvmrc)"
    nvm use --silent >/dev/null
    return 0
  fi

  warn ".nvmrc is present but nvm was not found; continuing with current node: $(node --version 2>/dev/null || printf 'not installed')"
}

pp_banner "Rotom Table quality gate"

pp_section "Shell syntax checks"
while IFS= read -r -d '' script; do
  pp_step "bash -n $script"
  bash -n "$script"
done < <(find scripts -type f -name '*.sh' -print0 | sort -z)
pp_success "Shell syntax checks passed."

mapfile -d '' script_regression_tests < <(
  find scripts -maxdepth 1 -type f -name 'test-build-loop-*.sh' -print0 | sort -z
)

if (( ${#script_regression_tests[@]} > 0 )); then
  pp_section "Autonomous build-loop script regressions"
  for test_script in "${script_regression_tests[@]}"; do
    run_cmd bash "$test_script"
  done
fi

if [[ -f scripts/check-no-secrets.sh ]]; then
  pp_section "Secret guardrail"
  run_cmd bash scripts/check-no-secrets.sh
fi

if [[ -f scripts/check-no-generated-private-files.sh ]]; then
  pp_section "Generated/private-file guardrail"
  run_cmd bash scripts/check-no-generated-private-files.sh
fi

pp_section "Node project"
use_project_node

if have npm; then
  if [[ -f package-lock.json ]]; then
    run_cmd npm ci
  else
    run_cmd npm install
  fi

  pp_section "Move automation metadata"
  run_cmd npm run check:move-automation
  run_cmd npm run check:move-automation-menu-status
  run_cmd npm run check:move-automation-legacy-links

  run_cmd npm run lint --if-present
  run_cmd npm run typecheck --if-present
  run_cmd npm test --if-present
  run_cmd npm run build --if-present
else
  warn "npm not installed; skipping Node checks"
fi

pp_section "Summary"
pp_success "Quality gate passed."
