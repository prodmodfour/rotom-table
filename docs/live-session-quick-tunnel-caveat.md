# Live session Quick Tunnel caveat

Quick Tunnel is **not** the supported remote hosting path for Live session campaign sessions. LAN / same Wi-Fi remains the primary supported path, and a named Cloudflare Tunnel with a stable hostname remains the supported remote path for trusted remote players.

This page exists only to document the narrow development-smoke-test boundary where a temporary `trycloudflare.com` URL may be useful. Do not treat the command below as campaign setup, player onboarding instructions, production hardening, or public authentication.

Use these runbooks for supported play instead:

- [Live session LAN hosting runbook](live-session-lan-hosting.md) for same-Wi-Fi/LAN sessions.
- [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) for remote players over a stable hostname.
- [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md) for the supported LAN/named-tunnel two-player smoke pass.

## What Quick Tunnel is allowed to prove

A Quick Tunnel may be used for a short developer smoke test that answers questions such as:

- does the `/sessions` lobby load through a public HTTPS origin;
- does the safety banner classify the request as remote, proxied, or unknown rather than local/LAN;
- can a throwaway session WebSocket connect to `wss://<temporary-host>/api/sessions/socket`;
- do heartbeat and reconnect UI paths behave sanely when a tunnel is stopped or restarted;
- does the explicit `/maps/<slug>?session=1` route still use server-authoritative commands rather than whole-map autosave.

Keep that smoke test brief, use non-private campaign data, and stop the tunnel as soon as the check is complete. The temporary URL should not be copied into campaign notes, committed docs, screenshots with secrets, or long-lived player instructions.

## What Quick Tunnel must not be used for

Do **not** use Quick Tunnel for:

- a recurring or scheduled campaign session;
- a player-facing URL that needs to remain stable between game nights;
- onboarding remote players who need reliable instructions;
- replacing the named Cloudflare Tunnel runbook;
- bypassing the explicit `ROTOM_ENABLE_SESSION_HOST=1` runtime gate;
- treating the existing `/login` GM/player role picker as public authentication;
- adding a database, SaaS service, Durable Objects, Redis, Postgres, or cloud persistence layer;
- exposing private maps, sheets, generated data, session snapshots, event logs, GM keys, join codes, tunnel credentials, tokens, private keys, or real `.env` files.

Quick Tunnel creates an ad-hoc public URL for the normal Rotom Table origin. It does not expose only one safe lobby page, does not provide full account auth, does not make the app multi-tenant, and does not change the server-authoritative session model.

## If you run a temporary smoke test

Use a clean working tree, a throwaway table session, and fake or non-sensitive map data. Start Rotom Table with the same explicit session-host gate and loopback binding used by named-tunnel hosting:

```bash
npm run dev:session:tunnel
```

Manual equivalent:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000
```

In another terminal, a developer may start a temporary Quick Tunnel to that local origin:

```bash
cloudflared tunnel --url http://localhost:3000
```

`cloudflared` prints a temporary hostname such as:

```text
https://temporary-name.trycloudflare.com
```

Use that URL only for the smoke test. For example:

```text
https://temporary-name.trycloudflare.com/sessions#gm-lobby-title
https://temporary-name.trycloudflare.com/sessions#player-lobby-title
https://temporary-name.trycloudflare.com/maps/<map-slug>?session=1
wss://temporary-name.trycloudflare.com/api/sessions/socket
```

Expected smoke-test boundaries:

- the `/sessions` safety banner should not imply a normal local-only exposure;
- session endpoints and the socket must still fail closed if the runtime flag is absent;
- browser clients must use `WebSocket /api/sessions/socket` for live session traffic;
- command acks/rejections, presence, heartbeat, reconnect, and patches still come from the GM-hosted server;
- the plain `/maps/<slug>` route remains local-first and is not a live-session authority path.

Stop at the first surprising exposure, auth, cache, or socket behaviour. Do not paper over it by continuing to use the temporary URL for real play.

## Why Quick Tunnel is not supported for campaign sessions

Quick Tunnel is intentionally ad hoc:

- the generated hostname is temporary and can change between runs;
- the GM does not get the stable DNS and ingress review path documented for named tunnels;
- player instructions cannot safely refer to a durable campaign URL;
- rollback is less explicit than stopping a named tunnel and disabling a known hostname;
- access controls, Cloudflare Access policy, cache rules, and hostname ownership are harder to document consistently;
- a convenience URL can be shared before the GM has reviewed the safety banner, join-code exposure, or repository data hygiene;
- WebSocket behaviour might work for a smoke test, but Live session validates remote play against LAN and named Cloudflare Tunnel assumptions.

If remote players need to join a real table, use the named tunnel runbook with a stable hostname and intentional rollback steps.

## Legacy SSE limitations

Legacy Server-Sent Events remain available only for local-first, non-session migration paths:

- `GET /api/events` is the existing SSE stream for local map, sheet, and library updates outside live session mode.
- Legacy SSE is one-way server-to-browser transport. It does not carry client commands, command acknowledgements, command rejections, presence, heartbeat, reconnect handshakes, `opId` idempotency, or session revision conflict handling.
- Legacy SSE events may carry whole saved map or sheet payloads and keep the existing last-writer-wins local workflow. That is acceptable only outside the live session concurrency path.
- A Quick Tunnel URL does not make SSE a supported public session transport. Do not route Live session command flow over `/api/events`, and do not use a temporary tunnel to justify whole-map autosave from live players.
- Proxies and tunnels can close or buffer long-lived HTTP streams differently from browsers on the GM machine. If an SSE path behaves differently through a temporary tunnel, treat it as a legacy local-mode limitation, not as a Live session remote-hosting target.

live sessions use the WebSocket route at `/api/sessions/socket` for commands, acks/rejections, broadcasts, presence, heartbeat, and reconnect. Quick Tunnel smoke tests should verify that boundary; they should not expand the legacy SSE surface.

## Cleanup after a smoke test

1. Ask any test browsers to stop sending commands and close session-map tabs.
2. Use **Forget in this browser** from `/sessions` for throwaway GM/player identities that should not remain remembered.
3. Stop `cloudflared tunnel --url http://localhost:3000` with `Ctrl+C`.
4. Stop the Nuxt dev server with `Ctrl+C`.
5. Unset the runtime flag in shells that keep environment variables:

   ```bash
   unset ROTOM_ENABLE_SESSION_HOST
   ```

   PowerShell:

   ```powershell
   Remove-Item Env:ROTOM_ENABLE_SESSION_HOST
   ```

6. Run `git status --short` and make sure no private maps, generated sheets, `data/sessions/` snapshots/event logs, join codes, GM keys, Quick Tunnel URLs, tunnel credentials, tokens, private keys, screenshots with secrets, or real `.env` files are staged.
7. If a real join code or private URL was accidentally shared, stop the tunnel, restart without the host flag or start a new session to rotate the join code, and switch to the named tunnel runbook before inviting remote players again.

## Related docs

- [Live session LAN hosting runbook](live-session-lan-hosting.md)
- [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md)
- [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md)
- [Live session socket protocol](live-session-socket-protocol.md)
- [live session protocol](live-session-protocol.md)
- [Live session client integration guide](live-session-client-integration.md)
- [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md)
- [Live session security review](live-session-security-review.md)
- [Live session dependency and runtime review](live-session-dependency-runtime-review.md)
- [ADR 002: LAN first and named Cloudflare Tunnel second](adrs/002-lan-first-named-cloudflare-tunnel.md)
- [ADR 003: Session socket transport](adrs/003-session-socket-transport.md)
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md)
