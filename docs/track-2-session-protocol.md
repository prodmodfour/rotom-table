# Track 2 session protocol

This document describes the shared TypeScript protocol contracts introduced for Track 2 session mode. It records the wire vocabulary that later server and client tickets must use when they add the session store, WebSocket endpoint, lobby UI, command handlers, and reconnect behaviour.

This is a contract document, not a claim that every command handler is already complete. The current shared contracts live in `shared/` and are covered by focused Vitest tests; the `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, and `sendOutPokemon` payload contracts and validators live in `shared/sessionTokenCommands.ts`, `modifyHp`, `modifyCombatStages`, `modifyConditions`, `useMove`, `useManeuver`, `useAbility`, and `useOrder` live in `shared/sessionTableActionCommands.ts`, GM-only `setInitiative`, `nextInitiative`, and `previousInitiative` live in `shared/sessionInitiativeCommands.ts`, GM-only `placeHazard`/`removeHazard` live in `shared/sessionHazardCommands.ts`, GM-only `setFieldEffect`, `removeFieldEffect`, and `tickFieldEffectDurations` live in `shared/sessionFieldEffectCommands.ts`, and GM-only `buildTerrainVoxel`/`removeTerrainVoxel` live in `shared/sessionTerrainCommands.ts`. `server/useCases/applyMoveTokenCommand.ts` now applies authorized token movement to server-owned map state with occupancy/rules validation, stale same-token rejection with current token state, revision increments, snapshot persistence, duplicate-`opId` handling, a sender `commandAck`/`commandReject`, and a same-session `tokenMoved` patch broadcast over `/api/sessions/socket`. `server/useCases/applyTurnTokenCommand.ts` applies authorized token facing changes with same-resource stale checks, snapshot persistence, duplicate-`opId` handling, and same-session `tokenTurned` patch broadcast. `server/useCases/applySpawnTokenCommand.ts` and `server/useCases/applyDeleteTokenCommand.ts` apply GM-only token placement creation/removal, persist authoritative snapshots, reject player actors, and broadcast same-session `tokenSpawned`/`tokenDeleted` patches without whole-map saves. `server/useCases/applySendOutPokemonCommand.ts` lets the GM or a player assigned to the trainer token send out a Pokémon from that trainer's current team, validates throw range/occupancy from authoritative map state, persists the spawned placement, and broadcasts a same-session `pokemonSentOut` patch. `server/useCases/applyModifyHpCommand.ts` lets the GM or assigned token/sheet controllers update HP and Injuries for a placed sheet, advances the session/map revision, persists the sheet plus session snapshot with rollback on snapshot failure, rejects stale same-resource HP changes, and broadcasts a same-session `hpModified` patch without whole-map or whole-sheet fanout. `server/useCases/applyModifyCombatStagesCommand.ts` applies GM or assigned token/sheet combat-stage updates with the same server-authoritative revision, sheet persistence, rollback, stale-resource rejection, and same-session `combatStagesModified` patch boundary. `server/useCases/applyModifyConditionsCommand.ts` applies GM or assigned token/sheet add/remove/replace condition updates, persists the sheet and session snapshot with rollback, rejects stale same-resource condition changes, and broadcasts a same-session `conditionsModified` patch boundary. `server/useCases/applyUseMoveCommand.ts` records move use through the session command boundary, applies EOT/Scene frequency usage to authoritative map state, applies Daily usage to the sheet file with rollback on snapshot failure, accepts untracked frequencies as ordered session events, rejects unavailable or stale same-resource move usage, and broadcasts a small same-session `moveUsed` patch without whole-map or whole-sheet fanout. `server/useCases/applyUseTableActionCommand.ts` records maneuver, ability, and order usage through the same server-authoritative command boundary, enforces GM-or-assigned-token/sheet permissions, appends authoritative maneuver/ability/order metadata and active-order effects, persists sheet ability/automation updates with rollback, rejects stale same-action resources, and broadcasts small `maneuverUsed`/`abilityUsed`/`orderUsed` patches without whole-map or whole-sheet fanout. `server/useCases/applyInitiativeCommand.ts` applies GM-only initiative score, active-turn, round, next-turn, and previous-turn changes to the authoritative map initiative lane, advances the session/map revision, persists a snapshot with rollback, rejects player actors and stale initiative-lane changes, and broadcasts a same-session `initiativeUpdated` patch without whole-map fanout. `server/useCases/applyHazardCommand.ts` applies GM-only hazard placement/removal to authoritative map hazards, advances the session/map revision, persists a snapshot with rollback, rejects player actors, no-op/out-of-bounds/stale hazard-lane changes, and broadcasts a same-session `hazardsUpdated` patch without whole-map fanout. `server/useCases/applyFieldEffectCommand.ts` applies GM-only Weather, Terrain field-effect, and Room changes plus finite-duration ticks to authoritative map field effects, advances the session/map revision, persists a snapshot with rollback, rejects player actors, no-op/stale field-effect-lane changes, and broadcasts a same-session `fieldEffectsUpdated` patch without whole-map fanout. `server/useCases/applyTerrainCommand.ts` applies GM-only terrain voxel build/remove changes to authoritative map voxels, preserves Track 1 terrain-builder material/default-colour and renderer invalidation expectations, advances the session/map revision, persists a snapshot with rollback, rejects player actors, out-of-bounds/occupied/no-op/stale same-cell changes, allows tracked disjoint cells across small revision gaps, and broadcasts a same-session `terrainVoxelsUpdated` patch without whole-map fanout. The map view can dispatch selected token movement and facing changes as commands in explicit session mode and apply client-local optimistic visual overrides that are confirmed by acks/patches or rolled back/reconciled from command rejections without autosaving the whole map. `src/composables/map-editor/useSessionMapSceneCommands.ts` now routes MapScenePanel-originated session events for token delete/send-out, HP, combat-stage, condition, move usage, maneuver, ability, order, next/previous initiative, hazard placement/removal, move-created field effects, and terrain voxel edits through the same session WebSocket command dispatcher; without the explicit session query flag those controls continue to call the existing local-first map/sheet handlers. See [Track 2 WebSocket protocol](track-2-websocket-protocol.md) for the live socket route, message examples, heartbeat/reconnect flow, command transport boundary, and named-tunnel expectations after the WebSocket transport chunk. See [Track 2 table action commands](track-2-table-action-commands.md) for the supported chunk 06 command inventory, permission matrix, conflict rules, patch events, and current limitations. See [Track 2 client integration](track-2-client-integration.md) for the local/session map mode boundary, optimistic UX, and user recovery guidance. See [Track 2 session lobby and manual QA](track-2-session-lobby.md) for the current GM/player join flow and two-browser smoke checklist, and [Track 2 session storage](track-2-session-storage.md) for the operational snapshot/event-log layout, backup guidance, and recovery limitations.

## Protocol goals

Track 2 session mode uses one GM-hosted server as the authority for live table state. Browsers send explicit commands and receive server acknowledgements, rejections, snapshots, patches, presence, heartbeat, and reconnect responses.

The protocol must preserve these locked decisions:

- session hosting is explicitly enabled by a runtime safety flag before session endpoints or sockets are available;
- WebSockets carry live session messages;
- clients do not autosave whole maps as the live concurrency mechanism;
- commands carry `opId` and `baseRevision` values so the server can provide idempotency and stale/conflict decisions;
- identity is session-local: GM key, join code, player ID, client ID, safe display name, and GM-managed assignments;
- state stays local-first through authoritative JSON snapshots and optional event logs, not a hosted database.

## Shared contract modules

| Module | Contract area | Notes |
| --- | --- | --- |
| `shared/sessionIdentity.ts` | `SessionId`, `PlayerId`, `ClientId`, `JoinCode`, `GmKey`, safe display names | Runtime wire values are strings. TypeScript brands prevent accidental mixing in app code. |
| `shared/sessionClientIdentity.ts` | Browser-persisted session-local GM/player identity records plus non-secret cookie hints | Local storage can remember the full session-local identity for reconnect; the cookie hint deliberately excludes GM keys and join codes. |
| `shared/sessionPermissions.ts` | GM/player actors, visible and controllable resources, assignments, permission results | Players can only view visible resources and control assigned visible resources. GM authority is broader but still validated. |
| `shared/sessionRevisions.ts` | monotonic `Revision`, `SessionRevision`, `MapRevision` helpers | Wire revisions are safe non-negative integers. Accepted commands advance revisions; rejections and duplicates do not. |
| `shared/sessionCommands.ts` | command envelope, `opId`, `baseRevision`, scope lanes, metadata | The common command wrapper is shared before individual command payloads are implemented. |
| `shared/sessionCommandValidation.ts` | common envelope validator | Validates schema, IDs, actor shape, revisions, scopes, metadata, and payload presence. Command-specific payload validation is intentionally separate. |
| `shared/sessionTokenCommands.ts` | token command payload contracts and validators | Defines the `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, and `sendOutPokemon` payloads; token-position/token-facing/token-spawn/token-delete/trainer-send-out scope helpers; grid-position/facing/placement/send-out validation; player/GM token-control checks for move/turn/send-out; and GM-only permission checks for spawn/delete handlers. |
| `shared/sessionTableActionCommands.ts` | table action command payload contracts and validators | Defines the `modifyHp`, `modifyCombatStages`, `modifyConditions`, `useMove`, `useManeuver`, `useAbility`, and `useOrder` payloads, token/sheet scope helpers, safe integer HP/Injury, -6..+6 combat-stage, condition add/remove/replace validation, move/maneuver/ability/order name validation, optional target token validation, and GM-or-assigned-token/sheet permission checks for table action changes. |
| `shared/sessionInitiativeCommands.ts` | initiative command payload contracts and validators | Defines GM-only `setInitiative`, `nextInitiative`, and `previousInitiative` payloads, initiative scope helpers, token initiative value, active turn, and round validation. |
| `shared/sessionHazardCommands.ts` | hazard command payload contracts and validators | Defines GM-only `placeHazard` and `removeHazard` payloads, hazard scope helpers, supported hazard kinds, grid-cell/layer/owner validation, and map-scope validation. |
| `shared/sessionFieldEffectCommands.ts` | field-effect command payload contracts and validators | Defines GM-only `setFieldEffect`, `removeFieldEffect`, and `tickFieldEffectDurations` payloads, field-effect scope helpers, Weather/Terrain/Room kind validation, duration/source/options validation, and map-scope validation. |
| `shared/sessionTerrainCommands.ts` | terrain voxel command payload contracts and validators | Defines GM-only `buildTerrainVoxel` and `removeTerrainVoxel` payloads, cell-specific terrain scope helpers, voxel material/style validation, and map/cell scope validation. |
| `shared/sessionCommandResults.ts` | accepted, rejected, duplicate, stale, unauthorized, invalid, conflict result shapes | Results are the server's authoritative answer to a submitted command. |
| `shared/sessionMessages.ts` | WebSocket message unions | Defines client `hello`, `heartbeat`, `command` messages and server `hello`, `heartbeat`, `commandAck`, `commandReject`, `snapshot`, `patch`, `presence`, and `error` messages. |
| `shared/sessionState.ts` | authoritative session state model | Defines the server-owned session snapshot shape: selected map slug, session/map revisions, map documents, connected clients, joined players, and GM-managed assignments. |
| `shared/sessionSafety.ts` | no-secret session-hosting safety banner status | Classifies the current request as disabled, local, LAN, remote, or unknown so the lobby can warn before join codes are shared. |

## Wire format rules

- Every WebSocket message uses `schemaVersion: 1` and a `direction` of `client` or `server`.
- Every command envelope uses `schemaVersion: 1` and includes `sessionId`, `actor`, `type`, `opId`, `baseRevision`, `scopes`, and `payload`.
- TypeScript-branded identifiers serialize as plain JSON strings. Revisions serialize as JSON numbers.
- `opId` values are scoped to the session/client operation scope and must not be reused for different user intent.
- `baseRevision` is the revision the client observed when it created the command. It is not authority; the server compares it to current authoritative state.
- `scopes` declare the resource lanes touched by the command so the server can evaluate permissions and conflicts.
- Message metadata such as `messageId`, `sentAt`, `traceId`, `clientIssuedAt`, and `clientSequence` is diagnostic. It does not decide command ordering.
- Unknown command payload, snapshot, patch payload, and current-state shapes are command/state specific and must remain JSON-serializable.

## Identity and permission boundaries

A client may include an actor shape in command envelopes, but the server must validate that actor against the authenticated session identity from the hello/join path before applying any command. The actor field is part of the audit and result vocabulary; it is not public authentication by itself.

The shared permission helpers distinguish:

- GM actors, represented by `{ role: "gm", clientId }` after the GM key has been validated for the session;
- player actors, represented by `{ role: "player", playerId, clientId, displayName }` after a join code and player identity have been validated;
- visible resources, which a player may see;
- controllable resources, which a player may command only when assigned and visible.

Permission denials use safe reasons such as `gm-required`, `player-required`, `resource-not-visible`, `resource-not-assigned`, and `missing-player-identity`. These reasons are suitable for player-facing conflict/rejection UI without exposing secrets.

## Session safety status endpoint and banner

`GET /api/sessions/safety` returns a no-secret summary for the current request so the `/sessions` lobby can display a safety banner before a GM starts or shares a hosted session. This endpoint is intentionally readable even when session hosting is disabled; its purpose is to make the fail-closed state visible rather than to grant session authority.

The response includes:

- whether the exact `ROTOM_ENABLE_SESSION_HOST=1` flag is active;
- the normalized request host and forwarded host, when present;
- a coarse exposure classification: `disabled`, `local`, `lan`, `remote`, or `unknown`;
- a severity for the banner and player-safe warnings/actions.

It never returns GM keys, join codes, player IDs, snapshots, map documents, or other campaign data. The banner repeats the Track 2 safety boundary: the existing local GM/player role picker is a trust switch for the local app, not public authentication. When hosting is enabled on a LAN or public/tunnel hostname, the GM should verify that the server exposure is intentional, use a named Cloudflare Tunnel for remote campaign play, treat Quick Tunnel as development smoke-test only, and stop the server or unset the flag after the session.

Example remote-exposure response:

```json
{
  "schemaVersion": 1,
  "hostEnabled": true,
  "requiredFlag": {
    "name": "ROTOM_ENABLE_SESSION_HOST",
    "value": "1"
  },
  "exposure": "remote",
  "severity": "danger",
  "requestHost": "localhost",
  "forwardedHost": "campaign.example.net",
  "effectiveHost": "campaign.example.net",
  "forwarded": true,
  "title": "Session hosting exposed remotely",
  "summary": "This browser reached Rotom Table through campaign.example.net, which looks publicly exposed or proxied.",
  "warnings": [
    "Track 2 session hosting is enabled and this request appears to use a public hostname, proxy, or tunnel.",
    "Use a named Cloudflare Tunnel with a stable hostname for campaign play; Quick Tunnel is development smoke-test only.",
    "Do not rely on the local GM/player role picker as public auth; keep the GM session key and browser private."
  ],
  "recommendedActions": [
    "Confirm the hostname is a named Cloudflare Tunnel or another deliberate private-server exposure path before sharing it.",
    "Rotate the join code by starting a new session if it was shared outside the trusted table."
  ]
}
```

## Session WebSocket route and hello/auth

`WebSocket /api/sessions/socket` is the reserved live session transport route. Nitro WebSocket support is enabled in the server build, and the route upgrade fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is set. This keeps the same explicit runtime safety gate as the HTTP session endpoints.

New sockets start as `pending-hello`. The first accepted client frame must be a JSON client `hello` with the session ID and session-local identity returned by the start/join endpoints. The server validates the GM key for GM clients, validates the player ID plus safe display name for player clients, rejects client-ID collisions with a different actor, records the connected client in authoritative session state without incrementing the session revision, and replies with a server `hello` carrying the validated actor, current revision, and heartbeat configuration. Invalid, unknown, ended, or unauthorized hello attempts receive a safe server `error` frame and the socket is closed with the policy close code.

Inbound frames are validated before dispatch. The server accepts only JSON client messages with `schemaVersion: 1`, `direction: "client"`, a valid `sessionId`, and a client message type of `hello`, `heartbeat`, or `command`; malformed frames receive a `malformed-message` error and close. Valid heartbeat or command frames sent before hello/auth receive `unauthorized` and close. After hello/auth, heartbeat and command messages must target the authenticated session, and command envelopes must pass the shared envelope validator and match the authenticated actor before command handlers see them. The live socket route now dispatches `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, `modifyCombatStages`, `modifyConditions`, `useMove`, `useManeuver`, `useAbility`, `useOrder`, `setInitiative`, `nextInitiative`, `previousInitiative`, `placeHazard`, `removeHazard`, `setFieldEffect`, `removeFieldEffect`, `tickFieldEffectDurations`, `buildTerrainVoxel`, and `removeTerrainVoxel`; authenticated command types that are not implemented yet receive `unsupported-message` without closing the socket.

After hello/auth succeeds, heartbeat is active. The server sends app-level heartbeat `ping` frames on the negotiated interval, replies to authenticated client `ping` frames with `pong`, records client `ping`/`pong` activity in the in-memory connected-client presence record without incrementing the session revision, and closes sockets that have not produced readable client activity within the heartbeat timeout. The client wrapper starts its own heartbeat `ping` loop after the server `hello`, answers server `ping` frames with `pong`, and closes the browser socket when server activity is stale.

The WebSocket server now keeps a process-local peer registry for fanout. Server-scoped `presence`, `commandAck`, `commandReject`, `patch`, and `snapshot` frames are serialized once and sent only to authenticated peers whose registry entry has the same `sessionId`; pending sockets, disconnected peers, explicit cross-session targets, and missing peer handles are skipped instead of receiving data. Successful hello/auth and socket close/heartbeat-timeout paths broadcast presence updates to the remaining authenticated peers in that same session. Heartbeat activity updates are recorded locally but are not broadcast on every ping/pong to avoid turning liveness traffic into noisy table updates.

A socket close or heartbeat timeout marks the authenticated client as `disconnected` in in-memory authoritative state; no snapshot or command event is written for this transient presence update yet, though the presence change is fanned out to same-session sockets.

The client wrapper lives in `src/composables/useSessionSocket.ts`. It resolves `/api/sessions/socket` to `ws://` or `wss://` from the current browser location, wraps the browser `WebSocket`, exposes connection status (`idle`, `connecting`, `open`, `closing`, `closed`, `error`, or `unavailable`), records the last error/close/server message, maintains a bounded JSON send queue, flushes queued messages after `open`, and provides explicit `connect`, `disconnect`, and `cleanup` methods. It can build/send a client `hello` from the remembered session-local identity, auto-sending that hello before queued messages when configured with `hello: { identity }`, tracks whether the server hello was accepted or rejected, sends heartbeat pings after the negotiated server hello, answers server heartbeat pings, reports stale heartbeat timeouts, records reconnect snapshot fallback messages, and advances its last-known revision when command results or patch broadcasts arrive.

`src/composables/map-editor/useSessionMapEditorState.ts` is the client-side state split for the map editor. Local mode still reads and mutates the `useEditableMap` document, so autosave and legacy SSE keep their existing Track 1 behaviour. When the map route is explicitly opened in session mode, the editor instead reads from a separate session map clone seeded from the local document and then replaced/updated by authoritative `snapshot` and `patch` WebSocket frames. Applying `tokenMoved`, `tokenTurned`, `tokenSpawned`, `tokenDeleted`, `pokemonSentOut`, `moveUsed`, `maneuverUsed`, `abilityUsed`, `orderUsed`, `initiativeUpdated`, `hazardsUpdated`, `fieldEffectsUpdated`, and `terrainVoxelsUpdated` patches mutates only that session clone; it does not mutate the local autosaved map ref or send whole-map saves from live clients.

`src/composables/map-editor/useSessionMap.ts` is the route-level session map composable for client integration. It loads the remembered GM/player session-local identity from browser storage, opens the shared WebSocket, sends a reconnect `hello` without a `lastSeenRevision` on initial map sync so the server falls back to an authoritative snapshot, subscribes the session map clone to `snapshot`/`patch` events, exposes connection/snapshot status plus safe error/rejection state, and provides a generic command-message dispatcher that refuses commands for a different session or actor before anything is sent. It also exposes an explicit refresh-snapshot action for rejection UI: the map view resets the shared socket and sends a fresh reconnect hello without `lastSeenRevision`, causing the server to answer with the current authoritative snapshot fallback. `/maps/<slug>?session=1` now uses this shared socket so initial session views request server authority instead of waiting for the first token command; local mode continues to use `useEditableMap` and legacy autosave only.

`src/components/map/MapNavigationRail.vue` now includes `src/components/map/MapSessionNavigationPanel.vue` on map routes. The panel adds explicit map-side entry points to the session lobby GM start/manage section, the player join section, and an opt-in `?session=1` link for the current map. If a map is already opened in session mode, the same panel offers a return link to the local-first map route without the session query. These links are navigation affordances only: they do not start hosting, join a player, expose join codes, or switch local routes into session mode until the user follows the explicit lobby or `?session=1` link.

`src/utils/sessionCommandRejectionUi.ts` and `src/components/map/SessionCommandRejectionBanner.vue` provide the current player-facing rejection surface for `/maps/<slug>?session=1`. The banner maps `commandReject` reasons (`invalid`, `unauthorized`, `stale`, and `conflict`) to safe titles, command labels, sanitized server detail text, and refresh/retry guidance without rendering permission objects, current-state payloads, GM keys, join codes, or sheet data. Stale and retryable conflict messages tell the player to refresh the session view, inspect the latest table state, and try again; unauthorized messages direct the player to ask the GM for assignment changes.

`src/utils/sessionPresencePanel.ts` and `src/components/map/SessionPresencePanel.vue` provide the compact session presence surface for `/maps/<slug>?session=1`. The panel derives display rows from the latest actor-scoped reconnect snapshot plus same-session `presence` frames, shows GM/player liveness, connected player/client counts, the current browser's session-local role, and assignment counts for controllable tokens/sheets. It intentionally renders counts and safe display names only; it does not show GM keys, join codes, hidden map documents, or whole snapshots.

`src/utils/sessionConnectionStatusUi.ts` and `src/components/map/SessionConnectionStatusBanner.vue` provide the reconnect-state surface for `/maps/<slug>?session=1`. The banner derives safe indicators from the route-level session map/socket refs: reconnecting while the socket/hello/snapshot path is pending, stale when heartbeat times out or replay is unavailable and a fresh snapshot is required, disconnected when the browser is showing only the last authoritative table state, and recovered snapshot when the map view has rebuilt itself from an actor-scoped reconnect snapshot. Refresh/reconnect actions reuse the explicit refresh-snapshot path; the banner shows only revision numbers and sanitized connection details, never GM keys, join codes, permission payloads, hidden maps, or whole snapshots.

`src/composables/map-editor/useSessionMoveTokenDispatch.ts` remains the high-level token move/turn helper and now shares the session map socket on the map route. When the map route is explicitly opened with session mode enabled (`?session=1`, `?session=true`, `?session=yes`, or `?session=on`) and a browser has a remembered GM/player session identity from `/sessions`, selected token movement is sent as a WebSocket `moveToken` command with an `opId`, `baseRevision`, token-position scope, and session actor; selected token facing changes are sent as `turnToken` commands with a token-facing scope. In this mode `useTokenControls` does not mutate the persisted local map placement or trigger whole-map autosave for the move/turn. Instead, a successful local send records a client-local optimistic token-position or token-facing override used only for rendering/session controls. A server `commandAck` or same-session `tokenMoved`/`tokenTurned` patch marks that override confirmed at the authoritative revision; a `commandReject` removes the override to roll back, or reconciles it to the safe `currentState.position`/`currentState.facing` returned by stale/conflict rejections. Without the explicit session query flag, existing local-first token movement and turning remain unchanged.

## Legacy SSE migration boundary

The existing non-session realtime channel remains available during the WebSocket migration. It is intentionally separate from Track 2 session hosting:

- `GET /api/events` is still the legacy Server-Sent Events stream for local-first map, sheet, and library updates outside session mode. It uses the existing local role cookie through `requireAuthRole`, not the `ROTOM_ENABLE_SESSION_HOST=1` gate, GM keys, join codes, player IDs, or session revisions.
- `src/composables/useRealtime.ts` continues to open one browser `EventSource` to `/api/events` and route events by legacy channels such as `maps`, `map:<slug>`, `sheets`, and `sheet:<kind>:<slug>`. Local-mode composables such as `useEditableMap`, `useEditableSheet`, `useLiveSheets`, and map-library subscriptions keep using this path for cross-tab/local-device echo suppression.
- Legacy SSE events may carry whole saved map or sheet payloads and retain their existing last-writer-wins semantics. That is acceptable only for the current local-first/non-session workflow.
- Live Track 2 sessions must not use `/api/events` for commands, command acknowledgements/rejections, presence, heartbeat, or reconnect. Session clients use `WebSocket /api/sessions/socket` after the session-host flag and hello/auth handshake, then later command tickets route table mutations through server-authoritative command handlers.

This boundary lets the app preserve existing Track 1/local workflows while the session WebSocket stack lands in additive slices. Future tickets may replace specific local-mode behaviours with session-aware alternatives when a session is active, but they should not remove the legacy SSE route until a separate migration ticket explicitly does so.

## GM start-session endpoint

`POST /api/sessions/start` creates the first server-side identity and state record for a Track 2 table session. The route fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is present, and the server use case repeats that runtime-gate check before allocating anything. The route currently also requires the existing local GM role so the GM can start a session from the trusted local app, but that role picker is not public authentication; the returned session-local GM key is the credential GM management routes and future WebSocket handshakes must validate.

A successful start creates an active in-memory session record, a session ID, a short player join code, a GM key, a GM client ID for the starting browser, an empty authoritative session state at revision `0`, and an initial local JSON snapshot. The response is shaped as session/join details rather than a whole-map autosave:

```json
{
  "session": {
    "sessionId": "session_generated_table_id",
    "status": "active",
    "revision": 0,
    "createdAt": "2026-05-25T12:00:00.000Z",
    "updatedAt": "2026-05-25T12:00:00.000Z"
  },
  "gm": {
    "gmKey": "gmkey_exampleGeneratedSecretValue01",
    "clientId": "client_generated_browser_id"
  },
  "join": {
    "joinCode": "ABCD2345"
  },
  "snapshot": {
    "writtenAt": "2026-05-25T12:00:00.000Z",
    "revision": 0
  }
}
```

The GM key and join code are session-local secrets and should be shown or stored only by later lobby/client-identity flows. Starting a session does not add accounts, hosted persistence, or client whole-map authority.

## Player join-session endpoint

`POST /api/sessions/join` lets a player join an active Track 2 table session with a short join code and a display name. The route fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is present, but unlike the GM start route it does not require the existing local role-picker cookie: the join code is the session-local capability for creating a player identity. This is still not public account authentication; it creates only a session-local `playerId`, `clientId`, safe display name, and empty assignment record for the GM to manage later.

Request bodies are small and do not contain map state:

```json
{
  "joinCode": "ABCD-2345",
  "displayName": "Misty"
}
```

The server normalizes join-code casing/separators, sanitizes the display name into the shared safe display-name shape, rejects unknown or ended sessions, creates a unique player ID and client ID, advances the session revision, writes the updated authoritative snapshot, and returns the identity the later WebSocket hello/client-identity flow must use:

```json
{
  "session": {
    "sessionId": "session_generated_table_id",
    "status": "active",
    "revision": 1,
    "createdAt": "2026-05-25T12:00:00.000Z",
    "updatedAt": "2026-05-25T12:01:00.000Z"
  },
  "player": {
    "playerId": "player_generated_id",
    "clientId": "client_generated_browser_id",
    "displayName": "Misty",
    "joinedAt": "2026-05-25T12:01:00.000Z",
    "actor": {
      "role": "player",
      "playerId": "player_generated_id",
      "clientId": "client_generated_browser_id",
      "displayName": "Misty"
    }
  },
  "snapshot": {
    "writtenAt": "2026-05-25T12:01:00.000Z",
    "revision": 1
  }
}
```

Duplicate display names are allowed because identity comes from the generated `playerId`, not the display label. The initial assignment record has no visible or controllable resources; the GM player-assignment endpoint decides which sheets/tokens each player can see or command. Joining never gives a player whole-map save authority.

## GM session management endpoint

`POST /api/sessions/manage` returns the GM-facing lobby summary for one Track 2 table session. The route fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is present and requires the session-local `gmKey`; it must not rely on the trust-based local role picker as public authentication. The request body contains only the session identity and GM key, not map edits:

```json
{
  "sessionId": "session_generated_table_id",
  "gmKey": "gmkey_exampleGeneratedSecretValue01"
}
```

A successful response lists the current session lifecycle status, the player join code, joined players, connected-client presence records, and the GM-managed assignment records that describe visible and controllable resources:

```json
{
  "session": {
    "sessionId": "session_generated_table_id",
    "status": "active",
    "revision": 1,
    "selectedMapSlug": "viridian-gym",
    "createdAt": "2026-05-25T12:00:00.000Z",
    "updatedAt": "2026-05-25T12:01:00.000Z",
    "playerCount": 1,
    "connectedClientCount": 1,
    "assignmentCount": 1,
    "mapCount": 1
  },
  "join": {
    "joinCode": "ABCD2345"
  },
  "players": [
    {
      "playerId": "player_generated_id",
      "displayName": "Misty",
      "joinedAt": "2026-05-25T12:01:00.000Z",
      "updatedAt": "2026-05-25T12:01:00.000Z"
    }
  ],
  "connectedClients": [
    {
      "clientId": "client_generated_browser_id",
      "actor": {
        "role": "player",
        "playerId": "player_generated_id",
        "clientId": "client_generated_browser_id",
        "displayName": "Misty"
      },
      "status": "connected",
      "connectedAt": "2026-05-25T12:01:05.000Z",
      "lastSeenAt": "2026-05-25T12:01:30.000Z",
      "lastSeenRevision": 1
    }
  ],
  "assignments": [
    {
      "playerId": "player_generated_id",
      "displayName": "Misty",
      "controllableResources": [],
      "visibleResources": [],
      "updatedAt": "2026-05-25T12:01:00.000Z"
    }
  ]
}
```

The response intentionally excludes the GM key. It may include an ended session's status for GM inspection, but ended sessions remain absent from active join-code lookups. This endpoint is read-only; assignment mutation uses the GM player-assignment endpoint below.

## GM player-assignment endpoint

`POST /api/sessions/assignments` lets the GM assign or unassign player-controllable `sheet` and `token` resources for one joined player. The route fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is present, requires the session-local `gmKey`, and only updates active sessions. It does not accept `map` resources as controllable assignments, and it does not trust the local role picker or player-supplied actors as public authentication.

```json
{
  "sessionId": "session_generated_table_id",
  "gmKey": "gmkey_exampleGeneratedSecretValue01",
  "gmClientId": "client_gm_browser_id",
  "playerId": "player_generated_id",
  "action": "assign",
  "resources": [
    { "kind": "sheet", "sheetKind": "trainer", "sheetSlug": "misty" },
    {
      "kind": "token",
      "tokenId": "token-starmie",
      "mapSlug": "viridian-gym",
      "sheetKind": "pokemon",
      "sheetSlug": "starmie"
    }
  ]
}
```

Accepted assignment updates advance the authoritative session revision, update the player's assignment record, and write a local session snapshot. Assigning a sheet/token adds it to both `controllableResources` and `visibleResources` so later permission checks can allow player control. Unassigning removes matching sheet/token control and exact sheet/token visibility while preserving unrelated visible maps. Duplicate resources are collapsed rather than stored multiple times.

```json
{
  "session": {
    "sessionId": "session_generated_table_id",
    "status": "active",
    "revision": 2,
    "createdAt": "2026-05-25T12:00:00.000Z",
    "updatedAt": "2026-05-25T12:02:00.000Z"
  },
  "player": {
    "playerId": "player_generated_id",
    "displayName": "Misty",
    "joinedAt": "2026-05-25T12:01:00.000Z",
    "updatedAt": "2026-05-25T12:01:00.000Z"
  },
  "assignment": {
    "playerId": "player_generated_id",
    "displayName": "Misty",
    "controllableResources": [
      { "kind": "sheet", "sheetKind": "trainer", "sheetSlug": "misty" },
      { "kind": "token", "tokenId": "token-starmie", "mapSlug": "viridian-gym" }
    ],
    "visibleResources": [
      { "kind": "sheet", "sheetKind": "trainer", "sheetSlug": "misty" },
      { "kind": "token", "tokenId": "token-starmie", "mapSlug": "viridian-gym" }
    ],
    "updatedAt": "2026-05-25T12:02:00.000Z",
    "updatedByClientId": "client_gm_browser_id"
  },
  "change": {
    "action": "assign",
    "resources": [
      { "kind": "sheet", "sheetKind": "trainer", "sheetSlug": "misty" },
      { "kind": "token", "tokenId": "token-starmie", "mapSlug": "viridian-gym" }
    ]
  },
  "snapshot": {
    "writtenAt": "2026-05-25T12:02:00.000Z",
    "revision": 2
  }
}
```

The response excludes the GM key and join code. If snapshot persistence fails, the server rolls back the in-memory assignment update so reconnect/player-state reads do not observe a revision that was not persisted.

## Player session-state endpoint

`POST /api/sessions/player-state` returns the player-filtered lobby/session summary for one joined player. The route fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is present and validates the session-local `sessionId`, `playerId`, `clientId`, and safe `displayName` returned by the join flow. These IDs are session-local continuity values, not full account auth.

```json
{
  "sessionId": "session_generated_table_id",
  "playerId": "player_generated_id",
  "clientId": "client_generated_browser_id",
  "displayName": "Misty"
}
```

A successful response returns the player's own identity, their assignment record, session lifecycle status, and current-map visibility filtered through visible map assignments. It does not return the GM key, join code, other players, connected-client lists, hidden selected-map slugs, or map documents:

```json
{
  "session": {
    "sessionId": "session_generated_table_id",
    "status": "active",
    "revision": 1,
    "createdAt": "2026-05-25T12:00:00.000Z",
    "updatedAt": "2026-05-25T12:01:00.000Z"
  },
  "player": {
    "playerId": "player_generated_id",
    "clientId": "client_generated_browser_id",
    "displayName": "Misty",
    "joinedAt": "2026-05-25T12:01:00.000Z",
    "updatedAt": "2026-05-25T12:01:00.000Z",
    "actor": {
      "role": "player",
      "playerId": "player_generated_id",
      "clientId": "client_generated_browser_id",
      "displayName": "Misty"
    }
  },
  "assignment": {
    "playerId": "player_generated_id",
    "displayName": "Misty",
    "controllableResources": [],
    "visibleResources": [
      { "kind": "map", "mapSlug": "viridian-gym" }
    ],
    "updatedAt": "2026-05-25T12:02:00.000Z"
  },
  "visibility": {
    "currentMapVisible": true,
    "currentMap": {
      "mapSlug": "viridian-gym",
      "revision": 2
    },
    "visibleMapSlugs": ["viridian-gym"],
    "visibleMaps": [
      { "mapSlug": "viridian-gym", "revision": 2 }
    ]
  }
}
```

When the server's selected/current map is not visible to the player, `currentMapVisible` is `false` and `currentMap` is `null`; the hidden map slug is not included. Ended sessions may still return status to already joined players, but the endpoint stays read-only and never grants whole-map save authority.

## Minimal session lobby UI

`/sessions` provides the first additive lobby surface for the endpoints above. It does not replace the existing local `/login` trust picker: the page is still reached through the current app shell, the GM start action still requires the local GM role plus `ROTOM_ENABLE_SESSION_HOST=1`, and player joins still create only session-local `playerId`/`clientId`/display-name continuity.

The GM panel can start a session, show the player join code, refresh the read-only management summary, and list joined players plus assignment counts. The player panel collects a join code and display name, stores the returned player identity in browser-local session identity storage, and refreshes the player-filtered session-state summary. The lobby sections have stable anchors (`/sessions#gm-lobby-title`, `/sessions#player-lobby-title`, and `/sessions#remembered-session-title`) so map navigation can link directly to start/manage, join, or remembered-identity recovery without adding separate public routes. The lobby intentionally does not send map edits, autosave whole documents, or expose the stored GM key in the page chrome. The operational lobby flow and two-browser manual QA checklist live in [Track 2 session lobby and manual QA](track-2-session-lobby.md), and the client-integration multi-tab token propagation helper lives in [Track 2 multi-tab local smoke script](track-2-multi-tab-smoke.md).

## Client identity continuity helper

`shared/sessionClientIdentity.ts` and `src/utils/sessionClientIdentityStorage.ts` define the browser continuity boundary for the identities returned by the GM start and player join flows. The helper stores one active session-local identity under `rotom:session:identity` in `localStorage` so a browser can reload or reconnect without asking the GM/player to copy the returned IDs again. A small `rotom-session-identity` cookie stores only a continuity hint for UI hydration and future same-origin request helpers.

The full local identity may include the session-local GM key for a GM browser, or the player ID/display name for a player browser. The cookie hint intentionally excludes GM keys and join codes, uses `SameSite=Lax`, and is not an authentication credential. Later WebSocket and session-state routes must still validate any cookie, local-storage value, or client-supplied actor against the authoritative session state before subscribing, applying commands, or showing privileged data.

The helper clears malformed local records or malformed/secret-bearing cookie hints instead of treating them as authority. This keeps Track 2 as session-local continuity, not full accounts, public auth, or durable cloud identity.

## Authoritative state shape

`AuthoritativeSessionState` is the JSON-serializable state the GM-hosted server owns for one session. It includes `sessionId`, monotonic session `revision`, `selectedMapSlug`, per-map `maps[]` entries with `MapRevision` values and server-owned map documents, `connectedClients[]` for WebSocket presence, joined `players[]`, and GM-controlled `assignments[]`.

This model is the state stored in the in-memory session store and later written as local snapshots. It is not a client autosave format: live clients still send commands, the server mutates this authoritative copy, and broadcasts small patches or snapshots from it.

## Local snapshot writer

`server/utils/sessionSnapshots.ts` writes the latest authoritative session snapshot as a JSON envelope containing the snapshot schema version, `sessionId`, current session `revision`, `writtenAt`, and the `AuthoritativeSessionState`. The default local path is `data/sessions/<sessionId>/snapshot.json`, which is ignored by git because snapshots may contain private campaign/session state.

Snapshot writes serialize the complete JSON in memory, write a unique temp file in the same session directory, flush and close it, rename it over `snapshot.json`, best-effort flush the directory, and remove the temp file on failures before publish.

Snapshot reads use the same session-scoped path, parse the latest `snapshot.json`, validate the persisted envelope, schema versions, session ID, revisions, timestamps, authoritative state arrays, presence actors, players, assignments, visible/controllable resources, and cross-check that the envelope and state refer to the requested session/revision. `recoverSessionStateFromSnapshot` returns the validated `AuthoritativeSessionState` for reconnect or restart paths, or a typed failure such as `not-found`, `invalid-json`, or `invalid-shape`; it never reconstructs live authority from client autosave state.

## Optional local event log

`server/utils/sessionEventLog.ts` provides the opt-in append-only JSON-lines helper for future command application and reconnect work. The default local path is `data/sessions/<sessionId>/events.jsonl`, under the same git-ignored session data root as snapshots.

Each line is one complete `schemaVersion: 1` event-log entry. Command entries bind the command envelope to the server command result, `opId`, command type, session ID, and resulting session revision. Generic event entries can record server-side session events such as presence or operational markers without becoming a client-edit stream.

The helper serializes and validates entries before creating session directories, appends one compact JSON object plus a trailing newline, flushes the file by default, and best-effort flushes the session directory. The event log remains optional: the latest valid snapshot is still the required recovery baseline, and reconnect code must fall back to a current snapshot whenever replay is disabled, missing, truncated, or unsafe.

## Revision application helper

`server/utils/sessionRevisionApplication.ts` is the pure application boundary for already-accepted commands. Command-specific handlers still own validation, permission checks, stale/conflict rejection, and duplicate `opId` lookup; after a handler decides a command is accepted, it calls this helper to advance the authoritative session revision exactly once, apply any supplied map-document effects with per-map revision increments, stamp server metadata, and return the next immutable `AuthoritativeSessionState`.

The helper also creates the accepted command result, a small `SessionPatchEvent`, and a validated command event-log entry object for optional persistence. It does not append the log or write snapshots itself, so callers can decide whether to persist, broadcast, or roll back as a unit.

## Duplicate operation tracker

`server/utils/sessionOperationTracker.ts` is the in-memory idempotency boundary for recently processed command `opId` values. It records only accepted or rejected command results, scopes entries by `sessionId`, actor `clientId`, and `opId`, and keeps a bounded recent history per session so retries can be answered without applying effects again.

The tracker returns `new`, `duplicate`, or `mismatched-opId` decisions. Exact duplicate user intents receive a `SessionCommandDuplicateResult` with the original accepted/rejected revision and the server's current revision at retry time. Reusing the same scoped `opId` with a materially different command envelope or payload is surfaced as a mismatch for later command handlers to reject safely instead of treating it as an edit to the original command. Diagnostic command metadata may change across retries and is not part of the material fingerprint.

This helper is process-local state, not a database. Snapshots and the optional event log remain the recovery baseline after server restart; future reconnect/replay work may rebuild or bypass recent-op memory from durable local data when safe.

## Session cleanup and explicit end

`server/utils/sessionCleanup.ts` defines the server-side lifecycle policy for in-memory session records. The default policy treats an active session as idle after 12 hours without server-owned activity and retains ended in-memory records for 24 hours before pruning them. Server-owned activity includes store updates plus authoritative state/presence timestamps; the WebSocket heartbeat path now touches connected-client presence without revision increments, and future reconnect/command paths should do the same when a client is still active.

The explicit end-session helper is the path future GM management routes should use when the GM ends a table. It idempotently marks the session record `ended`, stamps `endedAt`, removes the session from active join-code lookups, and clears process-local duplicate-`opId` records for that session. Repeated end requests leave the original `endedAt` intact.

Cleanup passes are conservative: an idle active session is ended but not deleted in the same pass, giving later socket/broadcast/persistence code a stable `session-ended` state to report. Only sessions that were already ended before a cleanup pass and have exceeded the ended-record retention window are pruned from the in-memory store. Cleanup does not delete `data/sessions/<sessionId>/snapshot.json` or `events.jsonl`; local snapshots and optional logs remain the recovery/backup boundary until the GM removes local files deliberately. The storage runbook documents when and how those local files should be backed up, restored, or manually removed.

## Message flow

### 1. Socket hello and reconnect

After session hosting is enabled and a GM/player has session-local identity, the browser opens the session WebSocket and sends a client `hello`.

```json
{
  "schemaVersion": 1,
  "type": "hello",
  "direction": "client",
  "sessionId": "session_lake_table_001",
  "identity": {
    "role": "player",
    "clientId": "client_browser_01",
    "playerId": "player_misty001",
    "displayName": "Misty"
  },
  "reconnect": true,
  "lastSeenRevision": 41
}
```

The server validates the identity and replies with a server `hello`. The reply authenticates the socket, reports the current revision, and records whether the connection resumed. If `reconnect` is true and the client's `lastSeenRevision` already matches the current authoritative revision, `snapshotRequired` is false and no snapshot is sent. If the client omits `lastSeenRevision`, reports an older revision, or reports a future revision the server cannot prove safe, event replay is treated as unavailable in this slice and `snapshotRequired` is true. An actor-scoped authoritative `snapshot` message follows the server `hello` with `reason: "reconnect"` and `replayAvailable: false`.

```json
{
  "schemaVersion": 1,
  "type": "hello",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "actor": {
    "role": "player",
    "playerId": "player_misty001",
    "clientId": "client_browser_01",
    "displayName": "Misty"
  },
  "currentRevision": 42,
  "resumed": true,
  "heartbeat": {
    "intervalMs": 25000,
    "timeoutMs": 60000
  },
  "snapshotRequired": true
}
```

Because event replay is not available in this slice, the server then sends the current authoritative snapshot view to the reconnecting peer. GM clients receive the full server-owned state; player clients receive only their own player/assignment records and map documents for maps assigned visible to that player.

```json
{
  "schemaVersion": 1,
  "type": "snapshot",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "reason": "reconnect",
  "currentRevision": 42,
  "replayAvailable": false,
  "snapshot": {
    "schemaVersion": 1,
    "sessionId": "session_lake_table_001",
    "revision": 42,
    "selectedMapSlug": "viridian-gym",
    "maps": [
      {
        "mapSlug": "viridian-gym",
        "revision": 42,
        "document": {
          "name": "Viridian Gym",
          "tokens": []
        }
      }
    ],
    "connectedClients": [
      {
        "clientId": "client_browser_01",
        "actor": {
          "role": "player",
          "playerId": "player_misty001",
          "clientId": "client_browser_01",
          "displayName": "Misty"
        },
        "status": "connected",
        "connectedAt": "2026-05-25T12:05:00.000Z",
        "lastSeenAt": "2026-05-25T12:05:00.000Z",
        "lastSeenRevision": 41
      }
    ],
    "players": [
      {
        "playerId": "player_misty001",
        "displayName": "Misty",
        "joinedAt": "2026-05-25T12:00:00.000Z",
        "updatedAt": "2026-05-25T12:00:00.000Z"
      }
    ],
    "assignments": [
      {
        "playerId": "player_misty001",
        "displayName": "Misty",
        "controllableResources": [],
        "visibleResources": [
          {
            "kind": "map",
            "mapSlug": "viridian-gym"
          }
        ],
        "updatedAt": "2026-05-25T12:00:00.000Z"
      }
    ],
    "createdAt": "2026-05-25T12:00:00.000Z",
    "updatedAt": "2026-05-25T12:05:00.000Z"
  }
}
```

### 2. Snapshot and presence

The server sends snapshots for initial load, reconnect fallback, recovery, permission changes, or manual sync. The active reconnect fallback snapshot is derived from the current server-owned `AuthoritativeSessionState`: GM clients receive the full state, while player clients receive only their own player/assignment records, their own connected-client records, and map documents whose map slugs are in their visible resource assignments. It contains the connected-client record created by the successful hello/auth path and does not expose the GM key, join code, hidden maps, or other players' assignment records to player clients. Presence messages are session-scoped and must never fan out across sessions.

```json
{
  "schemaVersion": 1,
  "type": "presence",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "change": "snapshot",
  "currentRevision": 42,
  "clients": [
    {
      "actor": {
        "role": "player",
        "playerId": "player_misty001",
        "clientId": "client_browser_01",
        "displayName": "Misty"
      },
      "clientId": "client_browser_01",
      "status": "connected",
      "lastSeenRevision": 42
    }
  ]
}
```

### 3. Heartbeat

Either side may send heartbeat messages according to the negotiated heartbeat configuration. The nonce is optional but lets implementations pair pings and pongs.

```json
{
  "schemaVersion": 1,
  "type": "heartbeat",
  "direction": "client",
  "sessionId": "session_lake_table_001",
  "heartbeat": "ping",
  "nonce": "hb-0001",
  "lastSeenRevision": 42
}
```

The current implementation negotiates a 25 second heartbeat interval and a 60 second timeout in the server `hello`. Those values are intentionally below common proxy/tunnel idle windows so a quiet table still sends application traffic in both directions while hosted over LAN or a named Cloudflare Tunnel. If a browser, the GM server, or an intermediary such as Cloudflare closes an idle/stale WebSocket anyway, clients should treat the socket as disconnected and reconnect with their last seen revision; if replay is unavailable, the server sends the current snapshot fallback. Heartbeat keeps live sockets detectable and warm, but it is not authentication and does not grant map-edit authority.

A server heartbeat ping uses the same message shape with `direction: "server"` and `heartbeat: "ping"`; clients answer with a matching `pong` nonce. A client heartbeat ping receives a server `pong`. Heartbeat `lastSeenRevision` is advisory activity metadata and does not advance the session revision.

### 4. Client command

The client wraps a command envelope in a client `command` message. The `moveToken` payload below is the shared movement command contract shape; `turnToken` uses the same envelope with `field: "facing"` and payload `{ "tokenId": string, "facing": "south-east" | "north-east" | "north-west" | "south-west" }`. GM-only `spawnToken` uses `field: "spawn"` with payload `{ "placement": { "id": string, "sheetKind": "pokemon" | "trainer", "sheetSlug": string, "position": { "x": number, "y": number, "z": number }, "facing"?: direction, "initiative"?: number | null } }`; GM-only `deleteToken` uses `field: "delete"` with payload `{ "tokenId": string }`. `sendOutPokemon` uses a trainer token scope with `field: "sendOut"`, a spawned Pokémon token scope with `field: "spawn"`, and payload `{ "trainerTokenId": string, "pokemonSlug": string, "tokenId": string, "position": { "x": number, "y": number, "z": number }, "facing"?: direction }`. `modifyHp` uses a token scope with `field: "hp"`, may include a matching sheet scope with `field: "hp"`, and payload `{ "tokenId": string, "currentHp": number, "injuries"?: number }`. `modifyCombatStages` uses a token scope with `field: "combatStages"`, may include a matching sheet scope with `field: "combatStages"`, and payload `{ "tokenId": string, "stages": { "atk": number, "def": number, "satk": number, "sdef": number, "spd": number, "acc": number } }` where each stage is an integer from -6 to +6. `modifyConditions` uses token/sheet `field: "conditions"` scopes and payload `{ "tokenId": string, "action": "add" | "remove" | "replace", "conditions": string[] }`; replace may clear to an empty list, while add/remove require at least one condition entry. `useMove` uses a token scope with `field: "moveUsage"`, may include a matching sheet scope with `field: "moveUsage"`, and payload `{ "tokenId": string, "moveName": string }`; the server resolves the move against the placed sheet before spending EOT/Scene/Daily usage. `useManeuver`, `useAbility`, and `useOrder` use token/sheet scopes with fields `"maneuver"`, `"ability"`, and `"order"` respectively, and payloads `{ "tokenId": string, "maneuverName": string, "targetTokenId"?: string }`, `{ "tokenId": string, "abilityName": string, "targetTokenId"?: string }`, and `{ "tokenId": string, "orderName": string, "targetTokenId"?: string }`; the server resolves the action against the placed sheet/reference data, appends authoritative action metadata, and persists sheet/active-order effects when applicable. GM-only initiative commands use an initiative scope with `field: "initiative"`: `setInitiative` payloads can set a token score, active token, and/or round with `{ "mapSlug"?: string, "tokenId"?: string, "initiative"?: number | null, "activeId"?: string | null, "round"?: number }`, while `nextInitiative` and `previousInitiative` use `{ "mapSlug"?: string }` and derive order from authoritative placement initiative values. GM-only hazard commands use a hazard scope with `field: "hazards"`: `placeHazard` payloads use `{ "mapSlug"?: string, "hazard": { "kind": "spikes" | "toxic-spikes" | "sticky-web" | "stealth-rock" | "fire", "x": number, "y": number, "z": number, "layer"?: 1 | 2, "owner"?: string } }`, and `removeHazard` uses `{ "mapSlug"?: string, "cell": { "x": number, "y": number, "z": number, "kind"?: hazardKind } }` where omitted `kind` removes every hazard on the cell. GM-only field-effect commands use a field-effect scope with `field: "fieldEffects"`: `setFieldEffect` payloads use `{ "mapSlug"?: string, "category": "weather" | "terrain" | "room", "kind": fieldEffectKind, "rounds"?: number | null, "source"?: string, "weatherMode"?: "replace" | "append", "terrainScope"?: "field" | "area", "startsNextRound"?: boolean }`; `removeFieldEffect` uses `{ "mapSlug"?: string, "category": "weather" | "terrain" | "room" | "all", "kind"?: fieldEffectKind }`; and `tickFieldEffectDurations` uses `{ "mapSlug"?: string, "amount"?: number }` to decrement finite durations and remove expired effects. GM-only terrain voxel commands use a terrain scope with a cell-specific field such as `field: "voxel:1,0,2"`: `buildTerrainVoxel` payloads use `{ "mapSlug"?: string, "voxel": { "x": number, "y": number, "z": number, "materialId": string, "color"?: string, "ghost"?: boolean, "blocksMovement"?: boolean, "blocksSight"?: boolean, "tags"?: string[] } }`, and `removeTerrainVoxel` uses `{ "mapSlug"?: string, "cell": { "x": number, "y": number, "z": number } }`. The WebSocket route validates the authenticated socket actor, dispatches `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, `modifyCombatStages`, `modifyConditions`, `useMove`, `useManeuver`, `useAbility`, `useOrder`, `setInitiative`, `nextInitiative`, `previousInitiative`, `placeHazard`, `removeHazard`, `setFieldEffect`, `removeFieldEffect`, `tickFieldEffectDurations`, `buildTerrainVoxel`, or `removeTerrainVoxel` to the corresponding server-authoritative use case, sends the sender a command result, and broadcasts accepted `tokenMoved`/`tokenTurned`/`tokenSpawned`/`tokenDeleted`/`pokemonSentOut`/`hpModified`/`combatStagesModified`/`conditionsModified`/`moveUsed`/`maneuverUsed`/`abilityUsed`/`orderUsed`/`initiativeUpdated`/`hazardsUpdated`/`fieldEffectsUpdated`/`terrainVoxelsUpdated` patches to authenticated peers in the same session.

```json
{
  "schemaVersion": 1,
  "type": "command",
  "direction": "client",
  "sessionId": "session_lake_table_001",
  "command": {
    "schemaVersion": 1,
    "sessionId": "session_lake_table_001",
    "actor": {
      "role": "player",
      "playerId": "player_misty001",
      "clientId": "client_browser_01",
      "displayName": "Misty"
    },
    "type": "moveToken",
    "opId": "op_01HZY7F2MAPMOVE1",
    "baseRevision": 41,
    "scopes": [
      {
        "lane": "token",
        "mapSlug": "thickerby-vale",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "thickerby-vale"
        },
        "field": "position"
      }
    ],
    "payload": {
      "tokenId": "token_pikachu",
      "to": { "x": 5, "y": 8, "z": 0 }
    },
    "metadata": {
      "clientIssuedAt": "2026-05-25T12:00:00.000Z",
      "clientSequence": 12,
      "traceId": "trace-token-move-12"
    }
  }
}
```

The shared `validateMoveTokenCommand`, `validateTurnTokenCommand`, `validateSpawnTokenCommand`, `validateDeleteTokenCommand`, `validateSendOutPokemonCommand`, `validateModifyHpCommand`, `validateModifyCombatStagesCommand`, `validateModifyConditionsCommand`, `validateUseMoveCommand`, `validateUseManeuverCommand`, `validateUseAbilityCommand`, `validateUseOrderCommand`, `validateInitiativeCommand`, `validateHazardCommand`, `validateFieldEffectCommand`, and `validateTerrainCommand` helpers compose the common envelope validator with command-specific checks: `moveToken` requires a non-empty `payload.tokenId`, safe non-negative integer `payload.to.x/y/z` grid coordinates, and a matching token scope with `field: "position"`; `turnToken` requires a non-empty `payload.tokenId`, a valid four-way token `payload.facing`, and a matching token scope with `field: "facing"`; `spawnToken` requires a complete placement payload and a matching `field: "spawn"` token scope; `deleteToken` requires a non-empty token ID and a matching `field: "delete"` token scope; `sendOutPokemon` requires a trainer token ID, Pokémon sheet slug, distinct spawned token ID, grid position, matching trainer `field: "sendOut"` scope, and matching spawned Pokémon `field: "spawn"` scope on the same map; `modifyHp` requires a non-empty token ID, safe integer absolute current HP, optional safe non-negative Injury count, a matching token `field: "hp"` scope, and optionally a matching sheet `field: "hp"` scope; `modifyCombatStages` requires a non-empty token ID, all six absolute stage values as safe integers from -6 to +6, a matching token `field: "combatStages"` scope, and optionally a matching sheet `field: "combatStages"` scope; `modifyConditions` requires a non-empty token ID, `add`/`remove`/`replace` action, condition string list, a matching token `field: "conditions"` scope, and optionally a matching sheet `field: "conditions"` scope; `useMove` requires a non-empty token ID, non-empty move name, a matching token `field: "moveUsage"` scope, and optionally a matching sheet `field: "moveUsage"` scope; `useManeuver`, `useAbility`, and `useOrder` require a non-empty token ID, non-empty action name, optional non-empty `targetTokenId`, a matching token scope with `field: "maneuver"`, `"ability"`, or `"order"`, and optionally a matching sheet scope with the same field; initiative commands require a matching initiative `field: "initiative"` scope, GM authority, valid `mapSlug` when provided, valid token/active IDs when set, initiative values from -999 to 999 or `null`, and rounds greater than or equal to 1; hazard commands require a matching hazard `field: "hazards"` scope, GM authority, valid `mapSlug` when provided, a supported hazard kind, safe non-negative grid cell coordinates, optional Toxic Spikes layer 1 or 2, optional non-empty owner text; field-effect commands require a matching field-effect `field: "fieldEffects"` scope, GM authority, valid `mapSlug` when provided, matching Weather/Terrain/Room kind categories, safe non-negative `rounds` or `null`, optional non-empty source text, valid weather/terrain/room options, and positive tick amounts; terrain voxel commands require a matching cell-specific terrain scope such as `field: "voxel:1,0,2"`, GM authority, valid `mapSlug` when provided, safe non-negative grid cell coordinates, a non-empty material ID for builds, optional style/blocking flags, and optional non-empty tags. GM actors pass token-control permission checks after hello authentication; player actors must have the target token or sheet assigned and visible through the current GM-managed assignment records. Spawn/delete, initiative, hazard, field-effect, and terrain controls are GM-only and reject player actors with `reason: "unauthorized"`/`gm-required` without mutating state; send-out allows a player only when they control the trainer token, then the server separately checks that the Pokémon slug is on that trainer's current team.

## Accepted command example

When a command is valid, authorized, and non-conflicting, the server applies it to authoritative state, advances the revision once, and persists the authoritative change. The `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, `modifyCombatStages`, `modifyConditions`, `useMove`, `useManeuver`, `useAbility`, `useOrder`, `setInitiative`, `nextInitiative`, `previousInitiative`, `placeHazard`, `removeHazard`, `setFieldEffect`, `removeFieldEffect`, `tickFieldEffectDurations`, `buildTerrainVoxel`, and `removeTerrainVoxel` WebSocket paths send accepted results as `commandAck` messages to the submitting socket and broadcast small `tokenMoved`/`tokenTurned`/`tokenSpawned`/`tokenDeleted`/`pokemonSentOut`/`hpModified`/`combatStagesModified`/`conditionsModified`/`moveUsed`/`maneuverUsed`/`abilityUsed`/`orderUsed`/`initiativeUpdated`/`hazardsUpdated`/`fieldEffectsUpdated`/`terrainVoxelsUpdated` `patch` events to authenticated clients in the same session. The movement example below shows the shape; turn patches use `from`/`to` facing strings and a legacy-compatible `turned` boolean, spawn patches include the newly authorized placement, delete patches include the removed placement plus whether active initiative was cleared, send-out patches include the trainer token, Pokémon slug, and spawned placement, HP patches include previous/current HP plus Injury counts for the placed sheet, combat-stage patches include previous/current absolute Atk/Def/SAtk/SDef/Spd/Acc stage maps, condition patches include previous/current normalized condition lists, use-move patches include the resolved move name/key, tracking bucket, previous usage, and current usage summary; maneuver, ability, and order patches include the resolved action name, optional target token, log lines, ability category/sheet updates, or active-order effect summary; initiative patches include previous/current active turn, round, and token initiative-score entries for the map initiative lane; hazard patches include the changed cell, previous/current hazards on that cell, the placed hazard when applicable, and removed hazards when applicable; field-effect patches include previous/current Weather, Terrain, and Room arrays plus the changed category/kind or tick amount; and terrain patches include the changed voxel cell, previous/current voxel values, build/remove details, and the Track 1 renderer invalidation reasons (`terrain`, `movement-preview`, `build-preview`, `hazard-preview`) that clients preserve by applying the patch to `map.voxels`.

```json
{
  "schemaVersion": 1,
  "type": "commandAck",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "result": {
    "schemaVersion": 1,
    "status": "accepted",
    "accepted": true,
    "sessionId": "session_lake_table_001",
    "opId": "op_01HZY7F2MAPMOVE1",
    "commandType": "moveToken",
    "actor": {
      "role": "player",
      "playerId": "player_misty001",
      "clientId": "client_browser_01",
      "displayName": "Misty"
    },
    "currentRevision": 42,
    "scopes": [
      {
        "lane": "token",
        "mapSlug": "thickerby-vale",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "thickerby-vale"
        }
      }
    ],
    "event": {
      "eventType": "tokenMoved",
      "revision": 42,
      "payload": {
        "tokenId": "token_pikachu",
        "mapSlug": "thickerby-vale",
        "to": { "x": 5, "y": 8, "z": 0 }
      }
    },
    "metadata": {
      "serverProcessedAt": "2026-05-25T12:00:00.050Z",
      "traceId": "trace-token-move-12"
    }
  }
}
```

```json
{
  "schemaVersion": 1,
  "type": "patch",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "event": {
    "eventId": "event_rev_42",
    "eventType": "tokenMoved",
    "revision": 42,
    "commandType": "moveToken",
    "opId": "op_01HZY7F2MAPMOVE1",
    "actor": {
      "role": "player",
      "playerId": "player_misty001",
      "clientId": "client_browser_01",
      "displayName": "Misty"
    },
    "scopes": [
      {
        "lane": "token",
        "mapSlug": "thickerby-vale",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "thickerby-vale"
        }
      }
    ],
    "payload": {
      "tokenId": "token_pikachu",
      "mapSlug": "thickerby-vale",
      "from": { "x": 4, "y": 8, "z": 0 },
      "to": { "x": 5, "y": 8, "z": 0 }
    }
  }
}
```

Accepted command rules:

- `currentRevision` is the authoritative revision after applying the command.
- A command is applied at most once for a given `opId` operation scope.
- The patch/event is small and domain-specific; it is not a whole-map autosave from the client.
- The sender receives the ack as the command result and may also receive the same broadcast patch as every other authenticated same-session client.

## Rejected command example

When the command cannot be applied, the server replies with `commandReject`. Rejections do not advance the authoritative revision. The example below rejects a stale same-token move and returns current token state so the client can reconcile or roll back optimistic UI.

```json
{
  "schemaVersion": 1,
  "type": "commandReject",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "result": {
    "schemaVersion": 1,
    "status": "rejected",
    "accepted": false,
    "reason": "stale",
    "message": "Token token_pikachu changed after revision 40.",
    "retryable": true,
    "sessionId": "session_lake_table_001",
    "opId": "op_01HZY7F2STALEMOVE1",
    "commandType": "moveToken",
    "actor": {
      "role": "player",
      "playerId": "player_misty001",
      "clientId": "client_browser_01",
      "displayName": "Misty"
    },
    "currentRevision": 42,
    "baseRevision": 40,
    "scopes": [
      {
        "lane": "token",
        "mapSlug": "thickerby-vale",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "thickerby-vale"
        }
      }
    ],
    "changedScopes": [
      {
        "lane": "token",
        "mapSlug": "thickerby-vale",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "thickerby-vale"
        }
      }
    ],
    "currentState": {
      "tokenId": "token_pikachu",
      "mapSlug": "thickerby-vale",
      "position": { "x": 5, "y": 8, "z": 0 },
      "revision": 42
    },
    "metadata": {
      "serverProcessedAt": "2026-05-25T12:00:01.000Z",
      "traceId": "trace-token-move-13"
    }
  }
}
```

Rejection categories are:

| Reason | Use |
| --- | --- |
| `invalid` | The envelope, message, or command-specific payload is malformed or missing required values. |
| `unauthorized` | The actor is not allowed to perform the command, such as a player controlling an unassigned or hidden token. |
| `stale` | The command was based on an old revision and the same resource changed after that base revision. |
| `conflict` | The command is valid but cannot be applied safely with the current authoritative state. |

Invalid rejections include structured validation issues. Unauthorized, stale, and conflict rejections may include safe current state for reconciliation. Current `moveToken` stale checks reject same-token movement when a newer accepted move for that token is known, current `turnToken` stale checks reject same-token facing changes when a newer accepted turn for that token is known, current `modifyHp` stale checks reject same-token/same-sheet HP changes when a newer accepted HP change is known, current `modifyCombatStages` stale checks reject same-token/same-sheet combat-stage changes when a newer accepted combat-stage change is known, current `modifyConditions` stale checks reject same-token/same-sheet condition changes when a newer accepted condition change is known, current `useMove` stale checks reject same-token/same-sheet move-usage changes when a newer accepted use of that resource is known, current `useManeuver`/`useAbility`/`useOrder` stale checks reject same-token/same-sheet action changes when newer accepted action metadata for that resource is known, current initiative stale checks reject old-base initiative commands when the initiative lane changed after the command's base revision, current hazard stale checks reject old-base hazard commands when the target map's hazard lane changed after the command's base revision, and current field-effect stale checks reject old-base field-effect commands when that map's field-effect lane changed after the command's base revision. These handlers conservatively reject old-base commands when recent command history is insufficient to prove the same resource did not change, while still permitting tracked unrelated token/scope changes across small revision gaps. Current `spawnToken`/`deleteToken` checks are GM-only: they reject player actors, malformed placement/delete scopes, duplicate or missing token placements, sheet-identity mismatches, and blocked/out-of-bounds/occupied spawn cells without advancing revisions or writing snapshots. Current initiative checks are GM-only: they reject player actors, malformed initiative scopes, missing maps, missing/duplicate active or scored token placements, no-op initiative changes, and stale initiative-lane updates without broadcasting whole maps. Current hazard checks are GM-only: they reject player actors, malformed hazard scopes, missing maps, out-of-bounds hazard cells, duplicate non-layered hazards, maximum Toxic Spikes layers, missing remove targets, and stale hazard-lane updates without broadcasting whole maps. Current field-effect checks are GM-only: they reject player actors, malformed field-effect scopes, missing maps, no-op set/remove/tick requests, invalid duration updates, and stale field-effect-lane updates without broadcasting whole maps. Current `sendOutPokemon` checks reject malformed trainer/spawn scopes, players who do not control the trainer token, missing trainer/Pokémon sheets, Pokémon not listed on the trainer's current team, duplicate spawned token IDs, non-trainer source tokens, and occupied/out-of-bounds/out-of-range destinations without advancing revisions or writing snapshots. Current `modifyHp`, `modifyCombatStages`, and `modifyConditions` checks reject missing target placements/sheets, sheet-identity mismatches, unauthorized unassigned player changes, no-op sheet updates, and stale same-resource updates without broadcasting whole sheets or maps. Current `useMove` checks reject missing target placements/sheets, sheet-identity mismatches, unknown sheet moves, unavailable EOT/Scene/Daily frequencies, unauthorized unassigned player use, and stale same-resource move usage without broadcasting whole sheets or maps. Current `useManeuver`/`useAbility`/`useOrder` checks reject missing acting or target placements/sheets, sheet-identity mismatches, unknown or passive/unautomated actions, orders from non-trainer tokens, already-active sheet abilities, missing required targets, unauthorized unassigned player use, and stale same-resource action usage without broadcasting whole sheets or maps.

## Duplicate `opId` handling

If the same session/client operation scope submits a previously processed `opId`, the server must not apply effects again. It returns either the original result or a duplicate acknowledgement with enough information for the client to reconcile.

Duplicate results travel as `commandAck` messages because the duplicate was recognized and handled idempotently; no new rejection or state mutation occurs.

```json
{
  "schemaVersion": 1,
  "type": "commandAck",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "result": {
    "schemaVersion": 1,
    "status": "duplicate",
    "duplicate": true,
    "idempotent": true,
    "sessionId": "session_lake_table_001",
    "opId": "op_01HZY7F2MAPMOVE1",
    "commandType": "moveToken",
    "actor": {
      "role": "player",
      "playerId": "player_misty001",
      "clientId": "client_browser_01",
      "displayName": "Misty"
    },
    "currentRevision": 42,
    "scopes": [
      {
        "lane": "token",
        "mapSlug": "thickerby-vale",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "thickerby-vale"
        }
      }
    ],
    "original": {
      "status": "accepted",
      "revision": 42
    }
  }
}
```

If the same `opId` is reused with a materially different command envelope or payload, later server work must reject it safely rather than treating it as an edit to the original command.

## Error messages

`error` messages are reserved for transport/session failures that are not normal command rejections, such as malformed message frames, unsupported message types, missing sessions, disabled session hosting, ended sessions, rate limits, or internal failures. Use command rejections when the message is valid enough to identify and answer a command.

```json
{
  "schemaVersion": 1,
  "type": "error",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "code": "session-host-disabled",
  "message": "Session hosting is not enabled on this Rotom Table server.",
  "retryable": false
}
```

## Validation expectations

Later implementation tickets should keep these checks at the protocol boundary:

1. Reject non-object or unsupported WebSocket messages before dispatch.
2. Validate `schemaVersion`, `direction`, `type`, and session scoping.
3. For client commands, run the shared command-envelope validator before command-specific validation.
4. Validate the socket identity against the session store; do not trust the actor field alone.
5. Recheck permissions and visibility against current authoritative state before applying player commands.
6. Detect duplicate `opId` submissions before applying effects.
7. Compare `baseRevision` and command scopes against recent authoritative event metadata.
8. Apply, persist, acknowledge, and broadcast only after all validation and conflict checks pass.
9. Fail closed to a rejection or snapshot fallback when replay/conflict safety cannot be proven.

## Related docs

- [Track 2 roadmap](track-2-roadmap.md)
- [Track 2 glossary](track-2-glossary.md)
- [Track 2 validation matrix](track-2-validation-matrix.md)
- [Track 2 WebSocket protocol](track-2-websocket-protocol.md)
- [ADR 003: WebSocket session transport](adrs/003-websocket-session-transport.md)
- [ADR 004: Server-authoritative commands](adrs/004-server-authoritative-commands.md)
- [ADR 005: Session identity and permissions](adrs/005-session-identity-and-permissions.md)
- [ADR 006: Revisions and conflict rules](adrs/006-revisions-and-conflict-rules.md)
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md)
