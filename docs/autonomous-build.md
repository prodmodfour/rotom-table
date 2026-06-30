# Autonomous build loop

Rotom Table includes a local autonomous build loop adapted from [`prodmodfour/autonomous-build-template`](https://github.com/prodmodfour/autonomous-build-template).

The current queue maps GitHub issues #27-#44 to local tickets in `BUILD_TICKETS.md`. Each autonomous cycle should complete exactly one ticket and commit it.

## Files

- `PROJECT_BRIEF.md` — project-specific goals, constraints, and quality expectations for this autonomous wave.
- `BUILD_TICKETS.md` — ordered ticket queue. The lowest-numbered `TODO` ticket is the next unit of work.
- `AGENTS.md` — repository and autonomous workflow rules.
- `scripts/build-loop.sh` — cycle runner.
- `scripts/run-agent.sh` — Pi wrapper used by the loop.
- `scripts/quality-gate.sh` — Rotom Table validation gate.

## Run one local cycle

Start from a clean working tree:

```bash
git status --short
scripts/build-loop.sh --max-cycles 1 --no-push
```

By default the loop pushes each successful cycle. Use `--no-push` for local-only trial runs.

## Run on a work branch

```bash
scripts/build-loop.sh --create-branch feature/group-inventory-autobuild --max-cycles 18 --no-push
```

To push the branch after each successful ticket, omit `--no-push`.

## PR mode

After authenticating `gh`, the loop can create or merge a PR after each successful cycle:

```bash
scripts/build-loop.sh \
  --branch feature/group-inventory-autobuild \
  --pr-each-cycle \
  --pr-base main \
  --max-cycles 18
```

Use PR automation only from a branch that is not `main`.

## Quality gate

`bash scripts/quality-gate.sh` runs:

- Bash syntax checks for shell scripts;
- autonomous build-loop regression tests;
- secret and generated/private-file guardrails;
- Node.js 24 via `.nvmrc` when `nvm` is available;
- `npm ci`;
- `npm run typecheck --if-present`;
- `npm test --if-present`;
- `npm run build --if-present`.

## Completion

When ticket #44 is complete and tickets #27-#43 are already `DONE`, the final ticket should set the top-level line in `BUILD_TICKETS.md` to:

```text
AUTOMATION_STATUS: DONE
```
