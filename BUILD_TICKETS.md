# BUILD_TICKETS.md

AUTOMATION_STATUS: NOT_DONE

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Live Play Sprint 3 ticket from `sprint-3.md`; build ticket numbers follow the suggested sprint order.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#018) may also set `AUTOMATION_STATUS: DONE` after all Live Play Sprint 3 tickets are complete.

---

# Live Play Sprint 3 Tickets

## Sprint goal

Make live play feel like people are sharing a LAN tabletop, not just sending fast commands. Sprint 3 adds ephemeral presence, token attention, map pings, and shared intent cues while preserving the Sprint 1–2 server-authoritative command model.

Presence and intent state is **not** gameplay authority. It is short-lived presentation state used to show who is here, what token they are looking at, what they are targeting, and where they want attention. Authoritative gameplay mutations continue to use explicit live-play commands, durable outbox recovery, revision checks, authorised realtime replay, and server-side validation.

## Non-goals for sprint 3

- Do not replace authoritative HTTP live-play command routes with WebSockets.
- Do not make presence, pings, hover, selection, target previews, or camera focus durable campaign state.
- Do not let presence state grant token control, bypass profile validation, or alter command authorisation.
- Do not store private profile payloads, sheet data, command bodies, access-gate data, hostnames, or secrets in presence events.
- Do not make local presence failure block normal gameplay commands.
- Do not build broad voice/video/chat features.
- Do not implement batch workflows yet; that should be a later sprint after presence/table-feel work lands.

## Transport choice for sprint 3

Use the existing authenticated app/API boundary and the existing `/api/events` realtime surface where practical. Presence events may be transient, unsequenced, and non-durable, with an HTTP snapshot/heartbeat fallback so gameplay still works when presence delivery drops. Do not send authoritative gameplay commands through the presence transport.

## Commit sizing rule

Each ticket should fit in one focused commit. If a ticket needs both server transport and UI rendering, split the transport first and wire UI in the next ticket. Tests should prove privacy/access and non-authoritative behaviour before visual polish expands.

---

## 001 — LP-S3-001 — Add shared live-presence contract

Status: DONE

**Goal:** Define a safe, minimal, ephemeral presence vocabulary shared by server, client, and tests.

**Primary files:**

- `shared/livePlayPresence.ts` (new)
- `tests/shared/livePlayPresence.test.ts` (new)

**Work:**

- Add schema constants and parsers for map presence payloads.
- Model these concepts:
  - connected user summary;
  - selected token ID;
  - hovered token ID;
  - active intent kind, such as `idle`, `moving-token`, `targeting`, `measuring`, `placing-ping`, or `viewing-sheet`;
  - optional map ping payload;
  - monotonic client presence timestamp or sequence.
- Redact identity to display-safe fields only: role, optional selected profile display name if already safe to show, client ID suffix, and stable visual accent.
- Make the parser reject command bodies, sheet payloads, arbitrary records, excessive strings, and unknown durable-state fields.

**Acceptance:**

- Presence payloads round-trip through strict parsers.
- Unknown or over-large fields are rejected or dropped according to parser rules.
- The contract explicitly distinguishes ephemeral presence from authoritative live-play commands.

---

## 002 — LP-S3-002 — Add server-side ephemeral map presence registry

Status: DONE

**Goal:** Track short-lived map presence in memory without writing to SQLite or campaign files.

**Primary files:**

- `server/livePlay/presenceRegistry.ts` (new)
- `tests/server/livePlayPresenceRegistry.test.ts` (new)

**Work:**

- Add an in-memory registry keyed by map slug and realtime principal context.
- Store sanitized presence state with TTL expiry.
- Add update, list, remove, and prune operations.
- Ensure registry entries never include full command bodies, sheet documents, private profile data, or secrets.
- Keep the registry process-local; multi-process delivery can degrade gracefully in this sprint.

**Acceptance:**

- Presence entries expire after TTL.
- Updating presence refreshes the TTL.
- Listing a map returns only non-expired sanitized entries.
- No SQLite writes occur in registry tests.

---

## 003 — LP-S3-003 — Add presence access checks and snapshot route

Status: DONE

**Goal:** Let clients fetch a safe current presence snapshot only for maps they can view.

**Primary files:**

- `server/api/maps/[slug]/presence.get.ts` (new or equivalent route)
- `server/livePlay/presenceAccess.ts` (new)
- `tests/server/livePlayPresenceApi.test.ts` (new)

**Work:**

- Add a read-only presence snapshot endpoint for a map.
- Reuse existing role/profile/map visibility checks where possible.
- Return only presence entries visible to the caller.
- Reject hidden map access for players.
- Include cache-control headers that prevent browser/proxy caching.

**Acceptance:**

- GM can read presence for visible maps they can access.
- Profiled player can read presence only for player-visible maps.
- Hidden maps do not leak presence to players.
- Response contains no durable map/sheet data beyond safe presence summaries.

---

## 004 — LP-S3-004 — Add presence heartbeat/update route

Status: DONE

**Goal:** Let clients publish their current ephemeral presence state without creating authoritative game mutations.

**Primary files:**

- `server/api/maps/[slug]/presence.post.ts` (new or equivalent route)
- `server/livePlay/presenceRegistry.ts`
- `tests/server/livePlayPresenceApi.test.ts`

**Work:**

- Accept sanitized presence updates from authorised map viewers.
- Attach server-observed role/profile context rather than trusting client identity fields.
- Clamp or reject invalid token IDs, pings, intent strings, and timestamps.
- Return the current sanitized snapshot after update.
- Do not append durable realtime rows and do not mutate map/sheet documents.

**Acceptance:**

- A heartbeat creates or refreshes an ephemeral entry.
- A malformed heartbeat is rejected without mutating presence.
- Client-supplied role/profile identity is ignored or rejected.
- No live-play command result or map revision changes are produced.

---

## 005 — LP-S3-005 — Broadcast transient presence updates over realtime

Status: DONE

**Goal:** Make presence feel live without making it durable replay history.

**Primary files:**

- existing `/api/events` server implementation or realtime broadcaster utilities
- `shared/livePlayPresence.ts`
- `tests/server/livePlayPresenceRealtime.test.ts` (new)

**Work:**

- Add a transient, unsequenced realtime event for map presence snapshots or deltas.
- Deliver it only to currently connected principals authorised for that map.
- Do not store transient presence in the durable realtime event log.
- Keep HTTP snapshot polling as a fallback for missed transient events.

**Acceptance:**

- Connected authorised clients receive presence updates without waiting for durable replay.
- Reconnecting clients rebuild presence from snapshot/heartbeat, not replay history.
- Durable realtime sequence numbers are not advanced by presence updates.
- Hidden maps do not leak transient presence to unauthorised players.

---

## 006 — LP-S3-006 — Add client composable for map presence

Status: DONE

**Goal:** Give map pages a single client-side presence API for heartbeat, snapshots, transient updates, TTL expiry, and graceful failure.

**Primary files:**

- `src/composables/map-editor/useMapPresence.ts` (new)
- `tests/composables/map-editor/useMapPresence.test.ts` (new)

**Work:**

- Load the initial snapshot from the presence snapshot route.
- Send periodic heartbeat/update requests while the map page is active.
- Subscribe to transient presence events from the realtime channel.
- Locally expire stale entries when heartbeats stop.
- Expose readonly presence entries, own presence state, error state, and transport freshness.
- Pause or reduce heartbeats when the tab is hidden.

**Acceptance:**

- Presence snapshot loads on mount.
- Heartbeats update local own-presence state.
- Transient updates refresh remote entries.
- Presence errors do not block live-play command dispatch.

---

## 007 — LP-S3-007 — Render connected table participants

Status: DONE

**Goal:** Show who is currently around the map without crowding gameplay controls.

**Primary files:**

- `src/components/map/MapPresencePanel.vue` (new)
- `src/pages/maps/[slug].vue`
- `tests/components/mapPresencePanel.test.ts` (new)

**Work:**

- Render a compact list of active participants.
- Show display-safe label, role/profile hint, accent, freshness state, and current high-level intent.
- Collapse gracefully on narrow screens.
- Hide or soften stale entries before expiry.

**Acceptance:**

- The panel renders zero, one, and multiple participants.
- It never displays raw profile IDs, command bodies, or sheet data.
- Stale/fresh state is visually distinguishable but non-blocking.

---

## 008 — LP-S3-008 — Publish local token selection and hover presence

Status: DONE

**Goal:** Let other clients see which token someone is looking at or controlling without changing authority rules.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `src/components/IsometricGrid.client.vue`
- `src/composables/map-editor/useMapPresence.ts`
- tests for page/composable wiring

**Work:**

- Publish selected token ID and hovered token ID as presence state.
- Clear token-specific presence when selection/hover leaves, map changes, or profile access changes.
- Only publish token IDs that exist on the currently loaded map and are visible to the current user.
- Do not block another user from selecting the same token unless existing command/control rules already do.

**Acceptance:**

- Selecting or hovering a token updates own presence.
- Clearing selection clears own selected-token presence.
- Invalid or no-longer-visible token IDs are not published.
- Existing token-control permissions are unchanged.

---

## 009 — LP-S3-009 — Render remote token attention affordances

Status: DONE

**Goal:** Make remote selection/hover visible on tokens in the isometric scene.

**Primary files:**

- `src/components/map/MapSceneRenderer.vue`
- `src/components/IsometricGrid.client.vue`
- `src/utils/isometric/tokenRenderer.ts`
- `tests/pages/mapPageRouteAuthority.test.ts` or focused component tests

**Work:**

- Pass remote selected/hovered token IDs plus display-safe accents into the renderer.
- Add subtle token ring, outline, badge, or hover cage style for remote attention.
- Support multiple users on the same token without excessive visual noise.
- Keep local selected/pending/correction styling higher priority where needed.

**Acceptance:**

- Remote attention renders for selected/hovered tokens.
- Local pending/correction indicators remain legible.
- Removing remote presence removes the visual affordance.

---

## 010 — LP-S3-010 — Add ephemeral map pings

Status: DONE

**Goal:** Let players and GMs quickly point at a map location without creating campaign state.

**Primary files:**

- `shared/livePlayPresence.ts`
- `src/composables/map-editor/useMapPresence.ts`
- `src/components/IsometricGrid.client.vue`
- `tests/composables/map-editor/useMapPresence.test.ts`

**Work:**

- Add a ping action to presence state with map cell, optional short label, creator summary, and expiry.
- Add a keyboard/mouse gesture or simple UI hook to place a ping on a visible map cell.
- Broadcast ping through the presence update path.
- Locally expire pings without requiring server acknowledgement after expiry.

**Acceptance:**

- A ping appears on the acting client and remote clients.
- Pings expire automatically.
- Ping payloads cannot contain arbitrary text beyond a short sanitized label.
- Pings do not change map revision or durable realtime history.

---

## 011 — LP-S3-011 — Render pings in the isometric scene

Status: DONE

**Goal:** Make pings obvious, short-lived, and non-disruptive.

**Primary files:**

- `src/utils/isometric/pingRenderer.ts` (new)
- `src/components/IsometricGrid.client.vue`
- `tests/components` or utility tests where practical

**Work:**

- Add a lightweight ping renderer for grid-cell pings.
- Animate or fade pings based on local expiry time.
- Keep pings independent from token selection, movement preview, move VFX, and build/hazard previews.
- Dispose ping rendering resources cleanly.

**Acceptance:**

- Pings render at the expected grid cell.
- Expired pings are removed and resources are disposed.
- Pings do not interfere with token picking or build/hazard targeting.

---

## 012 — LP-S3-012 — Publish targeting and measurement intent

Status: DONE

**Goal:** Help other players understand what someone is doing before an authoritative command exists.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `src/composables/map-editor/useMapPresence.ts`
- move automation / movement preview wiring tests

**Work:**

- Publish high-level intent when a user is:
  - previewing token movement;
  - targeting a move, ability, order, maneuver, or pokéball;
  - aiming an area template;
  - placing terrain/hazards in live play if controls allow it.
- Keep payloads descriptive but small: intent kind, source token ID when visible, candidate/target count when safe, and optional map cell/area summary.
- Do not publish hidden move details or sheet payloads that the viewer should not know.

**Acceptance:**

- Starting targeting updates presence intent.
- Cancelling or completing targeting clears intent.
- Hidden/private sheet details are not exposed through presence.

---

## 013 — LP-S3-013 — Render shared intent overlays

Status: TODO

**Goal:** Show remote movement/targeting/area intent in a low-noise way.

**Primary files:**

- `src/components/map/MapScenePanel.vue`
- `src/components/IsometricGrid.client.vue`
- relevant isometric overlay utilities
- focused component/page tests

**Work:**

- Display remote movement or targeting intent as text badges, reticles, or soft overlays.
- Avoid rendering exact hidden target lists when not safe.
- Prioritize current user interaction over remote intent overlays.
- Hide remote intent when stale, cancelled, or superseded.

**Acceptance:**

- Remote targeting intent is visible enough for table coordination.
- Local targeting remains usable and visually dominant.
- Hidden/private details are not rendered.

---

## 014 — LP-S3-014 — Add optional GM attention request

Status: TODO

**Goal:** Let the GM ask everyone to look at a token or map cell without forcing disruptive camera movement by default.

**Primary files:**

- `shared/livePlayPresence.ts`
- `src/pages/maps/[slug].vue`
- `src/components/map/MapPresencePanel.vue`
- `src/components/IsometricGrid.client.vue`
- tests for access and UI behavior

**Work:**

- Add a GM-only attention ping/focus request presence payload.
- Render an affordance for clients to focus the referenced token/cell.
- Do not automatically move a player camera unless a user preference explicitly allows it.
- Reject player attempts to publish GM-only attention requests.

**Acceptance:**

- GM can publish an attention request.
- Players see a focus affordance but are not forced by default.
- Player-authored GM attention payloads are rejected or downgraded to ordinary pings.

---

## 015 — LP-S3-015 — Add presence privacy and access regression tests

Status: TODO

**Goal:** Prove presence cannot leak hidden-map or profile-restricted information.

**Primary files:**

- `tests/server/livePlayPresenceApi.test.ts`
- `tests/composables/map-editor/useMapPresence.test.ts`
- any realtime/presence transport tests added earlier

**Work:**

- Test hidden map presence access for GM, profiled player, and unprofiled player.
- Test that profile changes stop old-context presence and start new-context presence.
- Test that inaccessible token IDs are dropped from outgoing presence.
- Test that presence snapshots/transient events do not include sheet payloads, command bodies, raw profile IDs, or private map data.

**Acceptance:**

- Hidden-map presence never reaches unauthorised players.
- Profile switches do not leave stale old-profile presence visible forever.
- Presence snapshots are safe to display to authorised map viewers.

---

## 016 — LP-S3-016 — Add presence failure and degradation tests

Status: TODO

**Goal:** Ensure presence improves feel but never becomes a gameplay dependency.

**Primary files:**

- `tests/composables/map-editor/useMapPresence.test.ts`
- `tests/pages/mapPageRouteAuthority.test.ts`
- `tests/integration/livePlayChaosHardening.test.ts` if useful

**Work:**

- Simulate snapshot failure, heartbeat failure, transient event loss, and tab visibility changes.
- Verify live-play command dispatch remains governed by existing command/reconciliation blockers, not presence transport.
- Show a small non-blocking presence status only if useful.
- Confirm stale presence expires locally.

**Acceptance:**

- Presence failure does not block move/turn/HP/condition commands.
- Stale remote presence disappears after TTL.
- Recovered presence resumes without requiring a full map reload.

---

## 017 — LP-S3-017 — Add presence metrics to the latency debug panel

Status: TODO

**Goal:** Let maintainers diagnose table-feel issues separately from command latency.

**Primary files:**

- `src/components/map/LivePlayLatencyDebugPanel.vue`
- `src/composables/map-editor/useMapPresence.ts`
- `tests/components/livePlayLatencyDebugPanel.test.ts`

**Work:**

- Add optional presence freshness metrics to the debug panel when presence data is available.
- Show heartbeat age, last snapshot age, last transient update age, and active participant count.
- Keep command trace payload redaction unchanged.

**Acceptance:**

- Debug panel still hides by default.
- Presence metrics appear only in debug mode.
- Metrics do not expose private profile IDs or presence payload internals.

---

## 018 — LP-S3-018 — Update live-play authority docs for ephemeral presence

Status: TODO

**Goal:** Document the boundary between authoritative commands and ephemeral table-feel state.

**Primary files:**

- `docs/live-play-authority.md`
- `docs/private-vps-live-play-smoke.md`

**Work:**

- Add a short authority section for presence, pings, remote hover/selection, intent, and GM attention.
- State that presence is process-local or short-lived, non-durable, and never gameplay authority.
- Add smoke checklist items for three-client presence, pings, intent, hidden-map access, reconnect, and presence transport failure.

**Acceptance:**

- Docs clearly distinguish authoritative live-play commands from ephemeral presence.
- Operators have manual smoke steps for Sprint 3 table-feel features.

---

## Suggested sprint order

1. `LP-S3-001`
2. `LP-S3-002`
3. `LP-S3-003`
4. `LP-S3-004`
5. `LP-S3-005`
6. `LP-S3-006`
7. `LP-S3-007`
8. `LP-S3-008`
9. `LP-S3-009`
10. `LP-S3-010`
11. `LP-S3-011`
12. `LP-S3-012`
13. `LP-S3-013`
14. `LP-S3-014`
15. `LP-S3-015`
16. `LP-S3-016`
17. `LP-S3-017`
18. `LP-S3-018`

## Sprint exit criteria

- Multiple clients on the same map can see display-safe active participant presence.
- Remote token selection/hover/attention is visible without changing token-control authority.
- Players and GMs can place short-lived map pings that never mutate authoritative map state.
- Targeting and movement intent is visible enough to coordinate turns but does not expose hidden/private sheet information.
- GM attention requests are available without forcing disruptive camera motion by default.
- Presence failure degrades gracefully and never blocks authoritative live-play commands.
- Hidden maps and profile-restricted contexts do not leak presence, pings, or intent to unauthorised players.
- Operator docs cover presence, pings, intent, reconnect, failure, and the non-authoritative boundary.
