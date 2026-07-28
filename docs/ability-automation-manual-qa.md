# Ability automation operator recovery and manual QA

This runbook covers the server-authoritative AbilitySpec runtime on normal live-play `/maps/<slug>` profile play. It does not authorize direct production code, SQLite-row, campaign-data, or service edits. Repository fixes deploy through the normal GitHub release path; back up production campaign data before any explicitly requested data operation.

Move mechanics invoked by an Ability still follow [Move automation operator recovery and manual QA](move-automation-manual-qa.md). A transient animation or presentation failure never changes an accepted mechanical result.

## Before a canary

1. Record the deployed Git revision and verify it passed `bash scripts/quality-gate.sh` and `npm run check:ability-automation-complete`.
2. Take a consistent SQLite backup using the private VPS backup runbook. A maintenance JSON export is interchange evidence, not a resumable backup for private pending windows.
3. Open independent GM, eligible-player, ineligible-player, and unauthenticated browser contexts. Do not reuse one profile/storage context when testing authorization.
4. Open the same player-visible live-play map as the first three users. Verify one current map revision and that the eligible player controls only linked placements.
5. Choose test creatures whose source Abilities, forms, held items, conditions, sides, and frequencies are known. Do not use private production character details in bug reports or telemetry.
6. Keep sanitized operator notes: deployed revision, map slug, opaque command/operation suffix, outcome/reason family, revision transition, count/timing bucket, and reconnect/retry result. Never copy response principals, option bindings, rolls, sheet bodies, or traces into public logs.

## Live-play UX acceptance

### Static Ability

- A purely Static Ability has no **Use Ability** button.
- Its provider applies only while the exact Ability instance is effective and its owner is conscious when the mechanic requires a conscious source.
- Suppression, source loss, form replacement, recall, or fainting removes ordinary active behavior at the authoritative boundary.
- A reviewed ambiguity-only `configuration` mode may offer a no-cost choice only while the ambiguity exists.

### Activated Ability

- The menu offers only manifest-selected activated/configuration modes for an effective Ability.
- The client submits an actor and opaque server-issued choices; it never submits targets, rolls, costs, or effects as authority.
- Stale, exhausted, out-of-range, unauthorized, suppressed, or malformed declarations fail without any partial action/frequency/item/HP/state write.
- One accepted declaration creates one revision transition and one generic terminal presentation. An exact retry returns the same result without paying or rolling again.

### Triggered, Interrupt, or Reaction Ability

- Trigger eligibility comes from accepted typed server events, not from browser watchers or combat-log text.
- Mandatory deterministic effects commit once. Optional triggers open only for eligible responders and use opaque option IDs.
- Simultaneous windows appear in deterministic priority/source order and share availability correctly.
- Passing, cancellation, expiry, conflict, and GM recovery are terminal and idempotent. A stale option from an earlier window is rejected.

## Representative mechanics matrix

Exercise at least one reviewed Ability from each applicable row:

- passive stat/damage/accuracy/evasion provider, with effective and suppressed branches;
- type, condition, keyword, or Move immunity, including a miss/prevention branch;
- activated self, ally, foe, area/cell, item, type/stat, and branch targeting;
- Scene and Daily frequency spend, exhaustion, reset, and exact retry;
- hit/miss/critical/multi-hit and hit-dependent secondary suppression;
- optional triggered response, mandatory trigger, Interrupt, and simultaneous reactions;
- voluntary movement evidence, forced movement exclusion, hazard/terrain crossing, and placement choice;
- weather, terrain, room, hazard, aura, side, and source-presence lifecycle;
- mark/counter/token/mode creation, cap/no-op, target loss, and source loss;
- healing and non-stacking Temporary HP, including prevention;
- form, disguise/illusion presentation, footprint/type/stat/movement synchronization, copied Ability, and restoration;
- held-item mutation, consumption, transfer, second-resource conflict, and Unnerve-style restriction;
- nested or Ability-invoked Move with fresh range, LOS, targetability, relationship, frequency, and geometry validation;
- nested random/response-owned effect with exact roll identities across resume.

For every scenario, verify all connected clients converge to the same revision and state. The ineligible client may see only the documented generic public outcome or pending existence; it must not learn the source Ability, actor, responder, choices, rolls, copied source, sheets, reads, or trace.

## Retry, conflict, and correction

### Uncertain delivery

Leave the durable client outbox entry intact after an HTTP interruption. Reconcile through SSE/replay/status and resend only the exact body with the same command identity. Never edit a queued choice or generate a new identity merely to discover whether the first command committed.

### Stale or conflicted execution

A changed map, sheet, item, inventory, form, target, relationship, field, frequency ledger, or pending read must fail before commit. Reload the authoritative snapshot and issue a new declaration only if the action remains legal. Repeatedly retrying a deterministic conflict is not recovery.

### Rules correction

Preserve the failing revision, sanitized state facts, canonical source citation, runtime definition hash, and minimal reproduction. Correct the app source/manifest/evidence in the repository, run focused conformance plus strict checks, and deploy normally. Do not edit an accepted audit trace, manifest hash, runtime file, or private database row in place. If table state needs a gameplay correction, use an existing typed GM command or an explicit new game action; never invent an ad hoc Ability patch.

## Disconnect and reconnect

1. Open an authorized response window and disconnect the eligible responder.
2. Leave it pending or complete/pass/cancel it from another authorized context.
3. Reconnect once within retained replay and once after forcing snapshot reconciliation.
4. Verify a still-current prompt reloads with the same resolution/window/opaque-option identities only for eligible users.
5. Verify a terminal prompt disappears immediately and a stale local response fails.
6. Verify denied private events still advance the ineligible viewer's event cursor without an information-revealing replay-gap loop.
7. Inspect browser storage/devtools and confirm terminal private options, rolls, traces, and response principals are not retained.

## Restart, backup, export, and recovery

1. Establish active Scene/Daily usage, a mark or mode, a source-bound effect, a form/copied Ability snapshot, and one pending response.
2. Stop the service cleanly and restart it against the same SQLite database.
3. Reconnect all authorized/ineligible contexts and compare revisions and visible state with the pre-restart snapshot.
4. Verify usage, timing, marks, entities, forms, copied mechanics, lifecycle state, exact pending window, roll ledger identity, and continuation cursor survive only in their authorized stores/views.
5. Resolve once, then retry the same declaration and response. No second payment, roll, mark, form, item mutation, or event may occur.
6. Verify source loss during downtime deterministically removes source-bound effects, entities, marks, forms, and copied Ability projection on recovery.

A private hash-bound recovery/database backup can preserve resumable windows. The maintenance JSON export policy is `terminally-abandoned-on-maintenance-export`: exported recovery payloads contain no pending private resolutions and the audit contains only resolution/operation/map identity plus previous `pending` status. Never restore a public pending summary without its matching private row, and never describe maintenance JSON as resumable.

## Privacy and abuse checks

As the ineligible and unauthenticated users, inspect HTTP responses, SSE live/replay, snapshots, browser state, public logs, and observable errors. Confirm there is no hidden Ability/source identity, suppression reason, target, response owner, option, roll, item/sheet value, read set, continuation, operation plan, or trace. Send malformed shapes, unknown/duplicate IDs, oversized arrays/strings, stale revisions, unissued options, and unauthorized actor/response requests; all must fail within parser/fan-out budgets and make no write.

Operator observability may contain only the closed event label, bounded reason family, duration bucket, and declaration/option/outstanding-window count buckets. A telemetry sink failure must not alter execution. Treat any identity or exact private mechanic value in telemetry as a release blocker.

## Release checks and evidence

Run from a clean dependency install on the release revision:

```sh
npm run check:ability-automation-complete
npm run check:ability-automation-links
npm run check:ability-automation-budgets
npm run typecheck
npm test
npm run build
bash scripts/quality-gate.sh
```

Record command results, test/file totals, build result, deployed/repository revision, prodlike startup/health result, browser-context matrix, console/network errors, restart/recovery result, and any unexecuted production-only observation dependency. A local prodlike pass is release evidence, not a claim that production was deployed or changed.

## Escalation

Preserve a consistent private backup and sanitized reproduction. Record the release revision, map revision, opaque operation identity, generic outcome/reason family, affected runtime hash, and whether HTTP/SSE/replay/status/reconnect each converged. Reproduce against local prodlike. Fix repository app code and let the user deploy through GitHub; do not hot-edit production app code or represent a local-only workspace change as a production fix.
