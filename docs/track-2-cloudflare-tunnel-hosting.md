# Track 2 named Cloudflare Tunnel runbook

This runbook is the supported remote-player hosting path for Track 2 table sessions. The GM still runs Rotom Table on a machine they control; a named Cloudflare Tunnel gives trusted remote players a stable HTTPS hostname that forwards to that private server.

Use the [Track 2 LAN hosting runbook](track-2-lan-hosting.md) first when everyone is on the same network. Use this guide only when players are remote and the GM intentionally wants to publish a stable hostname such as `https://table.example.com` for a campaign session.

Named tunnel hosting keeps the locked Track 2 architecture intact: one GM-hosted server owns session authority, live clients use `WebSocket /api/sessions/socket`, commands are acknowledged or rejected by the server, state is persisted as local JSON snapshots/event logs, and browsers must not autosave whole maps as the live session concurrency mechanism.

## What this runbook does and does not do

This runbook covers a locally managed named Cloudflare Tunnel using `cloudflared` and a stable hostname in a domain managed by the GM or the GM's table group.

It does **not** make Rotom Table a SaaS service, public multi-tenant app, Cloudflare-hosted application, or cloud database deployment. Cloudflare carries traffic to the GM's private server; the authoritative session state and snapshots remain local on the GM machine.

It also does **not** make the existing `/login` GM/player role picker public authentication. For Track 2 sessions, authority still comes from:

- the explicit `ROTOM_ENABLE_SESSION_HOST=1` runtime flag;
- the session-local GM key and player join code;
- player IDs, client IDs, and safe display names created by the lobby;
- WebSocket hello/auth validation;
- server-side permission, revision, and conflict checks for every command.

Cloudflare Access or other edge controls can be useful extra protection, but they are not a replacement for Rotom Table's session-local validation.

Quick Tunnel is not the supported campaign-session path. It can appear only as a temporary development smoke-test option in the dedicated Quick Tunnel caveat docs; do not use `trycloudflare.com` URLs as the normal remote table URL.

## Before you start

Preflight checklist:

- [ ] LAN or same-machine session hosting already works with the explicit host flag.
- [ ] `cloudflared` is installed and `cloudflared --version` works.
- [ ] The GM controls a Cloudflare account and DNS zone for the hostname, for example `table.example.com`.
- [ ] The GM has chosen a stable hostname that is safe to share with trusted players.
- [ ] The GM machine can stay awake, online, and plugged in for the whole session.
- [ ] The working tree is clean enough that generated session files or private campaign data will be easy to spot before committing.
- [ ] The GM understands that publishing a tunnel exposes the normal Rotom Table origin, not only one lobby page.
- [ ] Tunnel credentials, `cert.pem`, tokens, private keys, real `.env` files, GM keys, join codes, snapshots, and event logs will stay out of the repository.

Useful verification before a remote session:

```bash
npm run typecheck
npm test
npm run build
```

## Create the named tunnel

The commands below use `rotom-table` as the tunnel name and `table.example.com` as the public hostname. Replace both with values controlled by the GM.

Authenticate `cloudflared` to the Cloudflare account:

```bash
cloudflared tunnel login
```

This opens a browser and writes local Cloudflare credentials such as `cert.pem` under the user's `~/.cloudflared/` directory. Keep those files outside the repository.

Create the named tunnel:

```bash
cloudflared tunnel create rotom-table
```

Record the tunnel UUID printed by the command. `cloudflared` also writes a credentials JSON file under `~/.cloudflared/<TUNNEL-UUID>.json`. Treat that file as a credential.

Route the stable hostname to the named tunnel:

```bash
cloudflared tunnel route dns rotom-table table.example.com
```

The DNS route and the running tunnel are separate. The hostname can exist even while the tunnel is stopped, but it will not serve Rotom Table unless `cloudflared tunnel run rotom-table` is connected and the local Rotom Table server is running.

## Configure ingress

Create a local `cloudflared` configuration file outside the repo. One common path is `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /home/<you>/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: table.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Notes:

- Use the tunnel UUID from `cloudflared tunnel create rotom-table`.
- On Windows, use the matching credentials path for that machine instead of `/home/<you>/...`.
- Keep this config and the credentials JSON outside `workspace/rotom-table` unless you create a redacted example file in a future docs-only change.
- The `service: http://localhost:3000` line points Cloudflare to the local Nuxt server. Players still use `https://table.example.com`.
- Keep the catch-all `http_status:404` rule so unexpected hostnames do not silently route into Rotom Table.

Dashboard-managed tunnels are also acceptable if they publish the same stable hostname to the same local service and preserve `/api/sessions/socket`. This CLI example is the repeatable reference for Track 2 docs.

## Start the remote session host

For tunnel hosting, prefer binding Rotom Table to loopback so the public path is the named tunnel rather than an additional LAN listener:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000
```

PowerShell equivalent:

```powershell
$env:ROTOM_ENABLE_SESSION_HOST = "1"
npm run dev -- --host 127.0.0.1 --port 3000
```

Then start the named tunnel in another terminal:

```bash
cloudflared tunnel run rotom-table
```

Keep both terminals open for the whole session. If the GM laptop sleeps, changes networks, the Nuxt process exits, or `cloudflared` disconnects, players will lose the live session and need to reconnect.

If the GM intentionally wants LAN access at the same time, use the LAN runbook and make that exposure explicit. Do not bind to `0.0.0.0` casually just because remote players are using a tunnel.

## GM setup flow

1. Start Rotom Table with `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000`.
2. Start `cloudflared tunnel run rotom-table`.
3. On the GM machine, open `https://table.example.com/login` and choose **GM Login**.
4. Open `https://table.example.com/sessions#gm-lobby-title` so the safety banner evaluates the same public hostname players will use.
5. Confirm the safety banner reports session hosting enabled and a deliberate remote/tunnel exposure. If it reports disabled, stop and restart Rotom Table with the runtime flag. If it reports a surprising host, do not share the join code until the tunnel/DNS path is understood.
6. Press **Start GM session**.
7. Confirm the lobby shows a session ID, revision, and player join code. The GM key must not be copied into chat or shown in screenshots.
8. Share only the stable player URL and join code with trusted players, for example:

   ```text
   Open https://table.example.com/sessions#player-lobby-title and enter the join code I will send separately.
   ```

9. After players join, use **Refresh lobby** to verify player display names and assignment counts.
10. When the table is ready, open the session map intentionally with `?session=1`, for example `https://table.example.com/maps/viridian-gym?session=1`.

The plain `/maps/<slug>` route remains local-first. Use it for normal local editing; use `/maps/<slug>?session=1` when the live remote table should use server-authoritative session commands.

## Player join flow

Players should use a separate browser profile, browser container, or private/incognito window from any GM browser identity.

1. Open the GM-provided URL, for example `https://table.example.com/sessions#player-lobby-title`.
2. If Cloudflare Access or another edge check is enabled, complete that check first.
3. Enter the join code and a display name.
4. Press **Join session**.
5. Confirm the player summary shows the expected display name, active session status, and current revision.
6. Open the explicit session map only after joining, for example `https://table.example.com/maps/viridian-gym?session=1`.
7. If a command is rejected as unauthorized, ask the GM to assign the relevant token or sheet. If it is rejected as stale/conflicting, use the in-app refresh/reconnect guidance before retrying.

Players should not receive GM keys, raw snapshots, local session files, private maps/sheets, Cloudflare credentials, tunnel tokens, or the GM's Cloudflare account access.

## WebSocket and Cloudflare considerations

Track 2 clients resolve the session socket from the current browser origin. Through the named tunnel, this means:

```text
https://table.example.com            -> wss://table.example.com/api/sessions/socket
https://table.example.com/sessions   -> wss://table.example.com/api/sessions/socket
```

Operational expectations:

- Preserve the `/api/sessions/socket` path. Do not rewrite it to a different service.
- Do not add a Cloudflare rule that caches `/sessions`, `/maps/*`, `/api/sessions/*`, or WebSocket responses. Aggressive cache rules can serve stale lobby/session data.
- Keep the tunnel service as normal HTTP forwarding to the local Nuxt origin, for example `service: http://localhost:3000`.
- Cloudflare Access, WAF rules, or IP restrictions may be layered in front of the app for trusted tables, but Rotom Table session-local identity and server permissions still decide table authority.
- The current session heartbeat negotiates a 25 second interval and 60 second timeout. This keeps quiet tables active, but browsers, proxies, sleeping laptops, and network changes can still close WebSockets.
- When a socket closes, clients should reconnect with `lastSeenRevision`; if replay is unavailable, the server sends an actor-scoped snapshot fallback rather than making stale browser state authoritative.
- Use `https://` public pages so browsers connect with `wss://`. Do not ask players to manually enter a separate socket URL.

## Remote smoke checklist

Use this quick pass before relying on a named tunnel for play:

- [ ] `cloudflared tunnel run rotom-table` connects without errors.
- [ ] `https://table.example.com/sessions#gm-lobby-title` loads from the GM browser through the public hostname.
- [ ] The safety banner reports hosting enabled and expected remote/tunnel exposure.
- [ ] GM starts a session and sees a join code without exposing the GM key.
- [ ] A player on a different network opens `https://table.example.com/sessions#player-lobby-title`, joins with a display name, and appears in the GM lobby.
- [ ] GM and player open `https://table.example.com/maps/<map-slug>?session=1`.
- [ ] A basic token move/turn or other supported session command propagates through the session view without a whole-map autosave.
- [ ] Reloading the player session map reconnects or requests a snapshot rather than making stale browser state authoritative.
- [ ] No generated `data/sessions/` files, join codes, GM keys, tunnel credentials, real `.env` files, or private campaign data are staged for commit.

You can reuse the local smoke helper to print the public URLs:

```bash
npm run smoke:session:multi-tab -- --base-url https://table.example.com --map <map-slug> --no-open
```

The helper remains a browser/tab aid; this runbook remains the source for named-tunnel setup, WebSocket expectations, safety warnings, and rollback.

## Troubleshooting

| Symptom | Likely cause | What to check |
| --- | --- | --- |
| Public hostname does not resolve | DNS route missing, wrong zone, or DNS propagation delay | Re-run `cloudflared tunnel route dns rotom-table table.example.com`; verify the hostname is in the Cloudflare DNS zone you control. |
| Cloudflare error page or bad gateway | Tunnel is not running, ingress points at the wrong port, or Nuxt is stopped | Confirm `cloudflared tunnel run rotom-table` is connected and Rotom Table is listening on `http://localhost:3000`. |
| Safety banner says hosting disabled | Runtime flag was not set when Nuxt started | Stop Rotom Table and restart with `ROTOM_ENABLE_SESSION_HOST=1`; changing the environment variable after startup is not enough. |
| Safety banner says local while testing remote | The GM opened `localhost` instead of the public hostname | Reopen `/sessions` through `https://table.example.com/sessions#gm-lobby-title` before sharing the join code. |
| Safety banner shows an unexpected hostname | DNS, proxy, Access, or tunnel config points somewhere unintended | Do not share the join code until the public hostname and target service are understood. |
| Player blocked before the lobby | Cloudflare Access/WAF/DNS policy or browser security prompt | Confirm the player is allowed by the optional edge policy; remember Access is extra protection, not Rotom Table session auth. |
| WebSocket stays disconnected/reconnecting | Tunnel or browser closed the socket, laptop slept, cached/proxied path, or Access challenge interrupted the socket | Keep the GM host awake, disable aggressive cache rules for session paths, verify `wss://table.example.com/api/sessions/socket` reaches the app, then reload or use the reconnect/snapshot banner. |
| Player can join but cannot move a token | Player has not been assigned that token/sheet or the command is GM-only | The GM must assign controllable resources for player commands; GM-only commands remain GM-only. |
| Command rejected as stale/conflict | Another accepted command changed the same resource first | Refresh the session snapshot, inspect current state, and retry from the latest table state. |
| Local files changed after the smoke | Session snapshots/event logs are local runtime data | `data/sessions/` is ignored/private. Do not commit session files, generated private sheets, tunnel credentials, GM keys, join codes, screenshots with secrets, or real `.env` files. |

## Roll back or shut down exposure

For normal end-of-session shutdown:

1. Ask players to stop sending commands and close session-map tabs.
2. In each browser profile that should not remember the table identity, use **Forget in this browser** from `/sessions`.
3. Stop `cloudflared tunnel run rotom-table` with `Ctrl+C`.
4. Stop the Nuxt process with `Ctrl+C`.
5. Unset the runtime flag in shells that keep environment variables:

   ```bash
   unset ROTOM_ENABLE_SESSION_HOST
   ```

   PowerShell:

   ```powershell
   Remove-Item Env:ROTOM_ENABLE_SESSION_HOST
   ```

6. Check `git status --short` and make sure no private campaign data, generated session snapshots/event logs, join codes, GM keys, tunnel credentials, or real `.env` files are staged.

For emergency rollback after accidental exposure or a leaked hostname/join code:

1. Stop `cloudflared` first. The public hostname should stop reaching the GM machine even if the DNS record still exists.
2. Stop Rotom Table or restart it without `ROTOM_ENABLE_SESSION_HOST=1` so session endpoints and sockets fail closed.
3. Start a new Rotom Table session to rotate the join code if the old code was shared too widely.
4. Remove or disable the public hostname/CNAME in the Cloudflare dashboard if the hostname should not remain routable. Do not rely on an undocumented DNS-delete CLI command.
5. If the tunnel itself is being retired, delete it from the Cloudflare dashboard or run `cloudflared tunnel delete rotom-table` after active connections are stopped, then securely remove local credentials that are no longer needed.
6. Review Cloudflare Access/WAF/DNS settings before re-enabling the hostname.
7. Check the repository and any shared evidence for screenshots, logs, real hostnames that should remain private, GM keys, join codes, session snapshots, event logs, tunnel credentials, or real `.env` files.

Back up local session snapshots only if the GM intentionally wants a private recovery copy. See [Track 2 session storage](track-2-session-storage.md) for snapshot/event-log backup and recovery guidance.

## Boundaries

- LAN hosting remains the primary supported Track 2 path; named Cloudflare Tunnel is the supported remote path for trusted remote players.
- Quick Tunnel is not the supported campaign-session path.
- The existing `/login` GM/player picker is not public auth.
- Cloudflare Access is optional extra protection, not a replacement for Rotom Table session-local GM/player validation.
- The session join code and GM key are session-local credentials, not full accounts.
- Do not add a database, cloud persistence layer, SaaS deployment target, Durable Objects, Redis, Postgres, or shared-document autosave model to make tunnel hosting work.
- Keep Track 1 map rendering and local-first workflows intact; explicit session mode is entered through `/maps/<slug>?session=1`.
