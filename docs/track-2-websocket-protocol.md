# Track 2 WebSocket protocol

This is the WebSocket-focused reference for the Track 2 session transport. It complements the broader [Track 2 session protocol](track-2-session-protocol.md) by collecting the live socket route, message examples, heartbeat/reconnect behaviour, command-result flow, session isolation rules, and named Cloudflare Tunnel expectations in one place.

This document describes the transport slice that exists after the WebSocket transport chunk:

- the runtime-gated session socket route exists at `WebSocket /api/sessions/socket`;
- the client wrapper can connect, send hello, queue messages, run heartbeat, track reconnect snapshots, and keep its last-known revision current from command results and patch broadcasts;
- the server validates hello, heartbeat, and command frame shapes before dispatch;
- same-session fanout exists for presence, command results, patches, and snapshots;
- reconnect currently falls back to an authoritative snapshot when replay is unavailable;
- the shared `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, and `modifyCombatStages` command payload contracts, validators, server-side application use cases, sender acknowledgement/rejection, and same-session `tokenMoved`/`tokenTurned`/`tokenSpawned`/`tokenDeleted`/`pokemonSentOut`/`hpModified`/`combatStagesModified` patch broadcasts now apply through `/api/sessions/socket`; move/turn also have explicit map-view client dispatch and client-local optimistic visual reconciliation.

## Route, runtime gate, and URL shape

Session WebSockets use the same explicit host opt-in as the Track 2 HTTP session endpoints:

```bash
ROTOM_ENABLE_SESSION_HOST=1
```

Unless that exact flag is set, `/api/sessions/socket` fails closed and does not admit live session clients. This protects the existing trust-based local GM/player role picker from silently becoming public authentication.

Clients resolve the route relative to the current browser origin:

| Browser origin | WebSocket URL |
| --- | --- |
| `http://localhost:3000` | `ws://localhost:3000/api/sessions/socket` |
| `http://192.168.1.50:3000` | `ws://192.168.1.50:3000/api/sessions/socket` |
| `https://table.example.com` | `wss://table.example.com/api/sessions/socket` |

A socket is not part of a session until the first accepted frame is a valid client `hello` carrying the session-local identity returned by the GM start or player join flow.

## Message invariants

Every WebSocket message is JSON and carries:

- `schemaVersion: 1`;
- `direction: "client"` or `"server"`;
- a known `type`;
- `sessionId` for session-scoped messages.

Client message types are `hello`, `heartbeat`, and `command`. Server message types are `hello`, `heartbeat`, `commandAck`, `commandReject`, `snapshot`, `patch`, `presence`, and `error`.

Unknown frames, invalid JSON, unsupported message types, wrong schema versions, missing session scope, pre-auth heartbeat/command messages, and cross-session messages fail closed with a safe server `error` frame when possible. Valid authenticated `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, and `modifyCombatStages` frames are dispatched to server-authoritative command handlers; authenticated command types that are not implemented yet receive `unsupported-message` without closing the socket.

## Connection lifecycle

| Step | Sender | Message | Server authority rule |
| --- | --- | --- | --- |
| 1 | Browser | `hello` | Validate session identity before subscribing the peer. |
| 2 | Server | `hello` | Return validated actor, current revision, and heartbeat settings. |
| 3 | Server | `presence` | Fan out join/leave updates only to authenticated peers in the same session. |
| 4 | Both | `heartbeat` | Keep the socket warm and detect stale peers without incrementing revision. |
| 5 | Browser | `command` | Validate envelope, authenticated actor, permissions, revisions, and conflicts. |
| 6 | Server | `commandAck` or `commandReject` | Acknowledge accepted/duplicate operations or reject invalid/unauthorized/stale/conflicting operations. |
| 7 | Server | `patch` or `snapshot` | Broadcast small accepted changes or send filtered authoritative state when replay is unavailable. |
| 8 | Browser | reconnect `hello` with `lastSeenRevision` | Replay missed events only when safe; otherwise send current snapshot fallback. |

## Hello/auth examples

Player hello:

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
  "reconnect": false
}
```

GM hello uses the GM key returned by `POST /api/sessions/start` instead of a join code:

```json
{
  "schemaVersion": 1,
  "type": "hello",
  "direction": "client",
  "sessionId": "session_lake_table_001",
  "identity": {
    "role": "gm",
    "clientId": "client_gm_browser_01",
    "gmKey": "gmkey_exampleGeneratedSecretValue01"
  },
  "reconnect": false
}
```

Server hello:

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
  "resumed": false,
  "heartbeat": {
    "intervalMs": 25000,
    "timeoutMs": 60000
  },
  "snapshotRequired": false
}
```

The server stores connected-client presence in authoritative in-memory state without incrementing the session revision. Failed hello attempts do not join fanout and do not receive session data.

## Presence examples

Presence is a server message. It is sent only to authenticated peers in the same session and must not leak across sessions.

```json
{
  "schemaVersion": 1,
  "type": "presence",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "change": "joined",
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
      "connectedAt": "2026-05-26T12:00:00.000Z",
      "lastSeenRevision": 42
    }
  ]
}
```

Disconnects and heartbeat timeouts mark the client as `disconnected` and fan out a same-session presence update. Heartbeat pings/pongs update local liveness timestamps but are not broadcast as noisy presence changes.

## Heartbeat

The server negotiates heartbeat settings in its `hello` response. The current transport uses a 25 second interval and a 60 second timeout. Either side may send `ping`; the other side replies with `pong` using the same nonce when present.

Client ping:

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

Server pong:

```json
{
  "schemaVersion": 1,
  "type": "heartbeat",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "heartbeat": "pong",
  "nonce": "hb-0001",
  "lastSeenRevision": 42
}
```

Heartbeat is transport liveness only. It is not authentication, does not grant authority, does not carry map edits, and does not increment session or map revisions. If either side considers the socket stale, the client should reconnect with the highest revision it has observed.

## Reconnect and snapshot fallback

A reconnecting client sends another `hello` with `reconnect: true` and its `lastSeenRevision`.

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
  "lastSeenRevision": 40
}
```

If the client is current, the server can answer with `snapshotRequired: false`. If the client is missing revisions, omits a revision, or reports a future revision that the server cannot prove safe, this slice treats replay as unavailable and follows the server `hello` with a `snapshot` message:

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
    "connectedClients": [],
    "players": [
      {
        "playerId": "player_misty001",
        "displayName": "Misty",
        "joinedAt": "2026-05-26T11:50:00.000Z",
        "updatedAt": "2026-05-26T11:50:00.000Z"
      }
    ],
    "assignments": [],
    "createdAt": "2026-05-26T11:45:00.000Z",
    "updatedAt": "2026-05-26T12:00:00.000Z"
  }
}
```

GM snapshots can include the full server-owned state. Player snapshots are filtered to the reconnecting player's identity, connected-client records, assignments, and visible map documents. Snapshot fallback never asks the browser to make stale optimistic state authoritative.

## Command flow

The client sends a command envelope inside a client `command` message. The envelope includes the authenticated actor, an `opId`, `baseRevision`, scope lanes, and a JSON payload. The `moveToken` example below matches the shared movement payload validator and is dispatched by the WebSocket route to the server-side application use case; `turnToken` uses the same envelope with `field: "facing"` and payload `{ "tokenId": string, "facing": "south-east" | "north-east" | "north-west" | "south-west" }`. GM-only `spawnToken` uses `field: "spawn"` and a placement payload; GM-only `deleteToken` uses `field: "delete"` and a token ID payload. `sendOutPokemon` includes both a trainer `field: "sendOut"` token scope and a spawned Pokémon `field: "spawn"` token scope, with payload `{ "trainerTokenId": string, "pokemonSlug": string, "tokenId": string, "position": { "x": number, "y": number, "z": number }, "facing"?: direction }`. `modifyHp` uses a token `field: "hp"` scope plus an optional matching sheet `field: "hp"` scope, with payload `{ "tokenId": string, "currentHp": number, "injuries"?: number }`; the server updates the authoritative placed sheet, advances the session/map revision, and broadcasts `hpModified` without sending a whole sheet or whole map. `modifyCombatStages` uses token/sheet `field: "combatStages"` scopes and an absolute stage payload `{ "tokenId": string, "stages": { "atk": number, "def": number, "satk": number, "sdef": number, "spd": number, "acc": number } }`; each stage must be an integer from -6 to +6, and accepted updates broadcast `combatStagesModified`. The map page currently uses move/turn paths only when it is explicitly opened in session mode with a remembered session identity, for example `/maps/viridian-gym?session=1`; otherwise local-first token dragging and turning still mutate and autosave the local map as before. Spawn/delete/send-out/HP/combat-stage dispatch exists at the shared/server/socket layer for session mode and awaits later client UI integration slices where not already wired.

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
        "mapSlug": "viridian-gym",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "viridian-gym"
        },
        "field": "position"
      }
    ],
    "payload": {
      "tokenId": "token_pikachu",
      "to": { "x": 5, "y": 8, "z": 0 }
    },
    "metadata": {
      "clientIssuedAt": "2026-05-26T12:00:00.000Z",
      "clientSequence": 12,
      "traceId": "trace-token-move-12"
    }
  }
}
```

Server processing order for the command path:

1. Validate the WebSocket frame and command envelope.
2. Verify the command `sessionId` and actor match the authenticated socket.
3. Check permissions and visibility against the current authoritative session state.
4. Check `opId` idempotency before applying side effects.
5. Reject stale same-resource move/turn/HP commands when a newer accepted change for the same token or sheet field exists, or when the server lacks enough recent command history to prove the old base revision is safe; the rejection includes the current authoritative token or HP state. Valid non-conflicting effects then apply to server-owned state after command-specific rules checks such as map bounds, blocking voxels, occupied token cells, valid facing values, GM-only spawn/delete authority, duplicate placement IDs, missing delete targets, sheet identity matches, send-out trainer control, trainer current-team ownership, Poké Ball throw range, and sheet HP persistence.
6. Increment the relevant revision, persist a snapshot/event, send `commandAck` to the sender, and fan out a small `patch` to same-session clients.
7. Return `commandReject` for invalid, unauthorized, stale, or conflicting commands without advancing revision.

Current transport boundary: `moveToken` and `turnToken` dispatch are live on both the WebSocket route and the explicit map-view session mode. The client now applies local optimistic token-position and token-facing overrides after commands are queued/sent, confirms those overrides from `commandAck` or `tokenMoved`/`tokenTurned` patch frames, and rolls them back or reconciles them to returned `currentState.position`/`currentState.facing` on `commandReject`. The optimistic overrides affect rendering/session controls only; they do not mutate the persisted map document or trigger whole-map autosave. `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, and `modifyCombatStages` dispatch are live on the WebSocket route with `tokenSpawned`/`tokenDeleted`/`pokemonSentOut`/`hpModified`/`combatStagesModified` broadcasts; they are not yet wired to all map page buttons. Other command types still receive a server `error` with `code: "unsupported-message"` instead of mutating state until their command-specific tickets land.

### Accepted command and patch

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
        "mapSlug": "viridian-gym",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "viridian-gym"
        }
      }
    ],
    "event": {
      "eventType": "tokenMoved",
      "revision": 42,
      "payload": {
        "tokenId": "token_pikachu",
        "mapSlug": "viridian-gym",
        "to": { "x": 5, "y": 8, "z": 0 }
      }
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
        "mapSlug": "viridian-gym",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "viridian-gym"
        }
      }
    ],
    "payload": {
      "tokenId": "token_pikachu",
      "mapSlug": "viridian-gym",
      "from": { "x": 4, "y": 8, "z": 0 },
      "to": { "x": 5, "y": 8, "z": 0 }
    }
  }
}
```

The patch is a small authoritative event, not a whole-map autosave from a browser. Accepted `moveToken`, `turnToken`, `spawnToken`, `deleteToken`, `sendOutPokemon`, `modifyHp`, and `modifyCombatStages` commands send `commandAck` to the submitting socket and fan out small token/sheet-specific patches to authenticated peers in the same session; the sender can receive both frames. Spawn patches include the authoritative placement that was appended; delete patches include the removed placement and whether the active initiative pointer was cleared; send-out patches include the source trainer token, Pokémon sheet slug, and spawned placement; HP patches include the previous/current HP and Injury counts for the placed sheet; combat-stage patches include previous/current absolute Atk/Def/SAtk/SDef/Spd/Acc stage maps.

### Rejected command

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
        "mapSlug": "viridian-gym",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "viridian-gym"
        }
      }
    ],
    "changedScopes": [
      {
        "lane": "token",
        "mapSlug": "viridian-gym",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "viridian-gym"
        }
      }
    ],
    "currentState": {
      "tokenId": "token_pikachu",
      "mapSlug": "viridian-gym",
      "position": { "x": 5, "y": 8, "z": 0 },
      "revision": 42
    }
  }
}
```

Normal command rejections use `reason: "invalid"`, `"unauthorized"`, `"stale"`, or `"conflict"`. For `moveToken`, stale same-token rejections include `baseRevision`, `changedScopes`, and the current authoritative token position/revision so clients can reconcile optimistic state. For `turnToken`, stale same-token facing rejections include the same revision/scope metadata plus the current authoritative facing. For `modifyHp`, stale same-token/same-sheet HP rejections include the current authoritative HP/Injury state. For `modifyCombatStages`, stale same-token/same-sheet combat-stage rejections include the current authoritative stage map. `spawnToken`/`deleteToken` reject player actors as unauthorized and return conflicts for duplicate spawn IDs, missing delete targets, sheet-identity mismatches, and blocked/out-of-bounds/occupied spawn cells. `sendOutPokemon` rejects players who do not control the trainer token and returns conflicts for non-trainer source tokens, missing sheets, Pokémon not on the trainer's current team, duplicate spawned token IDs, occupied/out-of-bounds destinations, and destinations outside Poké Ball throw range. They are distinct from transport `error` messages.

### Duplicate `opId`

A retry with the same session/client/`opId` scope must not apply effects again. Duplicate operation results travel as `commandAck` because the retry was handled idempotently.

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
        "mapSlug": "viridian-gym",
        "resource": {
          "kind": "token",
          "tokenId": "token_pikachu",
          "mapSlug": "viridian-gym"
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

## Transport errors

Use server `error` messages for socket/session failures that are outside a normal command result: disabled hosting, malformed messages, unsupported message types, unauthorized pre-auth frames, missing/ended sessions, rate limits, or internal failures.

```json
{
  "schemaVersion": 1,
  "type": "error",
  "direction": "server",
  "sessionId": "session_lake_table_001",
  "code": "unsupported-message",
  "message": "Track 2 session WebSocket command dispatch currently supports moveToken, turnToken, spawnToken, deleteToken, sendOutPokemon, modifyHp, and modifyCombatStages commands only.",
  "retryable": false,
  "currentRevision": 42
}
```

Where possible, the server sends an error before closing. Malformed or unauthorized frames may then close the socket with the policy close code. Clients should show safe player-facing text and reconnect only when the error is retryable or when the transport closed unexpectedly.

## Fanout and session isolation

The WebSocket route keeps a process-local peer registry. Broadcast helpers serialize a server message once and deliver it only to authenticated peers whose registry entry has the same `sessionId`. They skip:

- pending sockets that have not completed hello/auth;
- peers from a different session;
- disconnected or missing peer handles;
- explicit targets outside the message session.

No session data should be sent to a socket before hello/auth, and no presence, patch, snapshot, ack, or rejection should cross a session boundary.

## Legacy SSE boundary

`GET /api/events` remains the legacy Server-Sent Events channel for local-first, non-session map/sheet/library updates. It is not used for Track 2 session commands, acknowledgements, rejections, presence, heartbeat, reconnect, or session patches. Existing local workflows may still carry whole saved map/sheet payloads over SSE; live sessions must use `/api/sessions/socket` and server-authoritative commands instead.

## Named Cloudflare Tunnel expectations

LAN remains the primary supported Track 2 hosting path. For remote players, the supported path is a named Cloudflare Tunnel with a stable hostname pointing to the private GM-hosted Rotom Table server.

WebSocket-specific expectations for that named tunnel:

- publish the normal Rotom Table origin through the named tunnel, for example `https://table.example.com` forwarding to the local server port;
- preserve the `/api/sessions/socket` path so browsers connect with `wss://table.example.com/api/sessions/socket`;
- keep `ROTOM_ENABLE_SESSION_HOST=1` as an explicit per-session opt-in, and stop the app or unset the flag after play;
- treat Cloudflare Access or other edge controls as optional extra protection, not as a replacement for session-local GM/player validation;
- rely on heartbeat to keep quiet tables active, but still expect proxies, browsers, sleeping laptops, or network changes to close sockets sometimes;
- handle tunnel/proxy closure by reconnecting with `lastSeenRevision` and accepting snapshot fallback when replay is unavailable;
- do not commit tunnel credentials, tokens, private hostnames that should remain private, real `.env` files, GM keys, join codes, snapshots, or event logs.

Quick Tunnel is not the supported campaign-session deployment path. It may be useful only for temporary development smoke tests, and any use should be documented as unstable, ad hoc, and unsuitable for regular campaign play.

## Manual chunk-04 smoke expectations

A transport-only smoke check should verify:

1. With the host flag disabled, `/api/sessions/socket` fails closed.
2. With `ROTOM_ENABLE_SESSION_HOST=1`, a GM/player identity from the lobby can complete hello/auth.
3. A second client in the same session receives presence for joins/disconnects.
4. Heartbeat ping/pong continues while the table is idle.
5. A stale or closed socket reconnects with `lastSeenRevision` and receives either no snapshot when current or a filtered snapshot when stale.
6. Malformed, pre-auth, cross-session, or actor-mismatched frames receive safe errors and do not mutate state.
7. Legacy `/api/events` still works for non-session local-first realtime and is not used by session clients.

## Automated chunk-05 token command smoke coverage

`tests/server/sessionTokenCommandTwoClientSmoke.test.ts` is the chunk-05 two-client token-command smoke test. It opens authenticated GM and player WebSocket peers in the same session, assigns the player a token, and verifies that:

1. the player can send `moveToken` for the assigned token, receive an accepted `commandAck`, and both clients receive the same small `tokenMoved` patch;
2. the GM can send `turnToken` at the next revision, receive an accepted `commandAck`, and both clients receive the same small `tokenTurned` patch;
3. neither patch carries whole-map fields such as `placements` or `fieldEffects`;
4. the server-owned session/map revisions, persisted snapshot calls, socket revision tracking, and authoritative token position/facing all advance to revision 2.

This automated fake-peer smoke test does not replace later browser multi-tab, LAN, or named-tunnel smoke scripts; it locks the server-authoritative two-client command/fanout behaviour while those later operational checks are still pending.

## Related docs

- [Track 2 session protocol](track-2-session-protocol.md)
- [Track 2 session lobby and manual QA](track-2-session-lobby.md)
- [Track 2 session storage](track-2-session-storage.md)
- [Track 2 validation matrix](track-2-validation-matrix.md)
- [ADR 002: LAN first and named Cloudflare Tunnel second](adrs/002-lan-first-named-cloudflare-tunnel.md)
- [ADR 003: WebSocket session transport](adrs/003-websocket-session-transport.md)
- [ADR 004: Server-authoritative commands](adrs/004-server-authoritative-commands.md)
- [ADR 006: Revisions and conflict rules](adrs/006-revisions-and-conflict-rules.md)
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md)
