# ADR 004: Server-authoritative commands

Date: 2026-05-25

Status: Accepted

## Context

Rotom Table's existing file-backed workflows persist maps, sheets, trainers, and related campaign files as inspectable JSON on the machine running the app or under `ROTOM_CAMPAIGN_ROOT`. That model is appropriate for non-session editing, where trusted table users edit campaign state through the app and document saves are easy to inspect, back up, and repair.

Live session adds live GM-hosted sessions where several browser clients may act at the same time. In that environment, whole-map autosave from each live client would make the browser that saved last the accidental authority. It would also make it difficult to explain which player was allowed to change a resource, why a stale move overwrote a newer one, whether a retry was applied twice, and what state a reconnecting client should trust.

Live table play needs domain outcomes rather than document-merging outcomes. Moving a token, changing HP, advancing initiative, placing hazards, or assigning controllable resources must be validated against session identity, permissions, visibility, current authoritative state, and conflict rules before the state changes.

## Decision

live session state changes use **server-authoritative command envelopes**.

In session mode, clients request changes by sending typed commands over the WebSocket session channel. A command envelope includes the common metadata the server needs to make an authoritative decision, such as:

- session and actor identity;
- client identity;
- command type;
- command-specific payload;
- resource scope touched by the command;
- client-generated `opId` for idempotency;
- client-observed `baseRevision` for stale/conflict checks;
- optional client timestamp or diagnostic metadata where useful.

The GM-hosted server validates each command before applying it. The server is responsible for:

1. validating the message and command shape;
2. verifying session identity, role, permissions, assignments, and visibility;
3. checking command-specific table rules and resource scope;
4. handling duplicate `opId` values idempotently;
5. rejecting stale or conflicting commands when current authoritative state has moved on;
6. applying accepted commands to authoritative session state;
7. incrementing the server-owned session/map revision;
8. writing local session persistence, such as a snapshot and optional event log entry;
9. sending an explicit ack or rejection to the command sender;
10. broadcasting a small accepted patch/event to other clients in the same session.

Live session clients must not mutate and autosave whole map documents as the primary concurrency mechanism. Whole-map JSON remains valid for local mode and for server-owned session snapshots, but live multi-client updates flow through commands and authoritative revision changes.

## Rationale

### Prevent last-writer-wins map overwrites

Whole-map autosave treats a large JSON document as the unit of concurrency. If two live clients edit different things or the same token from stale views, the later save can overwrite earlier accepted state without a clear table-rule decision. Commands make each user intent explicit and let the server accept, reject, or reconcile that intent before any authoritative state changes.

### Preserve table-domain permissions

Players should only control assigned and visible resources. The GM may have broader authority, but GM actions still need validation and safe state transitions. A command boundary gives the server a consistent place to check actor identity, assignment records, visibility, and command-specific rules before state changes are broadcast.

### Make conflicts and stale state explainable

Every command carries a `baseRevision` and a resource scope. The server can allow safe cross-resource changes across small revision gaps, reject stale same-token or same-resource changes, and return current authoritative state when the client must reconcile. That is clearer than asking clients to merge whole-map JSON or silently accepting whichever save arrives last.

### Support retries, reconnects, and optimistic UI

A client may retry a command after a network blip, and a browser may optimistically preview a token move before the server responds. The `opId` lets the server acknowledge or ignore duplicate submissions idempotently, while ack/reject messages and authoritative patches let the client confirm, roll back, or refresh local UI state.

### Keep broadcasts small and session-scoped

Accepted commands can produce compact patches/events, such as "token A moved to position B at revision 42." This avoids sending an entire map document for every live action and gives the server a natural point to fan out only to clients connected to the same session.

### Preserve file-backed ownership

Server-authoritative commands do not require a cloud database or SaaS backend. The GM-hosted server remains the authority for one session and persists recoverable state as filesystem-backed JSON snapshots plus optional local event logs. Campaign ownership stays with the GM/operator-controlled storage.

## Compatibility boundaries

- **Local mode keeps file-backed saves.** Existing non-session map and sheet editing may continue to load and save whole JSON documents through the app's filesystem-backed workflows.
- **Session mode is additive and guarded.** The command path applies when a Live session is active and session hosting has been explicitly enabled.
- **Server snapshots are allowed.** The server may write whole authoritative session snapshots for recovery. That is not the same as accepting whole-map autosaves from multiple live clients.
- **Imports, exports, setup, and GM maintenance can remain document-oriented outside live play.** Those workflows should not become the session concurrency mechanism.
- **Legacy non-session realtime paths may remain during migration.** Existing SSE behaviour can continue outside the new WebSocket session command channel.
- **Map rendering quality and map functionality must remain intact.** Session commands should feed authoritative state into the existing map experience without reducing visual quality or removing local map features.

## Rejected alternatives

### Live client whole-map autosave

Rejected for session concurrency. It recreates last-writer-wins behaviour, makes permission checks easy to bypass or duplicate incorrectly in browsers, hides same-resource conflicts, and makes retries/reconnects ambiguous.

### Generic collaborative document editing

Rejected for live sessions. CRDTs or generic shared-document merge tools are useful in some document editors, but Rotom Table needs table-domain validation, GM/player authority boundaries, revision-aware conflict handling, and command-specific acknowledgements.

### Client-side authority with peer reconciliation

Rejected. Letting browsers apply state changes directly and reconcile later would make the trust boundary unclear, especially for player-controlled resources. Live session is GM-hosted: the GM's server is the authority.

### Database-mediated conflict resolution

Rejected for Live session. Adding a hosted database or queue would conflict with the GM-hosted, filesystem-backed architecture. Conflict decisions belong in the session command application layer, backed by local JSON snapshots and optional event logs.

## Consequences

- Contract work must define shared command envelopes, `opId` handling, `baseRevision`, command result shapes, message schemas, and validators.
- Server implementation must maintain authoritative session state and apply command effects before broadcasting changes.
- Client session mode must dispatch commands instead of directly saving whole maps for live table actions.
- Optimistic UI must reconcile against server acks, rejections, and authoritative patches.
- Tests must cover command validation, permission denials, duplicate `opId` handling, stale/conflict rejection, revision increments, reconnect recovery, and local/session mode boundaries.
- Documentation must continue to distinguish non-session file-backed editing from guarded live session concurrency.

## Validation notes

Reviewers can validate this ADR by checking that live-session work:

- routes session-mode token and table actions through command envelopes;
- rejects malformed, unauthorized, stale, and conflicting commands before state mutation;
- increments server-owned revisions only after accepted commands;
- handles duplicate `opId` submissions idempotently;
- broadcasts accepted changes as small session-scoped patches/events;
- keeps whole-map autosave available for local mode but not as the live session concurrency mechanism;
- persists recoverable session snapshots locally without adding cloud database requirements.
