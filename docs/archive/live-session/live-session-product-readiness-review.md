# Live session product readiness review

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This document is retained as a legacy maintenance note for the guarded live-session endpoints and socket code. It is no longer the normal Rotom Table play guide.

Current product direction: normal play uses persistent player profiles, linked character sheets, and the regular `/maps/<slug>` route. Players select a profile after **Player Login**, open a player-visible map, and act with tokens whose `sheetKind`/`sheetSlug` matches a linked character. Players can also browse Pokédex, sheet-library, and PTU reference pages without joining a live session.

## Current normal play flow

1. GM starts Rotom Table normally, chooses **GM Login**, and prepares maps/sheets.
2. GM opens `/players`, creates player profiles, and links existing Pokémon/trainer sheets to those profiles.
3. Players choose **Player Login**, select their GM-created persistent profile, then open the relevant player-visible map at `/maps/<slug>`.
4. Linked players move, turn, and use supported token-scoped actions through document-backed map actions.
5. Linked players edit linked sheets through the normal sheet editor; unlinked private sheets and GM-only resource actions remain blocked.

No live-session join code, session map attachment, session-owned map copy, share link, invite link, or special map URL is part of this flow. See [Player profiles and linked character control](../../player-profiles.md).

## Legacy live-session status

The remaining `/sessions` route and `/api/sessions/*` surfaces are direct-only legacy maintenance/smoke surfaces. They remain guarded by `ROTOM_ENABLE_SESSION_HOST=1` and are useful only when maintaining old session identity/socket code. They should not be presented to GMs or players as the way to run profile-based map play.

The former session map attachment endpoint has been removed. The map navigation rail no longer exposes attach-current-map or session-map management controls for normal play.

## Validation and evidence

Standard validation remains:

```bash
npm run typecheck
npm test
npm run build
```

Profile-based play is covered by profile, sheet policy, map token-control, document-backed map action, route guard, library, and smoke-flow tests such as `tests/server/profilePlaySmoke.test.ts`.

Legacy live-session tests may continue to cover guarded endpoints and socket helpers while that code exists, but they are not acceptance criteria for normal profile-based play.

## Documentation map

- [Player profiles and linked character control](../../player-profiles.md) — current player/GM product flow.
- [Local development](../../local-development.md) — how to run the local app and where the legacy session helper fits.
- [Live session lobby and manual QA](live-session-lobby.md) — direct-only legacy lobby maintenance smoke notes.
- [Live session security boundaries](live-session-security-boundaries.md) — trust and no-secret boundaries for any remaining session-host maintenance.
