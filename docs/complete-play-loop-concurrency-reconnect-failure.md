# Complete Play Loop concurrency, reconnect, restart, and failure acceptance

P8-097 consolidates the exact failure model in `data/complete-play-loop/concurrency-failure-acceptance.v1.json`.

Run:

```bash
npm run check:complete-play-loop-concurrency-failure
```

## Recovery contract

- Write the exact strict command to durable client storage before dispatch.
- A known accepted or rejected response clears the matching retained command only after its durable server result is available.
- An unknown transport outcome keeps the exact command. Reconnect performs a status check; it never automatically replays.
- If status has no accepted result, the user may explicitly retry only the same command. Current server authority is revalidated before any write.
- One local-storage scope lock excludes a competing tab. `storage` events mirror or clear exact state without submitting it.
- A conflict, moved row, stale revision, changed definition, or invalidated choice requires a fresh projection and explicit redeclaration. No same-name or nearby row is substituted.
- Manual SQLite, JSON, sheet, or inventory repair is never an accepted recovery step.

## Transaction boundaries

Item use binds source custody, reservation, action/resource cost, target effects, sheet/inventory revisions, history, terminal result, and realtime journal in one transaction. Poké Ball use additionally binds the exact Ball row, capture roll/outcome, roster/Box destination, target state, map placement, and capture receipt.

Finish Encounter binds reward, Experience, capture settlement, outcomes, cleanup, group and sheet writes, immutable facts, attention sources, completion, and realtime in one exact-revision transaction. Tests inject failure at every write boundary and require no terminal result, no partial successor revision, and no publication before commit.

Corrections never rewrite accepted evidence. One current GM authority appends a hash-bound correction, audit row, and realtime event atomically. Exact restart replay returns that accepted correction; stale, player, drifted, or partially failed correction attempts mutate nothing.

## Exactly-once outcomes

The acceptance matrix covers items, rewards, effects, captures, Experience, attention decisions, and realtime delivery. For each asset:

- duplicate operation identities return byte-equivalent terminal evidence;
- divergent reuse is rejected;
- immutable rolls and choices are not recomputed;
- post-commit delivery failure is answered from the journal;
- restart loads durable evidence rather than rerunning the use case;
- rollback leaves no receipt that could be mistaken for acceptance.

## Operator troubleshooting

1. Do not delete a retained client command merely because the UI timed out.
2. Restore connectivity and use the exact status action.
3. If accepted, reload current projections; do not submit again.
4. If no accepted result exists, review current authority and explicitly retry or discard.
5. If current authority conflicts, discard only after the exact status check and redeclare from the fresh row/target/choice.
6. Investigate audit-drift or duplicate-journal failures as data-integrity incidents. Never bypass them with a direct storage edit.
