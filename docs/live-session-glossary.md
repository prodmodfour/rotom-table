# Live session glossary

This glossary defines the vocabulary used by the GM-hosted live session roadmap, ADRs, [session protocol](live-session-protocol.md), implementation areas, and tests.

## Product and hosting terms

| Term | Meaning |
| --- | --- |
| Live session | The workstream that adds GM-hosted multi-device session concurrency to Rotom Table. |
| GM-hosted session | A table session run by the GM on their own machine or a small machine they control. Players connect by browser. |
| Local mode | The existing local-first workflow where maps and sheets are edited through app routes and persisted as inspectable JSON files. |
| Session mode | The guarded live-session workflow where live clients send commands to a server-authoritative session instead of autosaving whole map documents. |
| LAN hosting | The primary supported Live session deployment path: GM and players are on the same local network or Wi-Fi. |
| Named Cloudflare Tunnel | The supported remote Live session path: a stable public hostname forwards to the private GM-hosted Rotom Table server. |
| Quick Tunnel | A temporary Cloudflare tunnel URL. It may be documented for development smoke tests only and is not the supported campaign-session path; see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md). |
| Public multi-tenant hosting | A SaaS-style deployment where unrelated groups share hosted infrastructure. This is a Live session non-goal. |
| Trust-based role picker | The current local GM/player/guest selector. It is convenient for local table use, but it is not hardened public authentication. |

## Identity and permission terms

| Term | Meaning |
| --- | --- |
| Session ID | Server-generated identifier for one table session. Used to scope state, sockets, snapshots, logs, and broadcasts. |
| GM key | Secret session-local credential proving a client is the GM for one session. It is not a long-lived account password. |
| Join code | Short session-local code players use to join the GM's current session. |
| Display name | Player-provided table name shown in lobby/presence UI. It is sanitized for display and is not an account identity. |
| Player ID | Server-generated session-local identifier for a joined player. |
| Client ID | Identifier for one browser/client instance. One player can reconnect or have more than one client over time. |
| Session actor | The GM or a player identity attached to a command or socket message. |
| Assignment | GM-managed record that gives a player control over specific sheets, tokens, or other resources. |
| Controllable resource | A token, sheet, or additional table resource that a player may command when assigned and visible. |
| Visible resource | A map, sheet, token, or state slice the player is allowed to see. Visibility does not always imply control. |
| Permission result | A structured allow/deny answer explaining whether an actor can perform an operation and why it was denied. |

## State and persistence terms

| Term | Meaning |
| --- | --- |
| Authoritative state | The server-owned session state that determines the real current map/session values during session mode. |
| Legacy session map state | The authoritative map-related state for a session, including selected map, tokens, terrain, hazards, field effects, initiative, and revision data as those features land. |
| Snapshot | JSON representation of the latest authoritative session state, written locally for recovery and reconnect fallback. |
| Atomic snapshot write | Persistence strategy that writes a temporary file and renames it into place so partial snapshot writes are avoided. |
| Event log | Optional append-only JSON-lines record of accepted commands/events. It supports audit/replay where available but is not a cloud database. |
| Recovery | Restart/reconnect path that restores authoritative session state from the latest valid local snapshot and optional events. |
| Idle cleanup | Policy for safely removing inactive in-memory sessions without deleting local snapshots unexpectedly. |

## Command vocabulary

| Term | Meaning |
| --- | --- |
| Command | A client request for the server to change authoritative session state. Examples include moving a token or modifying HP. |
| Command envelope | The common wrapper around a command payload, including `opId`, `baseRevision`, command type, actor/session metadata, and timestamp/metadata fields as needed. |
| Payload | The command-specific body inside the envelope, such as token ID and destination for a move-token command. |
| `opId` | Client-generated operation ID used to recognize duplicate submissions and make retries idempotent. |
| Duplicate command | A command with an `opId` the server has already processed for that session/client scope. It should be acknowledged or ignored idempotently instead of applied twice. |
| Ack | Server acknowledgement that a command was accepted, applied to authoritative state, and assigned a resulting revision. |
| Rejection | Server response that a command was not applied. It includes a safe reason and may include current authoritative state for reconciliation. |
| Invalid | Rejection reason for malformed messages, missing fields, impossible values, or schema violations. |
| Unauthorized | Rejection reason for commands the actor is not allowed to perform, such as a player controlling an unassigned token. |
| Stale | Rejection reason for a command based on an old revision where the same resource has changed and applying it would overwrite newer authoritative state. |
| Conflict | Rejection reason for a valid command that cannot be safely applied with current state, such as two same-resource operations that are incompatible. |
| Patch/event | Small broadcast that describes an accepted authoritative change without sending a whole-map autosave from a client. |
| Optimistic update | Client-side preview of a command before ack. It must reconcile with accepted patches or roll back on rejection. |

## Revision and conflict terms

| Term | Meaning |
| --- | --- |
| Revision | Monotonic server-owned number representing the authoritative session/map state version after accepted commands. |
| Initial revision | The revision assigned when a session starts from its initial authoritative snapshot. |
| `baseRevision` | The revision the client believed was current when it created a command. |
| Revision gap | Difference between the server's current revision and a command's `baseRevision`. Small gaps may be safe for commands touching unrelated resources. |
| Resource scope | The resource or state area a command touches, such as one token, one sheet, initiative, hazards, terrain, or field effects. |
| Same-resource conflict | A conflict where the command's resource scope changed after the command's `baseRevision`; stale same-token/same-resource commands are rejected. |
| GM precedence | Rule of thumb that GM commands generally win over player commands, while still passing validation and safety checks. |
| Idempotency | Guarantee that retrying the same accepted or rejected operation does not apply it a second time. |

## WebSocket and reconnect terms

| Term | Meaning |
| --- | --- |
| WebSocket session channel | The live bidirectional transport Live session uses for session commands, acks/rejections, broadcasts, presence, heartbeat, and reconnect handshakes. |
| Hello message | First client message on a socket, carrying session identity and reconnect metadata for validation. |
| Presence | Session-scoped connection status for the GM, players, and clients. Presence broadcasts must not leak across sessions. |
| Heartbeat | Ping/pong or equivalent keepalive messages used to detect stale connections and survive tunnel/proxy idle behaviour. |
| `lastSeenRevision` | Revision a reconnecting client reports so the server can decide whether to replay events or send a snapshot. |
| Replay | Sending missed events after reconnect when the server still has enough event history. |
| Snapshot fallback | Reconnect path where the server sends the latest snapshot because replay is unavailable or unsafe. |
| Broadcast fanout | Server delivery of presence, command results, events, and snapshots to the correct clients in one session only. |

## Safety and non-goal terms

| Term | Meaning |
| --- | --- |
| Session-host runtime flag | Explicit opt-in environment flag or equivalent setting, such as `ROTOM_ENABLE_SESSION_HOST=1`, required before hosting session endpoints/sockets. |
| Safety boundary | A documented limit that prevents local trust assumptions from being mistaken for public security guarantees. |
| Local-first JSON persistence | Continued use of local JSON files for app and session state instead of a hosted database service. |
| Whole-map autosave | Existing-style persistence of an entire map document. It remains useful in local mode but must not be the main live-session concurrency mechanism. |
| Cloud database | Hosted persistence such as Postgres, Redis, Durable Objects, or another managed service. Adding one is out of scope for Live session. |
| Private campaign data | User-created maps, sheets, generated campaign files, secrets, keys, tokens, private `.env` files, and similar local data that must not be committed. |

## Command lifecycle shorthand

1. **Create** — the client builds a command envelope with a new `opId` and current `baseRevision`.
2. **Validate** — the server checks message shape, identity, permissions, visibility, and command-specific rules.
3. **Apply or reject** — the server applies valid non-conflicting commands to authoritative state or returns a rejection.
4. **Revise** — accepted commands increment the server-owned revision.
5. **Persist** — the server writes a local snapshot and optionally appends an event-log entry.
6. **Ack/broadcast** — the sender receives the result and session clients receive the accepted patch/event.
7. **Reconnect** — clients that disconnect report `lastSeenRevision` and receive replay or snapshot fallback.
