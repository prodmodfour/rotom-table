# Track 2 session host runtime scripts

This guide documents the npm helpers for starting a guarded Track 2 session host during local development and table smoke testing. The helpers do not change the Track 2 architecture: a GM-controlled Rotom Table process remains the authoritative session server, clients use `WebSocket /api/sessions/socket`, and live table actions flow through server-authoritative command envelopes instead of whole-map autosave.

Use the mode that matches the supported hosting path:

| Mode | Command | Binding | Use for |
| --- | --- | --- | --- |
| LAN / same Wi-Fi | `npm run dev:session:lan` | `0.0.0.0:3000` | Trusted players on the same private network. |
| Named Cloudflare Tunnel | `npm run dev:session:tunnel` | `127.0.0.1:3000` | Remote players through a stable named tunnel hostname. |

The plain `npm run dev` script remains local-first development and does not enable session hosting by itself.

## What the helpers set

Both helpers run the existing Nuxt development server with the explicit runtime gate set for the child process:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host <safe-host> --port 3000
```

They do **not** write `.env` files, create accounts, mint public authentication, start Cloudflare, expose tunnel credentials, generate join codes by themselves, or commit snapshots. Session IDs, GM keys, join codes, player IDs, and client IDs are still created only through the guarded `/sessions` lobby after the server starts.

The helpers print the resolved command and safety reminders before starting Nuxt. To inspect the command without starting the server:

```bash
npm run dev:session:lan -- --print-only
npm run dev:session:tunnel -- --print-only
```

To use another port, pass it to the helper and include that port in player URLs:

```bash
npm run dev:session:lan -- --port 3001
npm run dev:session:tunnel -- --port 3001
```

## LAN mode

Use LAN mode when every participant is on the same trusted private network:

```bash
npm run dev:session:lan
```

This is equivalent to:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000
```

`--host 0.0.0.0` is intentional for LAN play: it lets player browsers reach the Nuxt server through the GM machine's private IP address. It is not public authentication and should not be combined with router port forwarding or improvised public exposure.

After startup, open `/sessions` through the player-facing private URL, for example:

```text
http://192.168.1.42:3000/sessions#gm-lobby-title
http://192.168.1.42:3000/sessions#player-lobby-title
```

Then use explicit session map URLs such as:

```text
http://192.168.1.42:3000/maps/<map-slug>?session=1
```

See the [Track 2 LAN hosting runbook](track-2-lan-hosting.md) for IP discovery, firewall troubleshooting, smoke checks, and cleanup. See [Track 2 public exposure checks](track-2-public-exposure-checks.md) for the safety banner warnings that appear when the host is reachable before an active session-local GM key, join code, and authoritative state are ready.

## Named tunnel mode

Use named tunnel mode when trusted remote players connect through a stable Cloudflare Tunnel hostname:

```bash
npm run dev:session:tunnel
```

This is equivalent to:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000
```

`--host 127.0.0.1` keeps Nuxt on loopback so the intended public path is the named tunnel, not an extra LAN listener. Start the tunnel in another terminal, for example:

```bash
cloudflared tunnel run rotom-table
```

Players use the stable public hostname and the same app paths:

```text
https://table.example.com/sessions#player-lobby-title
https://table.example.com/maps/<map-slug>?session=1
wss://table.example.com/api/sessions/socket
```

See the [Track 2 named Cloudflare Tunnel runbook](track-2-cloudflare-tunnel-hosting.md) for setup, ingress config, WebSocket considerations, safety warnings, and rollback steps. See [Track 2 public exposure checks](track-2-public-exposure-checks.md) before sharing a remote URL if the safety banner reports missing credentials, no active session, or unknown readiness.

## Safe operating boundaries

- Session hosting remains disabled unless the runtime flag is present in the process that runs Nuxt.
- The `/login` GM/player role picker remains a trust-based local UI switch, not public auth.
- Share only the player-facing base URL and join code with trusted players; never share GM keys, local session files, raw snapshots, tunnel credentials, real `.env` files, or private campaign data.
- LAN and named Cloudflare Tunnel are the supported Track 2 hosting paths. Quick Tunnel remains temporary development smoke-test only; see the [Track 2 Quick Tunnel caveat](track-2-quick-tunnel-caveat.md).
- Live session clients must use `/maps/<slug>?session=1` and WebSocket command flow. Plain `/maps/<slug>` remains local-first.
- Before committing, run `git status --short` and confirm generated `data/sessions/` snapshots/event logs, join codes, GM keys, screenshots with secrets, and private campaign JSON are not staged.
- For private session archives and restores after hosting, use the [Track 2 session backup and recovery runbook](track-2-session-backup-recovery.md); do not turn backups into a cloud database or public shared drive.

## Shutdown

1. Ask players to stop sending commands and close session-map tabs.
2. Use **Forget in this browser** in GM/player browser profiles that should not remember session-local identity.
3. Stop the Nuxt process with `Ctrl+C`.
4. Stop `cloudflared tunnel run ...` if named tunnel mode was used.
5. If you manually exported `ROTOM_ENABLE_SESSION_HOST` in the shell, unset it:

   ```bash
   unset ROTOM_ENABLE_SESSION_HOST
   ```

   PowerShell:

   ```powershell
   Remove-Item Env:ROTOM_ENABLE_SESSION_HOST
   ```

6. Check the working tree before committing.
