# Live session security and secret-hygiene readiness

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This readiness maintenance records the current Live session security and secret-hygiene posture for the command, hosting, LAN smoke, named-tunnel documentation, and local-mode no-regression boundaries. It should be read with the [Live session security boundaries](live-session-security-boundaries.md), [public exposure checks](live-session-public-exposure-checks.md), [deployment smoke checklist](live-session-deployment-smoke-checklist.md), [LAN manual smoke results](live-session-lan-manual-smoke-results.md), [named-tunnel maintenance checklist](live-session-named-tunnel-maintenance.md), [local-mode maintenance checks](live-session-local-mode-maintenance.md), and [session backup and recovery runbook](live-session-backup-recovery.md).

Review date: 2026-05-26

Current readiness baseline: the locked live-session trusted-table posture is ready within explicit limitations. The implemented session surfaces preserve the GM-hosted, filesystem-backed architecture: session hosting stays opt-in through `ROTOM_ENABLE_SESSION_HOST=1`, players join with session-local identity, live session mutations use `WebSocket /api/sessions/socket` server-authoritative commands, and the docs continue to reject public-auth, SaaS, cloud-database, generic shared-document, and Quick Tunnel campaign-session models.

This readiness maintenance covers auth/session/cookie/permission boundaries, public exposure warnings, secret-hygiene checks, and remaining non-goals. It did not create a live public tunnel, inspect private campaign data, record a real GM key or join code, or add a new authentication system. It reviewed source boundaries, existing focused tests, runbooks, tracked-file hygiene, and no-secret documentation.

## Scope

The review covered these security-sensitive boundaries:

- the existing trust-based `/login` GM/player role picker and its separation from Live session authority;
- the `ROTOM_ENABLE_SESSION_HOST=1` runtime gate around Live session HTTP endpoints and the WebSocket route;
- GM start/manage/assignment authority, player join/player-state authority, and session-local identity validation;
- browser identity continuity through `rotom:session:identity` local storage and the `rotom-session-identity` cookie hint;
- WebSocket hello/auth, heartbeat, command validation, actor matching, same-session fanout, and reconnect snapshot filtering;
- command-specific GM-only and assigned-resource permission checks;
- public exposure warnings for LAN and named Cloudflare Tunnel hosting;
- remaining non-goals that are still intentionally outside Live session.

The review intentionally did not harden legacy trust-based routes for arbitrary public internet users, add accounts/OAuth/MFA, add rate limiting or CAPTCHA, encrypt local backups, introduce a hosted database, or turn the app into public multi-tenant infrastructure.

## Evidence summary

| Boundary | Readiness result | Source and test evidence |
| --- | --- | --- |
| Runtime gate | Pass. Live session HTTP and WebSocket surfaces fail closed unless the exact `ROTOM_ENABLE_SESSION_HOST=1` flag is present. | `server/utils/sessionHosting.ts`, `shared/sessionSafety.ts`, `server/api/sessions/*.post.ts`, `server/api/sessions/socket.ts`, `tests/server/sessionHostingHardening.test.ts`, and `tests/server/sessionEndpointRoutes.test.ts`. |
| Local role picker boundary | Pass with documented trust limit. `POST /api/sessions/start` still requires the existing local GM role before creating a session-local GM key, but Live session authority does not treat `/login` as public auth. | `server/api/sessions/start.post.ts`, `server/utils/auth.ts`, `docs/archive/live-session/live-session-security-boundaries.md`, and `tests/server/sessionLobbyFlow.test.ts`. |
| GM session authority | Pass. GM management and assignment requests require the session-local `gmKey`; player assignment changes remain GM-only. | `server/useCases/getGmSessionManagement.ts`, `server/useCases/updatePlayerAssignment.ts`, `server/api/sessions/manage.post.ts`, `server/api/sessions/assignments.post.ts`, `tests/server/sessionLobbyFlow.test.ts`, and `tests/server/sessionEndpointRoutes.test.ts`. |
| Player join and state reads | Pass. Player join uses the join code plus sanitized display name to create player/client IDs; player-state reads validate the session-local player identity and return a filtered response. Duplicate display names remain labels, not authentication. | `server/useCases/joinPlayerSession.ts`, `server/useCases/getPlayerSessionState.ts`, `server/api/sessions/join.post.ts`, `server/api/sessions/player-state.post.ts`, and `tests/server/sessionLobbyFlow.test.ts`. |
| Browser identity continuity | Pass with operator caution. Local storage may remember the full GM/player session identity for that browser, while the cookie hint intentionally excludes GM keys and join codes and rejects `secret-in-cookie` payloads. | `shared/sessionClientIdentity.ts`, `src/utils/sessionClientIdentityStorage.ts`, `tests/shared/sessionClientIdentity.test.ts`, and `tests/utils/sessionClientIdentityStorage.test.ts`. |
| WebSocket auth and command boundary | Pass. Sockets begin pending hello, validate GM keys or player identity, reject client-ID actor collisions, validate message/envelope shape, require command actor/session match, and close/reject malformed or unauthorized frames safely. | `server/utils/sessionWebSocketServer.ts`, `server/api/sessions/socket.ts`, `tests/server/sessionWebSocketTransport.test.ts`, `tests/server/sessionWebSocketServer.test.ts`, and `tests/server/sessionIntegratedCommandFlow.test.ts`. |
| Permissions and player-visible state | Pass for the implemented command set. GM-only commands remain GM-only; player commands recheck current assignments/visibility; reconnect snapshots are filtered to the player, that player's assignment, visible maps, and that player's connected clients. | `shared/sessionPermissions.ts`, `shared/sessionTokenCommands.ts`, `shared/sessionTableActionCommands.ts`, `shared/sessionHazardCommands.ts`, `shared/sessionFieldEffectCommands.ts`, `shared/sessionTerrainCommands.ts`, per-command `tests/server/*WebSocketDispatch.test.ts`, and `tests/server/sessionIntegratedCommandFlow.test.ts`. |
| Same-session fanout and leakage | Pass. Presence, command acks/rejections, patches, and reconnect snapshots target authenticated peers in the same session and do not fan out to unrelated sessions. | `server/utils/sessionWebSocketFanout.ts`, `tests/server/sessionWebSocketFanout.test.ts`, `tests/server/sessionWebSocketTransport.test.ts`, and `tests/server/sessionIntegratedCommandFlow.test.ts`. |
| Public exposure warnings | Pass. The no-secret safety endpoint/banner reports disabled/local/LAN/remote exposure and startup readiness without returning GM keys, join codes, player IDs, session IDs, snapshots, maps, tunnel credentials, or private campaign data. | `server/api/sessions/safety.get.ts`, `shared/sessionSafety.ts`, `src/pages/sessions.vue`, `docs/archive/live-session/live-session-public-exposure-checks.md`, `tests/shared/sessionSafety.test.ts`, and `tests/server/sessionSafetyEndpoint.test.ts`. |
| Hosting runbooks | Pass. LAN remains primary, named Cloudflare Tunnel remains the supported remote path, and Quick Tunnel remains development smoke-test only. | `docs/archive/live-session/live-session-lan-hosting.md`, `docs/archive/live-session/live-session-cloudflare-tunnel-hosting.md`, `docs/archive/live-session/live-session-quick-tunnel-caveat.md`, `docs/archive/live-session/live-session-named-tunnel-maintenance.md`, and `docs/archive/live-session/live-session-deployment-smoke-checklist.md`. |
| Data and secret hygiene | Pass. Generated/private map or sheet data, session snapshots, event logs, tunnel credentials, tokens, private keys, real `.env` files, GM keys, and real join codes must stay out of tracked files. | `.gitignore`, `docs/archive/live-session/live-session-storage.md`, `docs/archive/live-session/live-session-backup-recovery.md`, `docs/archive/live-session/live-session-security-boundaries.md`, this readiness maintenance, and `tests/docs/liveSessionSecuritySecretHygieneReadiness.test.ts`. |

Representative WebSocket command-dispatch evidence includes `tests/server/sessionMoveTokenWebSocketDispatch.test.ts`, `tests/server/sessionModifyHpWebSocketDispatch.test.ts`, `tests/server/sessionInitiativeWebSocketDispatch.test.ts`, and `tests/server/sessionTerrainWebSocketDispatch.test.ts` in addition to the integrated multi-client command-flow coverage.

## Auth and session authority findings

The source review confirms that Live session authority is separate from the local trust picker:

- The existing `/login` page remains a local GM/player trust switch for non-session app navigation. It is still not public authentication.
- `POST /api/sessions/start` calls `assertSessionHostEnabled()` and then `requireGm(event)` before creating the GM session. This keeps accidental disabled/default startup fail-closed and preserves the local GM start boundary.
- `POST /api/sessions/join` is intentionally player-facing after the runtime gate. It accepts only a session join code plus sanitized display name and returns generated session-local `playerId`/`clientId` values.
- `POST /api/sessions/manage` and `POST /api/sessions/assignments` require the session-local GM key instead of trusting `/login` as public auth.
- `POST /api/sessions/player-state` validates `sessionId`, `playerId`, `clientId`, and display name before returning only the caller's filtered state.
- Display names remain labels. Duplicate names are allowed and do not grant authority without the generated player/client identity and current server-side assignment.

The accepted limitation is that a join code can be forwarded. Live session treats join codes as trusted-table capabilities, not account passwords, and does not add public brute-force defenses. If a code or GM browser identity leaks, the GM should stop exposure and start a fresh session.

## Cookie and browser identity findings

The browser continuity model is intentionally lightweight:

- `rotom:session:identity` local storage can remember full session identity for convenience, including the GM key for the GM browser. That browser profile should be treated as private.
- The `rotom-session-identity` cookie is only a continuity hint. For GM records it omits `gmKey`; all cookie hints reject `gmKey` or `joinCode` fields with the `secret-in-cookie` validation issue.
- The cookie uses the app's client-side helper and default `SameSite=Lax` development-friendly settings. It is not a hardened account/session cookie and should not be documented as such.
- The lobby's **Forget in this browser** action clears both local storage and the cookie hint and should be used on shared, stale, or accidentally exposed profiles.
- Server WebSocket and HTTP handlers revalidate session-local authority; they do not trust the cookie hint as proof of control.

## Permission and command findings

The implemented command boundary remains server-authoritative:

- A WebSocket peer starts as `pending-hello` and becomes authenticated only after the server validates the GM key or player identity against the active session store.
- Heartbeat frames keep activity fresh but do not grant authority or advance revisions.
- Command frames are accepted only after the server validates message shape, command envelope shape, `sessionId`, `opId`, `baseRevision`, actor identity, and command-specific payload.
- The authenticated socket actor must match the command actor; a modified client cannot claim another player or GM actor inside a command envelope.
- Player commands recheck current GM-managed assignments and visibility before mutating state. View-only or unassigned players receive safe `commandReject` frames without revision or snapshot changes.
- GM-only commands such as token spawn/delete, initiative lane changes, hazards, field effects, and terrain edits remain GM-only.
- Accepted commands produce `commandAck` plus small same-session patches, not live-client whole-map autosaves.
- Reconnect fallback for player clients filters snapshots to that player, their assignment, visible maps, and their connected-client rows; it excludes GM keys, join codes, hidden maps, and other players' identity/assignment records.

The accepted limitation is that command-specific bugs could still exist. Live session mitigates this with focused shared/use-case/WebSocket tests and documented non-goals, but it is not a public adversarial service.

## Public exposure findings

The public-exposure review confirms the warnings remain aligned with the locked hosting model:

- Plain `npm run dev` remains the standard local development path and does not enable session hosting.
- `npm run dev:session:lan` explicitly enables the runtime flag and binds to `0.0.0.0` for same-Wi-Fi/LAN play.
- `npm run dev:session:tunnel` explicitly enables the runtime flag and binds to `127.0.0.1` for a named Cloudflare Tunnel that provides the remote stable hostname.
- `GET /api/sessions/safety` is intentionally readable while hosting is disabled so the lobby can explain fail-closed status. When enabled, it reports no-secret counts/readiness and exposure classification.
- The `/sessions` safety banner warns that anyone who can reach the Rotom Table origin can load the local app, that the `/login` role picker is not public auth, and that join codes should be shared only with trusted players.
- LAN and named-tunnel runbooks require the GM to check `/sessions` through the same origin players will use before sharing a code.
- The named Cloudflare Tunnel runbook treats Cloudflare Access/WAF/IP rules as optional outer protection only; Rotom Table still enforces its own session-local identity, assignments, revisions, and command validation.
- Quick Tunnel remains documented only as a temporary development smoke-test option using temporary `trycloudflare.com` URLs. It is not the supported campaign-session path.

## Repository secret-hygiene confirmation

The current tracked-file review confirms that the repository does not commit live-session runtime authority or private table data:

- no real GM keys or join codes are documented; tests use synthetic constants and product docs use redacted placeholders instead of real table credentials;
- no `data/sessions/` runtime directories, `snapshot.json` session snapshots, or `events.jsonl` event logs are tracked;
- no private `data/maps/`, `data/trainers/`, `data/reference-overrides/`, or personal `data/sheets/` campaign files are tracked; only curated `data/sheets/examples/` and app-owned reference data are intentionally present;
- no Cloudflare `cert.pem`, tunnel credentials JSON, API tokens, private keys, real `.env` or `.env.*` files, tunnel logs, screenshots with secrets, or private campaign archives are tracked;
- `.gitignore` continues to ignore local campaign maps, generated/private sheets, trainer data, campaign reference overrides, live-session snapshots, event logs, environment files, build outputs, and temporary smoke data.

Repeat this check before sharing evidence or committing after a live table rehearsal:

```bash
git status --short
git ls-files | grep -E '(^|/)(\.env(\.|$)|data/sessions/|data/maps/|data/trainers/|data/reference-overrides/|snapshot\.json$|events\.jsonl$|cert\.pem$|.*credentials.*\.json$)'
```

The first command should show no unintended generated/private files. The second command should print nothing for this repository; if it prints a path, inspect and remove/rotate the data before sharing or committing.

## Remaining non-goals and residual risks

These limitations are still explicit and acceptable for Live session:

- no full public account system, passwords, OAuth, SSO, MFA, account recovery, or long-lived user accounts;
- no public multi-tenant hosting, anonymous public signup, self-serve rooms, SaaS operations, or tenant isolation;
- no production-grade internet abuse controls such as IP rate limiting, CAPTCHA, bot detection, WAF-managed app auth, or centralized abuse monitoring;
- no encrypted-at-rest session snapshots/backups, automatic credential rotation, tamper-proof audit log, or secrets-management service;
- no hosted database, Redis, Postgres, Durable Objects, cloud object storage, or cloud-first persistence layer;
- no hardening claim for every legacy trust-based mutating route when the whole app is exposed to arbitrary public users;
- no browser-owned recovery authority from local storage, screenshots, stale optimistic state, or copied map JSON;
- no Quick Tunnel campaign hosting and no legacy SSE session command transport.

If Rotom Table later targets public hosting, that must be a separate architecture effort with real authentication, route-by-route authorization, rate limiting, hosted persistence decisions, backup encryption, secret management, incident response, and content/asset rights review.

## Security checklist

- [x] Session hosting is disabled by default and requires the exact `ROTOM_ENABLE_SESSION_HOST=1` opt-in.
- [x] The local `/login` GM/player picker is still documented as a trust switch, not public authentication.
- [x] GM session management and assignment authority depend on the session-local GM key.
- [x] Player state and commands depend on generated player/client identity plus current assignments and visibility.
- [x] Cookie hints exclude GM keys and join codes; full remembered GM identity is confined to private browser local storage.
- [x] WebSocket commands validate session, actor, envelope, payload, permissions, revision, and conflict boundaries before mutation.
- [x] Same-session fanout and reconnect snapshots avoid cross-session and hidden-state leakage.
- [x] Public exposure warnings cover disabled, local, LAN, remote/tunnel, and missing-session-readiness states without returning secrets.
- [x] LAN remains primary, named Cloudflare Tunnel remains the supported remote path, and Quick Tunnel remains dev smoke-test only.
- [x] Remaining public-service hardening work is documented as out of scope rather than hidden behind session-local identity.
- [x] No real GM keys, join codes, session snapshots, optional event logs, tunnel credentials, private maps, private campaign files, real `.env` files, or generated/private sheet data are present in tracked files.

## Operator reminder

Before a real table session, the GM should still run an environment-specific smoke pass: start with the documented helper command, open `/sessions` through the same LAN or named-tunnel origin players will use, resolve the safety banner, start a fresh session if credentials were over-shared, use separate browser profiles for GM and players, and check `git status --short` before committing or sharing evidence.
