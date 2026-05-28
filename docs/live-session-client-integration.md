# Legacy live-session client integration guide

This guide is retained for maintainers of the old guarded session socket/client code. It does not describe normal player map control.

Normal player map control now comes from persistent player profiles on the regular `/maps/<slug>` route. Players choose a profile after **Player Login**, then act with tokens whose `sheetKind`/`sheetSlug` matches a linked character sheet. See [Player profiles and linked character control](player-profiles.md).

## Current normal client behaviour

- `/login` keeps the trust-based GM/Player role picker.
- Player Login opens the persistent profile picker and remembers the selected profile in browser storage.
- `/maps` and player-visible `/maps/<slug>` pages remain normal saved-map routes.
- The map page derives controllable placement IDs from the selected profile's linked character refs.
- Player movement, facing, move usage, and supported table actions use document-backed map APIs with server-side profile-control checks.
- `/sheets` and sheet editor routes include the selected profile ID so linked sheets can be loaded and saved.
- Pokédex and PTU reference routes remain player-browsable without any live-session identity.

## Remaining legacy client surfaces

The legacy `/sessions` page and session identity storage remain only for direct maintenance/smoke checks while the old session code exists. The old session-map client helpers, banners, explicit session-map navigation links, and multi-tab session-map smoke helper have been removed. Remaining guarded session endpoints still require `ROTOM_ENABLE_SESSION_HOST=1` and should not be linked from normal app navigation or used as a prerequisite for map play.

Legacy session surfaces must still avoid exposing GM keys, join codes, hidden maps, raw snapshots, tunnel credentials, or private campaign data. Browser-local session identity remains a continuity aid, not public authentication.

## Validation

Use the standard validation commands for product changes:

```bash
npm run typecheck
npm test
npm run build
```

Profile-play behaviour is covered by profile selection, route guard, sheet access, library, token-control, document-backed action, and smoke-flow tests. Legacy session endpoint/socket tests may remain useful for maintaining isolated guarded surfaces, but they are not the normal play acceptance path.

## Boundaries

- Do not reintroduce a map attachment step or session-owned map copy for normal play.
- Do not add share links, invite links, anyone-with-link access, per-map ACLs, or map-specific grants.
- Do not use whole-map browser autosave as a collaborative live-session authority model.
- Keep regular `/maps/<slug>` play, profile-linked token control, and player-visible Pokédex/reference browsing available.
