# Legacy live-session host runtime scripts

The `dev:session:*` scripts are retained for direct maintenance of the old guarded session endpoints and socket. They are not required for normal profile-based play.

For normal play, run:

```bash
npm run dev
```

Then use **GM Login**, `/players`, **Player Login**, and regular `/maps/<slug>` pages. Players can browse Pokédex and PTU reference pages without session hosting.

## Legacy helper commands

LAN maintenance host:

```bash
npm run dev:session:lan
```

Named-tunnel maintenance host with loopback binding:

```bash
npm run dev:session:tunnel
```

Manual equivalents:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000
```

Useful options:

```bash
npm run dev:session:lan -- --port 3001
npm run dev:session:lan -- --print-only
```

The helpers set the explicit `ROTOM_ENABLE_SESSION_HOST=1` runtime gate for the Nuxt child process. They do **not** write `.env` files, create public accounts, create share links, expose GM keys in documentation, or make live sessions public authentication.

## Safety boundaries

- Use these helpers only for `/sessions` and `/api/sessions/*` maintenance smoke checks.
- Keep generated `data/sessions/` snapshots/event logs, GM keys, join codes, tunnel credentials, private maps/sheets, screenshots with secrets, and real `.env` files out of git.
- Quick Tunnel remains temporary development smoke-test only.
- The remaining session socket uses `WebSocket /api/sessions/socket` and server-side validation; do not replace profile-based play with session-owned map authority.

See [Player profiles and linked character control](player-profiles.md), [Local development](local-development.md), [Live session LAN hosting runbook](live-session-lan-hosting.md), and [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md).
