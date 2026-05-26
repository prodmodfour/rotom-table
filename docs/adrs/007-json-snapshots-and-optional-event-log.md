# ADR 007: JSON snapshots and optional event log

Date: 2026-05-25

Status: Accepted

## Context

Rotom Table is local-first: campaign maps, sheets, generated data, and related table state are files owned by the person running the app. Track 2 adds a GM-hosted session authority, but it does not change the product into a hosted database service. The session server still runs on the GM's machine or another small machine they control.

Live sessions need recoverable state for reconnects, restarts, crashes, and manual backups. At the same time, persistence must not reintroduce live client whole-map last-writer-wins saves, and it must not require Postgres, Redis, Durable Objects, or another cloud persistence layer.

## Decision

Track 2 persists session state as **local JSON snapshots**, with an **optional append-only JSON-lines event log** for replay, audit, and recovery assistance.

A session snapshot is the latest server-authoritative representation of one session. It is written by the GM-hosted server after accepted authoritative changes, not by arbitrary browser clients. The snapshot includes enough information to resume or reconcile the session, such as session identity metadata, selected map state, players, assignments, connected-client-independent presence data, current revision, recent processed `opId` results, and command/resource metadata needed for safe reconnect behaviour.

An event log, when enabled, records append-only command/event entries associated with accepted authoritative changes. It can support replay after reconnect, troubleshooting, and recovery after the last snapshot. The event log is optional: the latest valid snapshot remains the required recovery source, and clients must receive a current snapshot when replay is unavailable, disabled, truncated, or unsafe.

All session persistence remains local-first JSON under app-owned local data paths that are ignored by git. Private campaign state, generated sheets, session keys, join codes, snapshots, event logs, backups, and real `.env` files must not be committed.

## Snapshot contents

The TypeScript snapshot types are defined in the Track 2 implementation, and every persisted snapshot is shaped around authoritative session state rather than client document edits. A snapshot should include:

- schema/version information for validation and migrations;
- `sessionId` and non-account session metadata;
- current selected map/session state and authoritative revision;
- player records, display names, roles, assignments, visibility/control metadata, and GM-managed session settings;
- current token, sheet, initiative, terrain, hazard, field-effect, and other table state that has landed in the session state model;
- recent processed `opId` result metadata needed to answer duplicate retries idempotently;
- enough recent resource-scope metadata to reject or safely accept commands across bounded revision gaps;
- timestamps useful for operations and cleanup.

Snapshots are not public API payloads. They may contain private campaign details and session-local secrets or secret-derived material needed for recovery. User-facing reconnect payloads must still be filtered by permissions and visibility.

## Atomic snapshot writes

Snapshot writes must use temp-file-and-rename semantics so the app does not leave a partially written file as the latest snapshot.

The implementation should follow this pattern:

1. serialize and validate the complete snapshot JSON in memory;
2. write it to a unique temporary file in the same directory as the final snapshot;
3. flush/close the temporary file before publishing it;
4. rename the temporary file over the final snapshot path atomically on the same filesystem;
5. best-effort flush the containing directory where the runtime supports it;
6. remove stale temporary files during startup or cleanup without deleting valid snapshots.

A failed write must not replace the previous valid snapshot. If persistence fails after a command has changed in-memory authoritative state, the server must fail closed for durability-sensitive flows: report the persistence failure, avoid pretending a non-durable command was safely committed, and avoid asking clients to trust a state the server cannot recover.

The implementation may write a snapshot after each accepted command for simplicity and safety. Follow-up implementations may coalesce snapshots only when every acknowledged accepted command is otherwise durably represented by an event-log entry and recovery can reconstruct the latest acknowledged revision.

## Optional event log

The event log is an append-only local JSON-lines file scoped to a session. Each line should be one complete event entry so tooling can inspect, copy, truncate, or replay it without a database.

Event entries should record enough information to support deterministic replay and reconnect decisions, including:

- event schema/version;
- session ID;
- resulting authoritative revision;
- command `opId`, actor/client metadata, command type, and resource scope;
- accepted patch/effect metadata or a replayable event payload;
- server timestamp and optional diagnostic metadata;
- visibility information when needed to decide which clients may receive replayed data.

The log should be append-only while a session is active. It must not become a shared-document edit stream, a second client authority, or a substitute for permission checks. Replay is allowed only when the server can validate the log entries and prove they apply after the client's `lastSeenRevision`. When the log is missing, disabled, corrupted, or too old, reconnect falls back to the latest snapshot.

The event log may be compacted, rotated, or truncated after a newer valid snapshot supersedes older entries. Such maintenance must preserve the ability to recover to the latest acknowledged revision or intentionally fall back to the latest snapshot with clear operational notes.

## Recovery expectations

On startup or reconnect, the server recovers from the latest valid local snapshot for the requested session. Recovery must validate snapshot shape, schema version, session ID, revision, and command metadata before treating it as authoritative.

The recovery flow is:

1. locate the latest snapshot for the session in the local session data directory;
2. validate and load it as authoritative state;
3. optionally read valid event-log entries after the snapshot revision;
4. replay only entries that are ordered, schema-valid, and safe for the snapshot's session;
5. expose the recovered current revision to reconnecting clients;
6. send replayed events when available and authorized, otherwise send a current snapshot.

If no valid snapshot exists, the session cannot be silently reconstructed from client state. The GM may need to start a new session or restore a backup. If multiple snapshots are retained and the newest one is invalid, implementation may fall back to the newest previous valid snapshot, but it must report the recovery limitation.

Rejected commands do not advance revision and do not need to be replayable state changes. The server may still persist limited duplicate/rejection metadata for recent `opId` idempotency, but snapshots are the baseline for recovering duplicate handling after restart.

## Storage and privacy boundaries

Session persistence is local operational data, not source code. Storage docs and implementation must ensure:

- snapshot and event-log directories are outside committed source fixtures or are ignored by git;
- generated/private campaign data is never added to the repository;
- backups are explicit GM-controlled file backups, not automatic cloud replication introduced by Track 2;
- logs do not print GM keys, join codes, private tokens, or full secret values unnecessarily;
- named Cloudflare Tunnel hosting does not change where session state is stored;
- Quick Tunnel remains development smoke-test only and does not alter persistence expectations.

## Rejected alternatives

### Hosted database persistence

Rejected for Track 2. Postgres, Redis, Durable Objects, managed document databases, and SaaS persistence conflict with the locked GM-hosted local-first architecture.

### Client-owned whole-map saves for live recovery

Rejected. Browser clients must not become the recovery authority by autosaving whole map documents during a live session. Recovery trusts the server's local snapshots/events, not stale client-side optimistic state.

### Event log as the only required source of truth

Rejected. An append-only log is useful, but the latest valid snapshot is the required recovery baseline. Requiring a full log from session start would make recovery more fragile and turn reconnect into a log-retention problem.

### Generic document operation log

Rejected. The log records typed table commands/events and their authoritative revisions. It is not a CRDT or arbitrary JSON patch stream for collaborative document editing.

### Committing sample private session data

Rejected. Tests may use synthetic fixtures, but real snapshots, logs, campaign maps, generated sheets, secrets, and `.env` files must stay out of git.

## Consequences

- Server state work must define snapshot schemas, validation, local data paths, and atomic temp-file-and-rename writers.
- Recovery helpers must load the latest valid snapshot, optionally replay safe event-log entries, and fail closed when data is invalid or missing.
- Command application must persist an accepted authoritative revision before clients are told the command is durable.
- Reconnect logic must prefer replay when valid event history is available and fall back to a current snapshot when it is not.
- Duplicate `opId` handling needs enough persisted metadata to avoid applying retried operations twice after reconnect or restart.
- Tests must cover atomic write behaviour, corrupted snapshot handling, event-log append/replay, recovery fallback, revision continuity, and private-data hygiene.
- Documentation must continue to distinguish local-first server snapshots from live client whole-map autosave.

## Validation notes

Reviewers can validate this ADR by checking that Track 2 work:

- writes session snapshots from server-authoritative state only;
- uses atomic temp-file-and-rename semantics for latest snapshots;
- keeps snapshot/log files local and out of source control;
- does not add hosted databases or cloud persistence requirements;
- treats the event log as optional and append-only;
- recovers from the latest valid snapshot and only replays safe ordered events;
- sends reconnecting clients replay or snapshot fallback instead of trusting stale browser state;
- avoids logging or committing private campaign/session data.
