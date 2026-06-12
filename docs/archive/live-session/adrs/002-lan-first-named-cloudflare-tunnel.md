# ADR 002: LAN first and named Cloudflare Tunnel second

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

Date: 2026-05-25

Status: Accepted

> Maintenance note: This ADR describes the legacy `/sessions` surface. Normal multiplayer play now uses persistent player profiles on `/maps/<slug>` and follows [ADR 009: Server-authoritative profile play](../../../adrs/009-server-authoritative-profile-play.md).

## Context

Live session keeps Rotom Table shaped as a GM-hosted table session. A GM runs the app on a machine they control, and players connect by browser for the duration of the session. That shape needs a practical hosting story for two cases:

1. everyone is on the same local network; and
2. one or more players need remote access over the internet.

The hosting path must preserve GM/operator ownership of the filesystem-backed campaign data and avoid implying that Rotom Table has become a public SaaS service or a hardened multi-tenant deployment. It also must be compatible with session socket transport, reconnect behaviour, and explicit session-host safety gates.

## Decision

Rotom Table Live session supports hosting in this order:

1. **LAN / same Wi-Fi is the primary path.** The GM runs Rotom Table locally or on a small machine they control. Players connect to the GM-owned server from browsers on the same network.
2. **Named Cloudflare Tunnel is the supported remote path.** For remote players, the GM may configure a named Cloudflare Tunnel with a stable public hostname that forwards to the private Rotom Table server.

Cloudflare Quick Tunnel is explicitly **not** the supported campaign-session deployment path. It may appear only as a temporary development smoke-test option, and any documentation that mentions it must state its limitations clearly.

This decision does not add a cloud database, public multi-tenant hosting, full accounts, or SaaS operations. The GM-hosted Rotom Table process remains the session authority.

## Rationale

### LAN first

LAN hosting best matches the existing filesystem-backed app and the tabletop use case:

- the GM keeps maps, sheets, generated data, and session snapshots on a machine they control;
- the server is reachable only by people on the trusted local network unless the GM deliberately exposes it;
- there is no dependency on external DNS, tunnel credentials, or cloud availability for in-person play;
- the networking model is easy to explain and debug: start the server, find the host address, and join from another browser on the same Wi-Fi.

LAN first also reinforces that the current trust-based local role picker is not public authentication. Session-hosting code still needs an explicit runtime flag and session-local credentials, but the default supported story starts with the smallest exposure boundary.

### Named Cloudflare Tunnel second

A named Cloudflare Tunnel is the supported remote option because it gives the GM a stable, intentional access path:

- a durable hostname can be shared with players and reused between sessions;
- tunnel configuration can be documented, reviewed, backed out, and tied to the GM's private server origin;
- WebSocket connections can be planned against a consistent route rather than an ad-hoc URL;
- safety warnings can be attached to one explicit remote-hosting mode.

The named tunnel is still only a path to the GM-hosted server. It does not make Rotom Table a Cloudflare-hosted application, does not add tenant isolation, and does not replace session-local identity or permission checks.

### Quick Tunnel rejected as the primary path

Quick Tunnel is rejected for supported campaign sessions because it is intentionally ad hoc:

- URLs are temporary and can change between runs;
- it is easy to share a public endpoint before the GM has reviewed session-host safety settings;
- it is harder to document stable player instructions, rollback steps, and operational expectations;
- the convenience can obscure the distinction between a development smoke test and a supported remote table setup.

Quick Tunnel can still be useful for a short developer smoke test when docs call it out as temporary and limited. It must not be presented as the recommended remote path for real play.

## Consequences

- Hosting docs and scripts should start with LAN instructions before remote tunnel instructions.
- Remote-hosting docs should describe a named Cloudflare Tunnel with a stable hostname, not Quick Tunnel as the normal path.
- WebSocket, heartbeat, reconnect, and session-safety work must be validated against LAN and named-tunnel assumptions.
- Session hosting still requires an explicit runtime opt-in and must not treat the local GM/player role picker as public auth.
- The GM remains responsible for deciding who can reach their server and for stopping or removing tunnel exposure when a session ends.
- Docs may mention Quick Tunnel only as a temporary development smoke-test tool with clear caveats.

## Rejected alternatives

### Quick Tunnel as the normal remote workflow

Rejected. It is convenient for quick checks, but its temporary URL and ad-hoc setup are a poor fit for recurring campaign sessions and stable player instructions.

### Full cloud deployment

Rejected for Live session. A cloud deployment would imply operational responsibilities, account management, hosted persistence, tenant isolation, and broader security hardening that are outside the GM-hosted session goal.

### VPN-only remote access

Rejected as the primary documented remote path. VPNs can work for some groups, but they are too environment-specific to be the Live session supported remote mode. A named tunnel gives one documented route while still pointing at the GM-controlled private server.

## Validation notes

Reviewers can validate this ADR by checking that live-session work:

- documents LAN as the first supported hosting path;
- documents named Cloudflare Tunnel as the supported remote path with a stable hostname;
- avoids presenting Quick Tunnel as the campaign-session recommendation;
- keeps session hosting behind an explicit safety flag;
- preserves filesystem-backed JSON persistence and GM-owned authority rather than adding cloud persistence or public multi-tenancy.
