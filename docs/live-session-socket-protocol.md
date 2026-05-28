# Legacy live-session socket protocol

This document is retained for maintainers of the guarded `WebSocket /api/sessions/socket` code. The socket is not part of normal profile-based map play.

Normal play uses persistent player profiles and regular `/maps/<slug>` saved-map documents. Linked character refs determine sheet editing and token control. See [Player profiles and linked character control](player-profiles.md).

## Legacy socket boundary

The legacy socket route remains behind `ROTOM_ENABLE_SESSION_HOST=1`. A client must complete a session-local hello/auth handshake before any legacy command messages are accepted. The server should continue to reject unauthenticated, cross-session, malformed, stale, or unauthorized commands safely.

Legacy session messages may include hello/helloError, heartbeat ping/pong, presence, command acknowledgement/rejection, patch, and snapshot frames. They must not expose GM keys, join codes, hidden maps, raw snapshots, private sheet data, local files, tunnel credentials, or other secrets to unauthorized clients.

## Current normal realtime boundary

Profile-based saved-map and sheet updates use the normal app APIs plus `/api/events` realtime updates. Document-backed token action endpoints enforce selected-profile control server-side and publish saved-map updates to other viewers. Players do not open a special session route or join a session socket to control linked tokens.

## Maintenance checklist

- [ ] Socket routes fail closed without `ROTOM_ENABLE_SESSION_HOST=1`.
- [ ] Session-local identity values are treated as secrets or continuity hints as appropriate.
- [ ] Player-filtered snapshots do not include hidden maps, GM keys, join codes, other players' private state, or raw campaign files.
- [ ] Legacy socket tests remain isolated from the normal `/maps/<slug>` profile-control path.
- [ ] No documentation tells players to use live sessions for normal profile-based play.

Run standard validation after changes:

```bash
npm run typecheck
npm test
npm run build
```

See [Legacy live-session protocol](live-session-protocol.md), [Live session lobby and manual QA](live-session-lobby.md), [Live session public exposure checks](live-session-public-exposure-checks.md), and [Live session security boundaries](live-session-security-boundaries.md).
