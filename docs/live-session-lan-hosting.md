# Live session LAN hosting runbook

This runbook is the supported same-network hosting path for live sessions. The GM runs Rotom Table on a machine they control, enables the session host explicitly, and players connect from browsers on the same Wi-Fi or wired LAN.

LAN hosting keeps the locked Live session architecture intact: one GM-hosted server owns session authority, live clients use `WebSocket /api/sessions/socket`, commands are acknowledged or rejected by the server, state is persisted as local JSON snapshots/event logs, and browsers must not autosave whole maps as the live session concurrency mechanism.

For the lobby flow itself, see [live session lobby and manual QA](live-session-lobby.md). For attaching the saved map to server-owned session state before players open it, see the [Live session map attachment flow](live-session-map-attachment.md). For no-secret warnings around unsafe host startup and missing session-local credentials/state, see [Live session public exposure checks](live-session-public-exposure-checks.md). For local multi-tab token propagation checks, see [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md). For the recorded LAN browser-client pass, see [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md). For the fuller two-player deployment smoke covering reconnect, token movement, initiative, and conflict rejection, see the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md). For expected concurrency and latency behaviour, see the [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md). For private snapshot/event-log backups and restores, see [Live session backup and recovery](live-session-backup-recovery.md). For trust boundaries, join-code limits, and non-hardened areas, see the [Live session security review](live-session-security-review.md). For dependency inventory, Node/Nitro compatibility, and runtime flag assumptions, see the [Live session dependency and runtime review](live-session-dependency-runtime-review.md). For remote play over the internet, use the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md); do not use ad-hoc public exposure as the LAN path.

## Before you start

Use this runbook when all players are on the same trusted local network.

Preflight checklist:

- [ ] The GM machine is on a private network the GM controls or trusts.
- [ ] Players are on the same Wi-Fi/LAN, not a guest network with client isolation enabled.
- [ ] At least one actual player device can be available for a rehearsal before play; do not rely only on tabs on the GM machine.
- [ ] Dependencies are installed with `npm install`.
- [ ] The working tree is clean enough that generated session files or private campaign data will be easy to spot before committing.
- [ ] The GM has chosen the existing local **GM Login** role before starting a session.
- [ ] The GM understands the local role picker is a trust switch for local use, not hardened public authentication.
- [ ] The GM is not port-forwarding the dev server through a router and is not using Quick Tunnel for a campaign session.

Useful verification before a real table session:

```bash
npm run typecheck
npm test
npm run build
```

## Start the LAN host

Session hosting is disabled unless the exact runtime flag is set. For a development LAN session, use the dedicated helper script:

```bash
npm run dev:session:lan
```

The helper sets `ROTOM_ENABLE_SESSION_HOST=1` for the Nuxt child process and starts Nuxt with the safe LAN defaults `--host 0.0.0.0 --port 3000`. To inspect the resolved command without starting Nuxt:

```bash
npm run dev:session:lan -- --print-only
```

If you need a different port, keep the port in the player URL:

```bash
npm run dev:session:lan -- --port 3001
```

Manual macOS/Linux equivalent:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000
```

PowerShell equivalent:

```powershell
$env:ROTOM_ENABLE_SESSION_HOST = "1"
npm run dev -- --host 0.0.0.0 --port 3000
```

Notes:

- `--host 0.0.0.0` is what makes the dev server listen on the LAN interface. Without it, `localhost` may work only on the GM machine.
- The helper does not create a `.env` file, account, GM key, join code, session snapshot, or tunnel credential; it only starts the local Nuxt process with the explicit runtime gate and LAN binding.
- Keep the terminal open for the whole session. If the GM laptop sleeps, changes networks, or stops the process, players will disconnect and need to reconnect.
- The WebSocket route uses the same origin and port as the browser page. Players do not need a separate socket URL; `http://192.168.1.42:3000` resolves the socket as `ws://192.168.1.42:3000/api/sessions/socket`.
- See [live session host runtime scripts](live-session-host-runtime.md) for the helper's tunnel mode, dry-run output, and shutdown notes.

## Find the GM machine's LAN address

Nuxt often prints a `Network:` URL after startup. Prefer that private URL if it appears. If not, find an IPv4 address on the active Wi-Fi or wired interface.

Common commands:

| Platform | Command | What to use |
| --- | --- | --- |
| macOS Wi-Fi | `ipconfig getifaddr en0` | The printed IPv4 address, often `192.168.x.x` or `10.x.x.x`. |
| macOS fallback | `ifconfig | grep "inet "` | Use the non-`127.0.0.1` address for the active interface. |
| Linux | `hostname -I` | Use the first private IPv4 address for the active LAN. |
| Linux detailed | `ip -4 addr show scope global` | Use the `inet` address on Wi-Fi or Ethernet, without the `/24` suffix. |
| Windows PowerShell/CMD | `ipconfig` | Use the `IPv4 Address` under the active Wi-Fi or Ethernet adapter. |

Good LAN addresses usually look like one of these private ranges:

- `192.168.x.x`
- `10.x.x.x`
- `172.16.x.x` through `172.31.x.x`

Do not give players `localhost`, `127.0.0.1`, `0.0.0.0`, a `169.254.x.x` link-local address, or a public IP address. `localhost` always means "this same device," so on a player laptop it points at the player laptop, not the GM host.

Example player-facing base URL:

```text
http://192.168.1.42:3000
```

## Real-device rehearsal before play

Run a short rehearsal from the actual phones, tablets, or laptops players expect to use at the table. Local tabs on the GM machine and the automated smoke helpers are useful, but they do not prove Wi-Fi isolation, firewall prompts, browser profile storage, or device-specific WebSocket behaviour.

Use the same private base URL the players will use during the game, for example `http://<GM-LAN-IP>:3000`:

1. GM starts the host with `npm run dev:session:lan` and opens `/sessions#gm-lobby-title` through the LAN URL.
2. Each player device opens `/sessions#player-lobby-title` through the LAN URL, joins with a safe display name, and confirms the remembered player summary loads without using the GM browser profile.
3. GM opens the saved map on `/maps/<map-slug>`, presses **Attach current map to live session**, and refreshes the lobby.
4. Each player device refreshes the remembered session and confirms the map appears under **Visible session maps**.
5. GM uses **Assign map tokens** and **Assign control** for the token each player should test.
6. GM and players open `/maps/<map-slug>?session=1` and verify the session socket connects, reconnects after a page reload, and shows the same current map state.
7. An assigned player moves or turns only their assigned token; an unassigned player should see the no-token-assigned guidance or an unauthorized rejection instead of moving the authoritative token.
8. End the rehearsal by closing session-map tabs and using **Forget in this browser** on player devices that should not keep the remembered session identity.

If any actual player device cannot load `/sessions`, connect the session socket, see **Visible session maps**, or send an assigned session command, fix that device/network issue before play instead of falling back to `localhost` or plain local-first map editing.

### Rehearsal recovery drills

- **No-map-attached recovery** — before the GM attaches a map, player devices can join but should not see a usable session map link. The GM opens the saved map on the plain route, presses **Attach current map to live session** with player visibility, then players refresh the remembered session until the map appears under **Visible session maps**.
- **No-token-assigned recovery** — after the map is visible, leave one player unassigned briefly and confirm token controls are disabled or unauthorized. The GM uses **Assign map tokens** and **Assign control** for the relevant current map token or sheet; the player refreshes/reconnects the session map and retries only after the assignment appears.

## LAN latency and concurrency expectations

A healthy private Wi-Fi or wired LAN should be the lowest-jitter live-session path for a small trusted table. Simple token moves, turns, and table actions should usually feel responsive after the local optimistic preview, but Rotom Table does not promise a millisecond latency target.

Command order is the server's accepted revision order, not the order browsers display local previews. Same-resource stale commands reject safely, view-only players remain unauthorized until the GM assigns control, and presence/heartbeat only report liveness. Event replay is currently unavailable for reconnect, so stale reconnects use an actor-scoped snapshot fallback rather than trusting browser-local state.

Before play, run the real-device rehearsal above or the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md). If repeated actions land in the `1-3s` or `>3s` timing buckets from the [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md), check Wi-Fi quality, firewall prompts, GM-machine load, map/render size, and local disk speed before starting the game.

## GM setup flow

1. Start Rotom Table with `npm run dev:session:lan` (manual equivalent: `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000`).
2. On the GM machine, open `http://localhost:3000/login` or `http://<GM-LAN-IP>:3000/login` and choose **GM Login**.
3. Open `http://<GM-LAN-IP>:3000/sessions#gm-lobby-title` so the safety banner evaluates the same LAN URL that players will use.
4. Confirm the safety banner reports hosting enabled and a LAN/private-network exposure. If it reports disabled, stop and restart with the runtime flag. If it reports remote or unknown unexpectedly, do not share the URL until the network path is understood. A no-active-session warning is expected before step 5; missing credentials, missing authoritative state, or unknown readiness are blockers.
5. Press **Start GM session**.
6. Confirm the lobby shows a session ID, revision, and player join code, and that the safety readiness no longer warns about missing session-local credentials or authoritative state. The GM key must not be shown in page chrome or copied into chat.
7. Open the saved map on the plain `/maps/<map-slug>` route, confirm intended edits are saved, and press **Attach current map to live session** in the map navigation rail.
8. Confirm the attached map is selected and available for session mode.
9. Share only the player-facing base URL and join code with trusted players, for example:

   ```text
   Open http://192.168.1.42:3000/sessions#player-lobby-title and enter the join code I will send separately.
   ```

10. After players join, use **Refresh lobby** to verify player display names, visible map state, and assignment counts.
11. In the map navigation rail, use **Assign map tokens** and **Assign control** for each player/token that should act on the selected session map. Map visibility lets players open the map; token assignment lets them send token commands.
12. When the table is ready, open the session map intentionally with `?session=1`, for example `http://192.168.1.42:3000/maps/viridian-gym?session=1`.

The plain `/maps/<slug>` route remains local-first. Use it for normal local editing; use `/maps/<slug>?session=1` when the live table should use server-authoritative session commands.

## Player join flow

Players should use a separate browser profile, browser container, or private/incognito window from any GM browser identity.

1. Join the same Wi-Fi/LAN as the GM.
2. Open the GM-provided URL, for example `http://192.168.1.42:3000/sessions#player-lobby-title`.
3. Enter the join code and a display name.
4. Press **Join session**.
5. Confirm the player summary shows the expected display name, active session status, and current revision.
6. Refresh the remembered session and open the attached map from **Visible session maps**, or use the explicit session map URL after the GM confirms attachment, for example `http://192.168.1.42:3000/maps/viridian-gym?session=1`.
7. If a command is rejected as unauthorized, ask the GM to assign the relevant token or sheet. If it is rejected as stale/conflicting, use the in-app refresh/reconnect guidance before retrying. If the session socket is disconnected, wait for reconnect or refresh the session map rather than using the plain local-first map as authority.

Players should not use `http://localhost:3000` unless Rotom Table is running on their own machine. They should not receive GM keys, raw snapshots, local session files, private maps/sheets, or router/tunnel credentials.

## LAN smoke checklist

Use this quick pass before relying on a LAN session for play. For the expanded two-player pass that also covers initiative, reconnect, and conflict rejection across LAN and named tunnels, use the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md).

- [ ] GM starts with `npm run dev:session:lan` (or the manual equivalent `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000`).
- [ ] GM opens `/sessions` through the private LAN URL and confirms the safety banner classifies the exposure as LAN/private.
- [ ] Player opens `http://<GM-LAN-IP>:3000/sessions#player-lobby-title` from a different device and can load the page.
- [ ] GM starts a session, attaches the saved map from `/maps/<map-slug>`, and confirms it is available as the selected session map.
- [ ] Player joins with a display name and the join code, then sees the attached map in **Visible session maps** after refresh.
- [ ] GM refreshes the lobby and sees the player exactly once.
- [ ] GM uses the **Assign map tokens** panel to assign any token/sheet resources the player should control; the player sees no token assigned guidance until assignment exists.
- [ ] GM and player open `http://<GM-LAN-IP>:3000/maps/<map-slug>?session=1`.
- [ ] A basic token move/turn or other supported session command propagates through the session view without a whole-map autosave.
- [ ] Reloading the player session map reconnects or requests a snapshot rather than making stale browser state authoritative.
- [ ] The plain `http://<GM-LAN-IP>:3000/maps/<map-slug>` route still behaves as local-first mode.
- [ ] No generated `data/sessions/` files, join codes, GM keys, or private campaign data are staged for commit.

## Common live-session blockers

Resolve these before play; they are expected operator states, not reasons to bypass session mode.

- **Host flag disabled** — `/sessions` reports hosting disabled, or attach/join/session socket calls fail closed. Stop Nuxt and restart with `ROTOM_ENABLE_SESSION_HOST=1`, preferably through `npm run dev:session:lan`.
- **No map attached** — players can join but no **Visible session maps** link appears. The GM opens the saved map on the plain route and presses **Attach current map to live session** with player visibility.
- **No token assigned** — a player can see the selected session map but token controls are disabled or commands reject as unauthorized. The GM uses **Assign map tokens** to grant control for the relevant current map token or sheet.
- **Stale revision** — a command was built from an older table revision after another accepted command changed the same resource. Use the in-app refresh/reconnect action, inspect the current state, then retry only if the action still makes sense.
- **Disconnected socket** — the session map banner reports disconnected or reconnecting. Keep the GM host awake, verify firewall/network reachability, and refresh the session map snapshot instead of sending local-first edits.

You can reuse the existing local smoke helper to print LAN URLs by passing the LAN base URL:

```bash
npm run smoke:session:multi-tab -- --base-url http://<GM-LAN-IP>:3000 --map <map-slug> --no-open
```

The helper is still a local browser aid; this runbook remains the source for cross-device LAN setup and network troubleshooting.

## Troubleshooting

| Symptom | Likely cause | What to check |
| --- | --- | --- |
| Player browser cannot load the page | Server is bound only to localhost, wrong IP/port, firewall block, or network isolation | Restart with `--host 0.0.0.0`; confirm the URL includes the printed/private IP and port; make sure both devices are on the same Wi-Fi/LAN; disable guest/client isolation; allow Node/Nuxt through the OS firewall. |
| Player used `localhost` and sees nothing or another app | `localhost` points to the player device | Use `http://<GM-LAN-IP>:3000`, not `localhost`, from player devices. |
| Safety banner says hosting disabled | Runtime flag was not set when Nuxt started | Stop the server and restart with `ROTOM_ENABLE_SESSION_HOST=1`; changing the environment variable after startup is not enough. |
| Safety banner says local while testing LAN | The GM opened `localhost` | Reopen `/sessions` through `http://<GM-LAN-IP>:3000/sessions` to verify the player-facing path. |
| Safety banner says remote or unknown unexpectedly | The request may be coming through a proxy, tunnel, VPN, public hostname, or unusual interface | Do not share the join code until the path is understood. For remote play, use the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) rather than improvising public exposure. |
| Safety banner says no active session, missing credentials, or missing authoritative state | The host is reachable before GM startup, or in-memory session startup state is incomplete | Start the GM session before sharing a code. If credentials/state are missing after start, stop hosting and start a fresh session or recover from a trusted private snapshot. |
| Join code fails | Code was copied incorrectly, the session ended, or the player has stale browser identity | Re-copy the current code from the GM lobby, refresh the GM lobby, use **Forget in this browser** on stale clients, then join again. |
| WebSocket stays disconnected/reconnecting | Network changed, laptop slept, firewall/proxy closed the socket, or the browser is on a different network | Keep the GM host awake, reload the player page, use the reconnect/snapshot banner, and verify `ws://<GM-LAN-IP>:3000/api/sessions/socket` is not blocked by local security software. |
| Player joined but has no session map link | The GM has not attached a saved map, attached it GM-only, or the player has not refreshed after attachment | Attach the saved map with player visibility, then have the player refresh the remembered session. |
| Player can see the session but cannot move a token | Player has not been assigned that token/sheet or the resource is not visible | The GM must assign controllable resources for player commands; GM-only commands remain GM-only. |
| Command rejected as stale/conflict | Another accepted command changed the same resource first | Refresh the session snapshot, inspect current state, and retry from the latest table state. |
| Local files changed after the smoke | Session snapshots/event logs are local runtime data | `data/sessions/` is ignored/private. Do not commit session files, generated private sheets, GM keys, join codes, screenshots with secrets, or real `.env` files. |

Firewall hints:

- macOS may prompt to allow incoming connections for Node or the terminal app.
- Windows may prompt through Windows Defender Firewall; allow access only on private networks you trust.
- Linux users with `ufw` can temporarily allow the dev port with `sudo ufw allow 3000/tcp` and remove that rule after the session if it is no longer needed.

## Shut down after play

1. Ask players to stop sending commands and close session-map tabs.
2. In each browser profile that should not remember the table identity, use **Forget in this browser** from `/sessions`.
3. Stop the Nuxt process with `Ctrl+C`.
4. Unset the runtime flag in shells that keep environment variables:

   ```bash
   unset ROTOM_ENABLE_SESSION_HOST
   ```

   PowerShell:

   ```powershell
   Remove-Item Env:ROTOM_ENABLE_SESSION_HOST
   ```

5. Remove any temporary firewall rule if you added one only for the session.
6. Check `git status --short` and make sure no private campaign data, generated session snapshots/event logs, join codes, GM keys, tunnel credentials, or real `.env` files are staged.

Back up local session snapshots only if the GM intentionally wants a private recovery copy. See [live session storage](live-session-storage.md) for snapshot/event-log layout details and [Live session backup and recovery](live-session-backup-recovery.md) for private backup/restore steps.

## Boundaries

- LAN hosting is the primary supported Live session path; remote players should use the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) with a stable hostname.
- Quick Tunnel is not the supported campaign-session path; see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) before using a temporary `trycloudflare.com` URL for development smoke tests.
- The existing `/login` GM/player picker is not public auth.
- The session join code and GM key are session-local credentials, not full accounts; see the [Live session security review](live-session-security-review.md) for join-code limits and incident response.
- Do not add a database, cloud persistence layer, SaaS deployment target, or shared-document autosave model to make LAN hosting work.
- Keep map rendering quality and local-first workflows intact; explicit session mode is entered through `/maps/<slug>?session=1`.
