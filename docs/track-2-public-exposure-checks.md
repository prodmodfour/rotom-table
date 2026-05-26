# Track 2 public exposure warnings and startup checks

This guide records the additional hardening checks that run before a GM shares a Track 2 hosted session URL. It complements the [LAN hosting runbook](track-2-lan-hosting.md), [named Cloudflare Tunnel runbook](track-2-cloudflare-tunnel-hosting.md), [Quick Tunnel caveat](track-2-quick-tunnel-caveat.md), and [session host runtime scripts](track-2-session-host-runtime.md).

Track 2 remains a GM-hosted table session, not a SaaS deployment or public multi-tenant app. These checks do not add full accounts or hardened public auth; they make unsafe startup states visible while the session-local GM key, player join code, player IDs, client IDs, assignments, and WebSocket command validation continue to enforce table authority.

## What the safety endpoint checks

`GET /api/sessions/safety` is intentionally no-secret and readable while hosting is disabled. When `ROTOM_ENABLE_SESSION_HOST=1` is set, the response now includes:

- the normalized request host and forwarded host, when present;
- a coarse exposure classification: `local`, `lan`, `remote`, or `unknown`;
- a no-secret session readiness summary with active-session counts only;
- startup issue codes when expected session-local credentials or authoritative state are missing.

The readiness summary reports counts such as `activeSessionCount`, `credentialedSessionCount`, and `stateBackedSessionCount`. It never returns session IDs, GM keys, join codes, player IDs, map documents, snapshots, tunnel credentials, or private campaign data.

## Unsafe startup states

The `/sessions` banner warns the GM before sharing a URL when any of these states are detected:

| Startup issue | Meaning | Required response |
| --- | --- | --- |
| `host-enabled-without-active-session` | The server has `ROTOM_ENABLE_SESSION_HOST=1`, but no active GM session has created a session-local GM key and join code yet. | Open `/sessions` as the GM, start a session, verify the fresh join code, then share only that code and the player URL with trusted players. |
| `remote-exposure-before-session-start` | The request looks remote/proxied/tunneled before a session has intentionally been started. | Stop the tunnel/proxy if unexpected; otherwise complete GM startup through the supported named Cloudflare Tunnel path before sharing. |
| `host-enabled-without-session-secrets` | An active in-memory record is missing the expected session-local GM key or join code. | Treat the startup as unsafe, stop hosting, unset the runtime flag, and start a fresh session so credentials rotate together. |
| `host-enabled-without-authoritative-state` | An active in-memory record is missing authoritative session state. | Stop hosting and recover from a private snapshot if one is trusted, or start a fresh session before players send commands. |
| `host-enabled-session-readiness-unknown` | The request could not verify active-session, credential, and authoritative-state readiness. | Refresh the safety banner; if the state remains unknown, stop hosting and inspect the startup path before sharing. |

A no-active-session warning is expected immediately after starting the dev server and before pressing **Start GM session**. It should not be ignored on a LAN or remote hostname: it means the app is reachable, but no current join code/session-local GM credential has been minted for the table yet.

## GM pre-share checklist

Before giving players a URL or join code:

- [ ] Start with `npm run dev:session:lan` for same-Wi-Fi play or `npm run dev:session:tunnel` plus `cloudflared tunnel run <name>` for the supported remote path.
- [ ] Open `/sessions` through the same origin players will use: the private LAN address or the named tunnel hostname.
- [ ] Confirm the safety banner exposure matches the intended path (`lan` for same-Wi-Fi, `remote` for a named tunnel).
- [ ] Confirm session readiness is `ready` after pressing **Start GM session**.
- [ ] Share only the player-facing URL and current join code with trusted players.
- [ ] Never share or commit GM keys, raw session snapshots, generated `data/sessions/` files, tunnel credentials, private keys, real `.env` files, screenshots with secrets, or private campaign data.

If the banner reports a surprising remote/unknown exposure, missing credentials, missing authoritative state, or an unexpected forwarded host, stop and fix the startup path before play.

## What this does not change

- The existing `/login` GM/player picker remains trust-based local UI and is not public authentication.
- Quick Tunnel remains development-smoke-test only, not the supported campaign-session path.
- Live clients still use `WebSocket /api/sessions/socket` and server-authoritative commands, not whole-map autosave.
- Persistence remains local JSON snapshots and optional event logs under ignored/private `data/sessions/` paths.
- No cloud database, SaaS deployment, public account provider, or generic collaborative document model is introduced by these checks.
