# Live session named-tunnel maintenance checklist

This maintenance checklist records the live-session named Cloudflare Tunnel documentation baseline, current Cloudflare assumptions, and safety warnings. It is a source/reference check, not a live remote smoke result. No real Cloudflare account, hostname, tunnel token, join code, GM key, snapshot, event log, private map, private sheet, or `.env` file was used or recorded.

## Maintenance baseline

**Current baseline as of 2026-05-26:** The existing [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) still matches the locked architecture and the current operator assumptions:

- LAN remains the primary supported hosting path; a named Cloudflare Tunnel with a stable hostname remains the supported remote path.
- Rotom Table still runs as a GM-controlled Node/Nuxt/Nitro process with the exact `ROTOM_ENABLE_SESSION_HOST=1` runtime gate.
- The tunnel forwards the normal Rotom Table origin to the private GM host; it does not make Rotom Table a SaaS app, Cloudflare-hosted app, public multi-tenant service, or cloud database deployment.
- Remote browsers use the same public origin for pages and `wss://<stable-hostname>/api/sessions/socket` for Live session WebSocket messages.
- Live session changes remain server-authoritative WebSocket commands with acknowledgements/rejections, revisions, patches, presence, heartbeat, and reconnect snapshot fallback.
- Cloudflare Access, WAF rules, and IP restrictions are documented only as optional outer protection; Rotom Table session authority still comes from session-local GM/player identity and server-side command validation.
- Quick Tunnel and temporary `trycloudflare.com` URLs remain development-smoke-test only and are not the campaign-session path.
- Tunnel credentials, `cert.pem`, tokens, private keys, real `.env` files, GM keys, join codes, snapshots, event logs, screenshots with secrets, and private campaign data remain outside git.

## Source material checked

This checklist compares Rotom Table docs against current Cloudflare documentation and the live-session project constraints:

| Source | What it confirmed for the runbook |
| --- | --- |
| Cloudflare Tunnel useful commands: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/> | `cloudflared tunnel login`, `cloudflared tunnel create`, `cloudflared tunnel route dns`, and `cloudflared tunnel run` remain the relevant locally managed named-tunnel command family. |
| Cloudflare tunnel configuration file: <https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/> | Locally managed tunnels can use `~/.cloudflared/config.yml` with `tunnel`, `credentials-file`, ingress rules, and a required catch-all rule; `http_status:404` is an appropriate catch-all example. |
| Cloudflare Tunnel routing: <https://developers.cloudflare.com/tunnel/routing/> | A published hostname can route HTTPS browser traffic to a local HTTP service such as `http://localhost:3000`, and `HTTP_STATUS` is a supported service type for catch-all handling. |
| Cloudflare Tunnels FAQ: <https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/> | Cloudflare Tunnel supports WebSockets, matching the Live session same-origin `wss://table.example.com/api/sessions/socket` expectation. |
| Cloudflare Cache Rules settings: <https://developers.cloudflare.com/cache/how-to/cache-rules/settings/> | Cache rules can intentionally bypass or alter cache eligibility; Rotom Table docs correctly require no caching for session paths and WebSocket traffic. |
| Cloudflare Tunnel permissions: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-permissions/> | `cert.pem` and tunnel credentials JSON files are credentials with management/run authority and must stay outside the repository. |
| Live session ADRs, roadmap, runtime, WebSocket, security, dependency, backup, and deployment smoke docs | The named-tunnel instructions preserve the GM-hosted, filesystem-backed JSON, WebSocket, session-local identity, no-public-auth, no-SaaS, no-cloud-database architecture. |

Cloudflare dashboard labels and Zero Trust navigation can change over time. The Rotom Table runbook intentionally documents the CLI/local-managed path as the repeatable baseline and allows dashboard-managed tunnels only when they preserve the same stable hostname, local service target, WebSocket route, no-cache rules, and credential hygiene.

## Runbook cross-check

| Check area | Current documented state | Result |
| --- | --- | --- |
| Stable remote hostname | The runbook uses `table.example.com`, `cloudflared tunnel route dns rotom-table table.example.com`, and `cloudflared tunnel run rotom-table`; it rejects temporary `trycloudflare.com` URLs for campaign play. | Pass |
| Local host binding | The runbook prefers `npm run dev:session:tunnel`, whose documented/manual equivalent is `ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000`, so the public path is the tunnel rather than an extra LAN listener. | Pass |
| Ingress config | The documented `~/.cloudflared/config.yml` maps `hostname: table.example.com` to `service: http://localhost:3000` and ends with `service: http_status:404`. | Pass |
| WebSocket route | The runbook and protocol docs preserve `/api/sessions/socket` and same-origin `wss://table.example.com/api/sessions/socket` without asking players to enter a separate socket URL. | Pass |
| Cache assumptions | The runbook, deployment smoke checklist, dependency/runtime maintenance, and security boundaries all warn not to cache `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket responses, patches, snapshots, or lobby state. | Pass |
| Optional edge protection | Cloudflare Access/WAF/IP restrictions are documented as optional outer gates only; Live session server-side GM key, join code, player/client identity, assignments, revisions, and command validation remain authoritative. | Pass |
| Safety banner/readiness | The GM flow requires opening `/sessions` through the public hostname, checking the remote/tunnel safety banner, treating pre-start no-active-session as expected, and blocking on missing credentials/state or unknown readiness after startup. | Pass |
| Rollback/shutdown | The runbook documents stopping `cloudflared`, stopping Nuxt, unsetting `ROTOM_ENABLE_SESSION_HOST`, disabling the DNS/CNAME/hostname if needed, deleting retired tunnels, rotating join codes through a fresh session, and checking git hygiene. | Pass |
| Secrets and private data | All linked docs use placeholders and explicitly prohibit committing tunnel credentials, tokens, real hostnames that should remain private, GM keys, join codes, snapshots, event logs, private maps/sheets, screenshots with secrets, and real `.env` files. | Pass |
| Architecture lock | The docs do not introduce Quick Tunnel campaign hosting, public accounts, SaaS hosting, Cloudflare Workers/Durable Objects, Redis/Postgres, hosted databases, or browser-owned whole-map live autosave. | Pass |

## Current assumptions to preserve

- `cloudflared` is an operator-installed CLI outside npm dependencies. Rotom Table does not start it, manage tunnel credentials, or import Cloudflare SDKs.
- The public hostname should forward to a normal local HTTP Nuxt origin such as `http://localhost:3000`; the player's browser should see HTTPS and same-origin WebSocket URLs.
- The GM machine must stay awake, online, and able to write filesystem-backed JSON session snapshots/event logs for the duration of play.
- If a dashboard-managed tunnel is used instead of the documented local config file, its public hostname must still point to the same local Rotom Table service and preserve `/api/sessions/socket` upgrade behaviour.
- Optional Cloudflare Access/WAF/cache changes must be smoke-tested before a session; Access challenges or cache rules can interrupt or mislead WebSocket/session UI even though they are not Rotom Table authority.
- This maintenance check does not run a live public tunnel. A live named-tunnel deployment smoke still requires a real Cloudflare account, DNS zone, and stable hostname plus remote clients; use the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md) to record that environment-specific result.

## Operator checklist before a named-tunnel game

Use this short checklist in addition to the runbook:

- [ ] `cloudflared --version` works on the GM host.
- [ ] `cloudflared tunnel list` or the Cloudflare dashboard shows the intended named tunnel.
- [ ] `cloudflared tunnel route dns rotom-table table.example.com` or the dashboard-published hostname points at the intended tunnel.
- [ ] `~/.cloudflared/config.yml` or the dashboard-managed public-hostname config points `table.example.com` to `http://localhost:3000` and includes a catch-all/404 equivalent for unexpected hostnames.
- [ ] `npm run dev:session:tunnel -- --print-only` shows `ROTOM_ENABLE_SESSION_HOST=1`, `--host 127.0.0.1`, and the intended port.
- [ ] `cloudflared tunnel run rotom-table` connects without errors.
- [ ] `https://table.example.com/sessions#gm-lobby-title` loads through the public hostname and the safety banner reports the expected remote/tunnel exposure.
- [ ] `wss://table.example.com/api/sessions/socket` reaches the app through the same origin; no Cloudflare cache rule covers `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket responses, snapshots, patches, or lobby state.
- [ ] Only the player URL and join code are shared with trusted players; the GM key, tunnel credentials, `cert.pem`, private maps/sheets, snapshots, event logs, and screenshots with secrets are not shared or committed.
- [ ] Cleanup includes stopping `cloudflared`, stopping Nuxt, unsetting the runtime flag, rotating a fresh session if the join code was over-shared, and checking `git status --short`.

## Boundaries

This document does not add a Cloudflare dependency, change runtime code, create a tunnel, run a live public hostname, or claim production-grade public hardening. It keeps the named-tunnel documentation baseline visible for the supported live-session remote path and leaves environment-specific verification to the deployment smoke checklist.
