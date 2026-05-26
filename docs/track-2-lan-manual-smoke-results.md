# Track 2 LAN manual smoke results

This document records the ticket 091 LAN browser smoke pass. It is evidence from one autonomous build host; it does not replace the operator [Track 2 LAN hosting runbook](track-2-lan-hosting.md) or the broader [Track 2 deployment smoke checklist](track-2-deployment-smoke-checklist.md) that a GM should run with their real table network and campaign data.

The smoke preserved the locked Track 2 shape: the GM hosted Rotom Table with the explicit runtime gate, browser clients connected over the LAN-bound origin, live session traffic used `WebSocket /api/sessions/socket`, reconnect recovered from server authority, and no generated session snapshots, join codes, GM keys, or private campaign data were committed.

## Run summary

| Item | Result |
| --- | --- |
| Date | 2026-05-26 |
| Mode | LAN / same-machine private interface smoke |
| Startup command | `npm run dev:session:lan -- --port 31091` |
| Player-facing URL shape | `http://<private-LAN-IP>:31091` |
| Browser clients | Three separate Chromium browser contexts: `GM browser`, `Player A browser`, and `Player B browser` |
| Session credentials in notes | Redacted; only the join-code length was recorded (`8 characters`) |
| Final status | Passed for LAN lobby reachability, two-player join, WebSocket hello/presence, reconnect snapshot fallback, and data-hygiene cleanup |

Notes:

- The autonomous harness used separate browser contexts on the same host through the private LAN interface because no physical second device is available inside the build controller.
- Real table operators should still run the deployment checklist from actual player devices before relying on a campaign session.
- Accepted table command propagation is covered by the integrated command audit in [Track 2 integrated command audit](track-2-command-audit.md), with final latency-sensitive behaviour and limitations summarized in [Track 2 concurrency benchmark notes](track-2-concurrency-benchmark-notes.md), and remains part of the full deployment checklist.

## Steps observed

| Step | Expected | Observed |
| --- | --- | --- |
| Guarded LAN startup | `ROTOM_ENABLE_SESSION_HOST=1` is set by the helper and Nuxt binds to `0.0.0.0` | `npm run dev:session:lan -- --port 31091` printed the LAN helper guidance and served `/sessions` on the private interface. |
| Safety banner | Opening `/sessions` through the LAN URL reports hosting enabled and a LAN/private exposure | GM browser opened `http://<private-LAN-IP>:31091/sessions#gm-lobby-title`; the banner reported host flag `Enabled` and LAN/private exposure. |
| GM session start | GM can start a session after choosing the local **GM Login** trust role | GM browser chose **GM Login**, started a session, and saw a redacted 8-character join code plus revision/session summary. The GM key was not rendered in page chrome. |
| Two player joins | Player A and Player B join from separate browser identities and appear once in the GM lobby | Player A and Player B browser contexts chose **Player Login**, joined with the redacted join code and safe display names, and the GM **Refresh lobby** view listed both players exactly once. |
| WebSocket hello | Each browser client opens the same-origin session socket and receives a server hello | GM, Player A, and Player B each opened `ws://<private-LAN-IP>:31091/api/sessions/socket` and received server `hello` messages at revision `2` after the two joins. |
| Presence fanout | Same-session socket clients receive presence updates without cross-session leakage | Same-session `presence` messages were observed in the browser WebSocket message buffers after the three hellos. No unrelated session was opened in this LAN smoke. |
| Reconnect snapshot fallback | A reconnecting player with a stale revision receives a server-authoritative snapshot fallback | Player B closed the socket and reconnected with stale `lastSeenRevision: 0`; the server replied with `snapshotRequired: true` and a `snapshot` message with `reason: "reconnect"` at revision `2`. |
| Browser errors | No visible page crash or client console failure during the pass | The three browser contexts reported no page errors and no warning/error console messages during the final smoke run. |
| Data hygiene | Local runtime data is cleaned up and not staged | The dev server was stopped, generated `data/sessions/` snapshots were removed from the checkout, and no join code, GM key, session ID, snapshot, private map, or `.env` file was staged. |

## Runtime regression found and fixed during the pass

The first browser WebSocket attempt exposed a runtime import boundary problem in the built/dev session socket route: session command helpers used by `server/api/sessions/socket.ts` reached `~~/data/characterSheets`, whose static `import.meta.glob` sheet catalog is intended for app-side sheet discovery and was not safe to evaluate from the Nitro WebSocket route bundle.

The fix keeps server-side session command helper imports away from that static sheet glob:

- `src/utils/sheets/pokemonDerived.ts` now reads species reference data directly from `~~/data/reference/pokedex.json` for derived Pokémon stats, skills, and capabilities.
- `src/utils/sheetSpawn.ts` now uses the same reference-data boundary for spawned-token HP snapshots instead of importing `~~/data/characterSheets`.

After the fix, `npm run build` succeeded, the LAN dev helper served `/sessions`, and the three-browser WebSocket smoke completed without the runtime `globalThis._importMeta_.glob is not a function` failure.

## Boundaries and follow-up guidance

- This smoke is a LAN browser-client pass, not a named Cloudflare Tunnel review; see the [Track 2 named Cloudflare Tunnel runbook](track-2-cloudflare-tunnel-hosting.md) and [Track 2 named tunnel documentation review](track-2-named-tunnel-documentation-review.md) for remote-hosting review.
- Quick Tunnel was not used and remains development-smoke-test only; see the [Track 2 Quick Tunnel caveat](track-2-quick-tunnel-caveat.md).
- The existing `/login` GM/player picker remains a local trust switch, not public authentication.
- Browser clients did not autosave whole maps as live session authority; reconnect used a server snapshot fallback.
- Do not commit `data/sessions/`, optional event logs, screenshots with join codes, GM keys, private campaign maps/sheets, tunnel credentials, private keys, or real `.env` files.
- Before a real campaign session, run the full deployment checklist with actual player devices and a real table map to cover token movement, initiative, stale/conflict rejection, reconnect, and local-mode boundary checks end to end.
