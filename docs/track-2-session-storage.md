# Track 2 session storage

Track 2 session storage is local operational data for a GM-hosted table session. It exists so the server can recover authoritative session state after reconnects, restarts, or crashes without adding hosted database infrastructure or letting live browsers become the source of truth.

This document describes the storage layout introduced by the Track 2 state/persistence work. It is an operations and recovery guide, not a claim that later lobby, WebSocket, or command routes are complete yet. For step-by-step private archive, restore, and recovery procedures, see the [Track 2 session backup and recovery runbook](track-2-session-backup-recovery.md). For the final ticket 095 review of snapshots, optional event logs, cleanup, backup docs, and local data hygiene, see the [Track 2 final persistence/recovery audit](track-2-final-persistence-recovery-audit.md).

## Storage principles

- The GM-hosted server owns live session state during session mode.
- Accepted commands update authoritative state, advance revisions, and are then persisted as local JSON snapshots and, when enabled, JSON-lines event-log entries.
- Browsers must not recover a live session by autosaving whole map documents over each other.
- Session files stay on the GM's machine or another machine they control. Track 2 does not add Postgres, Redis, Durable Objects, SaaS storage, or automatic cloud replication.
- LAN hosting and named Cloudflare Tunnel hosting use the same local storage paths; a tunnel changes how browsers reach the server, not where state is stored.

## Default layout

Runtime helpers resolve session storage relative to the project root by default:

| Path | Created by | Contents | Git status |
| --- | --- | --- | --- |
| `data/sessions/<sessionId>/` | Snapshot or event-log helpers when first needed | One local directory per session ID. | Ignored by `.gitignore`. |
| `data/sessions/<sessionId>/snapshot.json` | `server/utils/sessionSnapshots.ts` | Latest persisted authoritative session snapshot envelope. | Ignored/private. |
| `data/sessions/<sessionId>/events.jsonl` | `server/utils/sessionEventLog.ts` when optional logging is used | Append-only JSON-lines command/event entries. May be absent. | Ignored/private. |
| `data/sessions/<sessionId>/snapshot.json.tmp-*` | Snapshot writer during atomic publish | Same-directory temporary file written before rename. | Ignored/private; safe to remove only when the app is stopped or the writer has abandoned it. |

Tests may pass an alternate `rootDir`, but production/runtime code should treat `data/sessions/` as the session storage root unless a later documented configuration changes it.

## Snapshot file

`snapshot.json` stores a persisted snapshot envelope with:

- snapshot schema version;
- session ID;
- current authoritative session revision;
- `writtenAt` timestamp;
- the server-owned `AuthoritativeSessionState`, including selected map, per-map revisions/documents, connected-client presence records, joined players, and GM-managed assignments as those state slices exist.

The snapshot writer serializes the complete JSON payload first, writes a unique temp file in the same session directory, flushes and closes it, renames it over `snapshot.json`, and best-effort flushes the directory. A failed publish must leave the previous valid snapshot in place.

Snapshot reads validate the envelope, schema versions, session ID, revision, timestamps, authoritative state arrays, actors, players, assignments, resource references, and envelope/state consistency before recovery treats the file as authoritative.

## Optional event log

`events.jsonl` is optional. When present, each line is one complete `schemaVersion: 1` JSON object:

- `kind: "command"` entries bind a command envelope to the server's command result and resulting revision.
- `kind: "event"` entries record server-side session events or operational markers.

The event log can support future reconnect replay, troubleshooting, and recovery assistance, but it is not the required source of truth. The latest valid snapshot remains the recovery baseline, and reconnect must fall back to a current snapshot whenever replay is disabled, missing, truncated, corrupted, out of order, or unsafe.

The log is append-only while a session is active. It must not become a collaborative document edit stream or bypass command validation and permissions.

## Privacy and git boundaries

`data/sessions/` is ignored by `.gitignore` because snapshots and event logs may contain private campaign state, player display names, resource assignments, map/sheet slices, command metadata, and future session-local secret or secret-derived material.

Before committing any branch, run `git status` from the target repository and confirm that no files under `data/sessions/` are staged. Do not commit:

- real session snapshots or event logs;
- GM keys, join codes, tunnel credentials, private keys, tokens, or real `.env` files;
- private campaign maps, sheets, trainers, generated wild sheets, player notes, or unreleased story material.

Synthetic fixtures for tests are acceptable only when they use fake data and live under test-controlled paths, not under the runtime `data/sessions/` directory.

## Backup guidance

The dedicated [Track 2 session backup and recovery runbook](track-2-session-backup-recovery.md) has the current operator checklist and example archive commands. In short, for a recoverable campaign backup, copy the whole local data set that the session may reference, not just the latest session file:

- `data/sessions/<sessionId>/` for Track 2 snapshots and optional event logs;
- `data/maps/`, `data/sheets/`, and `data/trainers/` for local campaign documents that may still be referenced by session state;
- `encounter_tables/` if the campaign relies on local encounter data;
- any private assets the GM intentionally keeps outside source control.

Prefer backing up while the app is stopped, or immediately after ending/pausing a session so no snapshot write is in progress. Preserve file names, directory structure, and timestamps when possible. Treat backups as sensitive campaign data; if you copy them to cloud storage, that is a GM-controlled backup decision, not a Track 2 runtime requirement.

A simple manual backup can be as small as copying the relevant directories to an external drive or private archive. Do not paste backups into the repository, and do not publish them with support requests unless they have been scrubbed of private data and secrets.

## Restore and recovery expectations

To restore a session on the same machine or a replacement machine:

1. Stop the Rotom Table server.
2. Copy the saved `data/sessions/<sessionId>/` directory back into the project root.
3. Restore any referenced local campaign data such as maps, sheets, trainers, encounter tables, and private assets.
4. Start the server with the documented session-host runtime flag when session hosting is needed.
5. Let the server load the latest valid `snapshot.json`; future reconnect work may replay safe `events.jsonl` entries after that snapshot when available.

If no valid snapshot exists, the server must not silently reconstruct live authority from browser state. The GM should restore an older backup or start a new session. If an event log exists but the latest snapshot is missing or invalid, recovery still cannot assume the log alone is safe unless later tooling explicitly validates and documents that path.

## Cleanup and deletion

The session cleanup helper manages in-memory records only:

- idle active sessions are marked ended after the configured idle window;
- ended in-memory records are retained for a grace period before pruning;
- process-local duplicate-`opId` records can be cleared when a session ends or is deleted from memory;
- `data/sessions/<sessionId>/snapshot.json` and `events.jsonl` are not deleted by cleanup.

Manual deletion of local session files is a GM operation. Only delete `data/sessions/<sessionId>/` when the app is stopped and the GM is sure the snapshot/log are no longer needed for recovery, audit, or backup.

## Known limitations

- The current default path stores one latest `snapshot.json` per session. It does not yet retain a built-in history of older snapshots.
- `events.jsonl` is optional and helper-level only until later reconnect/replay tickets wire it into the WebSocket runtime.
- Recent duplicate-`opId` tracking is currently process-local memory unless a future command/recovery path durably records enough metadata in snapshots or events.
- Snapshots are local JSON, not encrypted archives. Protect filesystem permissions and backups accordingly.
- Corrupted, missing, or mismatched snapshots fail recovery with typed reasons instead of trusting stale clients.
- Cleanup does not free disk space automatically; GMs decide when to archive or remove old session directories.
