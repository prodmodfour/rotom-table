# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Live Play Sprint 2 ticket from `sprint-2.md`; build ticket numbers follow the suggested sprint order.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#015) may also set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 2 tickets are complete.

---

# Live Play Sprint 2 Tickets

## Sprint goal

Harden the Sprint 1 local-prediction model so it remains correct under real table pressure: out-of-order HTTP/SSE results, reconnects, remote accepted patches while local predictions are pending, repeated same-token input, and user-visible correction/recovery paths. After that foundation is stable, add narrowly scoped prediction coverage for one more common low-risk action family.

## Non-goals for sprint 2

- Do not replace HTTP/SSE with WebSockets yet.
- Do not weaken server authority, profile validation, revision checks, idempotency, durable outbox recovery, or authorised realtime replay.
- Do not predict complex rule outcomes such as `resolveMove`, capture, shop checkout, encounter spawn, random/hidden-information effects, or move automation side effects.
- Do not make local predictions durable authoritative state. Prediction state remains presentation-only and must be discarded or rebuilt from authoritative state.
- Do not implement broad CRDT/document merging. Conflicts remain tabletop-domain scoped.

## Commit sizing rule

Each ticket should fit in one reviewable commit. Prefer a small helper plus tests over a large cross-cutting behaviour change. If a ticket needs both an API shape change and UI wiring, implement the API shape first and UI wiring in the next ticket.

---

## 001 — LP-S2-001 — Add command lifecycle tracing for live-play dispatch

Status: DONE

**Goal:** Make live-play latency and ordering visible in tests and debug builds without changing user-facing behaviour.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/utils/livePlayCommandTrace.ts` (new)
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Add a small trace model keyed by `opId` with timestamps or sequence counters for: built, predicted, enqueued, claimed, sent, HTTP terminal, SSE terminal, patch adopted, confirmed, rejected, rolled back, uncertain.
- Keep the trace in memory only.
- Expose a readonly debug snapshot from `useLivePlayCommands` for tests and optional dev tooling.
- Avoid logging command bodies or profile-sensitive payloads to the console by default.

**Acceptance:**

- Tests can assert whether HTTP or SSE resolved a command first.
- Tracing records prediction-to-confirm and prediction-to-rollback lifecycle events.
- No production UI changes are required for this ticket.

---

## 002 — LP-S2-002 — Add a focused live-play latency debug panel behind a query flag

Status: DONE

**Goal:** Let maintainers see whether live play feels slow because of client prediction, outbox, HTTP, SSE, patch adoption, or reconciliation.

**Primary files:**

- `src/components/map/LivePlayLatencyDebugPanel.vue` (new)
- `src/pages/maps/[slug].vue`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/pages/mapPageRouteAuthority.test.ts`

**Work:**

- Show the latest small set of command traces only when a debug query flag is present, for example `?debugLivePlayLatency=1`.
- Display durations such as predicted-to-SSE, predicted-to-HTTP, HTTP-to-adopt, SSE-to-adopt, and total pending time.
- Redact command payloads; show only command type, opId suffix, status, and resource summary.

**Acceptance:**

- The panel is hidden by default.
- The panel renders useful timing fields in debug mode.
- No private profile IDs, sheet payloads, or full command bodies are displayed.

---

## 003 — LP-S2-003 — Add prediction conflict detection for incoming authoritative patches

Status: DONE

**Goal:** Detect when a remote authoritative patch touches a resource currently covered by a local prediction.

**Primary files:**

- `src/utils/livePlayPredictionConflicts.ts` (new)
- `src/utils/livePlayScopeConflicts.ts`
- `tests/utils/livePlayPredictionConflicts.test.ts` (new)

**Work:**

- Convert accepted live-play patches into conflict descriptors compatible with the existing client scope conflict helper.
- Compare pending local predictions against incoming accepted patches.
- Return a conflict summary that identifies the local predicted `opId`, placement ID, command type, and conflicting patch type.
- Keep this helper pure and framework-free.

**Acceptance:**

- Remote token-B movement does not conflict with local token-A movement.
- Remote token-A movement conflicts with local token-A movement.
- Remote token-A facing conflicts with local token-A facing but not token-A position when fields differ.
- Broad map-lane or unknown patch conflicts conservatively.

---

## 004 — LP-S2-004 — Add an authoritative patch adoption hook around local predictions

Status: DONE

**Goal:** Give the map page a safe place to roll back/reapply predictions when authoritative patches arrive.

**Primary files:**

- `src/composables/useEditableMap.ts`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/useEditableMap.test.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Add optional hooks around accepted patch application, for example `beforeLivePlayPatchesApply` and `afterLivePlayPatchesApply`, or an equivalent single adoption coordinator.
- Pass enough information to inspect map slug, previous revision, next revision, patches, and local pending predictions.
- Do not change default behaviour when hooks are absent.
- Ensure hooks are not called for setup/edit whole-map events.

**Acceptance:**

- Existing realtime patch tests still pass without hooks.
- Tests can observe the hook call order around patch application.
- Hook failures request authoritative reconciliation rather than leaving mixed prediction/authoritative state.

---

## 005 — LP-S2-005 — Rebase non-conflicting predictions after remote accepted patches

Status: DONE

**Goal:** Preserve the immediate local feel while still applying other clients’ authoritative updates in order.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/composables/useEditableMap.ts`
- `src/utils/livePlayPredictionConflicts.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Before applying a remote accepted patch, temporarily roll back local predictions that are currently applied.
- Apply the authoritative patch to the clean authoritative map state.
- Reapply non-conflicting pending predictions over the new map revision when safe.
- For conflicting predictions, roll back and show the existing correction/rejection path or request reconciliation.

**Acceptance:**

- Local predicted token A remains visually predicted after remote accepted token B movement applies.
- Remote accepted token A movement cancels or corrects the local token A prediction instead of merging two positions.
- The final map revision remains the authoritative server revision, not a prediction revision.
- Reapplying predictions is idempotent when duplicate SSE/HTTP terminal results arrive.

---

## 006 — LP-S2-006 — Harden stale HTTP terminal responses after SSE-first adoption

Status: DONE

**Goal:** Prevent a later HTTP response from overwriting or rolling back state already confirmed by realtime.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- When SSE has already acknowledged an `opId`, classify the later HTTP response as duplicate presentation data.
- Ignore older accepted HTTP response maps/patches if the local map revision has already advanced beyond them.
- Preserve outbox cleanup and user-facing accepted state.
- Ensure a late HTTP rejection cannot roll back a command already accepted by SSE for the same `opId`.

**Acceptance:**

- SSE accepted then HTTP accepted does not apply patches twice.
- SSE accepted then HTTP rejected keeps the accepted state and records the HTTP response as ignored/stale.
- SSE accepted then lost HTTP response still resolves as recovered, not uncertain.

---

## 007 — LP-S2-007 — Harden HTTP-first then SSE replay ordering

Status: DONE

**Goal:** Ensure replayed or delayed SSE events do not disturb state already adopted from a trusted HTTP terminal response.

**Primary files:**

- `src/composables/useEditableMap.ts`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/useEditableMap.test.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Confirm that already-current or older accepted SSE revisions still acknowledge local outbox entries when appropriate.
- Do not reapply patches when map revision is already at or beyond the event revision.
- Keep `opId` acknowledgement and recovery cleanup working even when patch application is skipped as stale.

**Acceptance:**

- HTTP accepted first, then matching SSE, leaves map state unchanged and outbox empty.
- Replayed stale SSE for a non-local command is ignored without entering reconciliation.
- A matching local stale SSE can still clear pending recovery state for the same `opId`.

---

## 008 — LP-S2-008 — Add pending prediction reconciliation on reconnect/gap recovery

Status: DONE

**Goal:** Avoid replaying presentation-only predictions after the client has to reload the authoritative live table snapshot.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/composables/useEditableMap.ts`
- `src/pages/maps/[slug].vue`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- When realtime enters reconnecting/reconciling/gap recovery, clear or suspend local predictions.
- After authoritative snapshot reload completes, keep only pending commands that are still durable outbox entries and require explicit retry/status resolution.
- Ensure cleared predictions do not roll back the freshly loaded authoritative snapshot.

**Acceptance:**

- A predicted token move disappears or resolves cleanly when a gap forces snapshot reload.
- Recovery panel still shows uncertain durable commands by `opId`.
- Fresh authoritative snapshot state is not overwritten by old rollback patches.

---

## 009 — LP-S2-009 — Add command-status awareness for pending predictions

Status: DONE

**Goal:** Let status checks resolve pending predictions without resending commands.

**Primary files:**

- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- When a status check returns accepted, adopt the authoritative result and clear the matching prediction.
- When a status check returns rejected, roll back the matching prediction and show the correction path.
- When a status check returns unknown, leave the durable outbox entry intact but avoid duplicating local predictions.

**Acceptance:**

- Accepted status response confirms a pending predicted token move.
- Rejected status response rolls back only that token’s predicted fields.
- Unknown status response does not apply, duplicate, or roll back prediction state unexpectedly.

---

## 010 — LP-S2-010 — Add prediction-safe same-token movement queue tests for revision changes

Status: TODO

**Goal:** Lock down same-token coalescing when remote operations advance the map revision between the first move and the queued superseding move.

**Primary files:**

- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Add tests where the first same-token move is accepted at revision N+1, then the queued superseding move is rebuilt from the latest map revision before send.
- Add tests where a remote non-conflicting patch advances the map revision while a superseding move is queued.
- Add tests where the first move rejects and the queued superseding move is cancelled without mutating the authoritative map.

**Acceptance:**

- Queued superseding move uses the current map revision when it is actually sent.
- Obsolete unsent move bodies are never sent.
- A rejected first move does not leak the queued prediction.

---

## 011 — LP-S2-013 — Add prediction-aware correction notice lifetime and deduping

Status: TODO

**Goal:** Keep correction feedback helpful without creating noisy repeated banners.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `src/components/map/MapScenePanel.vue`
- `tests/pages/mapPageRouteAuthority.test.ts`

**Work:**

- Auto-dismiss correction notices after a short duration or when the same token receives a new accepted command.
- Deduplicate repeated correction notices for the same `opId`.
- Keep stale-revision rejections on the existing stronger reconciliation/error path.

**Acceptance:**

- A predicted move rejection shows one non-modal correction notice.
- Duplicate HTTP/SSE rejection handling does not show duplicate notices.
- The notice clears after timeout or next accepted action for that token.

---

## 012 — LP-S2-011 — Predict simple HP edits for local token HUD only

Status: TODO

**Goal:** Extend prediction coverage to one common low-risk sheet-backed action without pretending sheet state is authoritative.

**Primary files:**

- `src/utils/livePlayPredictions.ts`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `tests/utils/livePlayPredictions.test.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts`

**Work:**

- Add prediction support for `modifyHp` limited to token HUD-facing map state, such as temporary HP overlays if already represented on the map.
- Do not mutate cached Pokémon/trainer sheet documents as prediction.
- Roll back on rejection and confirm on authoritative sheet/map update.
- Keep this behind a narrow helper path so unsupported sheet fields are ignored.

**Acceptance:**

- A local HP edit can show immediate pending token HUD feedback when the current UI supports it.
- Authoritative sheet updates remain the source of truth.
- Rejection clears the pending HUD prediction without changing sheet cache.

---

## 013 — LP-S2-012 — Predict simple condition edits as token-level pending feedback

Status: TODO

**Goal:** Make condition changes feel responsive without inventing authoritative sheet state locally.

**Primary files:**

- `src/utils/livePlayPredictions.ts`
- `src/composables/map-editor/useLivePlayCommands.ts`
- relevant token HUD/presentation components
- `tests/utils/livePlayPredictions.test.ts`

**Work:**

- Add local pending-condition metadata for `modifyConditions` commands.
- Display pending feedback on the affected token while the authoritative sheet update is in flight.
- Do not write predicted conditions into the live sheet cache.
- Roll back or clear pending metadata on terminal response.

**Acceptance:**

- Condition dialog actions provide immediate visible pending feedback on the token.
- Accepted authoritative updates replace the pending state.
- Rejected condition commands clear pending feedback and show a correction/rejection notice.

---

## 014 — LP-S2-014 — Add live-play prediction chaos tests

Status: TODO

**Goal:** Exercise prediction, scoped concurrency, and recovery under realistic out-of-order conditions.

**Primary files:**

- `tests/integration/livePlayChaosHarness.ts`
- `tests/integration/livePlayChaosHardening.test.ts` or a new focused prediction chaos test

**Work:**

- Extend the chaos harness with client prediction states where possible.
- Simulate two clients moving different tokens, same-token stale conflicts, SSE-before-HTTP, HTTP-before-SSE, reconnect/gap reconciliation, and uncertain outbox recovery.
- Assert final authoritative map state, not just individual command responses.

**Acceptance:**

- The chaos test fails if local prediction rollback overwrites unrelated accepted remote state.
- The chaos test fails if duplicate terminal delivery applies state twice.
- The chaos test passes with deterministic final map revisions and token positions.

---

## 015 — LP-S2-015 — Add operator smoke notes for prediction hardening

Status: TODO

**Goal:** Update the manual smoke checklist for the new Sprint 2 edge cases.

**Primary files:**

- `docs/private-vps-live-play-smoke.md`
- `docs/live-play-authority.md` if the authority notes need a short prediction-hardening paragraph

**Work:**

- Add a Sprint 2 section covering remote patch rebase, out-of-order terminal responses, reconnect prediction clearing, status-check resolution, and correction-notice deduping.
- Keep the checklist runnable by one GM and two player browsers.
- Avoid implementation details that would become stale quickly.

**Acceptance:**

- The smoke checklist explicitly distinguishes local prediction, authoritative acceptance, reconciliation, and recovery.
- Operators have concrete steps for SSE-before-HTTP and reconnect/gap scenarios.

---

## Suggested sprint order

1. `LP-S2-001`
2. `LP-S2-002`
3. `LP-S2-003`
4. `LP-S2-004`
5. `LP-S2-005`
6. `LP-S2-006`
7. `LP-S2-007`
8. `LP-S2-008`
9. `LP-S2-009`
10. `LP-S2-010`
11. `LP-S2-013`
12. `LP-S2-011`
13. `LP-S2-012`
14. `LP-S2-014`
15. `LP-S2-015`

## Sprint exit criteria

- Remote accepted patches can arrive while local predictions are pending without corrupting either resource.
- SSE-first and HTTP-first terminal delivery are both idempotent.
- Reconnect/gap recovery clears presentation-only predictions and preserves durable outbox recovery.
- Same-token coalesced moves rebuild from current authoritative revision before send.
- At least one additional low-risk action family has safe local pending feedback beyond move/turn.
- Maintainers can inspect command lifecycle timings in debug mode without exposing private command payloads.
