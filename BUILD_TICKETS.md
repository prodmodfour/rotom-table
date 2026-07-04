# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Live Play Sprint 4 ticket from `sprint-4.md`; build ticket numbers follow the suggested sprint order.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#019) may also set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 4 tickets are complete.

---

# Live Play Sprint 4 Tickets

## Sprint goal

Turn common multi-click live-play workflows into single server-authoritative batch commands. Sprint 1 made hot actions immediate, Sprint 2 made prediction safe, and Sprint 3 made the table feel inhabited. Sprint 4 should reduce the remaining “do the same command 12 times” friction: clearing hazards, clearing field effects, placing/removing terrain or hazards in small groups, applying area-cleanup actions, and presenting batch progress honestly.

The rule for this sprint is: **one user intention should become one authoritative transaction whenever the UI presents it as one action.** Batch commands still use explicit server-authoritative validation, `opId` idempotency, revision checks, conflict scopes, authorised realtime replay, durable outbox recovery, and accepted patches.

## Non-goals for sprint 4

- Do not replace HTTP/SSE command transport or presence transport.
- Do not make clients authoritative for batched changes.
- Do not use whole-map saves for live-play batch workflows.
- Do not introduce broad CRDT/document merging.
- Do not batch hidden-information or random-result workflows unless the server already resolves the authoritative result deterministically.
- Do not make local prediction cover complex batch side effects in this sprint.
- Do not remove existing single-item commands; keep them as primitives and compatibility paths.
- Do not build a general-purpose scripting engine for arbitrary command lists.

## Batch design constraints

- Every batch command must have a bounded payload size.
- Every accepted batch command must commit all effects in one SQLite transaction or reject without partial authoritative writes.
- Every accepted batch command must append durable realtime rows before commit and publish only after commit.
- Every batch result must be idempotent by `opId`; retrying the exact same body returns the stored terminal result without duplicating effects.
- Batch patches should describe changed resources precisely enough for clients to reconcile without full-map replacement when practical.
- If a batch would touch hidden, unauthorised, stale, invalid, or conflicting resources, prefer rejecting the batch with a clear reason over applying a partial subset.

## Commit sizing rule

Each ticket should fit in one focused commit. Avoid mixing command-contract, server executor, client dispatch, UI wiring, and docs in one ticket unless the change is tiny. Prefer narrow batch commands over a generic arbitrary-command batch.

---

## 001 — LP-S4-001 — Audit current sequential live-play workflows

Status: DONE

**Goal:** Identify the live-play UI flows that still dispatch many individual commands for one user intention.

**Primary files:**

- `docs/live-play-batch-workflows.md` (new)
- `src/pages/maps/[slug].vue`
- relevant map-editor composables

**Work:**

- Document current sequential workflows, including clear hazards, clear field effects, repeated terrain edits, repeated hazard edits, initiative/scene cleanup, and any action automation loops.
- For each workflow, record current command route(s), authority scope, likely conflict scopes, expected patch shape, and whether local prediction is safe.
- Classify each candidate as Sprint 4, later, or not worth batching.

**Acceptance:**

- The doc lists the highest-value batch candidates and explains why the first batch commands were chosen.
- No behavior changes are made in this ticket.
- Future tickets can reference this document for scope and non-goal decisions.

---

## 002 — LP-S4-002 — Add shared batch command guardrails

Status: DONE

**Goal:** Add reusable shared constants and validation helpers for bounded live-play batch payloads.

**Primary files:**

- `shared/livePlayBatchCommands.ts` (new)
- `shared/livePlayCommands.ts`
- `tests/shared/livePlayBatchCommands.test.ts` (new)

**Work:**

- Add shared maximums for batch payload sizes, such as max hazard cells, max terrain voxels, max field-effect operations, and max affected token IDs.
- Add helper validators for non-empty unique grid cells and bounded arrays.
- Add parser helpers that produce clear validation issues without accepting unknown durable-state fields.
- Keep helpers framework-free and side-effect free.

**Acceptance:**

- Invalid oversized batch payloads are rejected by shared validation tests.
- Duplicate cells are normalized or rejected according to documented rules.
- Validators do not mutate input payloads.

---

## 003 — LP-S4-003 — Add `clearHazards` live-play command contract

Status: DONE

**Goal:** Define a first real batch command for clearing hazards in one authoritative operation.

**Primary files:**

- `shared/livePlayCommands.ts`
- `shared/livePlayBatchCommands.ts`
- `tests/shared/livePlayCommands.test.ts` or existing shared command tests

**Work:**

- Add `CLEAR_HAZARDS` command type and payload.
- Support modes such as:
  - clear all hazards visible in the active map;
  - clear hazards by explicit cells;
  - optionally clear by hazard kind.
- Add conflict scopes for the map hazard lane and, where useful, explicit hazard cells.
- Add accepted patch type or reuse existing map-hazard patch shape if it can describe the final authoritative hazards list safely.

**Acceptance:**

- Command payload validation covers all/explicit/kind modes.
- Empty explicit-cell batches reject with a clear validation issue.
- Scope construction is conservative for all-hazard mode and precise for explicit-cell mode.

---

## 004 — LP-S4-004 — Implement server executor for `clearHazards`

Status: TODO

**Goal:** Clear many hazards in one SQLite transaction with one idempotent live-play operation result.

**Primary files:**

- `server/livePlay/commandExecutor.ts`
- `server/livePlay/sqliteCommandExecutor.ts`
- `server/useCases/applyMapTokenAction.ts` or relevant map mutation use case
- `tests/server/livePlayIntegrationHarness.ts`
- `tests/server/livePlayConcurrentIntegration.test.ts`

**Work:**

- Validate GM/profile permissions using the same authority rules as existing hazard commands.
- Apply the clear operation atomically.
- Reject stale or conflicting base revisions using existing live-play conflict logic.
- Return accepted patches that update hazards without whole-map replacement when possible.
- Store/reuse terminal result by `opId`.

**Acceptance:**

- Clearing all hazards removes every matching hazard in one accepted command.
- Retrying the same `opId` does not remove anything twice or append duplicate events.
- Stale/conflicting commands reject without partial writes.

---

## 005 — LP-S4-005 — Add API route and client result validation for `clearHazards`

Status: TODO

**Goal:** Expose the clear-hazards batch through the same durable command pipeline as other live-play map commands.

**Primary files:**

- `server/api/maps/[slug]/hazards/clear.post.ts` or equivalent route
- `src/utils/apiRoutes.ts`
- `shared/livePlayCommandResults.ts`
- route tests

**Work:**

- Add a route constant and server endpoint.
- Validate request body using the shared command contract.
- Ensure terminal responses validate against the submitted command body.
- Add operation-status support if needed by existing generic status route.

**Acceptance:**

- Route rejects invalid or oversized clear-hazard payloads.
- Route accepts valid command bodies and returns terminal live-play command results.
- Result validation catches mismatched `opId`, map slug, command type, or scopes.

---

## 006 — LP-S4-006 — Wire `clearHazards` into `useLivePlayCommands`

Status: TODO

**Goal:** Let the map page dispatch clear-hazard batches through the durable outbox.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/utils/apiRoutes.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Add a `clearHazards` dispatcher.
- Build command bodies with stable `opId`, base revision, scopes, and bounded payload.
- Reuse patch-first accepted-response handling and existing recovery/status behavior.
- Do not add local prediction yet beyond existing pending/correction affordances.

**Acceptance:**

- `clearHazards` enqueues, claims, sends, accepts, rejects, retries, and status-checks like existing commands.
- Scope-aware blocking prevents conflicting hazard commands while allowing unrelated token actions.
- Tests cover accepted, rejected, uncertain, and duplicate terminal responses.

---

## 007 — LP-S4-007 — Replace clear-all hazards UI loop with `clearHazards`

Status: TODO

**Goal:** Make the existing “clear all hazards” user action send one command instead of many.

**Primary files:**

- `src/pages/maps/[slug].vue`
- relevant hazard/menu components
- `tests/pages/mapPageRouteAuthority.test.ts`

**Work:**

- Replace the live-play loop that dispatches one `removeHazard` per hazard with one `clearHazards` command.
- Keep setup/edit behavior unchanged.
- Preserve confirmation copy and cancellation behavior.
- Show a single pending/sending state for the batch action.

**Acceptance:**

- Clearing all hazards in live play makes exactly one command request.
- Setup/edit still mutates local setup state as before.
- Rejection leaves hazards unchanged or reconciled authoritatively.

---

## 008 — LP-S4-008 — Add `clearFieldEffects` live-play command contract

Status: TODO

**Goal:** Define a batch command for clearing weather, terrain, room, or all field effects in one operation.

**Primary files:**

- `shared/livePlayCommands.ts`
- `shared/livePlayBatchCommands.ts`
- shared command tests

**Work:**

- Add `CLEAR_FIELD_EFFECTS` command type and payload.
- Support category modes: weather, terrain, room, and all.
- Support optional explicit effect kinds when safe.
- Add conservative map field-effect scopes.
- Define accepted patch expectations.

**Acceptance:**

- Category-only and explicit-kind payloads validate.
- Empty explicit-kind lists reject.
- Scope construction conflicts with other field-effect mutations but not unrelated token movement.

---

## 009 — LP-S4-009 — Implement server/API/client flow for `clearFieldEffects`

Status: TODO

**Goal:** Add end-to-end authoritative support for clearing field effects as a batch command.

**Primary files:**

- server command executor files
- route file and `src/utils/apiRoutes.ts`
- `src/composables/map-editor/useLivePlayCommands.ts`
- tests across server and composable layers

**Work:**

- Implement server validation and atomic mutation.
- Add route and result validation.
- Add client dispatcher and outbox support.
- Prefer accepted patches over full-map fallback.

**Acceptance:**

- Clearing all or one category of field effects is one accepted command.
- Retry/status/abandonment works using the exact command body and `opId`.
- Rejected stale/conflicting commands do not partially clear effects.

---

## 010 — LP-S4-010 — Replace clear-all field effects UI with `clearFieldEffects`

Status: TODO

**Goal:** Make clear-all field effects feel like one authoritative action.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `tests/pages/mapPageRouteAuthority.test.ts`

**Work:**

- Wire existing clear-all weather/terrain/room menu action to the new batch command.
- Keep existing single-effect set/remove commands unchanged.
- Reset local coexist UI flags only after accepted dispatch where appropriate.

**Acceptance:**

- Live-play clear-all field effects sends one command request.
- Setup/edit behavior remains local and unchanged.
- Rejection preserves or reconciles the authoritative field-effect state.

---

## 011 — LP-S4-011 — Add `editTerrainVoxels` batch command contract

Status: TODO

**Goal:** Define a bounded batch command for adding/removing many terrain voxels in one operation.

**Primary files:**

- `shared/livePlayCommands.ts`
- `shared/livePlayBatchCommands.ts`
- shared command tests

**Work:**

- Add a command type such as `EDIT_TERRAIN_VOXELS`.
- Support operations for add/update voxels and remove cells.
- Bound payload size and reject duplicate contradictory operations in the same payload.
- Define terrain scopes: explicit cells when small, broad terrain lane when required.
- Define patch payload for changed terrain or final terrain set.

**Acceptance:**

- Mixed add/remove payloads validate only when non-contradictory.
- Oversized terrain batches reject.
- Scope conflict behavior is conservative and tested.

---

## 012 — LP-S4-012 — Implement server/API/client flow for terrain voxel batches

Status: TODO

**Goal:** Let terrain brush-like live-play edits commit in one authoritative operation.

**Primary files:**

- server executor and route files
- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/utils/apiRoutes.ts`
- server/composable tests

**Work:**

- Validate every voxel/cell against map bounds and permission rules.
- Commit the batch atomically.
- Return patches that let clients update terrain without full-map adoption when possible.
- Ensure idempotent retry and conflict rejection work.

**Acceptance:**

- Valid terrain batches apply atomically.
- Invalid cell or stale revision rejects the whole batch.
- Retry with same `opId` returns the same terminal result.

---

## 013 — LP-S4-013 — Add terrain brush batching on the client

Status: TODO

**Goal:** Coalesce rapid terrain brush edits into bounded batch commands without losing authority safety.

**Primary files:**

- terrain builder composables
- `src/pages/maps/[slug].vue`
- `src/composables/map-editor/useLivePlayCommands.ts`
- focused tests

**Work:**

- Collect rapid live-play terrain edits for a short debounce window or until pointer release.
- Send one `editTerrainVoxels` command per brush stroke.
- Keep setup/edit terrain behavior unchanged.
- Do not locally predict complex terrain changes unless existing UI already has a safe preview-only layer.

**Acceptance:**

- A brush stroke sends one bounded command rather than one command per voxel.
- Very large strokes split into bounded chunks or reject with clear UI copy.
- Rejection does not leave local authoritative terrain mutated.

---

## 014 — LP-S4-014 — Add `editHazards` batch command contract

Status: TODO

**Goal:** Define a bounded batch command for placing/removing multiple hazard cells.

**Primary files:**

- `shared/livePlayCommands.ts`
- `shared/livePlayBatchCommands.ts`
- shared command tests

**Work:**

- Add a command type such as `EDIT_HAZARDS`.
- Support add/update hazard cells and remove hazard cells.
- Bound payload size and reject contradictory operations.
- Define hazard scopes and accepted patch behavior.

**Acceptance:**

- Mixed hazard add/remove payloads validate only when non-contradictory.
- Oversized hazard batches reject.
- Scope conflicts with clear-hazards and single hazard commands are tested.

---

## 015 — LP-S4-015 — Implement server/API/client flow for hazard cell batches

Status: TODO

**Goal:** Let hazard brush-like live-play edits commit in one authoritative operation.

**Primary files:**

- server executor and route files
- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/utils/apiRoutes.ts`
- server/composable tests

**Work:**

- Validate hazard kind, bounds, permissions, and stale revisions.
- Commit the batch atomically.
- Return patches that update hazards without full-map adoption when practical.
- Reuse idempotency and conflict logic.

**Acceptance:**

- Valid hazard batches apply atomically.
- Invalid hazard cell rejects the whole batch.
- Retry/status/abandonment works with exact `opId` body.

---

## 016 — LP-S4-016 — Add hazard brush batching on the client

Status: TODO

**Goal:** Coalesce rapid hazard drawing/removal into bounded batch commands.

**Primary files:**

- hazard builder composables
- `src/pages/maps/[slug].vue`
- focused tests

**Work:**

- Collect live-play hazard brush edits for a short debounce window or pointer stroke.
- Send one `editHazards` command per stroke.
- Keep setup/edit hazard behavior unchanged.
- Preserve existing single-cell hazard commands for direct clicks when batching is not active.

**Acceptance:**

- A live-play hazard brush stroke sends one bounded command.
- Large strokes split or reject safely.
- Presence/intent overlays remain independent from authoritative hazard batching.

---

## 017 — LP-S4-017 — Add batch operation pending/recovery UI affordances

Status: TODO

**Goal:** Make batch commands honest to users without reintroducing a global table lock.

**Primary files:**

- `src/pages/maps/[slug].vue`
- map panel/menu components
- `src/components/map/LivePlayCommandRecoveryPanel.vue` if needed
- tests/pages or component tests

**Work:**

- Show a concise pending label for active batch commands, such as “Clearing 12 hazards…” or “Applying terrain brush…”.
- Keep unrelated token actions interactive when scopes allow them.
- Ensure uncertain batch commands appear in the recovery panel with clear summaries.
- Avoid listing full payloads or private data.

**Acceptance:**

- Users can tell a batch command is pending.
- Recovery entries identify batch kind and resource summary safely.
- Unrelated commands remain available when conflict scopes allow.

---

## 018 — LP-S4-018 — Add batch command chaos tests

Status: TODO

**Goal:** Exercise batch workflows against concurrency, stale revisions, duplicate terminals, and recovery.

**Primary files:**

- `tests/integration/livePlayChaosHardening.test.ts`
- `tests/integration/livePlayChaosHarness.ts`

**Work:**

- Simulate clear hazards racing with single hazard edit.
- Simulate terrain batch racing with token movement on unrelated scopes.
- Simulate HTTP/SSE terminal ordering for an accepted batch.
- Simulate lost HTTP response and status/retry recovery for a batch command.
- Assert final authoritative map state and durable realtime convergence.

**Acceptance:**

- Batch commands do not partially apply under conflicts.
- Duplicate accepted terminals do not apply effects twice.
- Recovered uncertain batch commands converge to the same final state as direct acceptance.

---

## 019 — LP-S4-019 — Add operator smoke notes for live-play batch workflows

Status: TODO

**Goal:** Give maintainers a manual checklist for verifying batch workflow UX and authority.

**Primary files:**

- `docs/private-vps-live-play-smoke.md`
- `docs/live-play-authority.md`
- `docs/live-play-batch-workflows.md`

**Work:**

- Add smoke steps for clear hazards, clear field effects, terrain brush, hazard brush, rejection, retry/status, and reconnect.
- Document that batch commands are authoritative transactions, not client-side macros.
- Document payload bounds and expected fallback behavior for oversized brush strokes.

**Acceptance:**

- Operators can smoke test batch workflows with GM and two player browsers.
- Docs explain why one UI action should map to one authoritative batch command.

---

## Suggested sprint order

1. `LP-S4-001`
2. `LP-S4-002`
3. `LP-S4-003`
4. `LP-S4-004`
5. `LP-S4-005`
6. `LP-S4-006`
7. `LP-S4-007`
8. `LP-S4-008`
9. `LP-S4-009`
10. `LP-S4-010`
11. `LP-S4-011`
12. `LP-S4-012`
13. `LP-S4-013`
14. `LP-S4-014`
15. `LP-S4-015`
16. `LP-S4-016`
17. `LP-S4-017`
18. `LP-S4-018`
19. `LP-S4-019`

## Sprint exit criteria

- Clear-all hazards uses one authoritative live-play batch command.
- Clear-all field effects uses one authoritative live-play batch command.
- Terrain brush edits can be committed as bounded authoritative batches.
- Hazard brush edits can be committed as bounded authoritative batches.
- Batch commands are idempotent by `opId`, recoverable through the durable outbox, and safe under HTTP/SSE terminal reordering.
- Batch payloads have documented and tested bounds.
- Batch commands reject stale/conflicting/invalid payloads without partial authoritative writes.
- UI shows batch pending/recovery state without blocking unrelated scoped commands.
- Operator docs cover manual smoke testing and the authority boundary for batch workflows.
