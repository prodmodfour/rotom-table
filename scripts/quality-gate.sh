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
  find scripts -maxdepth 1 -type f -name 'test-*.sh' -print0 | sort -z
)

if (( ${#script_regression_tests[@]} > 0 )); then
  pp_section "Shell script regressions"
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

  pp_section "Ability automation metadata"
  run_cmd npm run check:ability-automation
  run_cmd npm run check:ability-automation-budgets
  run_cmd npm run check:ability-automation-plan

  pp_section "Capability automation metadata"
  run_cmd npm run check:capability-automation-complete

  pp_section "Edge automation metadata"
  run_cmd npm run check:edge-automation-complete

  pp_section "Feature automation metadata"
  run_cmd npm run check:feature-automation-complete

  pp_section "Breeding automation metadata"
  run_cmd npm run check:breeding-automation

  pp_section "Breeding Family resolutions"
  run_cmd npm run check:breeding-family-resolutions

  pp_section "Breeding compiled registry"
  run_cmd npm run check:breeding-compiler

  pp_section "Pokémon Contest authority and acceptance"
  run_cmd npm run check:pokemon-contests

  pp_section "Complete Play Loop acceptance"
  run_cmd npm run check:complete-play-loop-item-catalog-closure
  run_cmd npm run check:complete-play-loop-authority-guardrails
  run_cmd npm run check:complete-play-loop-performance
  run_cmd npm run check:complete-play-loop-accessibility-visual
  run_cmd npm run check:complete-play-loop-concurrency-failure
  run_cmd npm run check:complete-play-loop-golden-campaigns
  run_cmd npm run check:complete-play-loop-documentation
  run_cmd npm run check:complete-play-loop-alpha-acceptance

  pp_section "Deferred Mechanics Closure drift and forbidden gaps"
  run_cmd npm run check:deferred-closure-drift

  pp_section "GM Campaign Toolkit authority and finality"
  run_cmd npm run check:gm-campaign-toolkit-complete

  pp_section "1.0 Release Readiness"
  run_cmd npm run check:release-readiness

  pp_section "Encounter presentation contract"
  run_cmd npm run check:encounter-presentation

  pp_section "Encounter design system"
  run_cmd npm run check:encounter-design
  run_cmd npm run check:encounter-legacy

  pp_section "Move automation metadata"
  run_cmd npm run check:move-automation
  run_cmd npm run check:move-automation-complete
  run_cmd npm run check:move-automation-budgets
  run_cmd npm run check:move-automation-menu-status
  run_cmd npm run check:move-automation-legacy-links

  run_cmd npm run lint --if-present
  run_cmd npm run typecheck --if-present
  run_cmd npm test --if-present -- --maxWorkers=1 --no-file-parallelism
  run_cmd npm run test:nuxt --if-present
  run_cmd npm run test:e2e --if-present -- --workers=1
  run_cmd npm run build --if-present
else
  warn "npm not installed; skipping Node checks"
fi

pp_section "Summary"
pp_success "Quality gate passed."
