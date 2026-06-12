# Legacy live-session deployment smoke checklist

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This checklist is retained only for maintaining the guarded legacy session lobby/socket surfaces. It is not a before-game checklist for normal Rotom Table play.

Normal profile-based play uses `/login`, `/players`, `/maps`, `/maps/<slug>`, `/sheets`, Pokédex pages, and PTU reference pages. Players select persistent profiles and act with linked characters on regular player-visible maps. Do not ask players to join `/sessions`, use a join code, attach a map, or open a special session map URL for normal play.

## Prefer the current profile-play smoke

For the supported product flow, verify:

- [ ] GM chooses **GM Login**.
- [ ] GM prepares an existing Pokémon or trainer sheet and a player-visible saved map with a matching token placement.
- [ ] GM opens `/players` and links that sheet to the intended player profile.
- [ ] Player chooses **Player Login**, selects that profile, and opens `/maps/<map-slug>`.
- [ ] Player can move or act with the linked token.
- [ ] Player can edit a linked sheet field.
- [ ] Player cannot control an unlinked token, create maps, create sheets, delete resources, or use GM-only map-building/admin controls.
- [ ] Player can browse `/pokedex` and PTU reference routes such as `/moves`, `/abilities`, `/rules`, and `/items`.

Automated coverage for this path includes `tests/server/profilePlaySmoke.test.ts` and the focused profile, route-guard, library, sheet, and map-action tests.

## Legacy session-host smoke, if maintaining that code

Only use this section when changing the remaining legacy session endpoints or socket code.

- [ ] Start without `ROTOM_ENABLE_SESSION_HOST=1` and confirm `/sessions` reports hosting disabled.
- [ ] Restart with `npm run dev:session:lan` or `npm run dev:session:tunnel` and confirm the safety banner classifies the expected exposure.
- [ ] GM uses a separate browser profile, chooses **GM Login**, opens `/sessions`, and starts a legacy session.
- [ ] A player browser joins `/sessions` with a safe display name and the GM-provided join code.
- [ ] GM and player can refresh their lobby summaries without exposing GM keys, raw snapshots, private map documents, tunnel credentials, or real player secrets.
- [ ] Any socket or endpoint smoke uses synthetic/non-private data and cleans up browser identities afterwards.
- [ ] `git status --short` shows no generated `data/sessions/` snapshots/event logs, real `.env` files, credentials, screenshots with secrets, private maps/sheets, or other private campaign data staged for commit.

Legacy session smoke checks must remain isolated from the current profile-based map play path.

## Standard validation

```bash
npm run typecheck
npm test
npm run build
```

See [Player profiles and linked character control](../../player-profiles.md), [Local development](../../local-development.md), and [live session lobby and manual QA](live-session-lobby.md).
