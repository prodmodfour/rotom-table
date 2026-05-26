# Live session persistence and recovery maintenance

This maintenance guide records the current live-session persistence/recovery posture for the state, command, hosting, LAN smoke, local-mode, and security boundaries. Read it with the [live session storage guide](live-session-storage.md), [Live session backup and recovery runbook](live-session-backup-recovery.md), [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md), and [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md).

Last checked: 2026-05-26

Current maintenance baseline: the locked live-session local-first persistence model is ready within explicit limitations. Live session authority remains on the GM-hosted server; accepted commands update server-owned state, advance revisions, and persist local JSON snapshots with optional JSON-lines events. Recovery uses the latest validated snapshot or a GM-controlled private backup, not browser local storage, stale optimistic UI state, copied whole-map autosaves, a hosted database, or a public cloud service.

This maintenance pass checked source code, tests, and documentation. It did not create a live public tunnel, commit private campaign data, restore a real campaign backup, record real GM keys or join codes, add encrypted backup tooling, add automatic cloud replication, or add a database.

## Scope

This maintenance guide covers these persistence and recovery boundaries:

- local session storage paths under `data/sessions/<sessionId>/`;
- atomic `snapshot.json` writes, validated snapshot reads, and recovery helper behaviour;
- optional `events.jsonl` JSON-lines command/event logging and its non-authoritative recovery role;
- command use-case persistence and rollback boundaries after accepted server-authoritative commands;
- reconnect snapshot fallback and restart recovery expectations;
- backup/restore documentation for snapshots, optional event logs, referenced maps, sheets, trainers, encounter tables, and private assets;
- cleanup behaviour for in-memory records versus on-disk session artifacts;
- `.gitignore` and no-secret/no-private-data hygiene for local runtime files and backups.

This maintenance guide intentionally does not change the architecture into SaaS, public multi-tenancy, a generic collaborative document editor, Quick Tunnel campaign hosting, cloud database persistence, or browser-owned live whole-map recovery.

## Evidence summary

| Boundary | Maintenance result | Source and test evidence |
| --- | --- | --- |
| Local storage root | Pass. Session artifacts resolve under `data/sessions/<sessionId>/` by default and use safe path joins. The runtime directory is ignored/private. | `server/utils/sessionSnapshots.ts`, `server/utils/sessionEventLog.ts`, `server/utils/fsPaths.ts`, `.gitignore`, `tests/server/sessionSnapshots.test.ts`, and `tests/server/sessionEventLog.test.ts`. |
| Atomic snapshot writes | Pass. Snapshots serialize to JSON first, write a same-directory temp file with restrictive permissions, flush by default, rename over `snapshot.json`, best-effort fsync the directory, and remove failed temp files. | `writeSessionSnapshot`, `SESSION_SNAPSHOT_TEMP_FILE_PREFIX`, `tests/server/sessionSnapshots.test.ts`. |
| Snapshot validation and recovery | Pass. Reads validate schema version, session ID, revision, timestamps, authoritative state, maps, clients, players, assignments, and envelope/state consistency before returning recovery state. Missing, invalid JSON, invalid shape, and wrong-session snapshots fail closed. | `readSessionSnapshot`, `recoverSessionStateFromSnapshot`, `validatePersistedSessionSnapshot`, `tests/server/sessionSnapshots.test.ts`, and `tests/server/sessionStateQuality.test.ts`. |
| Optional event log | Pass with documented limits. `events.jsonl` entries are validated command/event JSON-lines records and can support troubleshooting or replay-oriented follow-up work, but the log is optional and is not a standalone recovery authority without a valid snapshot. | `server/utils/sessionEventLog.ts`, `server/utils/sessionRevisionApplication.ts`, `tests/server/sessionEventLog.test.ts`, and `tests/server/sessionRevisionApplication.test.ts`. |
| Accepted command persistence | Pass for implemented command families. Start/join/assignment and command use cases write authoritative snapshots after accepted changes; sheet-writing command handlers roll back sheet updates when session snapshot persistence fails. Rejections and duplicate retries do not create live-client whole-map authority. | `server/useCases/startGmSession.ts`, `server/useCases/joinPlayerSession.ts`, `server/useCases/updatePlayerAssignment.ts`, `server/useCases/applyMoveTokenCommand.ts`, `server/useCases/applyTurnTokenCommand.ts`, `server/useCases/applySpawnTokenCommand.ts`, `server/useCases/applyDeleteTokenCommand.ts`, `server/useCases/applySendOutPokemonCommand.ts`, `server/useCases/applyModifyHpCommand.ts`, `server/useCases/applyModifyCombatStagesCommand.ts`, `server/useCases/applyModifyConditionsCommand.ts`, `server/useCases/applyUseMoveCommand.ts`, `server/useCases/applyUseTableActionCommand.ts`, `server/useCases/applyInitiativeCommand.ts`, `server/useCases/applyHazardCommand.ts`, `server/useCases/applyFieldEffectCommand.ts`, `server/useCases/applyTerrainCommand.ts`, and focused server tests. |
| Reconnect/restart recovery | Pass. WebSocket reconnect falls back to current actor-scoped server snapshots when replay is unavailable; restart recovery uses the validated latest snapshot. Browser state is not the recovery authority. | `server/utils/sessionWebSocketServer.ts`, `src/composables/map-editor/useSessionMap.ts`, `tests/server/sessionWebSocketTransport.test.ts`, `tests/composables/map-editor/sessionClientIntegration.test.ts`, and `docs/live-session-backup-recovery.md`. |
| Cleanup and retention | Pass. Cleanup expires or prunes process-local in-memory records and clears recent operation tracking, but it does not delete `snapshot.json` or `events.jsonl`. Disk cleanup remains an explicit GM backup/removal decision. | `server/utils/sessionCleanup.ts`, `tests/server/sessionCleanup.test.ts`, `docs/live-session-storage.md`, and `docs/live-session-backup-recovery.md`. |
| Backup/restore docs | Pass. The runbook covers safe backup timing, `tar`/`rsync`/PowerShell examples, restore startup, reconnect guidance, invalid-snapshot fail-closed behaviour, event-log limitations, credential leak response, and local/private data boundaries. | `docs/live-session-backup-recovery.md` and `tests/docs/liveSessionBackupRecovery.test.ts`. |
| Local data hygiene | Pass. Docs and ignore rules keep `data/sessions/`, private maps/sheets/trainers, generated sheets, snapshots, event logs, tunnel credentials, private keys, tokens, real `.env` files, and backup archives out of git. | `.gitignore`, `README.md`, `docs/local-development.md`, `docs/live-session-storage.md`, `docs/live-session-security-boundaries.md`, and repository hygiene guidance in this maintenance guide. |

## Snapshot persistence findings

`server/utils/sessionSnapshots.ts` remains aligned with ADR 007 and the storage runbook:

- Default snapshot paths resolve to `data/sessions/<sessionId>/snapshot.json` through `sessionSnapshotFilePathFor` and safe root joins.
- `createPersistedSessionSnapshot` stores the snapshot schema version, session ID, current session revision, `writtenAt`, and the full `AuthoritativeSessionState` that the server owns.
- `serializeSessionSnapshot` performs full JSON serialization before directories are created or files are opened, so non-serializable state fails before publishing partial artifacts.
- `writeSessionSnapshot` creates a same-directory `snapshot.json.tmp-*` file with `wx` and `0o600`, writes the full JSON, fsyncs by default, closes the file, renames it over the latest `snapshot.json`, then best-effort fsyncs the directory.
- If publish fails before the rename, the helper closes handles and removes the temp file; the previous valid snapshot remains the recovery candidate.
- `cleanupStaleSessionSnapshotTempFiles` removes only files with the `snapshot.json.tmp-*` prefix for the requested session directory and is safe to use after the app is stopped.

Focused coverage in `tests/server/sessionSnapshots.test.ts` checks temp-before-rename publishing, previous-snapshot preservation on publish failure, serialization-before-directory-creation, stale-temp cleanup, valid reads, missing snapshots, invalid JSON, wrong-session snapshots, corrupted connected-client actor state, and invariant validation.

## Snapshot recovery findings

Recovery remains fail-closed:

- `readSessionSnapshot` returns typed failures for `not-found`, `invalid-json`, `invalid-shape`, and `read-error` rather than returning partial state.
- Snapshot validation checks the snapshot schema version, requested session ID, revision, timestamp, authoritative-state schema version, state session/revision consistency, selected-map validity, per-map revisions, presence records, player records, assignment records, and resource references.
- `recoverSessionStateFromSnapshot` returns `source: "snapshot"`, the validated state, and the snapshot revision only after validation succeeds.
- If the latest snapshot is missing, wrong-session, truncated, invalid JSON, or otherwise invalid, Live session docs tell the GM to restore an older private backup or start a fresh session instead of trusting browser state.

This is intentionally a latest-snapshot recovery model. It does not add automatic snapshot history, log-only replay, or browser-export recovery.

## Event-log findings

`server/utils/sessionEventLog.ts` remains optional and local-first:

- The default path is `data/sessions/<sessionId>/events.jsonl`.
- Command entries bind a validated command envelope to the server command result, `opId`, command type, scopes, session ID, and resulting revision.
- Generic event entries can record server-side operational markers without becoming a client edit stream.
- Entries serialize and validate before directories are created; malformed, wrong-session, mismatched-revision, or non-JSON entries fail before append.
- Appends use one compact JSON object per line, trailing newline, append mode, restrictive permissions, file fsync by default, and best-effort directory fsync.
- `server/utils/sessionRevisionApplication.ts` can create a validated command event-log entry as part of an accepted-command effect, but it deliberately does not append the log or write snapshots itself.

The accepted limitation is that `events.jsonl` is troubleshooting/replay-oriented data today. It is not sufficient when `snapshot.json` is missing or invalid, and it is not a command stream clients can edit.

## Command persistence and rollback findings

Accepted Live session state changes are persisted after server validation and revision application:

- GM start, player join, and assignment updates write new authoritative snapshots and roll back in-memory store state if the write fails.
- Token, initiative, hazard, field-effect, and terrain command use cases write snapshots after accepted map-state changes and return safe command rejections if persistence fails.
- Sheet-affecting table commands (`modifyHp`, `modifyCombatStages`, `modifyConditions`, `useMove`, `useAbility`, and `useOrder`) update sheet files only inside a rollback-aware boundary; when snapshot persistence fails after a sheet write, the handler attempts to restore the original sheet before returning an error.
- Rejected stale/unauthorized/invalid/conflict commands do not advance revisions and do not write snapshots.
- Duplicate `opId` retries are answered from process-local operation tracking and do not apply or persist the same command twice.

This keeps the browser out of the persistence authority path. Session-mode clients receive `commandAck`, `commandReject`, small patches, and actor-scoped snapshots; they do not repair persistence by autosaving whole map documents.

## Backup and restore documentation findings

The backup/recovery runbook remains accurate for the current implementation:

- Back up `data/sessions/<sessionId>/snapshot.json`, optional `events.jsonl`, `data/maps/`, `data/sheets/`, `data/trainers/`, `encounter_tables/`, and any GM-controlled private assets referenced by the campaign.
- Prefer backup after acknowledged commands, while play is paused, or after the app/tunnel is stopped so no snapshot write is in flight.
- Keep backup archives outside the repository and treat them as sensitive campaign data.
- Restore files with paths preserved, restart through `npm run dev:session:lan` or `npm run dev:session:tunnel`, and have clients reconnect through `/maps/<map-slug>?session=1` so the server provides authoritative state.
- Do not edit snapshot revisions, player IDs, client IDs, assignments, or map documents by hand as a recovery shortcut.
- If credentials or screenshots leak, stop exposure and start a fresh session to rotate join details rather than trying to treat old backups as public auth.

## Local data hygiene findings

The hygiene check confirms:

- `.gitignore` ignores `data/sessions/`, `data/maps/`, non-example `data/sheets/`, `data/trainers/`, `.env`, `.env.*`, local caches, and temp folders.
- Documentation warns that snapshots, event logs, backup archives, private maps/sheets/trainers, generated wild sheets, player display names, player/client IDs, GM keys, join codes, tunnel credentials, private keys, tokens, screenshots with secrets, and real environment files stay out of git and public issue trackers.
- Tests use synthetic temporary roots under the OS temp directory or synthetic checked-in docs; they do not depend on runtime `data/sessions/` files.
- Repository changes should not add or commit generated/private maps, sheets, snapshots, event logs, tunnel credentials, tokens, private keys, real `.env` files, or backup archives.

## Remaining limitations

These are still acceptable for Live session and should stay explicit:

- Rotom Table keeps one latest `snapshot.json` per session directory; it does not maintain built-in snapshot history.
- `events.jsonl` is optional and not a replacement for a valid snapshot.
- Recent duplicate-`opId` memory, open WebSocket peers, transient presence, and in-flight optimistic client state are process-local.
- Backup archives are not encrypted by Rotom Table. Use filesystem permissions or a private encrypted archive for sensitive campaigns.
- Cleanup helpers do not delete old session directories automatically; the GM decides when to archive or remove disk artifacts.
- Restore does not configure Cloudflare DNS, tunnel credentials, firewalls, browser profiles, or public-auth controls.
- Public hosting, SaaS persistence, cloud databases, automatic replication, Durable Objects, Redis, Postgres, and browser-owned whole-map recovery remain out of scope.

## Persistence maintenance checklist

- [x] Session snapshots are local JSON under `data/sessions/<sessionId>/snapshot.json`.
- [x] Snapshot writes use temp-file-and-rename semantics with same-directory temp files and default fsync behaviour.
- [x] Snapshot reads validate shape and fail closed before recovery.
- [x] The latest valid snapshot remains the authoritative recovery baseline.
- [x] Optional `events.jsonl` is append-only JSON-lines troubleshooting/replay-oriented data, not standalone recovery authority.
- [x] Accepted commands persist after server validation/revision application and roll back sheet side effects where needed.
- [x] Reconnect uses server-owned snapshots/patches, not browser-owned whole-map autosaves.
- [x] Cleanup does not silently delete snapshot/event-log files.
- [x] Backup docs include referenced local campaign data and private archive guidance.
- [x] `.gitignore` and docs keep runtime session files, private campaign data, backups, credentials, and real environment files out of git.
- [x] No database, SaaS storage, Quick Tunnel campaign path, or cloud-first persistence layer is part of this model.

## Operator reminder

Before relying on a restored campaign, test a private copy: stop the app, restore `data/sessions/<sessionId>/` plus referenced campaign data, start with the documented guarded session-host helper, open `/sessions`, then open `/maps/<map-slug>?session=1` in separate browser profiles and confirm the reconnect snapshot reflects the expected revision. Check `git status --short` before committing or sharing evidence.
