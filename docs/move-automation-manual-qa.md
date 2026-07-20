# Move automation operator recovery and manual QA

This runbook is for a private live-play deployment. Do not edit SQLite rows, copy app code into production, or guess whether a move committed. Use operation status, authoritative snapshots, and the supported GM actions.

Animation/VFX acceptance is separate; use [Move animation manual QA](move-animation-manual-qa.md). A mechanically accepted move remains accepted even if a transient animation is missed.

## Before a canary

1. Confirm a fresh database backup and its restore command. A SQLite backup is the resumable form because it contains maps, encounter state, operation history, and private pending rows.
2. Confirm the deployed revision passed `bash scripts/quality-gate.sh` and `npm run check:move-automation-complete`.
3. Open three independent browser contexts: GM, eligible player, and ineligible player. Use separate profiles/storage, not three tabs sharing one profile unless testing shared outbox behavior.
4. Open the same player-visible live-play map. Verify all clients converge to one map revision and the eligible player controls only linked placements.
5. Keep the latency debug panel available in development/canary environments. Record operation ID suffix, terminal outcome, reason code, retry/reconcile count, and timings—never private command bodies or sheet values.

## Representative canary matrix

Run one move from each row and verify both mechanics and convergence:

- ordinary hit/miss/critical/type immunity;
- self and target combat-stage cap;
- area ally/enemy filtering;
- multi-hit with follow-up miss;
- heal/drain/recoil/direct HP loss;
- weather/terrain/room/hazard creation and expiry;
- persistent effect plus round/turn cleanup;
- movement/switch/displacement with occupied destination;
- item choice touching a second resource;
- setup/execute move;
- reaction/guard/counter window;
- nested/copied/random move;
- restart while a response window is pending.

For each, check the GM and eligible player see one terminal presentation, the ineligible player receives no private options, every client reaches the same revision/state, and retrying the same operation performs no second roll, spend, item mutation, history append, or lifecycle event.

## Pending, uncertain, and conflicted operations

### Pending response

A pending summary on the map is public; private options come only from the authorized response endpoint. The eligible responder may choose/pass. A GM may use the supported force-resolve or cancel control. Do not submit an option copied from another user or old window.

For a movement Attack of Opportunity, confirm the solid token never travels to the final destination and then reverses. It should retain an immediate translucent route intent, advance only to the authoritative pre-step checkpoint, show the red checkpoint marker, and present the eligible responder with the prominent reaction card. The mover/ineligible viewer gets only the neutral waiting state and no attack options. Pass should continue forward along the remaining route; an attack that cancels or changes movement should remove the stale route instead of replaying it.

### Uncertain delivery

If the client lost HTTP after sending, leave the durable outbox entry intact. Let live SSE, replay, or operation-status recovery resolve it. **Retry** resends the exact stored body and `opId`. To choose something different, wait for authoritative status and submit a new authorized response operation; never mutate an existing outbox body.

### Stale/conflicted

A stale map, sheet, item, inventory, history, or pending-row revision must fail without partial state. Reconcile the authoritative snapshot, inspect the reason code, and declare a new operation if the action is still legal. Do not repeatedly retry a deterministic conflict.

### Cancel and correction

- **Cancel pending resolution:** GM cancellation terminally closes the saga and applies only its validated declaration-cost compensation policy.
- **Correct accepted move:** use the GM correction UI and only the inverse IDs offered for that terminal operation. The server requires the recorded post-move revision/value. If later play changed a resource, correction conflicts instead of overwriting it.
- Some accepted changes are intentionally unavailable for generic correction (history, externally observed or irreversible work, permanent move-list changes). Apply a new explicit game action; do not patch storage.

## Disconnect, replay gap, and zombie prompts

1. Disconnect the eligible responder with a window open.
2. Complete/cancel it from another authorized client, or leave it pending.
3. Reconnect after both retained-replay and forced-gap paths.
4. Verify the snapshot immediately removes obsolete local prompts; current public summaries trigger a fresh authorized-window load; stale local answers are rejected.
5. Verify denied private events still advance the ineligible client's cursor and do not force an information-revealing gap loop.

If reconciliation fails, keep the operation/outbox entry, restore connectivity, and retry snapshot reconciliation. Do not resend mechanics commands merely to refresh the UI.

## Restart recovery

1. With active effects, zones, resource spends, and one pending resolution, stop the service cleanly.
2. Restart against the same SQLite database.
3. Reconnect all three contexts.
4. Verify active durations/charges, sides, ground items, history, and resources match the pre-restart snapshot.
5. Verify the pending window reopens only for GM/eligible users and uses the same resolution/window/option identities.
6. Respond once, then retry the same response and declaration. Both retries must return the stored terminal result without new rolls or state changes.

If the deployment policy intentionally abandons pending work, verify an audited terminal `abandoned` result and removal of the public summary. Never leave a public summary without a private row.

## Backup, JSON export, and restore

- **Resumable backup:** use the documented SQLite backup procedure while respecting WAL consistency. Restore the database and verify map, encounter state, operation tables, pending rows, and schema version before enabling writes.
- **Maintenance JSON export:** active encounter rules round-trip, but pending prompts are terminally abandoned. Verify exported maps have empty pending summaries and inspect `data/move-automation-abandoned-pending-resolutions.json` for explicit audit evidence.
- Reject a backup/export containing a future unsupported encounter-state or storage schema version. Upgrade the app/migration first; never delete the version field.

After restore, run a read-only load, compare revisions/counts, then perform one isolated canary operation. Keep the old database until the observation window closes.

## Privacy checks

As the ineligible player, inspect HTTP responses, authorized SSE replay, live SSE, snapshots, operation status, and browser state. Confirm none contains hidden maps/tokens, private target names, HP/stat values, item rows, ownership IDs, unrevealed rolls, option bindings, sheets, command bodies, or audit traces. Public pending summaries may expose only their documented bounded fields. The debug panel may show runtime/version, counts, timings, outcome, and sanitized reason codes only.

## Escalation checklist

Record: deployed revision, map slug, operation ID suffix/full ID in private operator notes, current map revision, terminal/pending status, sanitized reason code, and whether HTTP/SSE/replay/status each arrived. Preserve logs and a database backup. Reproduce in local prodlike with sanitized fixtures. Fix app code in the repository and deploy through GitHub; do not hot-edit production runtime code or private campaign rows.
