# Local-mode and profile-play maintenance checks

This maintenance note records the current non-session setup/edit and transitional profile-play behaviour. Plain `npm run dev`, regular `/maps/<slug>`, sheet autosave, profile-linked token control, and legacy `/api/events` realtime sync remain supported, but browser-owned whole-map autosave is not the live gameplay authority model.

## Current baseline

- `/maps/<slug>` loads the persisted map document; setup/edit and compatibility workflows may save the whole document.
- Player token control is derived from the selected persistent player profile's linked Pokémon/trainer sheet refs.
- Players without a selected profile can still browse map/sheet libraries, Pokédex pages, PTU reference pages, login, and informational routes.
- Player map actions that mutate linked tokens currently use document-backed APIs and publish regular realtime map updates as transitional compatibility; the live-play direction is explicit server-authoritative commands with revisions, `opId`, and patches.
- GM map and sheet editing remains filesystem-backed and unrestricted by player profiles.
- Legacy live-session identity/socket code must not become a prerequisite for normal map play.

## Regression checks

- [ ] Plain `/maps/<slug>` works for both GM and player roles.
- [ ] A linked player can move/turn a matching token on a player-visible map.
- [ ] An unlinked player cannot control unrelated tokens.
- [ ] Terrain, hazards, field effects, initiative/admin lanes, map creation/deletion, and sheet creation/deletion remain GM-only.
- [ ] Linked Pokémon/trainer sheets can be edited by the selected player profile through the normal sheet editor.
- [ ] Pokédex and PTU reference pages remain player-browsable.
- [ ] `/sessions` is not linked from the primary app navigation and is not required for map control.
- [ ] Map and sheet realtime events do not echo-loop or overwrite newer saved state in setup/edit or compatibility flows.
- [ ] No maintenance work treats whole-map browser autosave as the live multiplayer command/revision strategy.

## Useful evidence

- `tests/server/profilePlaySmoke.test.ts`
- `tests/composables/useEditableMap.test.ts`
- `tests/server/saveMap.test.ts`
- `tests/server/mapTokenActionRoutes.test.ts`
- `tests/utils/playerProfileRouteGuards.test.ts`
- `tests/utils/appNavigation.test.ts`
- `tests/composables/library/useMapLibraryData.test.ts`
- `tests/composables/library/useSheetLibraryDataProfileRequests.test.ts`

## Legacy session boundary

Remaining live-session files are legacy maintenance surfaces. They may still have isolated endpoint/socket tests while the code exists, but documentation and navigation should keep them separate from normal profile-based play.

Run the standard checks before accepting changes:

```bash
npm run typecheck
npm test
npm run build
```
