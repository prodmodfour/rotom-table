# Live session local-mode no-regression audit

This document records the local-first no-regression review for existing non-session Rotom Table workflows. It is a local-mode/source-and-test audit, not a replacement for a GM's private campaign smoke pass.

Audit date: 2026-05-26

Outcome: pass for the audited local-first boundaries. Plain `npm run dev` remains the default local app, plain `/maps/<slug>` remains local-first, sheet editing still uses local autosave/persistence, and legacy non-session realtime still uses `GET /api/events`. Session-authoritative behaviour remains opt-in through guarded hosting plus the explicit `?session=1` map route.

## Mode boundary summary

- **Local-first mode is the default.** Plain `npm run dev`, `/maps/<slug>`, `/sheets`, `/sheets/<slug>`, and `/sheets/trainers/<slug>` use filesystem-backed JSON, local autosave, and legacy `/api/events` realtime updates without requiring session hosting.
- **Live-session mode is explicit.** Session hosting requires the documented runtime opt-in, and a map becomes a session map only when opened through the live-session flow or with `?session=1` on the map URL.
- **Local and session state do not share write authority.** Leaving `?session=1` off means edits save to the local campaign files; adding it means table actions use session commands against the server-owned attached map state.

## Scope

The audit covers the local workflows most likely to be affected by Live session client/server integration:

- default startup with `npm run dev` and no `ROTOM_ENABLE_SESSION_HOST=1` flag;
- the trust-based local `/login` GM/player role picker;
- map library create/list/rename/move/delete/load/save paths under `data/maps/`;
- plain `/maps/<slug>` map editing and table controls, including token movement/facing, spawn/delete, send-out, initiative, hazards, field effects, terrain voxels, move automation, maneuvers, abilities, and orders;
- Pokémon and trainer sheet library/editor create/list/load/save/rename/move/delete paths under `data/sheets/` and `data/trainers/`;
- sheet autosave, unload flush, slug rename sync, and sheet mutation helpers;
- legacy local realtime/SSE updates for maps, sheets, and libraries;
- local data hygiene for generated sheets, private campaign JSON, and Live session `data/sessions/` runtime files.

The audit intentionally does not broaden Live session into public authentication, SaaS hosting, a generic collaborative document editor, cloud persistence, or Quick Tunnel campaign hosting.

## Evidence summary

| Local workflow or boundary | Audit result | Evidence |
| --- | --- | --- |
| Default local startup | `npm run dev` stays the default local-first command and does not enable session hosting. Session HTTP/WebSocket routes fail closed unless the exact session-host flag is set. | `README.md`, `docs/local-development.md`, and `tests/server/sessionHostingHardening.test.ts`. |
| Plain map route | `/maps/<slug>` still creates the local editable map through `useEditableMap(slug)`. Session command routing is gated by `isSessionModeQueryEnabled(route.query.session)` and the explicit `?session=1` query. | `src/pages/maps/[slug].vue`, `src/composables/useEditableMap.ts`, `tests/composables/map-editor/useSessionMoveTokenDispatch.test.ts`, and `tests/composables/map-editor/useSessionMapEditorState.test.ts`. |
| Local map persistence | Local map edits still debounce and save whole map JSON through `MAP_API_PATHS.save`, then sync over the non-session realtime channel. This last-writer-wins local model remains acceptable outside live sessions. | `src/composables/useEditableMap.ts`, `tests/composables/localFirstEditingNoRegression.test.ts`, `tests/server/loadMap.test.ts`, `tests/server/createMap.test.ts`, `tests/server/renameMap.test.ts`, `tests/server/deleteMap.test.ts`, `tests/utils/maps/persistence.test.ts`, and `tests/utils/autosave.test.ts`. |
| Local token/table controls | In non-session mode, token movement/facing mutates the local map and movement log; initiative, hazards, field effects, terrain, HP/stage/condition mutation, move automation, maneuvers, abilities, and orders still call local composables or local API routes. | `tests/composables/map-editor/useTokenControls.test.ts`, `tests/composables/map-editor/useInitiativeTracker.test.ts`, `tests/composables/map-editor/useHazardBuilder.test.ts`, `tests/composables/map-editor/useFieldEffectsEditor.test.ts`, `tests/composables/map-editor/useTerrainBuilder.test.ts`, `tests/composables/map-editor/useTokenSheetMutations.test.ts`, `tests/composables/map-editor/useMoveAutomationPanel.test.ts`, `tests/composables/map-editor/useManeuverActionPanel.test.ts`, `tests/composables/map-editor/useAbilityAutomationPanel.test.ts`, and `tests/composables/map-editor/useOrderActionPanel.test.ts`. |
| Local/session state separation | Session snapshots and patches update only the session map clone. Disabling `?session=1` returns the UI to the local editable map ref without adopting unaccepted session optimistic state. | `tests/composables/map-editor/useSessionMapEditorState.test.ts`, `tests/composables/map-editor/sessionClientIntegration.test.ts`, and `docs/live-session-client-integration.md`. |
| Legacy non-session realtime | The old local realtime path remains `GET /api/events` plus `EventSource` for maps/sheets/libraries. It is available while session hosting is disabled and it is not the Live session command channel. | `src/composables/useRealtime.ts`, `tests/server/legacyRealtimeBoundary.test.ts`, `tests/composables/useRealtime.test.ts`, and `docs/live-session-quick-tunnel-caveat.md`. |
| Sheet library and editors | Pokémon/trainer sheet local editing still clones the loaded sheet, deep-watches changes, debounces saves through `SHEET_API_PATHS.save`, follows slug renames, and receives sheet SSE updates. Player visibility filtering remains local-route behaviour, not public auth. | `src/composables/useEditableSheet.ts`, `src/composables/sheets/useEditableSheetResource.ts`, `tests/composables/localFirstEditingNoRegression.test.ts`, `tests/server/saveSheet.test.ts`, `tests/server/loadSheet.test.ts`, `tests/server/createSheet.test.ts`, `tests/server/renameSheet.test.ts`, `tests/server/deleteSheet.test.ts`, `tests/composables/sheets/useEditableSheetResource.test.ts`, and `tests/utils/sheets/persistence.test.ts`. |
| Map/sheet navigation and libraries | Local map and sheet library actions still use their existing local routes and server helpers. Live session lobby/session links are additive navigation affordances only. | `tests/composables/library/useMapLibraryActions.test.ts`, `tests/composables/library/useMapLibraryCreation.test.ts`, `tests/composables/library/useSheetLibraryActions.test.ts`, `tests/composables/library/useSheetLibraryCreation.test.ts`, `tests/composables/localFirstEditingNoRegression.test.ts`, `tests/utils/mapRoutes.test.ts`, `tests/utils/sheetRoutes.test.ts`, and `tests/utils/mapSessionNavigation.test.ts`. |
| Validation | Standard validation covers `npm run typecheck`, `npm test`, and `npm run build`. | Repository validation commands. |

## Source boundary checks

The source check confirmed these local/session split points:

- `src/pages/maps/[slug].vue` always creates the local map with `useEditableMap(slug)` and then chooses session mode only when `isSessionModeQueryEnabled(route.query.session)` is true.
- Local fallbacks remain present for table actions: `deletePlacement(id)`, `turnPlacement`, `movePlacement`, `nextInitiative()`, `previousInitiative()`, local HP/stage/condition sheet mutations, local `recordMoveUsage`, `placeHazard`, `removeHazard`, `placeVoxel`, `removeVoxel`, and `sendOutPokemon`.
- `src/composables/useEditableMap.ts` still owns local map loading/saving through `/api/maps/load`, `/api/maps/save`, the autosave resource controller, and `useRealtimeChannel(mapChannel(slug), ...)`.
- `src/composables/useEditableSheet.ts` still owns local sheet editing through `SHEET_API_PATHS.save`, `subscribeChannel(sheetChannel(...))`, unload flushing, and debounced local autosave.
- `src/composables/useRealtime.ts` remains the local `EventSource` wrapper for `/api/events`; Live session commands, acks/rejections, presence, heartbeat, and reconnect stay on `WebSocket /api/sessions/socket` only in session mode.

## Known limitations that remain acceptable

- Local mode still uses whole-map and whole-sheet JSON saves with last-writer-wins semantics. That is the intended local-first behaviour for one trusted editing browser and is not the live-session concurrency mechanism.
- This audit did not use private campaign data and did not exercise every possible manual UI click in a real campaign. Operators should still run a local smoke on their own maps/sheets before a table session.
- Production write limitations remain: browser-based editing and autosave are intended for local development/GM-hosted use, not a hardened public deployment.
- The `/login` GM/player role picker remains a trust switch for local use. It is not public authentication and should not be treated as a substitute for session-local permissions or real auth.
- Plain `/maps/<slug>` can save local JSON. Do not use it to resolve a live session conflict unless the GM intentionally wants to edit the local campaign files outside session authority.

## Local smoke checklist for GMs

Before a real table night, a GM can run this quick local-only pass without starting a live session host:

1. Run `npm run dev` without `ROTOM_ENABLE_SESSION_HOST=1`.
2. Open `/login`, choose **GM Login**, and confirm local map/sheet navigation works.
3. Open `/maps`, create or load a non-private test map, then open plain `/maps/<slug>` without `?session=1`.
4. Move/turn a token, adjust initiative, place/remove a hazard, toggle a field effect, and build/remove one terrain voxel; confirm the local save indicator settles.
5. Open `/sheets`, edit a test Pokémon or trainer sheet, rename it if needed, and confirm autosave/route sync.
6. If encounter generation is part of the table workflow, run preview first and only write generated sheets when the output path is expected.
7. Check `git status --short` and do not commit private campaign maps/sheets, generated wild sheets, `data/sessions/`, snapshots, event logs, real `.env` files, tunnel credentials, private keys, or screenshots with secrets.

For session-mode checks, use the separate [Live session multi-tab local smoke script](live-session-multi-tab-smoke.md), [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md), and [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md). For the local/session coexistence model, see the [Live session client integration guide](live-session-client-integration.md).
