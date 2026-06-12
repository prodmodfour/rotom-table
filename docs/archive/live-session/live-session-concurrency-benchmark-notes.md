# Legacy live-session concurrency benchmark notes

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This note is retained for old session socket maintenance. It no longer describes the expected normal table play path.

Normal Rotom Table play now uses persistent player profiles, document-backed map actions, and the regular `/maps/<slug>` route. The relevant multi-client expectation is that saved-map realtime updates publish linked-player token edits to other viewers without echo loops or stale overwrites.

## Current profile-play checks

Before relying on a profile-based game flow, verify:

- a GM can link existing Pokémon/trainer sheets to player profiles;
- a player can select a profile and open a player-visible map;
- linked token movement/action updates appear for other viewers through normal map realtime events;
- unlinked players cannot control unrelated tokens;
- players can still browse Pokédex and PTU reference routes;
- GM-only map-building/admin actions remain blocked for players.

Automated evidence includes `tests/server/profilePlaySmoke.test.ts`, `tests/composables/useEditableMap.test.ts`, `tests/server/saveMapRoute.test.ts`, and `tests/server/mapTokenActionRoutes.test.ts`.

## Legacy session notes

The previous session-command benchmark posture assumed guarded session hosting, session-local identities, server-authoritative command revisions, heartbeat/reconnect behaviour, and local JSON snapshots. Those details remain relevant only when maintaining the isolated legacy session socket code. They are not acceptance criteria for current profile-based play.

Do not add a database, public account system, generic shared-document server, share links, invite links, per-map ACLs, or browser-owned whole-map collaborative authority to revive the old benchmark path.

## Standard validation

```bash
npm run typecheck
npm test
npm run build
```

Do not paste real join codes, GM keys, player details, snapshots, private campaign files, tunnel credentials, or screenshots with secrets into benchmark notes.
