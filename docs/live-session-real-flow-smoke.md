# Live session real-flow smoke script

Use this helper when you want an automated same-machine check of the complete live session command path against a running Rotom Table dev server. It starts a real GM session through HTTP, attaches a saved map, joins two players, assigns one map token, opens live session sockets, sends a player `moveToken` command, verifies patch fanout, reconnects the second player for an actor-scoped snapshot fallback, and then cleans up local smoke data where possible.

This script complements, but does not replace, the [LAN hosting runbook](live-session-lan-hosting.md), [named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md), [deployment smoke checklist](live-session-deployment-smoke-checklist.md), and [multi-tab browser helper](live-session-multi-tab-smoke.md). It is intended for quick operator confidence before or after manual browser/device checks.

## Start Rotom Table first

Run the guarded session host in one terminal:

```bash
npm run dev:session:lan
```

For a loopback-only named-tunnel setup, start with `npm run dev:session:tunnel` and point the smoke helper at the tunnel hostname or local loopback URL as appropriate. Plain `npm run dev` is expected to fail this smoke because live session routes and the session socket fail closed without `ROTOM_ENABLE_SESSION_HOST=1`.

## Run the real-flow helper

From another terminal:

```bash
npm run smoke:session:real-flow
```

By default the helper creates a temporary smoke map under ignored local map storage, makes it player-visible, places two tokens, attaches it to the new live session, assigns the first token to Player A, and removes the temporary map plus `data/sessions/<session-id>` after the socket/reconnect checks pass.

Use an existing saved map when you want to smoke a real campaign map shape:

```bash
npm run smoke:session:real-flow -- --map <map-slug> --token <token-id>
```

If `--token` is omitted for an existing map, the first placement with an ID is used. Existing maps are left unchanged by cleanup.

Useful options:

```bash
npm run smoke:session:real-flow -- --base-url http://127.0.0.1:3000
npm run smoke:session:real-flow -- --map <map-slug> --token <token-id> --to 3,0,4
npm run smoke:session:real-flow -- --player-a Leaf --player-b Blue
npm run smoke:session:real-flow -- --timeout-ms 12000
npm run smoke:session:real-flow -- --dry-run
npm run smoke:session:real-flow -- --keep-smoke-map
npm run smoke:session:real-flow -- --keep-session-data
```

## What the helper verifies

The smoke exercises production HTTP routes and the live session socket route:

1. Creates or loads a saved map.
2. Calls `POST /api/sessions/start` with the local GM role cookie.
3. Calls `POST /api/sessions/maps/attach` with the session-local GM key held only in memory.
4. Calls `POST /api/sessions/join` twice with the generated join code held only in memory.
5. Calls `POST /api/sessions/assignments` to grant Player A control of one token resource on the selected session map.
6. Calls `POST /api/sessions/player-state` for Player B to confirm the attached map is visible.
7. Opens three `WebSocket /api/sessions/socket` clients for GM, Player A, and Player B.
8. Sends Player A's `moveToken` session command at the current session revision.
9. Verifies the accepted command acknowledgement and same-session `tokenMoved` patches for all three sockets.
10. Reconnects Player B with the previous revision and verifies the reconnect snapshot includes the accepted token position while remaining player-scoped.
11. Closes smoke sockets, deletes the generated smoke map unless kept for debugging, and removes the generated session snapshot directory unless kept for inspection.

## Secret and data hygiene

The helper never prints GM keys or join codes. Output uses redacted session identifiers and generic Player A/Player B labels unless you pass custom display names. It does not write `.env` files, tunnel credentials, screenshots, public accounts, databases, or cloud storage configuration.

Generated runtime data remains under ignored paths:

- temporary smoke maps: `data/maps/`;
- live session snapshots/event logs: `data/sessions/`.

Cleanup is best effort. If the helper is interrupted, rerun `git status --short` and inspect ignored local data before committing. Do not commit private campaign maps, generated session snapshots, event logs, GM keys, join codes, tunnel credentials, real player names, screenshots with secrets, or real `.env` files.

## When to use manual checks instead

Use the deployment smoke checklist when you need evidence from real player devices, LAN firewall behaviour, named-tunnel WebSocket behaviour, browser UI assignment panels, initiative actions, stale/conflict rejection, or table-readiness copy. This script proves the core start → attach → join → assign → session socket → move → reconnect path quickly; real table readiness still benefits from a manual browser/device pass.
