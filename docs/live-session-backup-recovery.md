# Live session backup and recovery

This runbook explains how a GM keeps Live session data recoverable without changing the locked architecture. Rotom Table remains a GM-hosted, local-first app: the GM-controlled server owns the live session, players connect by browser, commands travel over `WebSocket /api/sessions/socket`, and persistence is local JSON snapshots plus an optional append-only event log.

Use this guide with the [live session storage guide](live-session-storage.md), the [Live session persistence/recovery audit](live-session-persistence-recovery-audit.md), the [LAN hosting runbook](live-session-lan-hosting.md), the [named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md), and the [Live session security review](live-session-security-review.md). It does not introduce a database, SaaS backup service, public accounts, Quick Tunnel campaign hosting, or client-owned whole-map recovery.

## Backup and recovery rules

- The latest valid `data/sessions/<sessionId>/snapshot.json` is the recovery baseline for authoritative session state.
- `data/sessions/<sessionId>/events.jsonl` is optional. It can support audit, troubleshooting, or replay-oriented follow-up work, but it is not sufficient by itself when the latest snapshot is missing, invalid, truncated, or from another session.
- Live browser state is never the recovery authority. If clients reconnect after a disconnect, they use `lastSeenRevision` and receive replay only when safe; otherwise the server sends an authoritative snapshot fallback.
- Backups are private GM-controlled file backups. Live session does not add Postgres, Redis, Durable Objects, cloud object storage, automatic replication, or a hosted database.
- Session files, maps, sheets, generated data, player names, join codes, GM keys, tunnel credentials, and real `.env` files must stay out of git.

## What to back up

Back up the session directory and any campaign data that the session references. A session snapshot can point at maps, sheets, trainers, encounter tables, and private assets that live outside the session directory.

| Path or data | Why it matters | Privacy note |
| --- | --- | --- |
| `data/sessions/<sessionId>/snapshot.json` | Latest server-authoritative session state, including revision, selected map state, players, clients, and assignments. | Private campaign/session data; ignored by git. |
| `data/sessions/<sessionId>/events.jsonl` | Optional append-only command/event history for audit or replay-oriented follow-up work after the snapshot. | Private command metadata; may be absent. |
| `data/maps/` | Local map documents and map-adjacent campaign files referenced by session state. | Private campaign maps; ignored by git. |
| `data/sheets/` | Pokémon sheets, including generated wild sheets and player/NPC sheet data. | Private sheet data unless deliberately curated as test/example data. |
| `data/trainers/` | Trainer sheets used by trainer tokens and send-out Pokémon commands. | Private campaign data. |
| `encounter_tables/` | Local encounter tables used by the campaign. | Back up if the table depends on them. |
| External private assets | Any GM-managed images, notes, or assets kept outside this repo. | Keep outside public archives unless scrubbed. |

Do not rely on browser local storage, cookies, screenshots, Discord logs, or player-exported map JSON as a backup. Browser identity hints are continuity aids, not durable session authority.

## When to take a backup

Recommended points:

1. Before a real table session, after the GM has prepared maps/sheets and before sharing the join code.
2. After a major scene, encounter, or session end, while the authoritative state is known good.
3. Before moving the campaign to another machine.
4. Before deleting old `data/sessions/<sessionId>/` directories.

Safest process:

1. Ask players to stop sending commands.
2. Close player session-map tabs or wait until all important commands have been acknowledged.
3. Stop `cloudflared tunnel run ...` if a named tunnel is active and remote players no longer need access.
4. Stop the Nuxt process with `Ctrl+C`, or at least pause play so no snapshot write is in progress.
5. Copy the full set of directories listed above.
6. Run `git status --short` before committing code and confirm no private backup, `data/sessions/` file, GM key, join code, tunnel credential, or real `.env` file is staged.

Snapshot writes use same-directory temp files such as `snapshot.json.tmp-*` before atomic rename. When the app is stopped, stale temp files are not the recovery source; keep `snapshot.json` and `events.jsonl` as the important session artifacts. If you see temp files while the app is running, do not delete them until the process is stopped.

## Example backup commands

Replace `<sessionId>`, paths, and archive names with values controlled by the GM. Keep the destination outside the repository.

macOS/Linux archive example:

```bash
mkdir -p ../rotom-table-backups
tar -czf ../rotom-table-backups/rotom-session-$(date +%Y%m%d-%H%M%S).tgz \
  data/sessions/<sessionId> \
  data/maps \
  data/sheets \
  data/trainers \
  encounter_tables
```

macOS/Linux mirror example:

```bash
rsync -a data/sessions/<sessionId>/ /media/backup/rotom-table/data/sessions/<sessionId>/
rsync -a data/maps/ data/sheets/ data/trainers/ encounter_tables/ /media/backup/rotom-table/
```

PowerShell archive example:

```powershell
New-Item -ItemType Directory -Force ..\rotom-table-backups
Compress-Archive -Path data\sessions\<sessionId>,data\maps,data\sheets,data\trainers,encounter_tables `
  -DestinationPath ..\rotom-table-backups\rotom-session-backup.zip -Force
```

Treat the resulting archive as sensitive campaign data. If the GM chooses to copy a backup to private cloud storage, that is an explicit GM backup decision, not Live session runtime cloud persistence.

## Restore procedure

Use this when moving to a replacement machine, recovering after a crash, or rolling back to a known-good private backup.

1. Stop Rotom Table and any active `cloudflared tunnel run ...` process.
2. Confirm the target working tree is a normal Rotom Table checkout and dependencies can run.
3. Extract or copy the backup into the project root so paths are preserved:
   - `data/sessions/<sessionId>/snapshot.json`
   - `data/sessions/<sessionId>/events.jsonl` if it exists
   - referenced `data/maps/`, `data/sheets/`, `data/trainers/`, `encounter_tables/`, and private assets
4. Do not edit `snapshot.json` by hand to change revisions, player IDs, client IDs, assignments, or map documents.
5. Start the host with the correct supported mode:
   - LAN: `npm run dev:session:lan`
   - named tunnel: `npm run dev:session:tunnel` plus `cloudflared tunnel run <tunnel-name>`
6. Open `/sessions` through the player-facing LAN URL or stable tunnel hostname and check the safety banner before sharing a join code.
7. Have clients use the explicit session map route, `/maps/<map-slug>?session=1`, so reconnect asks the server for authoritative state instead of using plain local-first mode.

Recovery tooling must validate the snapshot schema, session ID, revision, timestamps, authoritative state, players, clients, assignments, and map state before treating it as current. If the recovered process cannot safely recreate session-local credentials from current implementation state, start a fresh GM session and share the new join code rather than reusing or inventing old credentials.

## Recovery scenarios

| Scenario | Recommended response |
| --- | --- |
| A player reloads or loses network during play | Use the reconnect UI. The client sends `lastSeenRevision`; if replay is unavailable, the server sends an actor-scoped snapshot fallback. |
| The GM host crashes but `snapshot.json` is valid | Restart with `npm run dev:session:lan` or `npm run dev:session:tunnel`, then let clients reconnect from the server-owned snapshot. |
| The latest snapshot is missing, invalid JSON, wrong-session, or mismatched revision | Do not trust browser state. Move the bad file aside for diagnosis, restore an older private backup, or start a fresh session. |
| `events.jsonl` exists but `snapshot.json` is unusable | Treat the event log as audit/troubleshooting data only unless dedicated tooling explicitly validates log-only replay. Restore a snapshot backup or start fresh. |
| A join code, GM key, tunnel hostname, or screenshot leaked | Stop exposure, rotate by starting a fresh session, and follow the LAN/named-tunnel rollback steps. Do not rely on backups as public auth. |
| A player made optimistic moves before disconnecting | Reconcile from accepted acks, authoritative patches, or snapshot fallback. Do not copy the player's map JSON over the session snapshot. |

## Validate a backup before relying on it

A quick private validation pass:

- [ ] The archive contains `data/sessions/<sessionId>/snapshot.json`.
- [ ] Any `events.jsonl` file is kept beside the snapshot, not separated into another unrelated folder.
- [ ] Referenced maps, sheets, trainers, encounter tables, and private assets are included.
- [ ] The backup is stored outside the repository and outside any public folder.
- [ ] No real GM key, join code, tunnel credential, private key, token, `.env` file, screenshot with secrets, or private campaign archive is staged in git.
- [ ] A restore test on a private copy starts the app with the explicit session-host runtime flag and reaches the session map through `/maps/<slug>?session=1`.

## What remains local and private

Live session backup/recovery keeps the following on GM-controlled storage:

- `data/sessions/<sessionId>/snapshot.json` and optional `events.jsonl`;
- map documents, sheet files, trainer files, generated wild sheets, encounter tables, and private assets;
- player display names, player IDs, client IDs, assignments, command metadata, `opId` values, revisions, and presence/reconnect history stored in snapshots or logs;
- session-local GM keys and join codes wherever they appear in live memory, browser identity storage, screenshots, copied notes, or recovery metadata;
- named Cloudflare Tunnel config, credentials JSON, `cert.pem`, Access/WAF settings, tokens, private keys, and real `.env` files.

Do not commit these files or paste raw snapshots/event logs into issue trackers. If a support request needs evidence, create a synthetic reproduction or scrub private data first.

## Current limitations

- Rotom Table currently keeps one latest `snapshot.json` per session directory; it does not maintain automatic snapshot history.
- `events.jsonl` is optional and not a replacement for a valid snapshot.
- Recent duplicate-`opId` memory, open WebSocket connections, and transient presence are process-local; after restart, clients should reconnect and accept the server's current snapshot/revision guidance.
- Backups are not encrypted by Rotom Table. Use filesystem permissions or a private encrypted archive if the campaign data is sensitive.
- Backup/restore does not configure Cloudflare, DNS, firewalls, or browser profiles. Restore tunnel exposure separately with the named-tunnel runbook.
- Cleanup helpers do not delete old session directories automatically; the GM decides when to archive or remove them.
