# API route mutation audit

This audit lists the non-GET Nitro API surfaces that can mutate server memory or filesystem-backed JSON. It is scoped to private trusted-table hosting and local development. It is not a public-hosting hardening review.

GET routes are omitted unless they are relevant to the notes below; current GET endpoints are treated as read-only project/campaign queries, health checks, legacy SSE, or static data lookups. The legacy session WebSocket is included because commands through it mutate session state and write session snapshots.

## Hosted-write policy summary

`ROTOM_ENABLE_HOSTED_WRITES=1` is the exact production opt-in for persistent hosted filesystem writes on routes that are covered by the hosted-write policy. In non-production local development, these writes remain available without the flag.

Map write routes are covered by the same hosted-write policy. GM map library/admin routes still require GM role. `/api/maps/save` is restricted to explicit GM setup/edit whole-map saves; player-facing map/token routes keep the existing player-visible map and selected-profile token-control checks used by local profile play.

Legacy live-session maintenance routes use their separate `ROTOM_ENABLE_SESSION_HOST=1` guard and session-local credentials. They are not normal profile-based play routes and are not a substitute for the hosted-write flag on covered filesystem routes.

## Route table

| Route | Classification | Hosted-write policy | Notes |
| --- | --- | --- | --- |
| `/api/campaign/next-day` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Advances the campaign day by rewriting affected Pokémon/trainer sheet JSON and publishing sheet events. |
| `/api/encounters/create-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates an encounter-table folder under the campaign encounter-table root. |
| `/api/encounters/create` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates an encounter-table JSON file. |
| `/api/encounters/delete-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Removes an encounter-table folder. |
| `/api/encounters/delete` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Removes an encounter-table JSON file. |
| `/api/encounters/generate` | GM-only admin write | Covered for persistent output: production non-preview generation requires `ROTOM_ENABLE_HOSTED_WRITES=1`; preview uses temporary output. | Rolls an encounter table and can write generated Pokémon sheets under the campaign sheet root. |
| `/api/encounters/move-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves an encounter-table folder. |
| `/api/encounters/move` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves an encounter-table JSON file between folders. |
| `/api/encounters/rename` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Renames an encounter-table JSON file. |
| `/api/encounters/save` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Rewrites an encounter-table JSON file. |
| `/api/maps/create-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates a map folder under the campaign map root. |
| `/api/maps/create` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates a saved map JSON document and publishes map library events. |
| `/api/maps/delete-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Recursively removes a map folder and publishes map library events. |
| `/api/maps/delete` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Removes a saved map JSON document and prunes empty parent folders. |
| `/api/maps/move-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves a map folder. |
| `/api/maps/move` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves a saved map JSON document between folders. |
| `/api/maps/rename` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Renames a saved map and may move the JSON file when the slug changes. |
| `/api/maps/save` | GM setup/edit whole-map write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Requires GM role and `interactionMode: "setup-edit"`; player requests and `interactionMode: "live-play"` are rejected. Live gameplay uses command routes instead of player whole-map merge saves. |
| `/api/maps/action-event` | Player-authorized transient realtime broadcast | Not a hosted filesystem write. | Publishes bounded visual-only `map-action` events to `map:<slug>` after checking the map, actor placement, player-visible boundary, and selected-profile token control. It does not write map JSON, sheet JSON, logs, metadata, campaign state, or session snapshots. |
| `/api/maps/tokens/move` | Player-authorized profile/map command write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves a controllable token through a live-play command, validates the selected profile, and persists the authoritative map revision through SQLite before publishing map and command events. Players must select a profile linked to that token's sheet. |
| `/api/maps/tokens/turn` | Player-authorized profile/map command write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Turns a controllable token through a live-play command, validates the selected profile, and persists the authoritative map revision through SQLite before publishing map and command events. Players must select a profile linked to that token's sheet. |
| `/api/maps/tokens/modify-hp` | Player-authorized profile/map/sheet command write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Updates HP and injuries through a live-play command, validates the selected profile, resolves the backing sheet, and persists map/sheet revisions plus the `opId` result transactionally through SQLite. Players must select a profile linked to that token's sheet. |
| `/api/maps/tokens/modify-combat-stages` | Player-authorized profile/map/sheet command write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Updates combat stages through a live-play command, validates the selected profile, resolves the backing sheet, and persists map/sheet revisions plus the `opId` result transactionally through SQLite. Players must select a profile linked to that token's sheet. |
| `/api/maps/tokens/modify-conditions` | Player-authorized profile/map/sheet command write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Adds, removes, or replaces token conditions through a live-play command, validates the selected profile, resolves the backing sheet, and persists map/sheet revisions plus the `opId` result transactionally through SQLite. Players must select a profile linked to that token's sheet. |
| `/api/maps/tokens/use-ability` | Player-authorized profile/map/sheet write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Writes map combat-log metadata and may update linked Pokémon/trainer sheet state for automated abilities. Players must select a profile linked to the acting token's sheet. |
| `/api/maps/tokens/use-maneuver` | Player-authorized profile/map/sheet write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Writes map combat-log metadata for maneuver use. Players must select a profile linked to the acting token's sheet. |
| `/api/maps/tokens/use-order` | Player-authorized profile/map/sheet write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Writes map combat-log metadata and active-order effect state. Players must select a profile linked to the acting token's sheet. |
| `/api/maps/use-move` | Player-authorized profile/map/sheet write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Accepts `useMove` command envelopes for map-scoped EOT/Scene usage and untracked move action logging through the live-play executor. The existing compatibility request shape still handles sheet-scoped Daily usage until Daily move usage is moved onto the same command path. Players must select a profile linked to the acting token's sheet. |
| `/api/player-profiles/create` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates a persistent player profile JSON file under `data/player-profiles/`. |
| `/api/player-profiles/update` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Updates persistent player profile display names and linked character refs. |
| `/api/pokedex/restore-from-books` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Writes the campaign Pokédex override diff from local markdown source material; app-owned `data/reference/pokedex.json` remains unchanged. |
| `/api/pokedex/update` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Writes a campaign Pokédex override diff under `data/reference-overrides/pokedex.json`. Treat this as operator-controlled campaign reference maintenance, not app reference maintenance. |
| `/api/sessions/assignments` | Legacy session maintenance | Separate guard: `ROTOM_ENABLE_SESSION_HOST=1` plus GM session credentials; not covered by hosted-write policy. | Updates legacy live-session assignments in memory and writes session snapshots under `data/sessions/`. |
| `/api/sessions/join` | Legacy session maintenance | Separate guard: `ROTOM_ENABLE_SESSION_HOST=1` plus join/session checks; not covered by hosted-write policy. | Creates or selects a legacy session-local player identity and writes a session snapshot. |
| `/api/sessions/manage` | Legacy session maintenance | Separate guard: `ROTOM_ENABLE_SESSION_HOST=1` plus GM session credentials; no campaign write. | Reads legacy session management state through POST to keep GM credentials out of query strings. |
| `/api/sessions/player-state` | Legacy session maintenance | Separate guard: `ROTOM_ENABLE_SESSION_HOST=1` plus player session credentials; no campaign write. | Reads one legacy player's session state through POST to keep credentials out of query strings. |
| `/api/sessions/socket` | Legacy session maintenance | Separate guard: `ROTOM_ENABLE_SESSION_HOST=1` plus session socket authentication; not covered by hosted-write policy. | WebSocket commands mutate authoritative legacy session state and can write session snapshots/event logs. |
| `/api/sessions/start` | Legacy session maintenance | Separate guard: `ROTOM_ENABLE_SESSION_HOST=1` plus GM role; not covered by hosted-write policy. | Starts a legacy GM-hosted session, creates in-memory authority, and writes an initial snapshot. |
| `/api/sheets/create-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates a Pokémon/trainer sheet folder. |
| `/api/sheets/create` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Creates a Pokémon or trainer sheet JSON file and publishes sheet events. |
| `/api/sheets/delete-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Deletes a Pokémon/trainer sheet folder. |
| `/api/sheets/delete` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Deletes a Pokémon or trainer sheet JSON file and publishes sheet events. |
| `/api/sheets/move-folder` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves a Pokémon/trainer sheet folder. |
| `/api/sheets/move` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Moves a Pokémon or trainer sheet JSON file and publishes sheet events. |
| `/api/sheets/rename` | GM-only admin write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Renames a Pokémon or trainer sheet and may move the JSON file when the slug changes. |
| `/api/sheets/save` | Setup/edit sheet write | Covered: production requires `ROTOM_ENABLE_HOSTED_WRITES=1`. | Requires explicit `interactionMode: "setup-edit"`. Saves a Pokémon/trainer sheet for sheet editor/setup workflows. GM saves are unrestricted by profile; player saves outside live play still require selected-profile sheet access or public sheet access. Live map combat mutations must use command routes instead of direct whole-sheet saves. |

## Remaining limitations

- The hosted-write flag does not make the trust-based GM/Player role picker public authentication. Private VPS use still requires an outer access gate.
- Legacy session routes remain maintenance-only surfaces with their own runtime flag and credentials. They should not be used to justify public exposure of normal campaign routes.
