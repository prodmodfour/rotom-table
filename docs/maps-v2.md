# Map v2

Map v2 stores only the data the runtime renders or uses:

- sparse `voxels[]` for terrain blocks
- optional `hazards[]` for PTU battlefield hazards on map squares
- `placements[]` for Pokémon/trainer sheets on the map, with optional explicit encounter `sideId`
- optional `lights[]` for the lighting system
- optional `fieldEffects` for PTU Weather, Terrain field effects, and Rooms
- optional `initiative` state
- optional versioned `encounterState` for server-owned move-automation state
- optional `shopInterfaces[]` access points that reference campaign shop tables

Object layers such as decals, props, zones, doors, asset packs, and transparent-object toggles have been removed from the runtime and schema. Hazards are the exception: they are rules-state overlays, not decorative object layers.

## Terrain voxels

Each voxel is a 1×1×1 cube with integer `x`, `y`, and `z` coordinates and a `materialId` from the built-in material palette. Optional fields:

- `color`: one-off `#rrggbb` override
- `blocksMovement`: override material movement blocking
- `blocksSight`: override material sight blocking
- `tags`: map-local labels

The renderer still generates the same voxel block textures and face shading from material definitions. Transparent terrain materials (such as water) are persisted and rendered with their material opacity.

## Hazards

Hazards are sparse square overlays with integer `x`, `y`, `z` coordinates and a `kind`:

- `spikes`
- `toxic-spikes` (supports `layer: 1 | 2`)
- `sticky-web`
- `stealth-rock`
- `fire`

The editor renders hazards as floor decals and persists them in `hazards[]`. They do not block token placement or pathfinding by themselves.

## Shop interfaces

`shopInterfaces[]` stores map-local access points for reusable campaign shop tables. Each interface has a stable map-local `id`, a `shopSlug` reference, a display `label`, optional map `position`, optional `interactionRangeMeters`, and optional `playerVisible` flag. GMs manage these rows from the map admin panel while the map is in Prepare Map mode: the panel loads existing shop tables, adds/removes interfaces, changes the referenced shop, and edits label, position, range, and player visibility through the normal revision-checked setup/edit map save. Player users cannot edit shop interfaces. In live map view, the map shopfront launcher lists player-visible interfaces only when their referenced shop is also open and player-visible; GMs can use the same launcher to preview any mapped interface. Opening a mapped shop reuses `/shops/<slug>` with checkout origin `{ kind: 'mapInterface', mapSlug, interfaceId, actorPlacementId? }`, so checkout remains a shop live-play command rather than map metadata mutation. The referenced shop document remains authoritative for item catalog, price, finite/unlimited stock, and open/closed state; maps must not copy that commerce state into metadata or interface rows.

## Field effects

`fieldEffects` stores rules-state overlays for PTU battlefield-wide effects:

- `weather[]`: `sunny`, `rainy`, `hail`, `sandstorm`; normally one entry, but two can be kept for Climate Control.
- `terrains[]`: `electric`, `grassy`, `misty`, `psychic` field terrain effects.
- `rooms[]`: `magic`, `trick`, `wonder` psychic Rooms.

Each entry may track `rounds`; `null` means the duration is sustained or managed manually. These are visual/rules reminders only and do not currently automate damage rolls, initiative order, or end-of-turn ticks.

## Encounter state

`encounterState` is an optional, explicitly versioned envelope for authoritative move-automation state. Its `sides` directory stores bounded map-local side records keyed by stable lowercase IDs. Each record has the same `id`, a display `label`, optional `#rrggbb` presentation `color`, and `active` or `inactive` status. Inactive records remain addressable so existing placements do not lose allegiance when a side is archived.

The bounded `effects[]` collection stores typed temporary rule effects. Every instance has a stable identity; accepted operation, reviewed move, and source-placement references; explicit affected placements, sides, or cells; creation turn/round; duration, stack, and charge state; stable tags; and typed dispel/suppression metadata. Effect `kind` selects an exact payload for a condition, numeric modifier, or capability change, so free-form prose and opaque metadata cannot become mechanics state.

Canonical lasting conditions remain persisted as strings on the backing Pokémon or Trainer sheet. For a placed token, one pure projection combines that sheet layer with active direct-, side-, and cell-scoped condition effects. Ordinary condition names are not duplicated across the two layers, explicit stack counts remain meaningful, and active `suppress` modifiers remove a condition only from the effective view without rewriting its sheet value. Applicable effect records remain available alongside the projected names, preserving their source, timing, stacks, charges, and typed payload. A persistent condition reducer always starts from the sheet layer, so resolving another condition cannot accidentally copy a timed encounter effect into the sheet.

Lifecycle policy is stored with each effect rather than inferred from prose. Fixed durations name the start or end of the source or target turn, or a start/end round boundary; scene, until-triggered, and permanent durations expire only from their matching authoritative events. Reapplication explicitly replaces, refreshes, adds up to a maximum stack count, or creates an independently identified instance. Charge-based effects declare how many charges an exact server-authored trigger consumes. The pure policy transition layer is deterministic and clears suppression references when their source effect leaves. A versioned shared contract bounds server-internal scene, initiative, move, movement, switch, effect, and resource facts; every event identifies its source operation and causal parent, and no event accepts an arbitrary payload or state patch. The pure lifecycle reducer now processes ordered event batches, applies effect transitions, validates typed operations returned by ordered server trigger handlers, reduces emitted child events depth-first, and records bounded counters and trace evidence. Effect additions/removals happen before handlers, while turn/round/scene cleanup happens afterward so an active effect may enqueue its final boundary work before expiry. Recursion, emitted-event, operation, trigger, and trace ceilings fail closed. Initiative/scene command integration and move-specific trigger handlers remain unavailable until their owning tickets.

The counters, history, turn resources, zones, and pending-resolution-summary containers remain reserved and empty at this phase. Existing `hazards`, `fieldEffects`, `temporaryHitPoints`, and `moveUsage` fields remain separate and authoritative during the staged migration.

A placement may carry a `sideId` referencing that directory. Omission means the placement's side is unknown/unaffiliated; legacy maps are not assigned sides from sheet kind, player/GM control, or token ownership. Send-out inherits the trainer placement's explicit side, while an unknown-side trainer produces an unknown-side Pokémon. Explicit GM spawn commands may carry only an existing side ID. Recall/deletion results retain the removed placement's side in their authoritative result and patch evidence.

GMs configure this state from **Map Admin → Encounter sides** while the shared map is in **Prepare Map** mode. The setup control creates stable side IDs from display labels, allows labels and presentation colours to change without changing identity, archives/reactivates sides, preselects the currently selected map token, and supports bulk placement assignment or restoring unknown/unaffiliated allegiance. Archived sides are unavailable for new assignments but retain existing placement references. These edits use the normal whole-map setup save with the loaded `expectedRevision`; a stale save conflicts instead of overwriting a newer setup, and player/live-play views cannot invoke the mutation controls or the GM-only save route.

Legacy documents that omit `encounterState` receive a fresh canonical empty envelope at server read boundaries. Loading is non-persisting and does not advance the map revision; the canonical envelope is stored with the next accepted map write. Present state is validated strictly, so malformed containers, dangling placement side references, and unsupported future schema versions fail loading instead of being discarded or downgraded.

## Visibility layers

The editor supports only the active render layers:

- terrain
- shadows
- tokens
- grid
- hazards
- fieldEffects
