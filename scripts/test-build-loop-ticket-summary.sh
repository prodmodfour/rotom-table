#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/pretty-print.sh
source "$SCRIPT_DIR/lib/pretty-print.sh"

fail() {
  pp_error "$*"
  exit 1
}

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

work_dir="$tmp_dir/work"
state_dir="$tmp_dir/state"

pp_step "Regression: build-loop reports sprint-style TODO ticket headings"

git init -q "$work_dir"

(
  cd "$work_dir"

  git config user.name "Build Loop Test"
  git config user.email "build-loop-test@example.invalid"

  mkdir -p scripts/lib
  cp "$REPO_ROOT/scripts/build-loop.sh" scripts/build-loop.sh
  cp "$REPO_ROOT/scripts/lib/pretty-print.sh" scripts/lib/pretty-print.sh
  cp "$REPO_ROOT/scripts/lib/git-branch.sh" scripts/lib/git-branch.sh
  cp "$REPO_ROOT/scripts/lib/pull-request.sh" scripts/lib/pull-request.sh

  cat > scripts/quality-gate.sh <<'QUALITY_GATE'
#!/usr/bin/env bash
set -euo pipefail
exit 0
QUALITY_GATE

  cat > scripts/run-agent.sh <<'RUN_AGENT'
#!/usr/bin/env bash
set -euo pipefail

printf '\nStub implementation for ticket detection.\n' >> WORK_LOG.md
git add WORK_LOG.md
git commit -q -m "test: implement detected ticket"
RUN_AGENT

  chmod +x scripts/build-loop.sh scripts/quality-gate.sh scripts/run-agent.sh

  cat > AGENTS.md <<'AGENTS'
# AGENTS.md

Test fixture.
AGENTS

  cat > PROJECT_BRIEF.md <<'PROJECT_BRIEF'
# PROJECT_BRIEF.md

TEMPLATE_CUSTOMISED: true
PROJECT_BRIEF

  cat > BUILD_TICKETS.md <<'BUILD_TICKETS'
# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

---

# Live Play Sprint 5 Tickets

## Sprint goal

Introductory section without a status line.

## LP-S5-001 — Audit current token movement presentation

Status: TODO

Document the current pipeline.

## LP-S5-002 — Add pure token motion curve utilities

Status: TODO

Add tested motion helpers.
BUILD_TICKETS

  git add .
  git commit -q -m "test: initial fixture"

  output="$(
    NO_COLOR=1 \
    AUTONOMOUS_BUILD_LOOP_STATE_DIR="$state_dir" \
      bash scripts/build-loop.sh --max-cycles 1 --no-push 2>&1
  )"

  if ! grep -Fq "Now working on: ticket LP-S5-001 — Audit current token movement presentation (TODO)" <<< "$output"; then
    printf '%s\n' "$output" >&2
    fail "build loop did not report the sprint-style TODO ticket heading"
  fi

  if grep -Fq "No TODO ticket found" <<< "$output"; then
    printf '%s\n' "$output" >&2
    fail "build loop still warned that no TODO ticket was found"
  fi
)

pp_success "Build-loop ticket summary regression passed."
