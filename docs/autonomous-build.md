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
- `scripts/build-loop-follow.sh` — observer for the active detailed-agent log.
- `scripts/build-loop-monitor.sh` — read-only periodic progress interpreter.
- `scripts/prepare-pi-event-range.mjs` — streaming semantic event projector for bounded read-tool access.
- `scripts/build-loop-stop.sh` — graceful stop-request command.
- `scripts/build-loop-unlock.sh` — stale lock cleanup command.
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

The default `live` agent-log format renders Pi's JSON event stream as concise, line-oriented output in the external logs. The terminal that launched `just run` stays focused on cycle-level state and directs the operator to `just follow` instead of echoing every agent event. The detailed stream shows assistant progress text, safe tool argument summaries, stable tool identifiers that correlate parallel starts and completions, semantic actions such as **Read file**, **Find files**, or **Run tests**, provider retries, compaction, durations, and a periodic heartbeat while the model or a tool is still running. Thinking events/deltas and successful tool results are not printed in this concise view. Failed tool output is bounded so a single failure cannot flood it.

In parallel, every `live` or `json` invocation is tee'd byte-for-byte into a private `*.pi-events.jsonl` sidecar beside its rendered `*.log` file. This is the complete event source emitted by the headless Pi process, including assistant and thinking events, full emitted tool arguments/results, retries, failures, and lifecycle events. Sidecars are created with mode `0600`, remain in the external state directory, and must never be committed.

Select another mode when needed:

```bash
# Preserve the older final-response-only Pi print mode.
scripts/build-loop.sh --max-cycles 1 --agent-output final --no-push

# Store Pi's raw JSONL event stream in the detailed logs for low-level debugging.
scripts/build-loop.sh --max-cycles 1 --agent-output json --no-push
```

Raw JSON events can contain complete messages, source excerpts, tool arguments, tool results, model reasoning emitted by the provider, and sensitive command output. Keep raw event logs private and do not commit them. The normal live renderer remains the recommended human operator view. `final` output mode does not expose a live JSON event stream, so full-stream monitoring is unavailable in that mode.

## Follow, monitor, and gracefully stop a long run

Every active loop writes high-level launcher output to `current.log`, concise detailed agent activity to `follow.log`, and rendered plus full-event files for individual attempts in the external build-loop state directory. Detailed activity is not mirrored to the `just run` terminal. Follow the stable concise log from another terminal without finding a PID or cycle filename:

```bash
just follow       # show the latest 40 lines, then follow
just follow 100   # show the latest 100 lines, then follow
```

The follower reports the active PID, cycle, ticket, and phase. It follows cycle transitions automatically and exits when the loop exits. Pressing Ctrl-C detaches only the follower; it does not interrupt the build loop.

For concise interpreted updates instead of the raw activity stream, run:

```bash
just monitor       # report immediately, then every 10 minutes
just monitor 5     # report immediately, then every 5 minutes
```

Each report uses a fresh, ephemeral Pi invocation with only the read tool enabled; project context, extensions, and skills remain disabled. The monitor streams every new line in the active invocation's complete `*.pi-events.jsonl` sidecar into a private, segmented semantic view. Cumulative message snapshots, partial tool-call snapshots, and duplicate terminal message bodies are reduced to incremental deltas and metadata; authoritative tool starts, full emitted arguments/results, thinking/text deltas, retries, failures, and lifecycle events remain. Malformed or exceptionally large individual source lines produce bounded warning records instead of exhausting monitor memory. The analyzer is instructed to read this view to EOF using offsets, and it also receives sanitized process activity, Git status/statistics, commit metadata, and bounded rendered context. The first report projects the stream from its beginning; later reports project every event added since the previous successful report. Set `PI_MONITOR_AGENT_COMMAND` to choose another Pi-compatible executable or `PI_MONITOR_THINKING_LEVEL` to override the default `low` thinking level. Pressing Ctrl-C detaches the monitor without affecting the build loop; the monitor emits a final report and exits after observing that the loop ended.

The normalized event ranges read by the monitor are sent to the analyzer's configured model provider. They can still contain source contents, command output, model reasoning, and secrets accidentally exposed to Pi; use monitoring only with a trusted provider and keep the external logs private.

Request a safe cycle-boundary shutdown with:

```bash
just stop
```

A graceful stop does not terminate an active Pi process. The current agent attempt may finish, and a successful cycle still completes its normal commit and push or PR/MR publication. No next cycle starts. If the attempt fails, existing failure checkpoint guardrails finish but the loop exits before ticket-split recovery or another retry. A stop requested during a cycle or retry sleep ends that sleep without starting more work. Repeated `just stop` commands are harmless.

If a loop was terminated uncleanly and left its lock behind, remove only that stale lock with:

```bash
just unlock
```

`just unlock` preserves all logs and refuses to remove a lock while its recorded process is still active. Use `just stop` for a running loop. Repeating `just unlock` when no lock exists is harmless.

`just follow`, `just monitor`, `just stop`, and `just unlock` resolve the same per-repository external state directory as the loop. If the loop was started with `AUTONOMOUS_BUILD_LOOP_STATE_DIR`, pass the same environment variable to those commands.

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
