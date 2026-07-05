# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Live Play Sprint 5 ticket from the sprint planning document; build ticket numbers follow the suggested sprint order from that document.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#017) may also set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 5 tickets are complete.

---

# Live Play Sprint 5 Tickets

## Sprint goal

Make token movement look and feel smooth without weakening the server-authoritative live-play model. Sprint 5 focuses on presentation-layer token motion: intentional easing, path-aware interpolation, better handling of predicted/remote/corrected movement, clearer motion affordances, and reduced-motion support.

Current token rendering already interpolates rendered token centers toward target centers, but that interpolation is generic render-state smoothing. Sprint 5 should turn token relocation into a deliberate movement presentation system with explicit motion tracks, predictable durations, path segments, cancellation/replacement semantics, and tests.

## Non-goals for sprint 5

- Do not change live-play command authority, `opId` idempotency, revision checks, conflict scopes, durable outbox recovery, or authorised realtime replay.
- Do not make animation state authoritative or durable campaign state.
- Do not delay server command dispatch until animation finishes.
- Do not make accepted authoritative state wait for animation before becoming the source of truth.
- Do not reintroduce a global live-play input lock while tokens animate.
- Do not replace HTTP/SSE command transport or Sprint 3 presence transport.
- Do not require new art assets, skeletal animation, or a broad VFX rewrite.
- Do not animate hidden/private token information to unauthorized clients.

## Motion design constraints

- Authoritative map state remains the truth; animation is a visual bridge between previous and current rendered positions.
- Local prediction should animate immediately when a safe token move prediction is applied.
- Remote accepted movement should animate on receiving clients rather than teleporting when practical.
- Rejected/corrected predictions should animate or snap according to a clear correction policy and reduced-motion setting.
- Movement animation must not corrupt token picking, hover, presence attention, pings, targeting overlays, HP bars, shadows, or camera focus.
- Reduced-motion users should get shortened or snapped movement with clear state changes.
- Tests should cover motion math separately from three.js rendering where possible.

## Commit sizing rule

Each ticket should fit in one focused commit. Prefer pure motion-planning utilities plus tests before wiring into the renderer. Do not combine movement-path capture, animation runtime, UX polish, and docs in one commit.

---

## LP-S5-001 — Audit current token movement presentation

Status: DONE

**Goal:** Document how token motion currently flows from command/prediction to rendered position.

**Primary files:**

- `docs/live-play-token-motion.md` (new)
- `src/utils/isometric/tokenRenderState.ts`
- `src/utils/isometric/animationFrame.ts`
- `src/utils/isometric/tokenRenderer.ts`
- `src/components/IsometricGrid.client.vue`

**Work:**

- Document current token movement path: map placement changes, render object `targetCenter`, `currentCenter`, frame stepping, damping, CSS HUD updates, and render continuation.
- Identify where local predicted movement, remote accepted movement, rollback/correction, coalesced movement, and reconnect/reconciliation enter the renderer.
- List motion pain points: teleporting on create/reload, exponential slow tail, no explicit duration, no path segments, no correction semantics, and no reduced-motion policy.
- No behavior changes in this ticket.

**Acceptance:**

- The doc explains the current movement pipeline well enough for later tickets.
- The doc identifies which future tickets change pure utilities vs renderer wiring.

---

## LP-S5-002 — Add pure token motion curve utilities

Status: DONE

**Goal:** Create tested easing and duration helpers for token movement.

**Primary files:**

- `src/utils/isometric/tokenMotionCurves.ts` (new)
- `tests/utils/isometric/tokenMotionCurves.test.ts` (new)

**Work:**

- Add easing helpers for smooth start/stop movement, such as cubic ease-in-out or critically damped progress.
- Add duration helpers based on grid distance, with min/max caps.
- Add reduced-motion duration policy.
- Add helpers for interpolation between 3D center points.
- Keep this pure and independent of three.js objects where practical.

**Acceptance:**

- Tests cover progress at 0, midpoint, and 1.
- Distance-based duration is bounded and deterministic.
- Reduced-motion duration is much shorter or snaps according to policy.

---

## LP-S5-003 — Add token motion track model

Status: DONE

**Goal:** Represent one token movement as an explicit runtime track instead of only a target-center lerp.

**Primary files:**

- `src/utils/isometric/tokenMotionTracks.ts` (new)
- `tests/utils/isometric/tokenMotionTracks.test.ts` (new)

**Work:**

- Define motion track types: token ID, origin center, destination center, start time, duration, reason, and optional path segments.
- Add helpers to start, replace, finish, cancel, and sample a motion track at a frame timestamp.
- Support reasons such as `local-prediction`, `remote-accepted`, `server-correction`, `reconciliation`, and `setup-edit`.
- Keep track state presentation-only and non-serializable.

**Acceptance:**

- Sampling returns origin before start, destination after end, and eased positions during movement.
- Replacing an active track starts from the current sampled position rather than jumping back to the old origin.
- Cancelling a track can snap or return a final sampled position deterministically.

---

## LP-S5-004 — Extend render object state for explicit motion tracks

Status: DONE

**Goal:** Give `PokemonRenderObject` enough runtime state to animate movement intentionally.

**Primary files:**

- `src/utils/isometric/types.ts`
- `src/utils/isometric/tokenRenderer.ts`
- `tests/utils/isometric/tokenRenderer.test.ts`

**Work:**

- Add optional runtime motion-track state to `PokemonRenderObject`.
- Keep existing `currentCenter` and `targetCenter` compatibility while introducing explicit sampled center output.
- Ensure new render objects spawn at their first authoritative center without animating from origin/zero.
- Ensure dispose cleans up any track metadata without leaking resources.

**Acceptance:**

- Existing renderer tests continue to pass.
- New render objects do not animate from invalid positions.
- Motion state is runtime-only and never written to map data.

---

## LP-S5-005 — Replace generic center lerp with explicit motion sampling

Status: DONE

**Goal:** Use motion tracks for token relocation while preserving existing render continuation behavior.

**Primary files:**

- `src/utils/isometric/animationFrame.ts`
- `src/utils/isometric/renderLoop.ts`
- `src/utils/isometric/tokenRenderState.ts`
- tests for animation frame / render state

**Work:**

- Teach animation frame stepping to sample active token motion tracks by `frameNowMs`.
- Continue requesting animation frames while any token motion track is active.
- Retain generic snap/lerp fallback only for tokens without explicit tracks or for compatibility.
- Keep CSS HUD position updates in sync with the sampled token center.

**Acceptance:**

- Token motion completes exactly at or after its planned end time.
- Render continuation remains active while movement is in progress and stops after completion.
- HP bars, elevation badges, shadows, cages, and proxies follow the sampled center.

---

## LP-S5-006 — Start motion tracks when token placements change

Status: DONE

**Goal:** Detect token placement changes and start appropriate motion tracks in the isometric scene.

**Primary files:**

- `src/components/IsometricGrid.client.vue`
- `src/utils/isometric/tokenObjectSync.ts`
- `tests/composables/isometric/useIsometricSceneWatchers.test.ts` or focused sync tests

**Work:**

- Detect when an existing token placement position changes between syncs.
- Start a motion track from the current rendered center to the new target center.
- Do not animate pure sheet/HUD changes such as HP, conditions, or combat stages.
- Do not animate spawn/delete unless later tickets explicitly opt in.

**Acceptance:**

- Existing token movement starts a track instead of teleporting.
- HP/condition-only updates do not start movement tracks.
- New tokens appear at their authoritative center without sliding from another token or origin.

---

## LP-S5-007 — Preserve smoothness for rapid same-token movement replacement

Status: DONE

**Goal:** Make repeated clicks/coalesced move destinations feel continuous rather than stop-start.

**Primary files:**

- `src/utils/isometric/tokenMotionTracks.ts`
- `src/components/IsometricGrid.client.vue`
- `tests/utils/isometric/tokenMotionTracks.test.ts`
- focused page/composable tests if needed

**Work:**

- When a token receives a new target while already moving, replace the track from the current sampled position to the new destination.
- Preserve velocity feel where practical by shortening/lengthening duration based on remaining distance.
- Ensure coalesced same-token moves do not cause a visible snap back to the old authoritative center.

**Acceptance:**

- Rapid movement target changes remain visually continuous.
- Replacement uses sampled current position as the new origin.
- Final rendered position still reaches the latest authoritative/predicted target.

---

## LP-S5-008 — Add path-aware movement tracks for known paths

Status: DONE

**Goal:** Animate along path segments when the client has movement-path information instead of moving in a straight line through obstacles.

**Primary files:**

- `src/utils/isometric/tokenMotionTracks.ts`
- `src/utils/isometric/tokenMovementInteraction.ts` or movement preview utilities
- `src/pages/maps/[slug].vue`
- tests for path track sampling

**Work:**

- Extend track model to accept a list of grid anchors or centers.
- Capture the current movement preview path when the user confirms a move, if available.
- Build segmented motion tracks where each segment duration is proportional to segment distance.
- Fall back to direct motion if the path is unavailable or invalid.

**Acceptance:**

- A multi-cell movement with a known path animates through path waypoints.
- Invalid or missing paths fall back to direct movement.
- Path tracks still finish at the authoritative final position.

---

## LP-S5-009 — Add vertical step and hop affordance for elevation changes

Status: DONE

**Goal:** Make movement across elevation changes readable instead of flat sliding.

**Primary files:**

- `src/utils/isometric/tokenMotionCurves.ts`
- `src/utils/isometric/tokenMotionTracks.ts`
- tests for elevation sampling

**Work:**

- Add an optional small arc/hop component for movement between different cells or elevation changes.
- Keep the arc subtle and deterministic.
- Disable or reduce the arc under reduced-motion policy.
- Ensure shadow projection continues to ground/voxel surface rather than sticking to the lifted sprite.

**Acceptance:**

- Elevation-changing movement has a subtle readable vertical affordance.
- Reduced-motion mode shortens or removes the hop.
- Shadow and HUD remain visually coherent during the hop.

---

## LP-S5-010 — Coordinate facing updates with movement motion

Status: DONE

**Goal:** Prevent facing from popping awkwardly before or after a movement animation.

**Primary files:**

- `src/utils/isometric/tokenMotionTracks.ts`
- `src/utils/isometric/tokenRenderer.ts`
- tests for facing timing

**Work:**

- Define facing timing policy: face movement direction at movement start, final authoritative facing at movement end, or immediate turn for explicit `turnToken` commands.
- Keep explicit turn commands responsive.
- Avoid flipping facing repeatedly during segmented paths unless a clear policy is tested.

**Acceptance:**

- Move-token animations face the travel direction predictably.
- Explicit turn-token commands still update immediately or through a small turn affordance.
- Final facing matches authoritative placement after motion completes.

---

## LP-S5-011 — Add correction and rollback motion policy

Status: DONE

**Goal:** Make rejected/corrected predictions feel understandable rather than jarring.

**Primary files:**

- `src/utils/isometric/tokenMotionTracks.ts`
- `src/composables/map-editor/useLivePlayCommands.ts`
- `src/pages/maps/[slug].vue`
- tests for correction behavior

**Work:**

- Add a server-correction motion reason and duration policy.
- When a predicted move rolls back, animate back briefly if safe; otherwise snap with the existing correction notice.
- If authoritative reconciliation reloads a snapshot, prefer snap/no animation to avoid replaying stale local intent.
- Keep correction notices deduped and non-modal.

**Acceptance:**

- Simple rejected predicted movement can visibly correct back without corrupting authoritative state.
- Reconciliation snapshot adoption does not animate stale predictions over fresh state.
- Reduced-motion users receive a snap or very short correction.

---

## LP-S5-012 — Smooth remote accepted movement separately from local prediction

Status: DONE

**Goal:** Make other players’ accepted moves animate in observers’ browsers while local predictions remain immediate.

**Primary files:**

- `src/composables/useEditableMap.ts`
- `src/components/IsometricGrid.client.vue`
- `src/utils/isometric/tokenMotionTracks.ts`
- tests for local vs remote update classification

**Work:**

- Distinguish local predicted move, local authoritative confirmation, and remote accepted movement where enough context exists.
- Avoid restarting animation when a local predicted move is confirmed at the same final position.
- Start observer motion tracks when remote accepted patches move visible tokens.

**Acceptance:**

- Local predicted token does not stutter when the matching authoritative patch arrives.
- Remote accepted token movement animates smoothly on other clients.
- Duplicate HTTP/SSE terminal delivery does not restart motion.

---

## LP-S5-013 — Respect reduced-motion and performance settings

Status: DONE

**Goal:** Keep smoother movement accessible and performant.

**Primary files:**

- existing movement/reduced-motion settings composables
- `src/components/IsometricGrid.client.vue`
- `src/utils/isometric/tokenMotionCurves.ts`
- tests for reduced-motion behavior

**Work:**

- Connect token motion duration policy to existing reduced-motion settings or add a small token-motion setting if needed.
- Snap or heavily shorten motion when reduced motion is enabled.
- Add a performance safeguard for many simultaneous moving tokens.
- Ensure animation frame continuation does not run indefinitely after tracks complete.

**Acceptance:**

- Reduced-motion mode avoids long smooth movement.
- Many simultaneous token moves do not create unbounded animation work.
- Completed tracks are removed and render continuation stops.

---

## LP-S5-014 — Add token motion metrics to debug tooling

Status: DONE

**Goal:** Let maintainers diagnose motion smoothness and stutter.

**Primary files:**

- `src/components/map/LivePlayLatencyDebugPanel.vue`
- render metrics utilities if appropriate
- tests/components/livePlayLatencyDebugPanel.test.ts

**Work:**

- Add optional debug-only token motion metrics: active moving token count, longest active motion age, completed motion count, and motion source reason counts.
- Keep debug panel hidden unless query flag enables it.
- Do not display private token names if not already visible to the user.

**Acceptance:**

- Debug panel can show token motion state in debug mode.
- No private or hidden token information leaks through metrics.
- Metrics help distinguish command latency from animation polish issues.

---

## LP-S5-015 — Add visual polish for motion start/end

Status: DONE

**Goal:** Give token movement a subtle “alive” feeling without requiring new assets.

**Primary files:**

- `src/utils/isometric/tokenRenderer.ts`
- `src/utils/isometric/tokenMotionTracks.ts`
- renderer tests

**Work:**

- Add subtle scale, shadow, halo, or cage easing at motion start/end.
- Keep effects small enough not to obscure tactical position.
- Disable/shorten polish under reduced-motion policy.
- Ensure contact shadow remains the grounding cue.

**Acceptance:**

- Movement start/end reads smoother in normal mode.
- Reduced-motion mode is restrained.
- Tactical position remains clear throughout the animation.

---

## LP-S5-016 — Add motion regression tests for live-play predictions and batches

Status: DONE

**Goal:** Prove motion polish does not break authoritative state, batch commands, or prediction recovery.

**Primary files:**

- `tests/pages/mapPageRouteAuthority.test.ts`
- `tests/integration/livePlayChaosHardening.test.ts`
- focused motion utility tests

**Work:**

- Test predicted move, accepted confirmation, rejected rollback, remote accepted move, coalesced same-token move, and reconnect/reconciliation snap behavior.
- Include a batch command that changes terrain/hazards while a token is moving to ensure render layers do not interfere.
- Assert final authoritative positions and revisions, not just animation state.

**Acceptance:**

- Motion polish does not change authoritative map state.
- Duplicate terminal delivery does not restart completed motion.
- Batch terrain/hazard updates do not break active token motion.

---

## LP-S5-017 — Add token-motion smoke checklist

Status: TODO

**Goal:** Give maintainers a manual checklist for judging movement feel.

**Primary files:**

- `docs/private-vps-live-play-smoke.md`
- `docs/live-play-token-motion.md`
- `docs/live-play-authority.md` if needed

**Work:**

- Add smoke steps for local predicted movement, remote observed movement, rapid repeated clicks, path movement, elevation changes, rejected rollback, reconnect snap, reduced motion, and batch edits while tokens move.
- Explain that motion is presentation-only and never gameplay authority.
- Include guidance for using the debug panel to separate command latency from animation smoothness.

**Acceptance:**

- Operators can evaluate movement smoothness with GM and two player browsers.
- Docs clearly distinguish animation from authoritative position.

---

## Suggested sprint order

1. `LP-S5-001`
2. `LP-S5-002`
3. `LP-S5-003`
4. `LP-S5-004`
5. `LP-S5-005`
6. `LP-S5-006`
7. `LP-S5-007`
8. `LP-S5-008`
9. `LP-S5-009`
10. `LP-S5-010`
11. `LP-S5-011`
12. `LP-S5-012`
13. `LP-S5-013`
14. `LP-S5-014`
15. `LP-S5-015`
16. `LP-S5-016`
17. `LP-S5-017`

## Sprint exit criteria

- Token moves use explicit presentation motion tracks instead of only generic center lerp.
- Local predicted movement starts immediately and does not stutter when authoritative confirmation arrives.
- Remote accepted movement animates smoothly for observers.
- Rapid repeated same-token destinations replace active motion without visible snapback.
- Known movement paths animate through waypoints when available and fall back safely when unavailable.
- Elevation changes, facing updates, shadows, HUD, pings, presence overlays, and targeting affordances remain visually coherent during motion.
- Rejected predictions and reconciliation snapshots follow a clear correction/snap policy.
- Reduced-motion users get shortened or snapped movement.
- Motion polish does not change authoritative map state, command dispatch, recovery, or conflict behavior.
- Operator docs include a movement-smoothness smoke checklist.
