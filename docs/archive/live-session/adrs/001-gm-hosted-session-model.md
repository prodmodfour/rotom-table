# ADR 001: GM-hosted session model

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

Date: 2026-05-25

Status: Accepted

> Maintenance note: This ADR describes the legacy `/sessions` surface. Normal multiplayer play now uses persistent player profiles on `/maps/<slug>` and follows [ADR 009: Server-authoritative profile play](../../../adrs/009-server-authoritative-profile-play.md).

## Context

Live session adds real multi-device play so a GM can host a Rotom Table session and players can keep the app open during the game. The existing app uses filesystem-backed campaign data: campaign maps, sheets, trainers, and encounter tables are inspectable JSON files on the machine running Rotom Table or under `ROTOM_CAMPAIGN_ROOT`, and the current GM/player role picker is a trusted table convenience rather than hardened public authentication.

The concurrency problem Live session solves is table-session coordination, not general document collaboration or public product hosting. Live players need authoritative outcomes for moves, HP changes, initiative, visibility, and assignments. They also need clear acknowledgements, rejections, and reconnect behaviour. Those requirements are tied to tabletop domain rules and permissions, not just shared text/document editing.

## Decision

Rotom Table Live session is a **GM-hosted table session**.

A GM runs Rotom Table locally or on a small machine they control. Players connect by browser to that GM-owned server for one table session. During session mode, the GM-hosted server is the authority for session identity, permissions, command validation, revisions, snapshots, and broadcasts.

This decision means Live session is intentionally not:

- a SaaS product;
- a public multi-tenant app;
- a generic collaborative document editor;
- a cloud-first database application.

Existing file-backed workflows remain supported outside session mode. Live session adds a guarded session mode beside them rather than replacing the whole app with a hosted collaboration platform.

## Rejected alternatives

### SaaS or public multi-tenant hosting

Rejected for Live session. A SaaS shape would require durable tenant isolation, account management, hardened public auth, abuse handling, centralized operations, hosted persistence, and a broader security model. That is far beyond the current local table tool and would conflict with the locked Live session goal of GM-controlled hosting.

### Generic collaborative document editing

Rejected for live sessions. Treating maps as shared documents with every client autosaving or merging whole map JSON would recreate last-writer-wins risks and hide tabletop conflicts inside document merge behaviour. Rotom Table needs domain commands that the server can validate against identity, permissions, visibility, resource scope, and current revision.

### Public role picker as authentication

Rejected. The existing GM/player selector is suitable for trusted local use, but it must not become public auth just because a session can be reached by another browser. Session hosting requires explicit safety boundaries and session-local credentials rather than exposing the local trust model as if it were hardened account security.

### Cloud-first persistence rewrite

Rejected for Live session. Local JSON state is a project strength: it is inspectable, easy to back up, and aligned with home campaign ownership. Live session may add session snapshots and optional event logs, but it does not introduce Postgres, Redis, Durable Objects, or another hosted database as the session foundation.

## Consequences

- The GM is responsible for running the session server and deciding who can reach it.
- Session features must be additive and must preserve local mode for existing map/sheet workflows.
- Session code must assume one GM-owned authority per session rather than unrelated tenants sharing a public service.
- Player identity is session-local, not a full account system.
- Live session changes must flow through server-authoritative commands, not whole-map client autosaves as the primary concurrency mechanism.
- Documentation and implementation work must keep public exposure warnings clear, especially where the trust-based local role picker still exists.
- Follow-up architecture decisions for transport, hosting paths, persistence, runtime safety, identity, and conflict rules must remain consistent with this GM-hosted product shape.

## Validation notes

Reviewers can validate this ADR by checking that live-session work:

- keeps LAN and GM-controlled remote access as the user story;
- avoids tenant/account/cloud-database requirements;
- preserves filesystem-backed JSON workflows outside session mode;
- scopes permissions, presence, commands, and broadcasts to one GM-hosted session;
- documents any public exposure risks instead of implying production-grade public auth.
