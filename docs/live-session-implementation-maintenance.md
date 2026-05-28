# Legacy live-session implementation maintenance

This maintenance note tracks the remaining guarded live-session code as a legacy surface. It is not the normal play architecture.

Current Rotom Table play uses persistent player profiles, linked character refs, regular `/maps/<slug>` saved maps, and document-backed map/sheet APIs. See [Player profiles and linked character control](player-profiles.md).

## Remaining legacy areas

- `/sessions` direct-only identity/lobby page.
- Guarded `/api/sessions/*` endpoints.
- `WebSocket /api/sessions/socket` and related session-local identity helpers.
- Local private `data/sessions/` snapshots/event logs when legacy session hosting is explicitly enabled.

The removed session map attachment endpoint, attach-current-map UI, session-owned normal map path, and session map navigation controls must not be restored as normal play.

## Current product boundaries

- Players select persistent profiles after **Player Login**.
- GMs link existing Pokémon/trainer sheets from `/players`.
- Players normally navigate to player-visible maps and act with linked characters.
- Players can browse Pokédex, sheet-library, and PTU reference routes.
- Players cannot create/delete maps or sheets, manage profile links, or use GM-only map-building/admin tools.
- No share links, invite links, anyone-with-link access, restricted links, map-specific ACLs, accounts, passwords, OAuth, or hosted multi-tenant auth are introduced.

## Validation

Run:

```bash
npm run typecheck
npm test
npm run build
```

Useful evidence:

- `tests/server/profilePlaySmoke.test.ts`
- `tests/server/playerProfilePolicy.test.ts`
- `tests/shared/playerProfileTokenControl.test.ts`
- `tests/server/saveMap.test.ts`
- `tests/server/mapTokenActionRoutes.test.ts`
- `tests/utils/playerProfileRouteGuards.test.ts`
- `tests/utils/appNavigation.test.ts`

Legacy session tests may stay while code exists, but they should not assert that live sessions are normal profile-based play.

## Related docs

- [Player profiles and linked character control](player-profiles.md)
- [Legacy live-session protocol](live-session-protocol.md)
- [Legacy live-session socket protocol](live-session-socket-protocol.md)
- [Live session lobby and manual QA](live-session-lobby.md)
- [Live session security boundaries](live-session-security-boundaries.md)
