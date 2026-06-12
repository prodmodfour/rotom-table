# Legacy live-session persistence/recovery maintenance

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This note covers private legacy session snapshots and optional event logs. It is not part of the normal profile-based play path.

Normal play uses persistent player profiles, regular saved maps, and document-backed map/sheet APIs. The current product flow does not require session snapshots, session event logs, map attachment, or session-owned map recovery.

## Legacy persistence boundaries

- Legacy session runtime data lives under ignored/private `data/sessions/` paths.
- Snapshots and optional event logs may contain private map state, player labels, command metadata, and session-local identity references.
- Partial writes, malformed JSON, mismatched session IDs, or invalid revisions must fail closed.
- Cleanup should not silently delete data a GM intentionally needs for private recovery.

## Backup and restore reminders

- Back up `data/sessions/` only when maintaining or recovering a legacy session.
- Include referenced `data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, `data/reference-overrides/`, `encounter_tables/`, and private assets if a full local campaign restore is needed.
- Keep archives outside the repository and treat them as sensitive campaign data.
- Do not edit snapshot revisions, player IDs, client IDs, assignments, or map documents by hand as a shortcut.
- If join codes, GM keys, screenshots, snapshots, or tunnel credentials leak, stop exposure and start fresh rather than treating old backups as public auth.

## Current profile-play evidence

Profile-based play should be validated through profile storage/API, selected-profile identity, linked sheet access, linked token control, document-backed map action, realtime saved-map update, route guard, library, and smoke-flow tests.

## Related docs

- [Player profiles and linked character control](../../player-profiles.md)
- [Live session backup and recovery](live-session-backup-recovery.md)
- [Live session security boundaries](live-session-security-boundaries.md)
- [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md)
