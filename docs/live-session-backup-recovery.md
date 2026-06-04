# Legacy live-session backup and recovery

This runbook is retained for private `data/sessions/` runtime data created by the legacy session host. It is not required for normal profile-based play.

Normal play uses saved maps, sheets, trainer files, and player profiles. Players choose profiles and open regular `/maps/<slug>` pages; no session snapshot or event log is needed for linked-character control.

## What legacy backups may include

- `data/sessions/<sessionId>/snapshot.json`
- optional `data/sessions/<sessionId>/events.jsonl`
- referenced private campaign data such as `data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, `data/reference-overrides/`, and `encounter_tables/`
- external private assets that are intentionally part of the GM's local campaign copy

Keep backups outside the repository and outside public folders. Rotom Table does not encrypt these archives.

## Safe backup timing

- Pause legacy session activity before copying files.
- Stop any tunnel process if remote clients no longer need access.
- Stop Nuxt when possible so no snapshot write is in flight.
- Do not commit snapshots, event logs, join codes, GM keys, private player details, screenshots with secrets, credentials, private maps/sheets, or real `.env` files.

## Restore boundaries

Restore only into a private copy controlled by the GM. Validate snapshot shape, session IDs, revisions, timestamps, authoritative state, players, clients, assignments, and referenced map/sheet data before trusting restored legacy session state.

If credentials may have leaked or restored session-local identity cannot be trusted, start a fresh legacy session instead of inventing or reusing old keys. For normal current play, prefer the profile-based flow and regular saved maps rather than restoring legacy session authority.

## Related docs

- [Player profiles and linked character control](player-profiles.md)
- [Live session storage](live-session-storage.md)
- [Live session security boundaries](live-session-security-boundaries.md)
- [Live session persistence/recovery maintenance](live-session-persistence-recovery-maintenance.md)
