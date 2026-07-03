# BUILD_TICKETS.md

AUTOMATION_STATUS: NOT_DONE

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Live Play Sprint 1 ticket from `tickets.md`; build ticket numbers follow the suggested sprint order.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#014) may also set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 1 tickets are complete.

---

# Live Play Sprint 1 Tickets

## Sprint goal

Make common live-play table actions feel immediate while preserving the existing server-authoritative model. The first sprint focuses on token movement and facing because those are the highest-frequency LAN-feel interactions and the safest commands to predict locally.

## Non-goals for sprint 1

- Do not replace HTTP/SSE with WebSockets yet.
- Do not weaken server authority, profile validation, revision checks, idempotency, or durable realtime replay.
- Do not optimistically execute complex rule outcomes such as `resolveMove`, capture, shop checkout, inventory transfers, encounter spawn, or random/hidden-information effects.
- Do not remove the durable IndexedDB outbox; reduce its impact on perceived input latency.

## Commit sizing rule

Each ticket should fit in one reviewable commit. If a ticket needs both a refactor and a behavior change, split the refactor into its own follow-up ticket before implementation.

---

## 001 — LP-S1-001 — Add client-side live-play scope conflict utilities

Status: TODO

**Goal:** Give the client the same basic vocabulary as the server for deciding whether two pending commands can safely overlap.

**Primary files:**

- `src/utils/livePlayScopeConflicts.ts` (new)
- `tests/utils/livePlayScopeConflicts.test.ts` (new)

**Work:**

- Add a small client utility that compares `LivePlayScope[]` values.
- Support map lanes, token fields, sheet fields, and terrain cells when the cell can be derived from command payload.
- Keep the implementation conservative: unknown or broad scopes should conflict rather than silently overlap.
- Add unit tests for:
  - different token position scopes do not conflict;
  - same token position scopes conflict;
  - token position and token facing do not conflict;
  - same map lane conflicts;
  - different sheet fields do not conflict;
  - terrain broad scope conflicts with terrain cell scope.

**Acceptance:**

- Tests prove unrelated token commands can be classified as independent.
- The helper has no side effects and does not mutate command bodies.

---

## 002 — LP-S1-002 — Add a pending live-play command model

Status: TODO

**Goal:** Track multiple local live-play operations by `opId` instead of one global `saving` operation.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Add an internal `pendingCommands` ref keyed by `opId`.
- Store `opId`, request path, command type, base revision, scopes, body, and lifecycle state.
- Expose a readonly `pendingCommands` or `pendingCommandCount` from `useLivePlayCommands`.
- Keep existing behavior unchanged for dispatch blocking in this ticket.

**Acceptance:**

- Existing tests continue to pass.
- A dispatched command appears in pending state before send and is removed or terminally marked after accepted/rejected/uncertain handling.
- No UI behavior changes yet.

---

## 003 — LP-S1-003 — Split command transport status from command availability

Status: TODO

**Goal:** Stop using one `status === 'saving'` flag as both network state and table input lock.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/pages/maps/[slug].vue`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Introduce a derived transport/pending status that can show activity without implying all commands are blocked.
- Preserve recovery and reconciliation blockers.
- Leave same-scope commands blocked for now.
- Update map page computed values so `livePlayCommandsAllowed` no longer depends directly on a global `saving` state.

**Acceptance:**

- The page can remain in a command-ready state while at least one unrelated command is pending.
- Recovery gate, reconnect/reconcile gate, and Prepare Map gate still block new commands.
- Status messaging still shows when commands are being sent.

---

## 004 — LP-S1-004 — Replace global in-flight blocking with scope-aware blocking

Status: TODO

**Goal:** Allow unrelated live-play commands to be sent while another command is in flight.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/utils/livePlayScopeConflicts.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- In `runLivePlayCommand`, build the command body before checking same-page pending conflicts.
- Use the new scope conflict helper to reject only commands that overlap with pending local commands.
- Keep stricter blocking for recovery, abandonment, realtime reconciliation, and commands explicitly marked non-concurrent.
- Return a targeted blocked message such as `Another pending command is already changing this token position.`

**Acceptance:**

- Two `moveToken` commands for different placement IDs can be in flight at once.
- Two `moveToken` commands for the same placement ID still conflict.
- `moveToken` and `turnToken` for the same placement may be allowed or blocked according to the helper’s token-field rules, but the behavior is covered by tests.

---

## 005 — LP-S1-005 — Add local prediction patch builders for `moveToken` and `turnToken`

Status: TODO

**Goal:** Build local visual patches for the two fastest token interactions without waiting for the server.

**Primary files:**

- `src/utils/livePlayPredictions.ts` (new)
- `tests/utils/livePlayPredictions.test.ts` (new)

**Work:**

- Add prediction builders for:
  - `moveToken` → token position/facing visual update;
  - `turnToken` → token facing visual update.
- Predictions should be marked as local-only metadata and must not be persisted or sent as authoritative patches.
- Use existing map patch shape where practical so application logic can be reused.
- Keep movement-log, attack-of-opportunity, and other rule side effects out of the prediction.

**Acceptance:**

- Prediction output can be applied to a loaded map and rolled back.
- The helper returns no prediction for unsupported command types.
- Unit tests cover missing placement, stale map, and valid move/turn predictions.

---

## 006 — LP-S1-006 — Add a local prediction overlay store

Status: TODO

**Goal:** Separate authoritative map state from local pending visual state.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/utils/livePlayPredictions.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Store predicted patches per pending `opId`.
- Apply predictions immediately after the command is accepted into the local pending list.
- On local terminal accept, remove the matching prediction after authoritative patches are applied.
- On terminal reject or local failure, remove the prediction and restore the authoritative state for that scope.
- Keep this ticket internal to the composable; UI wiring can follow separately.

**Acceptance:**

- Prediction lifecycle is covered by tests: add, confirm, reject, uncertain.
- A rejected predicted move returns the token to the authoritative position.
- Prediction cleanup is idempotent when SSE and HTTP both report the same operation.

---

## 007 — LP-S1-009 — Treat accepted SSE as first-class local command acknowledgement

Status: TODO

**Goal:** Let realtime confirmation resolve local pending commands even if the matching HTTP response is still in flight.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/composables/useEditableMap.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- When an accepted realtime event has a local `opId`, mark the pending command accepted.
- Remove its prediction after the authoritative patch is applied.
- Ensure later HTTP terminal responses for the same `opId` do not apply the result twice.
- Keep current outbox acknowledgement behavior intact.

**Acceptance:**

- SSE-first acceptance resolves the visible pending state.
- Duplicate HTTP/SSE terminal results are idempotent.
- Remote accepted events still apply normally when `opId` is not local.

---

## 008 — LP-S1-010 — Prefer accepted patches over full-map adoption for hot-path command responses

Status: TODO

**Goal:** Avoid making successful token commands feel like whole-document replacements.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/composables/useEditableMap.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- In accepted terminal response handling, try authoritative patches before `response.map`.
- Use `response.map` only as a fallback when patches are absent or cannot be applied safely.
- Keep snapshot/reconciliation flows unchanged.

**Acceptance:**

- Accepted `moveToken` and `turnToken` responses apply patches without replacing the whole map object.
- Patch application failure still triggers reconciliation or full-map fallback.
- Tests cover responses containing both `patches` and `map`.

---

## 009 — LP-S1-007 — Wire immediate visual prediction for token movement

Status: TODO

**Goal:** A clicked token move should appear on the map immediately in Run Live Play.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/pages/mapPageRouteAuthority.test.ts` or a new focused page/composable test

**Work:**

- Enable the `moveToken` prediction path from the map page.
- Clear selection immediately after a valid local predicted move.
- Keep attack-of-opportunity prompt clearing/provocation gated behind authoritative acceptance.
- Show a non-blocking correction notice if the move is later rejected.

**Acceptance:**

- In live play, moving a controlled token updates its rendered position before HTTP completion.
- If the server rejects the command, the token rolls back and the user sees a concise notice.
- Attack-of-opportunity side effects do not run for rejected predicted movement.

---

## 010 — LP-S1-008 — Wire immediate visual prediction for token facing

Status: TODO

**Goal:** Turning a token should feel instant in Run Live Play.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Enable the `turnToken` prediction path from the map page.
- Clear selection immediately after a valid local predicted turn.
- Roll back facing if the command is rejected.

**Acceptance:**

- Turning a controlled token updates facing before HTTP completion.
- Rejected turns restore the previous authoritative facing.
- Existing setup-edit turn behavior is unchanged.

---

## 011 — LP-S1-011 — Add same-token movement coalescing before send

Status: TODO

**Goal:** Prevent rapid repeated moves for the same token from creating a sluggish queue of obsolete destinations.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- If a same-token `moveToken` command has not been sent yet, replace it with the latest destination instead of sending both.
- If a same-token move is already sending, keep at most one superseding queued move.
- Ensure each sent command still has a stable `opId` and exact body after it leaves the local queue.

**Acceptance:**

- Rapid clicks on the same token visually follow the latest destination.
- The client does not send obsolete unsent destinations.
- Already-sent commands are not mutated after durable outbox claim.

---

## 012 — LP-S1-012 — Add token-level pending/correction UI affordances

Status: TODO

**Goal:** Make prediction honest without making the whole table feel blocked.

**Primary files:**

- `src/pages/maps/[slug].vue`
- relevant map/token presentation component(s)
- `tests/pages/mapPageRouteAuthority.test.ts` or component tests

**Work:**

- Surface a subtle pending state for tokens with local predictions.
- Surface a small correction/rejection notice when a predicted token action rolls back.
- Remove or soften global “Sending live-play command to the server” messaging for ordinary predicted token actions.

**Acceptance:**

- The table remains interactive while one token is pending.
- Users can tell which token is waiting for server confirmation.
- Rejection/correction messaging is visible but non-modal.

---

## 013 — LP-S1-013 — Add regression tests for scoped concurrency

Status: TODO

**Goal:** Lock in the UX contract that unrelated token actions do not block each other.

**Primary files:**

- `tests/composables/map-editor/useLivePlayCommands.test.ts`
- `tests/server/livePlayConcurrentIntegration.test.ts` if needed

**Work:**

- Add composable tests for:
  - token A move and token B move can both dispatch;
  - token A move and token A move conflict or coalesce;
  - token A move can be accepted after token B move advances the map revision;
  - rejection of token A prediction does not revert token B authoritative update.

**Acceptance:**

- Tests fail against the old global `saving` lock.
- Tests pass with scope-aware pending behavior.

---

## 014 — LP-S1-014 — Add a short live-play feel smoke note

Status: TODO

**Goal:** Give maintainers a manual checklist for validating the new feel.

**Primary files:**

- `docs/private-vps-live-play-smoke.md` or `docs/live-play-authority.md`

**Work:**

- Add a short manual test section for the sprint:
  - two clients move different tokens rapidly;
  - one client turns while another moves;
  - rejected movement rolls back visibly;
  - reconnect/reconciliation still pauses commands;
  - recovery panel still handles uncertain commands.

**Acceptance:**

- The checklist is concise and runnable during manual smoke testing.
- It distinguishes “instant local prediction” from “authoritative acceptance.”

---

## Suggested sprint order

1. `LP-S1-001`
2. `LP-S1-002`
3. `LP-S1-003`
4. `LP-S1-004`
5. `LP-S1-005`
6. `LP-S1-006`
7. `LP-S1-009`
8. `LP-S1-010`
9. `LP-S1-007`
10. `LP-S1-008`
11. `LP-S1-011`
12. `LP-S1-012`
13. `LP-S1-013`
14. `LP-S1-014`

## Sprint exit criteria

- Moving and turning controlled tokens in Run Live Play renders immediately on the originating client.
- Independent token commands can overlap without a global page-level input lock.
- Server accepted events remain authoritative and idempotent.
- Rejected predicted token actions roll back only the affected predicted scope.
- Reconnect, replay gap, and durable recovery states still block new commands until safe.
