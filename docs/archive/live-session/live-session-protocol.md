# Legacy live-session protocol

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This protocol note is retained for maintainers of the old guarded session endpoints and socket code. It is not a normal-play guide.

Current normal play uses persistent player profiles, linked character sheets, and regular `/maps/<slug>` saved-map documents. Players do not need `/sessions`, join codes, map attachment, session-owned map copies, share links, or map-specific invites. See [Player profiles and linked character control](../../player-profiles.md).

## Remaining legacy scope

The legacy session surface consists of:

- `GET /api/sessions/safety`
- `POST /api/sessions/start`
- `POST /api/sessions/join`
- `POST /api/sessions/manage`
- `POST /api/sessions/player-state`
- `POST /api/sessions/assignments`
- `WebSocket /api/sessions/socket`

These routes remain fail-closed unless `ROTOM_ENABLE_SESSION_HOST=1` is set. Session-local GM keys, join codes, player IDs, client IDs, display names, assignments, snapshots, and optional event logs are legacy maintenance data, not public accounts or durable campaign identity.

The former `/api/sessions/maps/attach` endpoint has been removed. Normal saved maps are not published into sessions through an attachment step, and normal player token control is not derived from session assignments.

## Protocol boundaries

- The local GM/player role picker remains a trust switch, not public authentication.
- Legacy session HTTP routes and socket handshakes must not expose GM keys, raw join codes outside the lobby, hidden maps, raw snapshots, private sheet data, tunnel credentials, or local files.
- WebSocket command handlers, while they exist, should continue validating actor identity, resource scope, payload shape, and current permissions server-side.
- Legacy session snapshots and optional event logs live under `data/sessions/` and are ignored/private runtime data.
- `GET /api/events` remains the normal local realtime channel for saved map, sheet, and library updates outside legacy session hosting.

## Current profile-play protocol

Profile-based map and sheet requests include the selected player profile ID where player-specific authority is needed. Server-side policy resolves the persisted profile and derives permissions from linked Pokémon/trainer sheet refs:

- linked sheets may be loaded and saved by that player;
- matching map token placements may be moved, turned, and used for supported token-scoped actions;
- unrelated tokens, terrain, hazards, field effects, initiative/admin lanes, map creation/deletion, and sheet creation/deletion remain blocked for players.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

Profile play evidence includes `tests/server/profilePlaySmoke.test.ts`, profile policy tests, sheet access tests, map token-control tests, route guard tests, library tests, and document-backed map action tests.

See [Local development](../../local-development.md), [Live session lobby and manual QA](live-session-lobby.md), [Live session socket protocol](live-session-socket-protocol.md), [Live session security boundaries](live-session-security-boundaries.md), and [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md) for remaining legacy-session details.
