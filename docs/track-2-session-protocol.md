# Track 2 session protocol

This document describes the shared TypeScript protocol contracts introduced for Track 2 session mode. It records the wire vocabulary that later server and client tickets must use when they add the session store, WebSocket endpoint, lobby UI, command handlers, and reconnect behaviour.

This is a contract document, not a claim that the WebSocket runtime is already complete. The current shared contracts live in `shared/` and are covered by focused Vitest tests; command-specific payload contracts such as `moveToken` land in later command tickets. See [Track 2 session storage](track-2-session-storage.md) for the operational snapshot/event-log layout, backup guidance, and recovery limitations.

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
| `shared/sessionCommandResults.ts` | accepted, rejected, duplicate, stale, unauthorized, invalid, conflict result shapes | Results are the server's authoritative answer to a submitted command. |
| `shared/sessionMessages.ts` | WebSocket message unions | Defines client `hello`, `heartbeat`, `command` messages and server `hello`, `heartbeat`, `commandAck`, `commandReject`, `snapshot`, `patch`, `presence`, and `error` messages. |
| `shared/sessionState.ts` | authoritative session state model | Defines the server-owned session snapshot shape: selected map slug, session/map revisions, map documents, connected clients, joined players, and GM-managed assignments. |

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

`server/utils/sessionCleanup.ts` defines the server-side lifecycle policy for in-memory session records. The default policy treats an active session as idle after 12 hours without server-owned activity and retains ended in-memory records for 24 hours before pruning them. Server-owned activity includes store updates plus authoritative state/presence timestamps, so future heartbeat, reconnect, command, join, and assignment paths should touch the store or state when a client is still active.

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

The server validates the identity and replies with a server `hello`. If replay is unavailable or unsafe, `snapshotRequired` is true and a `snapshot` message follows.

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
  "snapshotRequired": false,
  "replayFromRevision": 41
}
```

### 2. Snapshot and presence

The server sends snapshots for initial load, reconnect fallback, recovery, permission changes, or manual sync. Presence messages are session-scoped and must never fan out across sessions.

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

### 4. Client command

The client wraps a command envelope in a client `command` message. The `moveToken` payload below is illustrative until the token command tickets define exact payload contracts.

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
        }
      }
    ],
    "payload": {
      "tokenId": "token_pikachu",
      "mapSlug": "thickerby-vale",
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

## Accepted command example

When a command is valid, authorized, and non-conflicting, the server applies it to authoritative state, advances the revision once, persists the authoritative change, replies to the sender with `commandAck`, and broadcasts a small `patch` event to relevant clients in the same session.

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
- The sender may receive both the ack and the broadcast patch depending on later fanout policy, but the ack remains the command result.

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

Invalid rejections include structured validation issues. Unauthorized, stale, and conflict rejections may include safe current state for reconciliation.

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
- [ADR 003: WebSocket session transport](adrs/003-websocket-session-transport.md)
- [ADR 004: Server-authoritative commands](adrs/004-server-authoritative-commands.md)
- [ADR 005: Session identity and permissions](adrs/005-session-identity-and-permissions.md)
- [ADR 006: Revisions and conflict rules](adrs/006-revisions-and-conflict-rules.md)
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md)
