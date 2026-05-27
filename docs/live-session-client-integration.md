# Live session client integration guide

This guide explains how the current Live session client integration lets local-first map editing and session-authoritative play coexist. It also gives player-safe recovery steps for disconnects, stale state, and command conflicts.

It is not a LAN runbook, named Cloudflare Tunnel runbook, public authentication guide, or deployment hardening checklist. Hosting operations remain separate; this document focuses on what a browser sees after the GM has explicitly enabled session hosting and started or joined a table session. Normal profile-based map play no longer uses a session map attachment step or attach endpoint. For guarded startup helpers, see the [live session host runtime scripts](live-session-host-runtime.md). For remote setup with a stable hostname, see the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md). For the two-player LAN/named-tunnel smoke covering reconnect, token movement, initiative, and conflict rejection, see the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md); for the recorded LAN browser-client smoke, see [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md). For temporary `trycloudflare.com` smoke-test caveats and legacy SSE limitations, see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md).

## Short version

| Browser route or state | Authority model | Transport | Persistence behaviour |
| --- | --- | --- | --- |
| `/maps/<slug>` | Local-first map editor/table view | Legacy local APIs plus `/api/events` SSE for non-session realtime updates | Browser actions can mutate the editable map document and use the existing local autosave/save flows. |
| `/maps/<slug>?session=1` | Legacy session-authoritative table view for a server-owned session map | `WebSocket /api/sessions/socket` after session hello/auth | Browser actions send commands with `opId` and `baseRevision`; accepted server patches update a session map clone and do not autosave whole maps from live clients. |
| `/sessions` | Session-local lobby and identity surface | HTTP session endpoints plus browser-local identity storage | GM/player identity is remembered for reconnect; the cookie hint is non-secret and the GM key/join code are not public auth. |

Open the plain map route for local editing. Open the explicit `?session=1` route when the table is using live session mode. The query flag is intentional so existing local map workflows keep their behaviour unless the user opts into the session view.

## Entry points and identity

1. Start the app with a guarded helper when the GM wants session hosting:

   ```bash
   npm run dev:session:lan
   ```

   For a named Cloudflare Tunnel, use `npm run dev:session:tunnel`; for same-machine-only development, the manual equivalent remains `ROTOM_ENABLE_SESSION_HOST=1 npm run dev`.

2. The GM uses `/sessions#gm-lobby-title` to start or manage a session. The response includes session-local GM identity and a player join code; the page should not expose the GM key in generic page chrome.
3. A player uses `/sessions#player-lobby-title` with the join code and a display name. The server returns a session-local `playerId`, `clientId`, and safe display name.
4. Normal map play happens on `/maps/<slug>` with persistent player-profile links; there is no attach-current-map step for normal play.
5. For legacy session experiments, after players join, the GM uses **Assign map tokens** / **Assign control** for tokens each player should move or act with when a session map is already available.
6. Players use **Visible session maps** from `/sessions` or an explicit `/maps/<slug>?session=1` URL only for legacy session-mode checks.
7. The map navigation panel links to the lobby and can manage current-map token assignments for remembered GM sessions. These links are affordances only; they do not start hosting, join a player, reveal join codes, use session maps, or switch local map routes into session mode by themselves.
8. Use separate browser profiles, containers, or private windows for GM and player testing. Session-local identities are stored per browser profile; using one profile for multiple roles can overwrite the remembered identity.

The existing `/login` GM/player role picker remains a local trust switch for the app shell. It is not public authentication. Live session authority comes from the runtime flag, session-local GM key or player identity, WebSocket hello/auth validation, and server-side permission checks.

## How local mode behaves

Plain `/maps/<slug>` remains the local-first route:

- the route uses the existing editable map state, including `useEditableMap`;
- local token movement, terrain editing, sheet and map controls keep their existing local save/autosave behaviour;
- legacy non-session realtime updates still use `GET /api/events` and `src/composables/useRealtime.ts` for local map/sheet/library sync;
- no session identity, join code, WebSocket hello, session revision, or command acknowledgement is required;
- local-mode whole-map saves are acceptable because they are outside the live Live session concurrency path.

Use local mode for map preparation, private campaign editing, and any workflow where one trusted browser is editing the repository-backed JSON files directly.

## How session mode behaves

`/maps/<slug>?session=1` is the explicit session-authoritative map route. It keeps the renderer and map controls, but changes where live table authority comes from:

- Legacy session mode requires the session snapshot to already include a server-owned session map. The removed attach endpoint is no longer the way normal play publishes saved maps into sessions.
- `src/composables/map-editor/useSessionMap.ts` loads the remembered GM/player session identity, opens the shared session WebSocket, sends a reconnect hello, and requests an authoritative snapshot fallback.
- `src/composables/map-editor/useSessionMapEditorState.ts` keeps a separate session map clone. It may be seeded from the local map for first paint, but that local seed is only a visual starting point; authoritative `snapshot` and `patch` messages replace or update the session clone.
- Applying session patches mutates only that clone; it does not mutate the local autosaved map ref and does not send whole-map saves from live clients.
- A player who has map visibility but no matching token/sheet assignment can observe the selected session map but cannot control that token; GM authority remains available to the GM.
- `src/composables/map-editor/useSessionMoveTokenDispatch.ts` sends selected token movement and facing as `moveToken` and `turnToken` command messages instead of direct local placement writes.
- `src/composables/map-editor/useSessionMapSceneCommands.ts` routes MapScenePanel table actions through command envelopes for token delete/send-out, HP, combat stages, conditions, move/maneuver/ability/order use, initiative, hazards, field effects, and terrain voxel edits.
- The server validates actor identity, permissions, visibility, payload shape, resource scopes, and revision/conflict rules before accepting a command.
- Accepted commands return `commandAck` to the sender and same-session `patch` messages to connected clients. Rejected commands return `commandReject` and do not advance the authoritative revision.

Session mode is therefore not a generic shared-document editor. Browsers request table actions; the GM-hosted server owns the accepted session state.

## Session map readiness checklist

Before a user treats `/maps/<slug>?session=1` as ready for live play, confirm the full chain is true:

- session hosting is enabled with `ROTOM_ENABLE_SESSION_HOST=1` and the session socket can connect;
- the GM has started a live session and the browser has a remembered GM or player session identity;
- the requested session map appears in the authoritative snapshot or a later patch;
- the current actor is allowed to see that session map;
- players who should move or act with a token have a matching assignment from **Assign map tokens**;
- the route has received an authoritative snapshot or patch for the session map, not only a local visual seed.

If any item is false, use the recovery guidance below instead of sending local-first edits or treating stale browser state as authority.

## Optimistic token UX

Token move and turn controls use client-local optimistic overrides so the table feels responsive while waiting for server authority:

1. The browser creates a command with a new `opId`, the latest known `baseRevision`, the actor, and a resource scope such as token position or token facing.
2. If the WebSocket send is queued or accepted by the browser, the view records a temporary position/facing override for rendering and follow-up controls.
3. A matching `commandAck` or same-session `tokenMoved`/`tokenTurned` patch confirms the override at the authoritative revision.
4. A `commandReject` removes the override or reconciles it to safe `currentState.position` / `currentState.facing` from the rejection.

The optimistic layer is deliberately local to the session view. It should not write a movement log, mutate `map.placements` on the local autosaved document, or become authority when the server disagrees.

## Session map UI surfaces

`/maps/<slug>?session=1` renders session-specific surfaces on the map page:

- **Presence panel** — shows safe display names, GM/player liveness, connected player/client counts, current revision, current browser role, and assignment counts. It does not show GM keys, join codes, hidden maps, whole snapshots, or raw assignment payloads.
- **Connection status banner** — shows reconnecting, stale, disconnected, and recovered-snapshot states based on the shared socket/session map state. Its refresh/reconnect actions reuse the explicit snapshot refresh path.
- **Command rejection banner** — turns `invalid`, `unauthorized`, `stale`, and `conflict` command rejections into player-safe titles, details, and guidance. It does not render permission objects, GM keys, join codes, hidden sheet data, or raw current-state payloads.
- **Player access / Assign map tokens** — lets a remembered GM assign or unassign current map token control for joined players once an active session map and lobby summary are available.

These surfaces are informational and recovery-oriented. They do not grant permission and do not replace server validation.

## Recovering from disconnects

Use these steps when the connection status banner reports reconnecting, stale, disconnected, or recovered snapshot state:

| What you see | What it means | Safe recovery |
| --- | --- | --- |
| Host flag disabled | The session endpoints or socket fail closed because the app was not started with the explicit host flag. | Restart the app with `ROTOM_ENABLE_SESSION_HOST=1`, then return to `/sessions` and refresh the remembered identity before reopening the session map. |
| Reconnecting / waiting for snapshot | The WebSocket, hello/auth, or snapshot fallback is still pending. | Wait briefly. If it persists, confirm the dev server is still running with `ROTOM_ENABLE_SESSION_HOST=1`, then use the banner refresh/reconnect action or reload `/maps/<slug>?session=1`. |
| Disconnected socket | The browser is showing the last authoritative state it received, but the session socket is not live. | Do not treat new browser-local edits as authoritative. Reconnect from the banner, reload the session map, or return to `/sessions` to verify the remembered identity. |
| Stale revision / snapshot required | The client cannot safely replay from its last revision or heartbeat activity became stale. | Use the refresh-session action. The client sends a reconnect hello without `lastSeenRevision`, and the server should answer with the current actor-scoped snapshot fallback. |
| Recovered snapshot | The map view rebuilt itself from an authoritative snapshot. | Inspect the current table state before retrying an action; local optimistic changes that were not accepted may be gone. |
| No session map or missing identity | The session snapshot does not include the requested map for this actor, the map is not visible to this player, or the browser has no valid remembered identity. | Return to `/sessions`, rejoin or refresh identity, verify map visibility/assignments, then reopen the explicit session map route. |
| No token assigned | The map is visible, but this player has no controllable token/sheet assignment for the attempted action. | Ask the GM to use **Assign map tokens** for the relevant current map token, refresh or retry from the latest session map state, and do not change the local role picker to bypass session permissions. |

If a browser profile has the wrong role or a stale player identity, use **Forget in this browser** on `/sessions`, then join again. For manual GM/player testing, keep roles in separate browser profiles.

## Recovering from conflicts and rejections

A rejected command did not change authoritative state and did not advance the accepted revision. The rejection banner should explain the safe next step:

| Rejection reason | Common cause | Recovery |
| --- | --- | --- |
| `stale` | Another accepted command changed the same token/resource after this browser built its command. | Refresh the session snapshot, inspect the current token/resource state, then repeat the action from the new table state if it still makes sense. |
| `conflict` | The requested action violates a table rule or current map state, such as occupied movement, blocked terrain, no matching target, or an unavailable move/resource. | Read the player-safe detail, adjust the action, and retry only after checking the current authoritative table state. |
| `unauthorized` | The player is not assigned to control that token/sheet or the action is GM-only. | Ask the GM to change assignments or perform the action. Changing the local `/login` role is not a public-auth bypass and should not grant session authority. |
| `invalid` | The command payload, scope, revision, or identity was malformed or missing. | Refresh the session view. If it repeats, capture the safe error text and report it as a bug without sharing GM keys, join codes, snapshots, or private sheet data. |

For retryable stale/conflict cases, prefer the banner refresh action before retrying. Do not switch to plain `/maps/<slug>` to "fix" a session conflict; the plain route is local-first and can autosave local JSON, but it is not the live session authority.

## Manual verification

Use the local multi-tab smoke helper when validating this client integration path:

```bash
npm run dev:session:lan
npm run smoke:session:multi-tab -- --map <map-slug>
```

The helper opens or prints the GM lobby, player lobby, plain local map route, and explicit session map route. The corresponding [multi-tab smoke checklist](live-session-multi-tab-smoke.md) covers token propagation, rejection/reconnect guidance, local-mode comparison, and cleanup without committing private runtime data. For cross-device same-Wi-Fi setup and troubleshooting, use the [Live session LAN hosting runbook](live-session-lan-hosting.md). For remote players over a stable hostname, use the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md). Do not use Quick Tunnel for campaign play; see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) for the temporary development-only boundary.

The local-mode regression review is recorded in [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md), which cross-checks the plain map/sheet workflows, legacy SSE, local autosave, and explicit `?session=1` opt-in boundary for live-session mode.

Focused automated coverage currently lives in:

- `tests/composables/map-editor/sessionClientIntegration.test.ts` for session snapshot loading, shared socket command dispatch, optimistic acknowledgement/rejection reconciliation, reconnect refresh, and cleanup;
- `tests/composables/map-editor/useSessionMapEditorState.test.ts` for local/session map clone separation and patch adoption;
- `tests/composables/map-editor/useSessionMapSceneCommands.test.ts` for MapScenePanel command construction and fail-closed behaviour;
- `tests/utils/sessionCommandRejectionUi.test.ts`, `tests/utils/sessionConnectionStatusUi.test.ts`, and `tests/utils/sessionPresencePanel.test.ts` for safe UI models;
- `tests/scripts/sessionMultiTabSmoke.test.ts` for the smoke helper command and no-secret checklist content.

## Boundaries and non-goals

- Session clients must not use whole-map autosave as the live concurrency mechanism.
- A local map seed shown before an authoritative snapshot is not command authority; the GM-hosted server-owned session map is authority.
- Session mode does not add accounts, third-party auth, public multi-tenancy, SaaS hosting, cloud persistence, and does not add a database.
- The local role picker is still not public authentication; session identity and server checks are separate session-local safeguards.
- The session view must not expose GM keys, raw join-code secrets outside the lobby, hidden maps, hidden sheets, raw snapshots, tunnel credentials, or private campaign data.
- Map rendering quality and local map functionality should remain unchanged. The session/local state split is additive and guarded by the explicit query flag.

See the [live session protocol](live-session-protocol.md) for protocol contracts, the [Live session socket protocol](live-session-socket-protocol.md) for live transport details, the [Live session table action commands](live-session-table-action-commands.md) for command behaviours, the [live session lobby guide](live-session-lobby.md) for start/join flow, the [Live session LAN hosting runbook](live-session-lan-hosting.md) for same-network hosting, the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) for stable-hostname remote hosting, the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md) for two-player deployment checks, [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md) for the recorded browser-client LAN pass, the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) for temporary smoke-test limits and legacy SSE caveats, and the [Live session multi-tab smoke guide](live-session-multi-tab-smoke.md) for a local browser checklist.
