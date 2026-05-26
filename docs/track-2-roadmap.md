# Track 2 roadmap — GM-hosted session concurrency

Track 2 adds real multi-device table sessions to Rotom Table while preserving the existing local-first app. It is an architecture and implementation roadmap, not a claim that every item below is already shipped.

## Goal

A GM can run Rotom Table on their own machine or a small machine they control, start a table session, and let players keep the app open in their browsers during play. Live session changes flow through server-authoritative commands with acknowledgements, rejections, monotonic revisions, and reconnect-safe state.

Track 2 replaces live-session whole-map last-writer-wins editing with command-based concurrency. Existing local-first map and sheet workflows remain available outside session mode.

## Locked product shape

Track 2 is a **GM-hosted table session**.

Supported hosting modes:

1. **LAN / same Wi-Fi** — the primary path. The GM runs Rotom Table locally and players connect by browser.
2. **Named Cloudflare Tunnel** — the supported remote path. A stable hostname points to the private Rotom Table server.

Track 2 deliberately does **not** make Rotom Table a SaaS product, public multi-tenant app, cloud-first database app, or generic collaborative document editor.

Cloudflare Quick Tunnel can be used only as a temporary development smoke-test option when docs explicitly call out its limitations. It is not the supported campaign-session deployment path; see the [Track 2 Quick Tunnel caveat](track-2-quick-tunnel-caveat.md) for the narrow smoke-test boundary and legacy SSE limitations.

## Architecture pillars

| Pillar | Track 2 decision |
| --- | --- |
| Runtime safety | Session hosting requires an explicit opt-in flag, such as `ROTOM_ENABLE_SESSION_HOST=1`. |
| Transport | New live session concurrency uses WebSockets for commands, acks/rejections, broadcasts, presence, heartbeat, and reconnect handshakes. |
| Authority | The server owns authoritative session state. Clients request changes with commands. |
| Concurrency | Each accepted command increments a monotonic session/map revision and is associated with an operation ID (`opId`). |
| Identity | Track 2 uses session-local identity: GM key, join code, player display name, player ID, client ID, and assigned controllable resources. |
| Persistence | State remains local-first JSON: atomic session snapshots plus an optional append-only event log. |
| Compatibility | Legacy local-first editing and non-session realtime paths can remain during migration, but live session clients must not autosave whole maps as the main concurrency mechanism. |

## Roadmap phases

| Phase | Focus | Expected outcome |
| --- | --- | --- |
| 0. Architecture lock | Roadmap, glossary, ADRs, validation matrix | The locked scope, non-goals, and review expectations are documented before implementation spreads through the app. |
| 1. Session contracts | Shared identity, role, revision, command, result, message, validation, and permission types | Client and server code use one protocol vocabulary for session messages. |
| 2. State and persistence | In-memory session store, authoritative map state, snapshots, recovery, event log, duplicate `opId` tracking, cleanup | The server can own, mutate, persist, and recover session state without a hosted database. |
| 3. Identity, join, lobby | GM start-session flow, player join flow, client identity continuity, assignments, minimal lobby UI, safety banner | A GM can start a guarded session and players can join with session-local identity. |
| 4. WebSocket transport | Socket route, client composable, hello/auth handshake, heartbeat, fanout, reconnect, message validation | Session clients can connect, stay alive, recover, and receive isolated session broadcasts. |
| 5. Token commands | Move, turn, spawn/delete, send-out Pokémon commands, optimistic handling, two-client smoke checks | Token manipulation moves from direct whole-map mutation to authoritative command flow in session mode. |
| 6. Table actions | HP, combat stages, conditions, initiative, move/ability/order boundaries, hazards, field effects, terrain commands | Core table actions use session command boundaries with permissions, conflicts, and broadcasts. |
| 7. Client integration | Session/local state split, map composable, MapScenePanel wiring, rejection UI, presence, reconnect states, navigation, multi-tab smoke helper | The app can run local mode and session mode side by side without regressing Track 1 map quality. |
| 8. Hosting hardening | LAN runbook, named Cloudflare Tunnel runbook, Quick Tunnel caveat, runtime scripts, warnings, backups, security review | GMs have safe documented hosting paths and know the remaining trust boundaries. |
| 9. Final audit | Multi-client command audit, LAN smoke pass, tunnel docs review, local-mode regression review, security and recovery audit | Track 2 is validated end to end and known limitations are recorded. |

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
   - Local snapshots and optional event logs remain available for backup or recovery according to the [Track 2 session storage guide](track-2-session-storage.md).

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
- Track 1 render quality and map functionality must not be reduced to make Track 2 easier.

## Non-goals

Track 2 does not include:

- full user accounts or third-party auth providers;
- public multi-tenant hosting;
- Postgres, Redis, Durable Objects, or another hosted database;
- a cloud-first persistence rewrite;
- Quick Tunnel as the supported campaign-session path;
- a generic shared-document editor;
- mobile-native apps;
- broad VTT features unrelated to the current Rotom Table workflow;
- committing private campaign maps, generated sheets, secrets, tokens, private keys, or real `.env` files.

See [Track 2 glossary](track-2-glossary.md) for the shared vocabulary used by this roadmap and later protocol documents. See the [Track 2 session protocol](track-2-session-protocol.md) for the shared identity, command envelope, result, WebSocket message, ack/reject, duplicate, and reconnect contracts. See the [Track 2 WebSocket protocol](track-2-websocket-protocol.md) for the live session socket route, message examples, heartbeat, reconnect, command flow, and named-tunnel expectations. See the [Track 2 table action command reference](track-2-table-action-commands.md) for supported HP, condition, initiative, move/action, hazard, field-effect, and terrain command behaviours, permissions, conflicts, and limitations. See the [Track 2 client integration guide](track-2-client-integration.md) for how local-first map mode and explicit session mode coexist, including disconnect and conflict recovery. See the [Track 2 session lobby and manual QA guide](track-2-session-lobby.md) for the current GM/player join flow, expected LAN lobby usage, and two-browser checklist. See the [Track 2 LAN hosting runbook](track-2-lan-hosting.md) for same-Wi-Fi setup commands, IP discovery, player join URLs, smoke checks, and troubleshooting. See the [Track 2 named Cloudflare Tunnel runbook](track-2-cloudflare-tunnel-hosting.md) for stable-hostname remote setup, WebSocket considerations, safety warnings, and rollback steps. See the [Track 2 Quick Tunnel caveat](track-2-quick-tunnel-caveat.md) for the temporary development smoke-test boundary, campaign-session rejection, and legacy SSE limitations. See the [Track 2 multi-tab local smoke script](track-2-multi-tab-smoke.md) for the GM/player session-map tab helper and token propagation checklist. See the [Track 2 session storage guide](track-2-session-storage.md) for snapshot/event-log paths, privacy boundaries, backup guidance, and recovery limitations. See the [Track 2 validation matrix](track-2-validation-matrix.md) for the expected tests, smoke checks, docs, and safety reviews attached to later implementation areas.
