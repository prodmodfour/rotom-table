# Legacy live-session multi-tab smoke helper

This helper documentation is retained only for maintaining old session lobby/socket code. It is not the normal player-control smoke path.

Normal profile-based play should be checked by selecting a player profile, opening `/maps/<slug>`, controlling linked tokens, editing linked sheets, and browsing Pokédex/reference routes. See [Player profiles and linked character control](player-profiles.md).

## Legacy helper

When changing the remaining legacy session client/socket code, you can still run:

```bash
npm run dev:session:lan
npm run smoke:session:multi-tab -- --map <map-slug>
```

Use `--no-open` or a custom `--base-url` when you only want printed URLs for manual checks. Keep GM and player identities in separate browser profiles or private windows.

## Legacy smoke boundaries

- The helper must not create or require session map attachment for normal play.
- Any `/sessions` checks are direct-only maintenance checks.
- Do not commit generated `data/sessions/` files, screenshots with secrets, GM keys, join codes, tunnel credentials, private maps/sheets, or real `.env` files.
- Do not use this helper as evidence that profile-based map control works; use the profile-play tests and manual profile flow instead.

## Current profile-play evidence

- `tests/server/profilePlaySmoke.test.ts`
- `tests/composables/map-editor/useDocumentMapTokenActions.test.ts`
- `tests/composables/map-editor/useTokenControls.test.ts`
- `tests/composables/useEditableMap.test.ts`
- `tests/utils/playerProfileRouteGuards.test.ts`
