# Live-session legacy validation matrix

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This matrix is retained for the remaining guarded live-session maintenance surface. It does not define normal profile-based play.

Normal Rotom Table play is validated through persistent player profile, linked-sheet, linked-token, document-backed map action, route guard, library, and smoke-flow tests. See [Player profiles and linked character control](../../player-profiles.md).

## Baseline for every change

Run the standard checks:

```bash
npm run typecheck
npm test
npm run build
```

Keep examples and evidence free of real secrets, private maps, generated sheets, player details, session snapshots, event logs, tunnel credentials, and real `.env` files.

## Current profile-play validation areas

| Area | Expected coverage |
| --- | --- |
| Player profile storage/API | list, create, update, malformed payloads, duplicate/invalid data, filesystem isolation |
| Profile picker/browser identity | remembered profile summary, missing profile recovery, clear/switch profile |
| GM profile management | link/unlink existing Pokémon/trainer sheets, duplicate prevention, player rejection |
| Sheet access | GM all-sheets access, player linked sheet load/save, public player sheets, unlinked save rejection |
| Map token control | GM all-token control, linked player token control, unlinked/missing-profile rejection |
| Document-backed map actions | linked player movement/turning/table actions, server-side profile enforcement, realtime update publication |
| Navigation and libraries | players can browse player-visible maps, linked/public sheets, Pokédex, and PTU reference pages; GM-only admin routes remain blocked |
| End-to-end smoke | GM links a profile, player selects it, controls a linked token, edits a linked sheet field, cannot control unlinked resources |

## Remaining legacy live-session checks

When changing legacy `/sessions`, `/api/sessions/*`, or `WebSocket /api/sessions/socket` code, keep focused tests for runtime gating, no-secret identity handling, session-local authorization, socket validation, and private `data/sessions/` hygiene. These checks must stay isolated from normal `/maps/<slug>` profile-based play and must not reintroduce map attachment or session-owned map authority.

## Non-goals

Do not add public accounts, OAuth, share links, invite links, anyone-with-link access, per-map ACLs, generic collaborative-document servers, cloud databases, SaaS hosting, or browser-owned whole-map collaborative autosave as part of validation work.
