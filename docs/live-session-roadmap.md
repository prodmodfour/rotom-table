# Live session roadmap — GM-hosted session concurrency

Live session adds real multi-device table sessions to Rotom Table while preserving the existing local-first app. This document started as the architecture and implementation roadmap and now also serves as a reviewer index for the completed live-session implementation.

## Goal

A GM can run Rotom Table on their own machine or a small machine they control, start a table session, and let players keep the app open in their browsers during play. Live session changes flow through server-authoritative commands with acknowledgements, rejections, monotonic revisions, and reconnect-safe state.

Live session replaces live-session whole-map last-writer-wins editing with command-based concurrency. Existing local-first map and sheet workflows remain available outside session mode.

## Locked product shape

Live session is a **GM-hosted table session**.

Supported hosting modes:

1. **LAN / same Wi-Fi** — the primary path. The GM runs Rotom Table locally and players connect by browser.
2. **Named Cloudflare Tunnel** — the supported remote path. A stable hostname points to the private Rotom Table server.

Live session deliberately does **not** make Rotom Table a SaaS product, public multi-tenant app, cloud-first database app, or generic collaborative document editor.

Cloudflare Quick Tunnel can be used only as a temporary development smoke-test option when docs explicitly call out its limitations. It is not the supported campaign-session deployment path; see the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) for the narrow smoke-test boundary and legacy SSE limitations.

## Architecture pillars

| Pillar | Live session decision |
| --- | --- |
| Runtime safety | Session hosting requires an explicit opt-in flag, such as `ROTOM_ENABLE_SESSION_HOST=1`, with helper scripts for guarded LAN and named-tunnel startup. |
| Transport | New live session concurrency uses WebSockets for commands, acks/rejections, broadcasts, presence, heartbeat, and reconnect handshakes. |
| Authority | The server owns authoritative session state. Clients request changes with commands. |
| Concurrency | Each accepted command increments a monotonic session/map revision and is associated with an operation ID (`opId`). |
| Identity | Live session uses session-local identity: GM key, join code, player display name, player ID, client ID, and assigned controllable resources. |
| Persistence | State remains local-first JSON: atomic session snapshots plus an optional append-only event log. |
| Compatibility | Legacy local-first editing and non-session realtime paths can remain during migration, but live session clients must not autosave whole maps as the main concurrency mechanism. |

## Roadmap phases

| Phase | Focus | Expected outcome |
| --- | --- | --- |
| 0. Architecture lock | Roadmap, glossary, ADRs, validation matrix | The locked scope, non-goals, and review expectations are documented before implementation spreads through the app. |
| 1. Session contracts | Shared identity, role, revision, command, result, message, validation, and permission types | Client and server code use one protocol vocabulary for session messages. |
| 2. State and persistence | In-memory session store, authoritative map state, snapshots, recovery, event log, duplicate `opId` tracking, cleanup | The server can own, mutate, persist, and recover session state without a hosted database. |
| 3. Identity, join, lobby | GM start-session flow, player join flow, client identity continuity, assignments, minimal lobby UI, safety banner | A GM can start a guarded session and players can join with session-local identity. |
| 4. Session socket transport | Socket route, client composable, hello/auth handshake, heartbeat, fanout, reconnect, message validation | Session clients can connect, stay alive, recover, and receive isolated session broadcasts. |
| 5. Token commands | Move, turn, spawn/delete, send-out Pokémon commands, optimistic handling, two-client smoke checks | Token manipulation moves from direct whole-map mutation to authoritative command flow in session mode. |
| 6. Table actions | HP, combat stages, conditions, initiative, move/ability/order boundaries, hazards, field effects, terrain commands | Core table actions use session command boundaries with permissions, conflicts, and broadcasts. |
| 7. Client integration | Session/local state split, map composable, MapScenePanel wiring, rejection UI, presence, reconnect states, navigation, multi-tab smoke helper | The app can run local mode and session mode side by side without regressing map rendering quality. |
| 8. Hosting hardening | LAN runbook, named Cloudflare Tunnel runbook, Quick Tunnel caveat, runtime scripts, warnings, backups, security review, dependency/runtime review | GMs have safe documented hosting paths and know the remaining trust, dependency, and runtime boundaries. |
| 9. Readiness review | Multi-client command review, LAN smoke pass, tunnel docs review, local-mode regression review, security review, and recovery review | Live session validation evidence and known limitations are recorded without relying on one-off status notes. |

## Session lifecycle

1. **GM opts in to hosting**
   - Session hosting is disabled unless the GM starts the app with the documented runtime flag.
   - This prevents the current trust-based local role picker from silently becoming public auth.

2. **GM starts a session**
   - The server creates a session ID, a GM session key, a player join code, an initial authoritative snapshot, and an initial revision.
   - Session state is stored locally, not in a cloud database.

3. **Players join**
   - A player provides the join code and a display name.
   - The server creates session-local player and client identity records.
   - The GM assigns controllable sheet/token resources as needed.

4. **Clients connect over WebSocket**
   - Clients send a hello message with their session identity.
   - The server validates the identity, sends current state or a snapshot, and broadcasts presence changes only within the session.

5. **Clients send commands**
   - Each command includes an `opId`, `baseRevision`, actor metadata, and a typed payload such as moving a token or changing HP.
   - The server validates shape, permissions, visibility, and conflict rules before applying anything.

6. **Server applies or rejects**
   - Accepted commands update authoritative state, increment the revision, persist a snapshot/event, acknowledge the sender, and broadcast a small patch/event.
   - Rejected commands return a safe reason such as invalid, unauthorized, stale, or conflict, plus current authoritative state when needed.
   - Duplicate `opId` values are handled idempotently.

7. **Clients reconnect safely**
   - A reconnecting client reports the last revision it saw.
   - The server replays available events or sends the latest snapshot when replay is unavailable.

8. **Session ends or expires**
   - The GM can end a session, and idle cleanup can remove in-memory state safely.
   - Local snapshots and optional event logs remain available for backup or recovery according to the [live session storage guide](live-session-storage.md) and [Live session backup and recovery runbook](live-session-backup-recovery.md).

## Command and revision rules

- Revisions are monotonic and server-owned.
- Clients include their `baseRevision` so the server can detect stale assumptions.
- Commands touching different scopes may be accepted across small revision gaps when safe.
- Stale commands that touch the same token or resource are rejected with current authoritative state.
- GM commands generally win, subject to validation and safety rules.
- Players can only affect assigned and visible resources.
- Accepted changes are broadcast as small events/patches, not by autosaving whole map documents from every live client.

## Compatibility boundaries

- Local map/sheet editing remains local-first JSON persistence.
- Session mode is additive and guarded; it should not remove existing local mode behaviour.
- Existing SSE code may remain for non-session/local sync paths during migration.
- New live session concurrency should use WebSocket messages.
- Map rendering quality and map functionality must not be reduced to make Live session easier.

## Non-goals

Live session does not include:

- full user accounts or third-party auth providers;
- public multi-tenant hosting;
- Postgres, Redis, Durable Objects, or another hosted database;
- a cloud-first persistence rewrite;
- Quick Tunnel as the supported campaign-session path;
- a generic shared-document editor;
- mobile-native apps;
- broad VTT features unrelated to the current Rotom Table workflow;
- committing private campaign maps, generated sheets, secrets, tokens, private keys, or real `.env` files.

See [Live session glossary](live-session-glossary.md) for the shared vocabulary used by this roadmap and protocol documents. See the [live session protocol](live-session-protocol.md) for the shared identity, command envelope, result, WebSocket message, ack/reject, duplicate, and reconnect contracts. See the [Live session socket protocol](live-session-socket-protocol.md) for the live session socket route, message examples, heartbeat, reconnect, command flow, and named-tunnel expectations. See the [Live session table action command reference](live-session-table-action-commands.md) for supported HP, condition, initiative, move/action, hazard, field-effect, and terrain command behaviours, permissions, conflicts, and limitations. See the [Live session client integration guide](live-session-client-integration.md) for how local-first map mode and explicit session mode coexist, including disconnect and conflict recovery. See the [live session lobby and manual QA guide](live-session-lobby.md) for the current GM/player join flow, expected LAN lobby usage, and two-browser checklist. See the [live session host runtime scripts](live-session-host-runtime.md) for npm helpers that set the explicit runtime flag and safe LAN/named-tunnel bindings. See the [Live session public exposure checks](live-session-public-exposure-checks.md) for no-secret banner warnings when hosting is enabled before session-local credentials and authoritative state are ready. See the [Live session LAN hosting runbook](live-session-lan-hosting.md) for same-Wi-Fi setup commands, IP discovery, player join URLs, smoke checks, and troubleshooting. See the [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) for stable-hostname remote setup, WebSocket considerations, safety warnings, and rollback steps. See the [Live session named tunnel documentation review](live-session-named-tunnel-documentation-review.md) for the accuracy/current-assumptions/safety-warning review. See the [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md) for a LAN and named-tunnel smoke pass covering two players, reconnect, token movement, initiative, and conflict rejection. See the [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md) for the recorded browser-client LAN pass. See the [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) for multi-client behaviour observations, latency-sensitive paths, and known performance limitations. See the [Live session local-mode no-regression audit](live-session-local-mode-no-regression-audit.md) for the plain map/sheet workflow, local autosave, and legacy SSE regression review. See the [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) for the temporary development smoke-test boundary, campaign-session rejection, and legacy SSE limitations. See the [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md) for the GM/player session-map tab helper and token propagation checklist. See the [live session storage guide](live-session-storage.md) for snapshot/event-log paths, privacy boundaries, backup guidance, and recovery limitations. See the [Live session backup and recovery runbook](live-session-backup-recovery.md) for private archive/restore steps and local-only data boundaries. See the [Live session persistence/recovery audit](live-session-persistence-recovery-audit.md) for the review of snapshots, optional event logs, backup/restore docs, cleanup, and local data hygiene. See the [Live session security review](live-session-security-review.md) for trust boundaries, join-code limits, tunnel exposure risks, non-hardened areas, and security non-goals. See the [Live session security readiness audit](live-session-security-readiness-audit.md) for the review of auth/session/cookie/permission boundaries, public exposure warnings, and remaining non-goals. See the [Live session dependency and runtime review](live-session-dependency-runtime-review.md) for dependency inventory, runtime flags, Node/Nitro compatibility, and Cloudflare tunnel assumptions. See the [Live session implementation review](live-session-implementation-review.md) for the review linking implementation evidence, tests, docs, and known limitations. See the [Live session readiness summary](live-session-readiness-summary.md) for validation, evidence links, and architecture confirmation. See the [Live session validation matrix](live-session-validation-matrix.md) for the expected tests, smoke checks, docs, and safety reviews attached to live-session implementation areas.
