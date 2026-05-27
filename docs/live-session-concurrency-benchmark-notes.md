# Live session concurrency benchmark notes

This note records the current live-session multi-client concurrency benchmark notes for the command, LAN browser smoke, named-tunnel documentation, local-mode no-regression, security, and persistence/recovery boundaries. Read it with the [Live session command-flow maintenance](live-session-command-flow-maintenance.md), [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md), [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md), [Live session socket protocol](live-session-socket-protocol.md), and [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md).

Last checked: 2026-05-26

Current maintenance baseline: the locked live-session small-table concurrency posture is ready within explicit limitations. The current implementation behaves as a GM-hosted WebSocket session for a trusted table: accepted commands advance server-owned revisions, produce sender acknowledgements and small same-session patches, rejected stale/unauthorized commands do not advance revisions, and reconnect falls back to actor-scoped server snapshots when replay is unavailable. This document records behaviour and latency-sensitive paths; it is not a load test, WAN benchmark, browser FPS benchmark, or numeric latency SLA.

## Scope and measurement caveats

This note is intentionally conservative:

- It records observations from focused automated fake-WebSocket tests and the recorded LAN browser-client smoke on the local test host.
- The recorded LAN browser smoke used separate Chromium contexts through a private LAN URL rather than physically separate player devices because the test environment had one machine available.
- No live named Cloudflare Tunnel, public WAN path, real campaign map, private sheets, screenshots, join codes, GM keys, session snapshots, tunnel credentials, or real `.env` files were recorded.
- No millisecond latency target is claimed. Browser, filesystem, map size, local CPU/GPU load, Wi-Fi quality, and Cloudflare edge routing can all change user-visible latency.
- Operators should run the [deployment smoke checklist](live-session-deployment-smoke-checklist.md) on their real LAN or named-tunnel environment before trusting a campaign session.

## Expected behaviour for LAN and named-tunnel play

For both supported hosting paths, concurrency semantics are the same:

- One GM-hosted process owns the active session state. Session sockets send commands; accepted commands advance the server-owned session/map revision once, acknowledge the sender, and fan out small same-session patches to authenticated peers.
- Players who can see a map but lack a controllable assignment remain view-only. Their commands are rejected safely and do not advance revisions or fan out patches.
- Commands that touch the same token/resource from an older `baseRevision` are rejected as stale/conflicting when the server cannot prove they are safe. Commands on disjoint lanes may be accepted by handlers that explicitly support that conflict rule.
- Presence and heartbeat are liveness hints, not ordering authority; command order is the accepted server revision order.
- Browser optimistic previews are temporary. The accepted acknowledgement/patch, rejection, or snapshot fallback is the source of truth.

LAN expectation:

- On a healthy private Wi-Fi/wired LAN with a small table (one GM plus a few players), simple token moves/turns should usually feel near-immediate after the local optimistic preview because frames remain on the private network. Rotom Table still does not claim a millisecond SLA.
- The user-visible wait can become noticeable when the GM machine is CPU/GPU-bound, the map is large, filesystem writes are slow, Wi-Fi is weak, a firewall/proxy delays WebSockets, or a reconnect snapshot is large.
- If the same action repeatedly lands in the `1-3s` or `>3s` timing buckets, reduce map/render load where possible, check Wi-Fi/firewall conditions, and run the deployment smoke checklist before play.

Named-tunnel expectation:

- A named Cloudflare Tunnel uses the same server-authoritative command path but adds the browser-to-Cloudflare-to-GM-host round trip, TLS/WebSocket proxying, optional Access/WAF checks, and edge routing variance.
- Remote players should expect more jitter than LAN. Occasional reconnect banners or snapshot recovery can happen after browser sleep, network changes, edge policy interruptions, or GM host/tunnel restarts.
- The supported remote baseline is a stable named tunnel tested with actual players. Quick Tunnel and temporary `trycloudflare.com` URLs are not latency baselines for campaign sessions.

### Event replay and snapshot fallback

Current implementation detail: event replay is not available for reconnect (`replayAvailable: false`). Optional `events.jsonl` data is useful for audit/troubleshooting and future replay-oriented work, but reconnect should be treated as snapshot-first today. When a client is stale, omits `lastSeenRevision`, or reports a revision the server cannot prove safe, the server sends an actor-scoped authoritative snapshot fallback.

If a future implementation adds validated replay, update this document, the protocol docs, and the reconnect tests together. Until then, operators should size their maps with the expectation that reconnect recovery may transfer the visible snapshot.

### Before-game GM/player smoke checks

Recommended checks before a real game:

1. GM starts the intended host path (`npm run dev:session:lan` for LAN, or `npm run dev:session:tunnel` plus `cloudflared tunnel run` for a named tunnel) and opens `/sessions` through the same URL players will use.
2. Safety banner shows hosting enabled and the expected exposure (`LAN/private` or the deliberate remote/tunnel path) before any join code is shared.
3. GM starts the session and confirms any legacy session map is selected and visible to intended players.
4. Two player browser identities/devices join with safe display names, refresh **Visible session maps**, and open `/maps/<map-slug>?session=1`.
5. GM assigns at least one map token with **Assign map tokens** / **Assign control**; the assigned player sends a move or turn command and all clients see the same server-accepted result.
6. A view-only player tries the same token and sees no-token-assigned guidance or a safe unauthorized rejection.
7. One player reloads or briefly reconnects and recovers from the current authoritative state, using snapshot fallback if replay is unavailable.
8. GM records only generic timing buckets (`<250ms`, `250-1000ms`, `1-3s`, or `>3s`), checks for browser console errors/repeated reconnect banners, and confirms no generated session data or secrets are staged.

## Evidence summary

| Area | Behaviour observed | Evidence |
| --- | --- | --- |
| Integrated command sequence | One GM socket, two same-session player sockets, and one unrelated-session socket drove `moveToken`, `turnToken`, `modifyHp`, `modifyConditions`, and `nextInitiative` through the real WebSocket dispatcher. Accepted commands advanced revisions 1 through 5, wrote authoritative state as needed, and broadcast small same-session patches only. | `tests/server/sessionIntegratedCommandFlow.test.ts` and [Live session command-flow maintenance](live-session-command-flow-maintenance.md). |
| Same-session fanout | Accepted `tokenMoved`, `tokenTurned`, `hpModified`, `conditionsModified`, and `initiativeUpdated` patches reached same-session peers while the unrelated session received nothing. Patch messages intentionally omitted whole-map `placements`, `voxels`, and `fieldEffects` payloads in the integrated command-flow coverage. | `tests/server/sessionIntegratedCommandFlow.test.ts`, `tests/server/sessionTokenCommandTwoClientSmoke.test.ts`, and `server/utils/sessionWebSocketFanout.ts`. |
| Permission and conflict behaviour | An unassigned/view-only player move was rejected as `unauthorized`; a stale same-token move from revision 0 after accepted movement was rejected as `stale` with current authoritative token state. Neither rejection advanced the revision or wrote an accepted-command snapshot. | `tests/server/sessionIntegratedCommandFlow.test.ts`, `tests/server/applyMoveTokenCommand.test.ts`, and [Live session command-flow maintenance](live-session-command-flow-maintenance.md). |
| Reconnect behaviour | A stale reconnect with `lastSeenRevision: 0` received `snapshotRequired: true` and an actor-filtered snapshot because event replay is currently unavailable. The snapshot path stayed server-authoritative and did not trust browser-local state. | `tests/server/sessionWebSocketTransport.test.ts`, `tests/server/sessionIntegratedCommandFlow.test.ts`, and `server/utils/sessionWebSocketServer.ts`. |
| Heartbeat and liveness | The WebSocket server negotiates a 25 second heartbeat interval and a 60 second stale timeout. Heartbeat pings/pongs update liveness without incrementing revisions, and stale sockets close safely. | `server/utils/sessionWebSocketServer.ts` and `tests/server/sessionWebSocketTransport.test.ts`. |
| Browser LAN smoke | Three Chromium contexts (`GM browser`, `Player A browser`, `Player B browser`) connected through `http://<private-LAN-IP>:31091`, completed session start/join, received server hello messages at revision 2, observed same-session presence, and recovered a stale player reconnect with a snapshot. The smoke reported no page errors or warning/error console messages in the recorded run. | [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md). |
| Client integration | Explicit `/maps/<slug>?session=1` views use a session-authoritative map clone, WebSocket command dispatch, optimistic move confirmation, stale rejection reconciliation, reconnect refresh, and cleanup without mutating the local autosaved map document. | `tests/composables/map-editor/sessionClientIntegration.test.ts` and [Live session client integration](live-session-client-integration.md). |

## Latency-sensitive command path

A normal accepted command has this latency path:

1. The browser sends a JSON `command` frame over `WebSocket /api/sessions/socket` with an `opId`, `baseRevision`, actor, scopes, and typed payload.
2. The server validates the WebSocket message, authenticated socket actor, command envelope, permissions, resource visibility, and revision/conflict rules.
3. The server applies the command to authoritative in-memory state, increments the session/map revision exactly once, and persists the accepted state to local JSON where the command family requires a snapshot.
4. The server sends the acting socket a `commandAck` and fans out a small `patch` message to authenticated peers in the same session.
5. Session-mode clients reconcile optimistic UI from the ack/patch or roll back/reconcile from `commandReject`.

The local filesystem snapshot write is on the accepted-command path. On the local test host this path is covered functionally, but no dedicated disk-latency benchmark was recorded. Slow disks, network filesystems, very large map documents, or sheet-heavy command families can increase command acknowledgement latency.

## Behaviour observations

- Server authority remained deterministic in the checked multi-client sequence: accepted revisions were monotonic, duplicate/rejected operations did not create extra accepted revisions, and stale same-resource commands did not overwrite newer authoritative state.
- Same-session fanout used compact event patches rather than live-client whole-map autosaves, which keeps network payloads bounded by command output for movement, HP, conditions, initiative, hazards, field effects, terrain, and other implemented command families.
- Player-visible reconnect snapshots were filtered to the player identity, assignments, visible map state, and that player's connected-client rows; they did not include GM keys, join codes, hidden maps, or other players' assignment records.
- Optimistic token movement and facing are client-local previews. They make common LAN interactions feel immediate, but the final state remains the server ack/patch; rejection UI tells players to refresh or ask the GM rather than treating local previews as authority.
- Heartbeat detection is intentionally coarse for table play. A hard network loss may take up to the negotiated timeout window to show as stale/disconnected before reconnect snapshot recovery completes.
- Local mode stayed separate from session mode. Plain `/maps/<slug>` continues to use local-first autosave/SSE, while explicit `/maps/<slug>?session=1` uses WebSocket commands and authoritative session patches.

## Known performance limitations

These limits are acceptable for Live session and should remain explicit:

- The implementation is sized for a trusted small table, not a public high-concurrency service. Automated coverage exercises one GM plus two same-session players and an unrelated-session isolation peer; it is not a soak test for dozens of players.
- No real WAN/named-tunnel latency measurement is recorded here. A named Cloudflare Tunnel adds network and edge routing variables that each GM should smoke-test with their actual players.
- WebSocket peer state, connected-client presence, and recent duplicate-`opId` tracking are process-local. A restart requires snapshot recovery and loses transient liveness/recent-operation memory.
- Event replay is currently unavailable (`replayAvailable: false`), so stale reconnects use snapshot fallback unless a future validated replay implementation updates these docs and tests. For large visible maps, snapshot transfer and client-side scene reconciliation can dominate recovery time.
- Accepted command handlers persist local JSON snapshots. Snapshot size, sheet writes, filesystem speed, and fsync behaviour can affect acknowledgement/fanout timing.
- The current docs do not claim production abuse resistance, rate limiting, CAPTCHA, horizontal scaling, hosted databases, Redis, Durable Objects, or public multi-tenant isolation.
- Map renderer performance still matters. Session patches avoid whole-map network saves, but large terrain/hazard/effect scenes can still cost client rendering work after a patch is applied.
- Quick Tunnel remains development smoke-test only; temporary `trycloudflare.com` behaviour is not a campaign benchmark or supported remote latency baseline.

## Operator benchmark checklist

When a GM wants environment-specific numbers, record only generic, no-secret observations:

1. Start with `npm run dev:session:lan` or `npm run dev:session:tunnel` plus the named `cloudflared tunnel run` command.
2. Use one GM browser and at least two separate player browser identities/devices.
3. Verify the session map, assign at least one current map token, open `/maps/<map-slug>?session=1` for all clients, and perform a short sequence: token move, token turn, HP/condition change, initiative change, reconnect, and stale/conflict rejection.
4. Record rough user-visible timing buckets rather than secrets, for example: `<250ms`, `250-1000ms`, `1-3s`, or `>3s` from action to all clients showing the authoritative result.
5. Note whether any browser shows reconnect/stale banners, console errors, visible render jank, repeated rejected heartbeats, or slow snapshot recovery.
6. Check `git status --short` and remove local `data/sessions/` artifacts before committing docs or code.

Use placeholders such as `Player A`, `Player B`, `table.example.com`, `<private-LAN-IP>`, and `<map-slug>`. Do not paste real join codes, GM keys, player names, snapshots, event logs, private campaign files, tunnel tokens, screenshots with secrets, or real `.env` values.

## Concurrency checklist

- [x] Live session concurrency uses WebSocket commands, acks/rejections, patches, heartbeat, presence, and reconnect.
- [x] Accepted commands in the integrated checks advance revisions exactly once and fan out same-session patches only.
- [x] Unauthorized and stale same-resource commands reject safely without accepted revision or snapshot advancement.
- [x] Reconnect snapshot fallback is server-authoritative and actor-filtered when event replay is unavailable.
- [x] Expected LAN behaviour is documented as small-table, low-jitter, no-SLA behaviour that still depends on device, Wi-Fi, filesystem, and map/render load.
- [x] Expected named-tunnel behaviour is documented as the same server-authoritative path with extra Cloudflare, TLS/WebSocket proxy, edge-policy, and network-jitter variables.
- [x] Recommended before-game GM/player smoke checks cover start, join, assign, move, unauthorized/view-only rejection, reconnect snapshot recovery, timing buckets, and cleanup hygiene.
- [x] LAN browser smoke observed session start/join, WebSocket hello/presence, reconnect snapshot fallback, and no recorded browser console/page errors.
- [x] Known latency and scaling limitations are documented without adding public auth, SaaS hosting, cloud databases, Quick Tunnel campaign hosting, or browser-owned whole-map autosave.
