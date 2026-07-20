# Private VPS live-play smoke checklist

Run this checklist after the normal [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md) when a private trusted-table host is expected to support live play from multiple browsers. Use disposable campaign data or table-approved smoke tokens. Do not record real hostnames, access tokens, player details, screenshots, logs, campaign JSON, SQLite databases, or backup archives in the app repository.

For move-specific pending, restart, correction, backup/export, and privacy recovery, run [Move automation operator recovery and manual QA](move-automation-manual-qa.md) as an extension of this checklist. Keep animation review separate.

`/api/health` only proves that the built Nitro process can answer a simple no-secret request. It is not live-play readiness: the checks below verify the outer access gate, `/api/events` SSE stream, command routes, revision/conflict behavior, reconnect reconciliation, and SQLite persistence together.

## Preconditions

- [ ] The host has passed the deployment smoke checklist, including loopback Node binding, reverse proxy, outer access gate, and Git/private-data hygiene.
- [ ] The same outer access gate protects page loads, `/api/events`, `/api/health`, all `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrade paths that exist now or are added later.
- [ ] Production writes are intentionally enabled with exactly `ROTOM_ENABLE_HOSTED_WRITES=1` if this smoke should persist map or sheet changes.
- [ ] The current private campaign has a player-visible smoke map with at least two controllable tokens linked to two different persistent player profiles, plus a separate GM browser profile.
- [ ] The current private campaign has a hidden or GM-only smoke map available for access-boundary checks, or the operator can temporarily mark the smoke map hidden and restore it afterward.
- [ ] For a real campaign host, the operator created a current `SESSION_TAG=pre-session` or `SESSION_TAG=pre-deploy` backup with the [Private VPS backup runbook](private-vps-backups.md). Disposable throwaway campaigns may skip this only when the entire campaign root can be deleted.

## Backup and rollback checkpoint

- [ ] Confirm the chosen backup archive listing includes `rotom-table.sqlite` when the campaign has been migrated to database-backed live play, plus any `rotom-table.sqlite-wal` and `rotom-table.sqlite-shm` sidecars that existed at backup time.
- [ ] Confirm residual JSON campaign files are in the same backup, including `data/player-profiles/`, encounter tables, and any setup/edit map or sheet JSON kept for inspection, imports, exports, or maintenance.
- [ ] If this smoke follows a deploy, keep the pre-deploy/pre-session archive until the deploy and live-play smoke pass. If the deploy fails, stop the service and follow the backup runbook's [rollback after a bad deploy](private-vps-backups.md#rollback-after-a-bad-deploy) steps instead of continuing to play on questionable state.
- [ ] After a successful smoke on a real campaign, create a `SESSION_TAG=post-session`, `SESSION_TAG=post-smoke`, or `SESSION_TAG=post-deploy` archive so the verified live-play SQLite state can be restored later.

## Browser setup

Use three separate browser profiles, private windows, or devices so cookies and selected profiles do not overlap:

1. GM browser: pass the outer access gate, choose **GM Login**, open the same `/maps/<slug>` smoke map.
2. Player A browser: pass the same gate, choose **Player Login**, select profile A, and open the same map.
3. Player B browser: pass the same gate, choose **Player Login**, select profile B, and open the same map.

Confirm both player browsers can see only player-visible content and can control only their linked tokens.

## Live Play Sprint 1 feel smoke

Use the three browsers above and separate what the acting browser shows immediately from what every browser shows after authoritative server acceptance or rejection.

- [ ] From Player A and Player B, rapidly move two different controlled tokens. Each acting browser shows its own token move immediately as a local prediction with only token-level pending feedback, the other token remains interactive, and all browsers converge on the accepted server positions after HTTP/SSE confirmation.
- [ ] While one client moves a token, have another client turn a different token. The turn appears immediately on the acting browser, does not block the unrelated move, and reaches the other browsers only after authoritative acceptance.
- [ ] Force a disposable movement rejection, such as a stale same-token conflict from another browser. The acting browser may predict first, then visibly rolls back only that token and shows the concise correction notice; unrelated accepted token updates stay in place.
- [ ] Trigger reconnect/reconciliation by disconnecting one browser, changing token state elsewhere, then reconnecting it. Command controls pause until the browser catches up or reconciles; do not treat this pause as failed local prediction.
- [ ] Interrupt a disposable command after it is journaled or sent so the recovery panel shows an uncertain command. Use retry/status or abandonment to resolve the exact `opId` and body, and confirm recovery does not replay presentation-only predictions as authoritative state.

## Live Play Sprint 2 prediction-hardening smoke

Use the same three browsers. If terminal-order timing is hard to see, open only the acting browser with `?debugLivePlayLatency=1`; the panel is operator-only smoke tooling and should not be left open for normal play. Treat immediate token movement, facing, HP HUD, or condition markers on the acting browser as **local prediction**. Treat the same result appearing after a map revision changes, after another browser receives it, or after the recovery panel resolves an `opId` as **authoritative acceptance**. Treat reconnect/gap reloads as **reconciliation**, and the recovery panel as durable **recovery** for exact `opId` bodies rather than as prediction replay.

- [ ] Remote patch rebase: from Player A, start a disposable move or turn for token A and, while it is still pending if possible, move token B from Player B. Player A may keep token A's local prediction visible, token B's authoritative movement should arrive without corrupting token A, and all browsers should converge on the accepted server revision. Repeat with a same-token conflict if practical; the conflicting prediction should roll back or reconcile instead of merging two token A states.
- [ ] SSE-before-HTTP terminal ordering: with the acting browser's latency panel open, use a non-destructive smoke-only delay for the mutating `/api/maps/*` command response while `/api/events` stays connected, or repeat a disposable move/turn until the panel shows SSE terminal before HTTP terminal. Once SSE acceptance is visible, the outbox should clear and the accepted token state should remain stable. A later HTTP accepted response must not apply the patch twice, and a later HTTP rejected response for the same `opId` must not roll back the already accepted state.
- [ ] HTTP-before-SSE terminal ordering: perform a normal disposable move/turn and observe HTTP acceptance before the matching SSE event or replay. The later SSE acknowledgement may clear pending recovery state for the same `opId`, but it should not move the token again, show a second correction notice, or disturb an already-current map revision.
- [ ] Reconnect/gap prediction clearing: start a disposable predicted action from one player browser, then disconnect that browser or block its network long enough for reconnecting/reconciling status. Change token state from another browser while it is offline, then reconnect. The returning browser should reload the authoritative snapshot, clear presentation-only predictions that are no longer safe, and keep only durable uncertain commands in recovery without rolling old prediction rollback patches over the fresh snapshot.
- [ ] Status-check recovery: interrupt a disposable command after it is journaled or sent so the recovery panel shows the exact `opId`. Use status/check rather than creating a new command. An accepted status result should confirm and clear the matching prediction, a rejected status result should roll back only the predicted fields and show the correction path, and an unknown result should leave the durable outbox entry available for later retry/status without duplicating the local prediction.
- [ ] Correction-notice dedupe: force a disposable stale same-token move or delayed duplicate terminal result. The acting browser should show at most one concise non-modal correction for the predicted action, and that notice should dismiss after its lifetime or after the same token receives a new accepted command.
- [ ] Simple HP/condition pending feedback: on a disposable token that supports the HUD affordance, apply a simple HP or condition change. The acting browser may show token-level pending feedback immediately, but cached sheet state and other browsers should change only after authoritative acceptance. A rejection should clear the pending token feedback and use the correction path without writing predicted values into the sheet cache.

## Live Play Sprint 3 presence and table-feel smoke

Presence, pings, remote hover/selection, targeting intent, and GM attention are **ephemeral presentation state**. They should feel live, but they must not change map revisions, create durable replay rows, mutate sheets, grant control, or block normal live-play commands when unavailable.

Use the same three browsers from the setup section. If the acting browser uses `?debugLivePlayLatency=1`, the debug panel may show presence freshness metrics; do not copy private logs or screenshots into the repository.

- [ ] Three-client presence: open the same player-visible smoke map in the GM, Player A, and Player B browsers. The connected-participants panel should show display-safe labels, role/profile hints, tab suffixes, accents, freshness, and high-level intent only. It must not show raw profile IDs, command bodies, sheet data, hostnames, or access-gate details.
- [ ] Token attention: select and hover Player A's visible token from Player A's browser. The GM and Player B browsers should see subtle remote attention on that token. Selecting or hovering the same token elsewhere should still follow existing token-control rules; presence must not lock the token or grant another profile control.
- [ ] Ping: place a smoke ping on a visible map cell from Player A, then from the GM. The ping should appear quickly on all authorized browsers, may include only a short sanitized label, and should expire by itself. Confirm the map revision and durable command history do not change because of the ping.
- [ ] Targeting and measurement intent: start a disposable movement preview, targeting flow, area aim, or measurement from one player browser. Other authorized browsers should see only a low-noise high-level intent summary such as moving, targeting, measuring, source token if visible, safe counts, or public cell/area summary. They must not see hidden move details, private sheet payloads, raw target lists, or command envelopes.
- [ ] GM attention: from the GM browser, request attention for a visible token or cell. Player browsers should show a focus affordance and may choose to focus it, but their cameras should not move automatically unless that client explicitly opted into auto-focus. Attempting the same GM-only attention request from a player browser should be rejected or treated as an ordinary short-lived ping.
- [ ] Hidden-map access: open the hidden or GM-only smoke map in the GM browser and verify GM presence works there. Player A and Player B must not be able to load that map or receive its presence snapshot, transient presence event, ping, intent, or attention request. Returning the players to the visible map should show only visible-map presence.
- [ ] Profile switch cleanup: in one player browser, switch from profile A to profile B or to unprofiled player context, then return to the smoke map. The old profile's presence should disappear after context closure or TTL expiry, and new presence should use only the new context's display-safe label and visible tokens.
- [ ] Reconnect: disconnect or reload one browser while the other two continue to publish presence, pings, or intent. On reconnect, the returning browser should rebuild presence from a fresh snapshot/heartbeat rather than from durable replay history. Authoritative map state should still reconcile through the normal live-play path.
- [ ] Presence transport failure: temporarily block the presence snapshot/heartbeat route or `/api/events` for one browser while leaving command routes reachable. The UI may show delayed presence and stale remote entries should expire, but move/turn/HP/condition commands should remain governed by the existing command/reconciliation blockers, not by presence freshness. Unblock transport and confirm presence resumes without a full map reload when practical.

## Live Play Sprint 4 batch workflow smoke

Sprint 4 batch commands are **authoritative server transactions**, not client-side macros. For every check below, one normal UI intention should create one bounded command body and one `opId` for the relevant batch route unless the explicit oversized-stroke fallback intentionally splits it. The server validates the whole payload, commits all accepted effects in one SQLite transaction, appends durable realtime rows before commit, and publishes the result only after commit. Rejection, stale revision, conflict, invalid payload, or authorization failure must leave authoritative state unchanged.

Use browser developer tools only when practical, and do not copy private request bodies, logs, hostnames, screenshots, profile IDs, or campaign data into the repository. Player browsers should see public map results after acceptance, but recovery/pending UI must show only safe summaries such as counts and command kind.

- [ ] Clear hazards: from the GM browser in **Run Live Play**, place several disposable hazards on a visible smoke map, then use the clear-all hazards menu action. Confirm the UI asks once, sends one `POST /api/maps/hazards/clear` request for the action, shows one concise pending label such as “Clearing 3 hazards…”, and all browsers converge on zero matching hazards after the accepted patch. Player token movement on unrelated scopes should remain available when normal command blockers allow it.
- [ ] Clear field effects: from the GM browser, set disposable weather, terrain, and room effects, then clear weather or clear all field effects from the menu. Confirm the action sends one `POST /api/maps/field-effects/clear` request rather than one remove request per effect, the recovery/pending label names only the category/count, and all browsers converge on the accepted field-effect lane.
- [ ] Terrain brush batch: from the GM browser, draw or erase several terrain cells in one live-play brush stroke. Confirm normal strokes send one `POST /api/maps/terrain/edit` request after the short brush window, show a summary such as “Applying terrain brush (N cells)…”, and update terrain only from authoritative accepted patches/reconciliation. Setup/edit terrain behavior is not part of this live-play check and should remain local setup state.
- [ ] Hazard brush batch: from the GM browser, draw or erase several hazard cells in one live-play brush stroke. Confirm multi-cell strokes send one `POST /api/maps/hazards/edit` request, while a solitary direct click may still use the existing single-cell place/remove command. Presence, ping, targeting, and intent overlays should remain independent and must not become command transport.
- [ ] Oversized brush fallback: if practical on disposable map space, exceed the terrain brush limit of 256 operations or hazard brush limit of 128 operations. The client may split the stroke into multiple bounded batch requests; this is expected and is not a failed “one action” smoke. Each chunk must stay within its limit, preserve ordering, and stop sending later chunks after a rejection or uncertain result. No local authoritative terrain or hazard state should remain mutated without an accepted patch.
- [ ] Batch rejection/access boundary: from Player A or Player B, confirm GM-only batch controls are absent or cannot mutate the map. If using a second GM tab or latency tooling to force a stale/conflicting terrain, hazard, clear-hazard, or field-effect batch, the rejected command should show a concise correction/recovery path and must not partially apply any subset of the payload.
- [ ] Batch retry/status recovery: interrupt a disposable batch after it is journaled or sent, such as by briefly taking the acting GM browser offline after dispatch. The recovery panel should show a safe summary like “Applying hazard brush (5 cells)” or “Clearing 2 weather effects”, not raw cells or private data. Use status/retry to resolve the exact `opId` and body; accepted recovery must not apply the patch twice, rejected recovery must leave authoritative state unchanged, and unknown recovery must keep the durable outbox entry available.
- [ ] Batch reconnect: disconnect one player browser before the GM sends a batch, accept the batch from the GM, then reconnect the player. The returning browser should reconcile from authoritative map state or retained SSE replay and show the same hazards, field effects, and terrain as the GM without replaying presence or local predictions as authority.

## Live Play Sprint 5 token-motion smoothness smoke

Token movement animation is **presentation-only**. Authoritative gameplay state is still the accepted map revision, command terminal result, replay/reconciliation state, and final token placement; do not treat an in-flight animation as permission, denial, distance travelled, or durable state. Use the same GM, Player A, and Player B browsers. If motion feel is hard to diagnose, open only an operator smoke browser with `?debugLivePlayLatency=1`; the panel shows aggregate motion counts/reasons and command timings, not private token names or command payloads.

- [ ] Local predicted movement: from Player A, move a controlled visible token one or more cells. Player A should see the token begin moving immediately as a local prediction, pending feedback should stay token-scoped, and the token should not stutter or restart when the matching authoritative HTTP/SSE confirmation arrives at the same final placement.
- [ ] Remote observed movement: from Player B, move a different controlled visible token while the GM and Player A watch. The observing browsers should animate the accepted remote movement smoothly after the authoritative patch arrives, and all browsers should converge on the same final revision and token position.
- [ ] Rapid repeated same-token movement: from one acting browser, click or choose several legal destinations for the same disposable token in quick succession. The visible token should continue from its sampled in-flight position toward the newest predicted/accepted target without snapping back to the old center; unrelated tokens should remain interactive according to the normal command blockers.
- [ ] Path movement: choose a multi-cell move whose preview path bends around blocking terrain or a tactical obstacle. When the acting client confirms the preview, the token should follow the known waypoints when available; if the path preview is unavailable or invalid, it may fall back to a direct animation but must still finish at the authoritative destination.
- [ ] Elevation change: move a disposable token up or down a visible elevation step. The sprite may show only a subtle hop/step affordance, while the contact shadow remains grounded to the terrain/voxel surface and HP bars, cages, proxies, pings, presence attention, targeting affordances, and camera focus remain visually coherent.
- [ ] Rejected rollback/correction: force a safe disposable rejected move, such as a stale same-token conflict. The acting browser may animate a brief correction back or snap according to the correction policy, should show at most the normal concise correction notice, and must leave the accepted authoritative token state unchanged on every browser.
- [ ] Reconnect/reconciliation snap: disconnect one browser, move tokens from another browser, then reconnect. The returning browser should reconcile from the authoritative snapshot or replay, snap surviving tokens to fresh authoritative centers when needed, and must not replay stale local prediction animation over the reconciled state.
- [ ] Reduced motion: enable the operating-system/browser reduced-motion preference for one smoke browser, then repeat a local move, a remote observed move, and a rollback. Movement should snap or use very short transitions with restrained polish, while final authoritative positions and notices remain clear.
- [ ] Batch edits while moving: while a token is in motion, have the GM perform a disposable Sprint 4 batch action such as terrain or hazard brush/clear. Terrain, hazards, field effects, pings, and presence overlays should update only from accepted authoritative patches and should not cancel, corrupt, or become authority for the token's presentation motion.
- [ ] Debug interpretation: with `?debugLivePlayLatency=1`, compare command latency entries with token-motion metrics. High command latency with normal active-motion ages points to transport/server acceptance timing; fast command terminals with long active-motion ages, many active moving tokens, or unexpected reason counts points to animation/performance polish. Do not copy screenshots, token names, command bodies, profile IDs, hostnames, or logs into the repository.

## Live-play command and revision checks

- [ ] Move Player A's token in Player A's browser. The GM and Player B browsers receive the accepted movement without refreshing, and the moving browser does not rely on whole-map autosave.
- [ ] Move Player A's token and Player B's token at nearly the same time from the two player browsers. Both different-token moves are accepted or reconciled according to the current resource-scope rules, and all browsers converge on the same token positions.
- [ ] Try a same-token conflict by moving the same token from two browsers using stale views or near-simultaneous actions. One action is accepted and the other is rejected or reconciled as a stale/conflicting command; the older browser state must not overwrite the accepted server state.
- [ ] While one player moves a token, have the GM advance initiative. Both changes are accepted when their resource scopes are compatible, or the stale command is rejected with a visible reconciliation path. All browsers should show the same final initiative lane and token positions.
- [ ] Use one sheet-backed command such as HP, conditions, combat stages, or Daily move usage on a disposable token. Confirm the acting browser receives the authoritative result and the other browsers receive the map/sheet update without direct `/api/sheets/save` live-play writes.

## Reconnect and refresh checks

- [ ] Disconnect one player browser from the network, block its connection, or temporarily stop/reload the reverse proxy long enough for the map UI to show reconnecting/reconciling status.
- [ ] While that browser is disconnected, move a different token or advance initiative from another browser.
- [ ] Reconnect the disconnected browser. It should reload/reconcile authoritative map state before allowing more commands; missed SSE events must not be treated as harmless.
- [ ] Refresh both player browsers and the GM browser. Confirm the final map revision state, token positions, initiative state, and relevant sheet-backed values match across all browsers.

## Service restart persistence check

- [ ] Restart the Node service, for example `sudo systemctl restart rotom-table.service`.
- [ ] Confirm the loopback `/api/health` endpoint responds after restart, then reopen the smoke map in all browsers.
- [ ] Confirm the final token positions, initiative state, and sheet-backed live-play values survived the restart through the authoritative repositories.
- [ ] Inspect service logs, for example `journalctl -u rotom-table.service -n 120 --no-pager`, and confirm `/api/events` SSE connect/disconnect logs appear without secrets. Do not commit copied logs.

## Proxy and access-gate checks

- [ ] In browser developer tools, the `/api/events` request remains pending as `text/event-stream` and is not buffered, cached, or redirected after login.
- [ ] The reverse proxy does not cache `/maps/*`, `/api/events`, `/api/maps/*`, `/api/sheets/*`, or accepted command responses.
- [ ] An unauthenticated or off-network browser cannot reach `/login`, `/api/health`, `/api/events`, any `/api/maps/*` command route, or WebSocket upgrade paths before the outer access gate challenges or blocks it.

## Cleanup

Delete disposable smoke data or keep it only in the private campaign store if the table intentionally wants an audit trail. If the smoke modified a real campaign and the table is keeping those changes, take the post-smoke or post-session backup described above before inviting players. Before committing app changes, confirm no smoke data, SQLite databases, WAL sidecars, logs, screenshots, backups, real `.env` files, hostnames, or access-gate exports are staged.

## Related docs

- [Private VPS hosting scope](private-vps-hosting.md)
- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md)
- [Private VPS backup runbook](private-vps-backups.md)
- [Live play authority](live-play-authority.md)
