# ADR 003: WebSocket session transport

Date: 2026-05-25

Status: Accepted

## Context

Live session adds live GM-hosted table sessions where the GM's Rotom Table server is the authority for session state. During a session, multiple browser clients need to send table commands, receive command acknowledgements or rejections, see presence updates, receive accepted map/table patches, and reconnect without losing the authoritative revision.

The existing app may keep local-first and non-session realtime behaviour during migration, including any Server-Sent Events (SSE) paths that are still useful outside session mode. The new live session channel, however, needs bidirectional messaging with explicit ordering and session-scoped fanout. It also must work for the supported hosting modes: LAN first, and named Cloudflare Tunnel for remote players.

## Decision

live session concurrency uses **WebSockets** as the session transport.

Each live GM/player client connects to a session WebSocket endpoint after the GM has explicitly enabled session hosting. The WebSocket channel carries structured session messages for:

- hello/auth and reconnect handshakes;
- client commands;
- server command acknowledgements and rejections;
- accepted patch/event broadcasts;
- presence updates;
- heartbeat/keepalive messages;
- transport-level errors and safe close reasons.

Existing SSE code may remain for non-session or local-sync routes during the migration, but new Live session concurrency must not rely on SSE, polling, or whole-map autosave as the primary live transport.

The TypeScript message unions, validators, endpoint shape, and client composables are defined in the live-session implementation. This ADR locks the transport expectation they must follow.

## Rationale

### Bidirectional command flow

Session clients must send commands and receive authoritative results on one live channel. WebSockets provide a browser-native bidirectional stream that can carry a command from the client, an ack/reject from the server, and follow-up broadcasts without pairing a one-way stream with separate HTTP writes.

### Explicit ack/reject semantics

The server must be able to tell the sender whether a command was accepted, rejected as invalid/unauthorized/stale/conflicting, or treated as a duplicate `opId`. WebSocket messages make those command results part of the same session protocol, which helps clients reconcile optimistic UI and current revision state.

### Session-scoped broadcasts

Accepted changes should be fanned out as small session events or patches to connected clients in the same session. WebSockets support prompt fanout for token movement, HP changes, initiative, presence, and table events without every client autosaving or refetching whole map JSON.

### Heartbeat and stale connection detection

Long-lived table sessions need keepalive behaviour. The protocol will include heartbeat messages, such as ping/pong or an equivalent app-level message, so the server and client can detect stale sockets, update presence, and handle proxy/tunnel idle behaviour.

### Reconnect-safe state

A reconnecting client reports its last observed revision during the hello/reconnect handshake. The server then decides whether to replay available missed events or send the current snapshot. WebSockets keep this recovery path in the same live protocol as commands and broadcasts.

## Transport expectations

- A socket is scoped to exactly one session after a validated hello message.
- The first client message includes session identity and reconnect metadata; unauthenticated or malformed sockets are rejected safely.
- Inbound messages are validated before command dispatch.
- Command results are sent to the originating client as explicit ack/reject messages.
- Accepted authoritative changes are broadcast only to clients in the same session.
- Presence broadcasts never leak across sessions.
- Heartbeats are frequent enough to detect stale clients and avoid idle proxy/tunnel disconnect surprises where practical.
- Reconnect uses `lastSeenRevision` and falls back to the latest authoritative snapshot when replay is unavailable or unsafe.
- Session WebSocket hosting is guarded by the session-host runtime flag and does not turn the trust-based local role picker into public authentication.

## Rejected alternatives

### SSE as the live session channel

Rejected for new session concurrency. SSE is useful for one-way server-to-client updates, but Live session needs a bidirectional session channel for commands, acks/rejections, heartbeat, and reconnect handshakes. Keeping commands on separate HTTP requests while broadcasts arrive over SSE would complicate ordering, duplicate handling, and reconnect semantics. Existing SSE paths may remain outside session mode.

### HTTP polling or long polling

Rejected for live sessions. Polling would add latency, waste requests during quiet table periods, and make presence/heartbeat/reconnect behaviour less direct than a single socket. It can still be used for ordinary non-live endpoints where appropriate.

### Peer-to-peer or WebRTC authority

Rejected for Live session. Peer-to-peer transport would complicate NAT traversal, permissions, and authoritative conflict handling. Live session is explicitly GM-hosted: the GM's server remains the authority and clients communicate through it.

### Hosted realtime service

Rejected for Live session. A managed realtime service would introduce cloud dependency and operational assumptions that conflict with the local-first GM-hosted architecture. The session channel should run in the GM-controlled Rotom Table process.

## Consequences

- Session transport work must add a WebSocket server route or adapter and a client connection composable.
- Message schema work must include hello, heartbeat, command, ack/reject, snapshot, patch/event, presence, and error messages.
- Transport tests must cover handshake validation, heartbeat, malformed messages, reconnect, and session isolation.
- Hosting docs must account for WebSocket behaviour on LAN and through a named Cloudflare Tunnel.
- Legacy local-first workflows remain supported; this ADR only locks the transport for new live session concurrency.

## Validation notes

Reviewers can validate this ADR by checking that live-session work:

- uses WebSockets for live session commands, results, broadcasts, presence, heartbeat, and reconnect;
- keeps SSE, if present, limited to non-session/local migration paths;
- gates the session socket behind explicit session-host opt-in;
- validates hello and inbound message shapes before joining a session or applying commands;
- scopes fanout and presence to one session;
- implements reconnect with `lastSeenRevision`, replay when available, and snapshot fallback when needed.
