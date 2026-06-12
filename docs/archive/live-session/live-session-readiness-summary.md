# Live session readiness summary

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

This summary is retained for legacy live-session maintenance. It no longer describes the normal Rotom Table play path.

## Current readiness baseline

Profile-based play is the supported product path:

- players choose a GM-created persistent player profile after **Player Login**;
- GMs create profiles and link existing Pokémon/trainer sheets to them from `/players`;
- players browse player-visible maps, linked/public sheets, Pokédex pages, and PTU reference pages;
- players open the normal `/maps/<slug>` route and act with linked-character tokens;
- players do not use live-session map attachment, session-owned map copies, join codes, invite links, or per-map sharing semantics for normal play.

See [Player profiles and linked character control](../../player-profiles.md) for the current flow.

## Remaining legacy session scope

The `/sessions` page and guarded `/api/sessions/*` endpoints are direct-only maintenance/smoke surfaces. They remain behind `ROTOM_ENABLE_SESSION_HOST=1`, still assume trusted local users, and should not be promoted as campaign play setup.

Any future work on those surfaces should preserve no-secret handling for GM keys, join codes, local snapshots, optional event logs, tunnel credentials, and private campaign data. It must not reintroduce session map attachment as normal play.

## Validation

Run the standard checks before accepting documentation or product changes:

```bash
npm run typecheck
npm test
npm run build
```

Relevant profile-play evidence includes `tests/server/profilePlaySmoke.test.ts` plus focused profile storage, profile API, sheet access, map token-control, route guard, library, and document-backed action tests.

## Related docs

- [Player profiles and linked character control](../../player-profiles.md)
- [Architecture](../../architecture.md)
- [Data model](../../data-model.md)
- [Live session lobby and manual QA](live-session-lobby.md)
- [Live session security boundaries](live-session-security-boundaries.md)
- [Live session product readiness review](live-session-product-readiness-review.md)
