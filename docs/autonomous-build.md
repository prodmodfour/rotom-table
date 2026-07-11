# Autonomous build loop

Rotom Table includes a local autonomous build loop adapted from [`prodmodfour/autonomous-build-template`](https://github.com/prodmodfour/autonomous-build-template).

The current queue maps GitHub issues #27-#44 to local tickets in `BUILD_TICKETS.md`. Each autonomous cycle should complete exactly one ticket and commit it.

## Files

- `PROJECT_BRIEF.md` — project-specific goals, constraints, and quality expectations for this autonomous wave.
- `BUILD_TICKETS.md` — ordered ticket queue. The lowest-numbered `TODO` ticket is the next unit of work.
- `AGENTS.md` — repository and autonomous workflow rules.
- `scripts/build-loop.sh` — cycle runner.
- `scripts/run-agent.sh` — Pi wrapper used by the loop.
- `scripts/render-agent-events.mjs` — dependency-free live Pi event renderer.
- `scripts/build-loop-follow.sh` — observer for the active aggregate log.
- `scripts/build-loop-stop.sh` — graceful stop-request command.
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

## Live agent output

The default `live` agent-output mode renders Pi's JSON event stream as concise, line-oriented terminal output. It shows assistant progress text, safe tool argument summaries, tool completion and duration, provider retries, compaction, and a periodic heartbeat while the model or a tool is still running. Thinking deltas and successful tool results are not printed. Failed tool output is bounded so a single failure cannot flood the terminal.

Select another mode when needed:

```bash
# Preserve the older final-response-only Pi print mode.
scripts/build-loop.sh --max-cycles 1 --agent-output final --no-push

# Emit Pi's raw JSONL event stream for low-level debugging.
scripts/build-loop.sh --max-cycles 1 --agent-output json --no-push
```

Raw JSON events can contain complete messages, tool arguments, and tool results. Keep raw event logs private and do not commit them. The normal live renderer is the recommended operator view.

## Follow and gracefully stop a long run

Every active loop writes its complete human-readable output to a stable `current.log` in the external build-loop state directory, in addition to the existing per-cycle logs. Follow it from another terminal without finding a PID or log filename:

```bash
just follow       # show the latest 40 lines, then follow
just follow 100   # show the latest 100 lines, then follow
```

The follower reports the active PID, cycle, ticket, and phase. It follows cycle transitions automatically and exits when the loop exits. Pressing Ctrl-C detaches only the follower; it does not interrupt the build loop.

Request a safe cycle-boundary shutdown with:

```bash
just stop
```

A graceful stop does not terminate an active Pi process. The current agent attempt may finish, and a successful cycle still completes its normal commit and push or PR/MR publication. No next cycle starts. If the attempt fails, existing failure checkpoint guardrails finish but the loop exits before ticket-split recovery or another retry. A stop requested during a cycle or retry sleep ends that sleep without starting more work. Repeated `just stop` commands are harmless.

`just follow` and `just stop` resolve the same per-repository external state directory as the loop. If the loop was started with `AUTONOMOUS_BUILD_LOOP_STATE_DIR`, pass the same environment variable to those commands.

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
