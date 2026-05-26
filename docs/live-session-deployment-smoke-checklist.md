# Live session deployment smoke checklist

Use this checklist before trusting a live session on either supported deployment path: same-Wi-Fi/LAN or a named Cloudflare Tunnel with a stable hostname. It is a repeatable operator checklist, not a record that a specific environment has passed; operators can copy the evidence template and fill in observed results.

The smoke keeps the locked Live session architecture intact: the GM runs the server, session hosting is explicitly enabled, live clients use `WebSocket /api/sessions/socket`, accepted changes are server-authoritative command patches, reconnect uses authoritative state, and runtime data stays in local JSON snapshots/event logs. Do not use this checklist to introduce public accounts, SaaS hosting, a cloud database, or whole-map browser autosave as the live concurrency model.

Related runbooks:

- [Live session LAN hosting runbook](live-session-lan-hosting.md) for private same-network setup, IP discovery, and firewall troubleshooting.
- [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md) for the recorded browser-client LAN pass.
- [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) for stable remote hostname setup, WebSocket considerations, and rollback.
- [live session host runtime scripts](live-session-host-runtime.md) for `npm run dev:session:lan` and `npm run dev:session:tunnel` helper details.
- [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md) for local tab helpers and focused automated token/client checks.
- [Live session real-flow smoke script](live-session-real-flow-smoke.md) for an automated same-machine start, attach, join, assign, session socket token move, reconnect snapshot, and cleanup pass.
- [Live session map attachment flow](live-session-map-attachment.md) for attaching saved maps to server-owned session state before players open session maps.
- [Live session security boundaries](live-session-security-boundaries.md) for trust boundaries, join-code limits, tunnel exposure risks, and incident response.
- [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md) for dependency inventory, runtime flags, Node/Nitro compatibility, and Cloudflare assumptions.
- [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) for latency-sensitive behaviour observations, operator timing buckets, and known performance limits.

## Smoke scope

Run the same functional scenario in each deployment mode you plan to use:

1. GM starts a guarded session.
2. GM attaches the saved map to server-owned session state.
3. Two players join from separate browser identities and can see the attached map.
4. GM assigns controllable resources needed for player actions with **Assign map tokens**.
5. GM and both players open the explicit session map route.
6. A token move propagates to all clients as a small authoritative patch.
7. An initiative change propagates to all clients as a small authoritative patch.
8. A player/client reconnects and receives current authoritative state.
9. A stale/conflicting same-resource command is rejected safely.
10. Cleanup leaves no secrets or private runtime data staged for commit.

Use generic names in notes such as `GM`, `Player A`, `Player B`, `table.example.com`, and `<map-slug>`. Do not paste real join codes, GM keys, snapshots, event logs, private player names, Cloudflare tokens, tunnel credentials, screenshots with secrets, or real `.env` values into evidence.

## Preflight for both modes

- [ ] The target map exists, is saved, and has at least one placed token that can be moved and one initiative entry or token that can be placed into initiative.
- [ ] The GM browser and each player browser use separate profiles, browser containers, private windows, or devices so session-local identities do not overwrite each other.
- [ ] The GM has chosen **GM Login** in the existing local `/login` role picker. This trust picker is not public authentication.
- [ ] The working tree is clean before the smoke: `git status --short` prints no private campaign/runtime files.
- [ ] Standard checks passed recently, preferably through the project validation: `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] The GM has reviewed the [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) and is ready to record generic timing buckets such as `<250ms`, `250-1000ms`, `1-3s`, or `>3s` without pasting secrets or private campaign data.
- [ ] Optional focused checks passed before manual deployment smoke:

  ```bash
  npm test -- tests/server/sessionTokenCommandTwoClientSmoke.test.ts tests/server/sessionInitiativeWebSocketDispatch.test.ts tests/composables/map-editor/sessionClientIntegration.test.ts
  ```

- [ ] The GM understands that `data/sessions/`, optional `events.jsonl`, generated sheets, join codes, GM keys, tunnel credentials, private keys, and real `.env` files must stay out of git.
- [ ] Quick Tunnel is not being used for a campaign-session smoke. If a temporary `trycloudflare.com` URL is used for development only, use the [Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) instead of this deployment checklist.

## Common failure states to verify

A deployment smoke should prove the happy path and that common recovery paths are understandable:

- **Host flag disabled** — starting without `ROTOM_ENABLE_SESSION_HOST=1` must leave `/sessions`, attach-map, assignment, and session socket behaviour fail-closed.
- **No map attached** — players may join, but **Visible session maps** remains empty and the session map route must not claim authoritative readiness until the GM attaches the saved map.
- **No token assigned** — a player who can see the attached map but lacks a token assignment receives disabled controls or an unauthorized rejection instead of moving the authoritative token.
- **Stale revision** — a command sent from an older revision is rejected safely and does not advance the accepted session revision.
- **Disconnected socket** — reload or network interruption shows reconnect/disconnected UI and recovers through replay or an actor-scoped snapshot without whole-map autosave.

## LAN deployment lane

Use this lane when all smoke participants are on the same trusted Wi-Fi or wired LAN.

### Start and exposure

- [ ] Start Rotom Table with the guarded LAN helper:

  ```bash
  npm run dev:session:lan
  ```

  Manual equivalent: `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000`.
- [ ] Find the GM machine's private IP address and use a player-facing base URL such as `http://<GM-LAN-IP>:3000`.
- [ ] Do not give players `localhost`, `127.0.0.1`, `0.0.0.0`, a link-local address, a public IP, or a router port-forward URL.
- [ ] GM opens `http://<GM-LAN-IP>:3000/sessions#gm-lobby-title` and confirms the safety banner reports hosting enabled and LAN/private exposure.
- [ ] A pre-start warning about no active session is acceptable. Missing credentials, missing authoritative state after session start, disabled hosting, remote exposure, or unknown readiness are blockers.

### Two-player reachability

- [ ] Player A opens `http://<GM-LAN-IP>:3000/sessions#player-lobby-title` from a separate browser identity or device.
- [ ] Player B opens the same player lobby URL from a separate browser identity or device.
- [ ] Both player browsers can load `/sessions` without using the GM's browser profile.
- [ ] If either browser cannot load the page, resolve LAN binding, firewall, guest Wi-Fi/client isolation, IP, or port issues before continuing.

## Named Cloudflare Tunnel deployment lane

Use this lane for trusted remote players over a stable hostname that points a named Cloudflare Tunnel to the GM-controlled Rotom Table server.

### Start and exposure

- [ ] The named tunnel and DNS route already exist, for example `rotom-table` and `https://table.example.com`.
- [ ] Start Rotom Table with the guarded tunnel helper:

  ```bash
  npm run dev:session:tunnel
  ```

  Manual equivalent: `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000`.
- [ ] Start the named tunnel in a second terminal:

  ```bash
  cloudflared tunnel run rotom-table
  ```

- [ ] GM opens `https://table.example.com/sessions#gm-lobby-title` through the public hostname and confirms the safety banner reports hosting enabled and the expected remote/tunnel exposure.
- [ ] Confirm `/api/sessions/socket` resolves as `wss://table.example.com/api/sessions/socket`; do not rewrite or cache `/sessions`, `/maps/*`, `/api/sessions/*`, or WebSocket responses.
- [ ] Cloudflare Access/WAF rules, if enabled, are treated only as optional outer protection. Rotom Table authority still comes from session-local identity, WebSocket hello/auth, permissions, revisions, and conflict checks.
- [ ] Quick Tunnel and temporary `trycloudflare.com` URLs are not accepted for this lane.

### Two-player reachability

- [ ] Player A opens `https://table.example.com/sessions#player-lobby-title` from a remote network or separate browser identity and passes any optional Cloudflare Access check.
- [ ] Player B opens the same player lobby URL from a separate browser identity and, ideally, a different network from Player A.
- [ ] Both player browsers can load `/sessions` over HTTPS and do not see GM keys, raw snapshots, local files, tunnel credentials, or Cloudflare account data.
- [ ] If either browser cannot load the page or is blocked by an Access/WAF/cache rule, fix the tunnel/DNS/edge policy before continuing.

## Shared functional scenario

Run this scenario after completing either the LAN lane or the named-tunnel lane. Replace `<base-url>` with `http://<GM-LAN-IP>:3000` or `https://table.example.com`.

### 1. Start session and join two players

- [ ] GM browser: open `<base-url>/login` and confirm **GM Login** is active.
- [ ] GM browser: open `<base-url>/sessions#gm-lobby-title` and press **Start GM session**.
- [ ] GM browser: confirm a session ID, current revision, and player join code appear; the GM key is not shown in page chrome or copied into shared chat.
- [ ] GM browser: open `<base-url>/maps/<map-slug>`, press **Attach current map to live session**, and confirm the selected map is available for session mode.
- [ ] Player A browser: join from `<base-url>/sessions#player-lobby-title` with the join code and a safe display name such as `Player A`.
- [ ] Player B browser: join from the same URL with a separate display name such as `Player B`.
- [ ] GM browser: press **Refresh lobby** and verify both players appear exactly once.
- [ ] Player browsers: refresh remembered session state and verify each player sees only their own identity, assignment summary, current revision, safe session status, and the attached map in **Visible session maps**.
- [ ] GM browser: use the map navigation rail **Assign map tokens** panel to assign at least one current map token to Player A. Leave another visible player without that token assignment if you want to verify the no token assigned rejection path.

### 2. Open session map and verify presence

- [ ] GM browser: open `<base-url>/maps/<map-slug>?session=1`.
- [ ] Player A browser: open `<base-url>/maps/<map-slug>?session=1`.
- [ ] Player B browser: open `<base-url>/maps/<map-slug>?session=1`.
- [ ] The session/presence panel shows the current session and three connected browser identities: GM, Player A, and Player B.
- [ ] The plain `<base-url>/maps/<map-slug>` route remains local-first and is not used for the live smoke actions after attachment.

### 3. Token move propagation

- [ ] Use the GM browser, or Player A after the GM has assigned the relevant controllable token/sheet, to move one placed token in the explicit session-map view.
- [ ] The acting browser may show an optimistic preview, then confirms the accepted command from server authority.
- [ ] GM, Player A, and Player B all see the same final token position without refreshing.
- [ ] The accepted update arrives as a small session patch such as `tokenMoved`, not as a live-client whole-map autosave.
- [ ] No player-facing rejection banner appears for the accepted move.
- [ ] If Player B is not assigned the token, a Player B attempt to move it is rejected as unauthorized and does not move the authoritative token.

### 4. Initiative propagation

- [ ] GM uses the initiative controls from the explicit session-map view to set or advance initiative for the smoke token, for example `setInitiative`, `nextInitiative`, or `previousInitiative`.
- [ ] GM, Player A, and Player B all see the same initiative state, active turn, and/or round after the server acknowledgement.
- [ ] The accepted update arrives as a small session patch such as `initiativeUpdated` and advances the displayed revision.
- [ ] If a player attempts a GM-only initiative action, it is rejected safely as unauthorized and does not advance initiative.

### 5. Reconnect and snapshot recovery

- [ ] In Player B's session-map browser, reload the page or briefly disconnect/reconnect the network.
- [ ] Player B sees a reconnecting/disconnected/stale indicator while the socket is recovering.
- [ ] Player B reconnects with remembered session identity and last-known revision; if replay is unavailable, the server sends an actor-scoped snapshot fallback.
- [ ] After recovery, Player B sees the token position and initiative state that the GM and Player A currently see.
- [ ] Stale browser-local state does not become authoritative, and no whole-map save is sent from the reconnecting browser.

### 6. Conflict rejection

- [ ] Prepare a stale same-resource action against the same token or initiative lane. For token movement, one practical setup is two actor-capable browsers/tabs starting from the same displayed revision: accept one token move first, then send the other stale same-token move. For initiative, accept one `nextInitiative`/`setInitiative` change first, then attempt a stale same-lane initiative change from the older revision.
- [ ] If the current UI cannot reliably freeze an older `baseRevision`, run the focused automated command tests listed in preflight and record the manual conflict step as blocked by tooling rather than skipped silently.
- [ ] The first command is accepted and increments the authoritative revision once.
- [ ] The stale/conflicting command receives a safe `commandReject` with reason `stale` or `conflict` and player-safe current-state guidance.
- [ ] GM and both players continue to see the authoritative token/initiative state from the accepted command.
- [ ] The rejected command does not increment the authoritative revision, write a snapshot as an accepted change, expose hidden permission payloads, or leak GM keys/join codes.

### 7. Cleanup and data hygiene

- [ ] Player A and Player B close session-map tabs and use **Forget in this browser** if their identities should not remain remembered.
- [ ] GM closes session-map/lobby tabs after recording generic evidence.
- [ ] Stop the Nuxt process with `Ctrl+C`.
- [ ] For named-tunnel smoke, stop `cloudflared tunnel run rotom-table` with `Ctrl+C` before leaving the machine.
- [ ] Unset the runtime flag in shells that keep environment variables:

  ```bash
  unset ROTOM_ENABLE_SESSION_HOST
  ```

  PowerShell:

  ```powershell
  Remove-Item Env:ROTOM_ENABLE_SESSION_HOST
  ```

- [ ] Check `git status --short` and confirm no generated `data/sessions/` files, optional event logs, private maps/sheets, generated sheets, real hostnames that should stay private, screenshots with join codes, GM keys, tunnel credentials, private keys, or real `.env` files are staged.

## Evidence template

Keep evidence generic. Fill this table for each mode tested without pasting secrets or private campaign data.

| Item | Expected | LAN observed | Named tunnel observed |
| --- | --- | --- | --- |
| Startup | `npm run dev:session:lan` for LAN or `npm run dev:session:tunnel` plus `cloudflared tunnel run rotom-table` for named tunnel | | |
| Safety banner | LAN/private for `http://<GM-LAN-IP>:3000`; expected remote/tunnel for `https://table.example.com` | | |
| Two players | Player A and Player B join from separate browser identities and appear once in GM lobby | | |
| Session map | GM, Player A, and Player B open `<base-url>/maps/<map-slug>?session=1` | | |
| Token assignment | GM uses **Assign map tokens** so Player A can control one current map token while unassigned players remain view-only | | |
| Token move | Accepted token move propagates to all clients as `tokenMoved` or equivalent small patch | | |
| Initiative | Accepted initiative action propagates to all clients as `initiativeUpdated` or equivalent small patch | | |
| Reconnect | Reload/disconnect recovers from remembered identity with current authoritative state or snapshot fallback | | |
| Conflict rejection | Stale/conflicting same-resource command receives safe `commandReject` and does not advance revision | | |
| Local-mode boundary | Plain `/maps/<map-slug>` remains local-first and is not used as session authority | | |
| Cleanup | Runtime flag/tunnel stopped, browser identities cleared as needed, no secrets or private runtime data staged | | |

## Pass, fail, or block guidance

- **Pass** only when both players can join, observe token and initiative patches, survive reconnect, and see a safe conflict rejection in the deployment mode being tested.
- **Fail** when the app starts but any required smoke behaviour is incorrect, unsafe, or inconsistent across clients.
- **Block** when the environment cannot exercise a step, such as no second player device, no stable tunnel hostname, or no reliable way to produce an old `baseRevision` manually. Record the blocker and the automated checks that still covered the behaviour.

## Boundaries

- LAN remains the primary supported Live session path; a named Cloudflare Tunnel with a stable hostname is the supported remote path.
- Quick Tunnel is development smoke-test only and is not the campaign-session deployment path.
- The existing `/login` role picker is not public authentication.
- Live session-local identity uses GM keys, join codes, player IDs, client IDs, display names, and GM-managed assignments; it is not a full account system.
- WebSocket commands, acknowledgements/rejections, presence, heartbeat, reconnect, and patch fanout are the live session channel. Legacy SSE remains only for non-session/local flows during migration.
- Do not add Postgres, Redis, Durable Objects, a hosted database, public multi-tenancy, or SaaS deployment to satisfy this checklist.
- Do not commit private campaign data, generated sheets, session snapshots, optional event logs, tunnel credentials, secrets, private keys, screenshots with secrets, or real `.env` files.
