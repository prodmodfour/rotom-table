# Live session security review

This review records the security posture for GM-hosted live sessions and the current hosting/runtime safeguards. It should be read with the [LAN hosting runbook](live-session-lan-hosting.md), [named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md), [deployment smoke checklist](live-session-deployment-smoke-checklist.md), [Quick Tunnel caveat](live-session-quick-tunnel-caveat.md), [public exposure checks](live-session-public-exposure-checks.md), [session host runtime scripts](live-session-host-runtime.md), [dependency and runtime review](live-session-dependency-runtime-review.md), [session backup and recovery runbook](live-session-backup-recovery.md), and the [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md).

Live session remains a trusted-table, GM-hosted feature. It is appropriate for a GM-controlled machine serving known players on a LAN or through a named Cloudflare Tunnel when the GM follows the runbooks. It is not a hardened public service for anonymous internet users.

The [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md) documents the current auth/session/cookie/permission boundaries, public exposure warnings, committed-data hygiene, and remaining non-goals alongside the command, LAN smoke, named-tunnel documentation, and local-mode no-regression evidence.

## Security outcome

The current Live session boundary is acceptable for the locked product shape when all of these are true:

- the GM explicitly enables session hosting with `ROTOM_ENABLE_SESSION_HOST=1` by using `npm run dev:session:lan`, `npm run dev:session:tunnel`, or the documented manual equivalent;
- the GM checks `/sessions` through the same origin players will use and resolves any safety-banner warnings before sharing a code;
- players are trusted table participants who receive only the player-facing URL and the current join code;
- live map/table actions happen through `WebSocket /api/sessions/socket` and server-authoritative command handlers, not through live-client whole-map autosave;
- snapshots, event logs, maps, sheets, trainer files, backups, GM keys, join codes, tunnel credentials, private keys, and real `.env` files stay local/private and out of git;
- the GM stops the tunnel/server, forgets unneeded browser identities, and rotates the session by starting a fresh GM session if credentials or URLs are shared too broadly.

If any of those assumptions are false, do not treat Live session as secure enough for public exposure. Use local mode only, or add a separate hardened authentication/deployment design outside Live session.

## Trust boundaries

| Boundary | Trusted side | Less-trusted side | Current controls | Remaining risk |
| --- | --- | --- | --- | --- |
| GM host process and filesystem | The GM-controlled Rotom Table process, local JSON data, snapshots, event logs, and private backups. | Player browsers, networks, tunnel edge, and any other client input. | Session hosting is disabled by default; command handlers validate shape, actor, permissions, revisions, conflicts, and persistence before applying state. | A compromised GM machine or exposed filesystem compromises the table. Rotom Table does not encrypt local data or provide host-level hardening. |
| Existing `/login` role picker | Local/trusted campaign use on the GM's normal app origin. | Anyone who can reach the exposed origin. | Live session routes add the runtime flag plus session-local GM key/join code/player identity checks; docs and banners repeat that `/login` is not public auth. | Non-session local-first routes still reflect trust-based assumptions. Do not expose the app as a general public website. |
| Session-local credentials | GM key in the GM browser/session memory, player join code, player IDs, client IDs, and assignments created by the lobby. | People outside the trusted table and stale browser profiles. | GM keys and join codes are not returned by no-secret safety endpoints; player permissions are rechecked server-side on every command; non-secret cookie hints exclude GM keys/join codes. | A join code can be forwarded. Browser local storage that remembers session identity should be treated as private. Rotate by starting a fresh session if credentials leak. |
| WebSocket command channel | Authenticated same-session peers after a valid hello. | Malformed frames, stale clients, cross-session clients, and unsupported command types. | The socket route validates JSON message shape, session ID, hello identity, actor match, command envelope, `opId`, `baseRevision`, permissions, and same-session fanout. Heartbeat detects stale clients. | Bugs in command-specific validation could still expose state or accept an unsafe action. Recent duplicate-`opId` memory is process-local after restart. |
| Player browsers | Player UI after join, visible resources, assigned controllable tokens/sheets, and sanitized display name. | Browser devtools, modified clients, stale optimistic state, and copied local storage. | The server treats browser commands as requests, not authority; reconnect uses authoritative replay/snapshot fallback; UI sanitizes player-facing rejection/presence details. | A player can attempt arbitrary WebSocket frames. Display names are labels, not identities. Use separate browser profiles for GM and player identities. |
| LAN or named tunnel network path | A private LAN the GM trusts, or a stable named Cloudflare Tunnel intentionally configured by the GM. | Other devices on the LAN, public internet traffic that reaches the tunnel, proxies, caches, and edge rules. | LAN and named tunnel runbooks specify safe bindings, safety-banner checks, WebSocket expectations, no-cache guidance, and rollback steps. | A tunnel exposes the normal Rotom Table origin, not just one lobby page. Cloudflare Access/WAF can add protection but is not Rotom Table authentication. |
| Local JSON persistence and backups | Latest valid `data/sessions/<sessionId>/snapshot.json`, optional `events.jsonl`, referenced maps/sheets/trainers/encounter tables, and private backup archives. | Git history, public issue trackers, screenshots, shared drives, and player machines. | `.gitignore` keeps runtime session data private; snapshot writes are atomic; backup docs require private archives and no-secret git checks. | Backups are not encrypted by the app. Optional event logs are audit/replay-oriented data, not standalone authority. |
| Legacy local realtime/SSE | Existing local-first map/sheet/library sync outside session mode. | Live Live session clients. | live session commands, acks/rejections, presence, heartbeat, reconnect, and patches use WebSockets instead of `/api/events`. | Legacy SSE may carry whole map/sheet payloads for local mode; do not expose or repurpose it as a public session transport. |

## Data and secret handling

| Data class | Examples | Handling rule |
| --- | --- | --- |
| Public project docs/reference | README, runbooks, ADRs, app-owned reference data intended for the repo. | Safe to commit when it contains no private campaign data or real secrets. |
| Player-facing session details | Player URL, current join code, player display names, current table revision shown in UI. | Share only with trusted players. Treat screenshots as sensitive if they include join codes, player names, map state, or private campaign details. |
| GM-private session authority | GM key, GM browser identity, management responses, assignment controls, hidden maps/sheets, raw command state. | Do not share with players or put in docs/issues/logs. Use a separate browser profile for GM control. |
| Local runtime state | `data/sessions/<sessionId>/snapshot.json`, optional `events.jsonl`, map/sheet/trainer JSON, generated wild sheets, encounter tables, private assets. | Keep local/private and out of git. Back up only to GM-controlled private storage. |
| Tunnel and environment credentials | Cloudflare `cert.pem`, tunnel credentials JSON, tokens, private keys, Access/WAF config, real `.env` files. | Keep outside the repo. Rotate/remove if accidentally exposed. |
| Browser identity storage | Remembered GM/player session identity and non-secret cookie hints. | Use **Forget in this browser** after shared-device play. Treat remembered GM identity as private even when the cookie hint omits GM key/join code. |

## Join-code and identity limits

Live session join codes are session-local capabilities for joining a trusted table, not account passwords.

- The default join code generator uses cryptographic randomness over the Live session join-code alphabet and currently creates 8-character codes; validators accept 6-12 characters and normalize case/separators for user entry.
- A join code lets a browser create a session-local player identity. It does not grant GM authority, assignment control, or permission to command arbitrary resources.
- Players receive a generated `playerId` and `clientId`; duplicate display names are allowed and must not be used as authentication.
- Player commands still require the authenticated WebSocket actor to match the joined identity and the GM-managed visible/controllable assignment for the target resource.
- Rotom Table does not currently provide production-grade public brute-force defenses such as per-IP rate limiting, CAPTCHA, email verification, account lockout, or abuse monitoring.
- Join-code rotation is operational: stop exposure if needed and start a fresh GM session so the GM key, join code, session ID, and in-memory authority rotate together.
- Do not publish join codes in screenshots, permanent campaign notes, public chat, issue trackers, docs, or commit messages.

For named tunnel sessions with a public hostname, consider Cloudflare Access, IP allow lists, or other edge controls as an additional outer gate for the small trusted group. Those controls reduce exposure but do not replace server-side session identity and permissions.

## Tunnel exposure risks

A named Cloudflare Tunnel is the supported remote path, but it still changes the risk profile:

- The public hostname reaches the normal Rotom Table origin. It is not limited to `/sessions` or `/api/sessions/socket`.
- DNS and tunnel configuration can outlive one game night. A stale hostname can become reachable again if `cloudflared tunnel run ...` is restarted later.
- Cache rules must not cache `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket traffic, or session snapshots/patches. Stale cached session UI can mislead players.
- Cloudflare Access, WAF rules, and IP restrictions are optional outer protections. They can block unwanted visitors, but the Rotom Table server must still validate the GM key, join code, player/client identity, assignments, revisions, and conflicts.
- Access challenges, proxy disconnects, sleeping laptops, and network changes can close WebSockets. Clients should reconnect and accept server-owned snapshot fallback instead of trusting stale browser state.
- The tunnel config, credentials JSON, tokens, `cert.pem`, private keys, and real `.env` files are credentials. Keep them outside `workspace/rotom-table` and rotate/delete them if exposed.
- Quick Tunnel uses temporary `trycloudflare.com` hostnames and is development smoke-test only. It is not a campaign-session URL, not a stable rollback model, and not a public-auth layer.

If an unexpected public hostname, forwarded host, cache rule, or Access challenge appears during setup, do not share the join code until the path is understood and the safety banner is clean.

## Non-hardened areas and out-of-scope items

The following are intentionally not solved by Live session and must not be implied by docs or UI:

- full public authentication, passwords, OAuth, SSO, MFA, account recovery, or long-lived user accounts;
- anonymous public signup, public multi-tenancy, self-serve rooms, tenant isolation, or SaaS operations;
- production-grade internet abuse controls such as IP reputation, rate limiting, CAPTCHA, bot detection, or centralized security monitoring;
- encrypted-at-rest snapshots/backups, hardware key storage, secrets management, or automatic credential rotation;
- a hosted persistence layer such as Postgres, Redis, Durable Objects, cloud object storage, or a cloud-first database architecture;
- tamper-proof audit logs, compliance logging, moderation tooling, or legal discovery workflows;
- end-to-end encryption between players and GM beyond the HTTPS/WSS/TLS provided by the browser/tunnel path;
- hardening every legacy local-first mutating route for arbitrary public internet access;
- turning legacy `/api/events` SSE or local whole-map autosave into session concurrency;
- relying on player browser storage, screenshots, or copied map JSON as authoritative recovery data.

If Rotom Table is ever redesigned for public hosting, that should be a separate architecture effort with real auth, hosted persistence decisions, route-by-route authorization review, rate limiting, secrets management, backup encryption, content/asset rights review, and incident response procedures. Live session should not silently grow into that model.

## Incident response checklist

Use this when something is shared too broadly or the host appears exposed unexpectedly:

1. Stop `cloudflared tunnel run ...` first if a named or temporary tunnel is active.
2. Stop Rotom Table or restart it without `ROTOM_ENABLE_SESSION_HOST=1` so session endpoints and sockets fail closed.
3. If a join code or GM key may have leaked, start a fresh GM session before play continues and share only the new player-facing code with trusted players.
4. Use **Forget in this browser** on shared, stale, or accidentally exposed browser profiles.
5. Remove or disable unexpected DNS/CNAME/tunnel routes; delete retired tunnels and local credentials when they are no longer needed.
6. Review Cloudflare Access/WAF/cache rules before re-enabling a public hostname.
7. Check git status and shared evidence for private maps, sheets, snapshots, event logs, screenshots, join codes, GM keys, tunnel credentials, tokens, private keys, or real `.env` files.
8. Restore only from trusted private backups. Do not overwrite server snapshots with player browser state.

## Reviewer checklist

Before marking a live session hosting setup or docs change as acceptable:

- [ ] Session hosting remains disabled without the explicit runtime flag.
- [ ] `/sessions` safety output is no-secret and warns about remote/LAN exposure before a ready session exists.
- [ ] LAN remains the primary hosting path and named Cloudflare Tunnel remains the supported remote path.
- [ ] Quick Tunnel is still documented only as a temporary development smoke test.
- [ ] The `/login` role picker is never described as public auth.
- [ ] Live session changes use WebSocket command acks/rejections and patches, not whole-map client autosave.
- [ ] Player command permissions are assignment/visibility-based and server-enforced.
- [ ] Reconnect uses authoritative replay/snapshot fallback instead of browser-owned recovery.
- [ ] Private session/campaign/tunnel data stays out of docs, tests, git, issue trackers, and screenshots.
- [ ] Out-of-scope hardening work is called out honestly rather than hidden behind the session-local join flow.
