# ADR 008: Session runtime safety flag

Date: 2026-05-25

Status: Accepted

> Maintenance note: This ADR describes the legacy `/sessions` surface. Normal multiplayer play now uses persistent player profiles on `/maps/<slug>` and follows [ADR 009: Server-authoritative profile play](009-server-authoritative-profile-play.md).

## Context

Live session lets a GM-hosted Rotom Table process accept browser connections from multiple devices. That is a meaningful exposure change from the existing filesystem-backed trusted-table workflow, where the GM/player role picker is a trusted table convenience and app data usually stays in operator-controlled storage.

The supported hosting paths are LAN first and named Cloudflare Tunnel second. Both can make the app reachable by people beyond the GM's browser, and a named tunnel can make it reachable from the public internet. Live session therefore needs a deliberate runtime safety gate before any session-hosting routes, WebSocket endpoints, lobby flows, or public join surfaces are enabled.

The safety gate must prevent accidental exposure. It must also make clear that enabling session hosting does not convert the current local role picker into hardened public authentication, and does not make Rotom Table a SaaS or public multi-tenant service.

## Decision

live session hosting requires an explicit runtime opt-in. The canonical flag is:

```bash
ROTOM_ENABLE_SESSION_HOST=1
```

Unless that flag is set to the documented enabled value, session-hosting functionality is disabled. Disabled means session start/join endpoints, session WebSocket routes, session lobby management, player join flows, and any server-authoritative live-session command entry points must fail closed rather than becoming available silently.

The flag is a runtime safety gate, not a secret and not authentication. Once hosting is enabled, every session still requires session-local identity and permissions: GM key, join code, player ID, client ID, assignments, visibility checks, command validation, revisions, and server-authoritative conflict handling.

## Required behaviour

Implementation and follow-up changes must preserve these behaviours:

- **Default disabled:** a normal local development run does not host Live sessions unless the flag is explicitly enabled.
- **Fail closed:** session endpoints and sockets reject or hide themselves when the flag is absent, empty, misspelled, or set to any value other than the documented enabled value.
- **Visible opt-in:** server logs, UI banners, and hosting docs should make the enabled/disabled state clear to the GM.
- **No role-picker escalation:** the existing trusted GM/player role picker remains a local convenience and must not be treated as public auth for session hosting.
- **Session credentials still required:** enabling the flag only permits the session-host feature to run; it does not grant GM authority, player control, or access to hidden state.
- **Local mode preserved:** disabling the flag must not break existing local map/sheet workflows outside session mode.
- **No committed secrets:** examples may show the flag name and value, but real `.env` files, GM keys, join codes, tunnel tokens, private maps, generated sheets, snapshots, and event logs must not be committed.

## Public exposure boundary

Running with `ROTOM_ENABLE_SESSION_HOST=1` means the GM has intentionally allowed Rotom Table to host a table session. It does not mean the app is safe to expose as a general public website.

When a GM binds the server to a LAN interface or places it behind a named Cloudflare Tunnel, the reachable surface includes at least the session start/join flow, session WebSocket route, and any non-session routes already served by the app. Documentation and UI should warn that:

- anyone who can reach the server may be able to load public app surfaces;
- join codes are invitation secrets for the current session, not durable passwords;
- a leaked GM key grants GM authority for that session;
- named tunnels must be stopped or restricted when no longer needed;
- Quick Tunnel, when mentioned, is only a temporary development smoke-test path;
- Live session does not provide full accounts, tenant isolation, abuse handling, or hardened public auth.

This boundary is especially important while legacy non-session functionality coexists with session mode. The safety gate ensures the app does not accidentally publish a session API, but it does not replace route-level validation, permission checks, or conservative docs.

## Rejected alternatives

### Session hosting enabled by default

Rejected. Default-on hosting would make it too easy for a local-only app run to become reachable through a LAN bind, reverse proxy, tunnel, or copied development command without the GM understanding the exposure.

### Trusting the local GM/player role picker as public auth

Rejected. The role picker is a trusted local-table convenience. Public or remote session access requires explicit session-local credentials and server-side permission checks, not a user-selected role in the browser.

### Treating the runtime flag as the only security control

Rejected. The flag only gates whether hosting can start. Session identity, command validation, permissions, revisions, duplicate `opId` handling, and reconnect rules remain required for all live-session behaviour.

### Full account/auth provider requirement

Rejected for Live session. Adding accounts or external auth would conflict with the locked no-full-accounts, GM-hosted product shape. The safety flag combines with session-local identity rather than a SaaS-style login system.

### Environment-specific implicit enablement

Rejected. Session hosting must not become enabled merely because the app is in development mode, production mode, bound to `0.0.0.0`, or running behind a tunnel. The opt-in must be explicit and documented.

## Consequences

- Start-session, join-session, WebSocket, and session command routes must check a shared runtime gate before doing session work.
- Tests must cover disabled-by-default behaviour, exact enabled value handling, unsafe startup states, and preservation of local mode when the flag is absent.
- Hosting docs and npm scripts should show the explicit flag alongside LAN or named-tunnel commands.
- UI work should surface a clear session-hosting safety banner when the flag is enabled and avoid implying production-grade public auth.
- Logs and docs may name `ROTOM_ENABLE_SESSION_HOST`, but they must not print or commit real GM keys, join codes, tunnel credentials, private campaign data, snapshots, or `.env` files.
- Security review must treat the flag as one safety layer, not as a substitute for session-local credentials and server-side authorization.

## Validation notes

Reviewers can validate this ADR by checking that live-session work:

- keeps session hosting disabled unless `ROTOM_ENABLE_SESSION_HOST=1` is present;
- fails closed for session routes and sockets when the flag is absent or invalid;
- preserves existing file-backed app workflows outside session mode;
- does not expose the local role picker as public authentication;
- requires GM keys, join codes, player/client IDs, assignments, and command permissions even when hosting is enabled;
- warns clearly before LAN or named-tunnel exposure;
- keeps Quick Tunnel documented only as a development smoke-test option;
- avoids committing secrets, private data, real `.env` files, snapshots, or logs.
