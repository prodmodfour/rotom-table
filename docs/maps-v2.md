# Map v2

Map v2 stores only the data the runtime renders or uses:

- sparse `voxels[]` for terrain blocks
- optional `hazards[]` for PTU battlefield hazards on map squares
- `placements[]` for Pokémon/trainer sheets on the map
- optional `lights[]` for the lighting system
- optional `fieldEffects` for PTU Weather, Terrain field effects, and Rooms
- optional `initiative` state
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

`shopInterfaces[]` stores map-local access points for reusable campaign shop tables. Each interface has a stable map-local `id`, a `shopSlug` reference, a display `label`, optional map `position`, optional `interactionRangeMeters`, and optional `playerVisible` flag. GMs manage these rows from the map admin panel while the map is in Prepare Map mode: the panel loads existing shop tables, adds/removes interfaces, changes the referenced shop, and edits label, position, range, and player visibility through the normal revision-checked setup/edit map save. Player users cannot edit shop interfaces. The referenced shop document remains authoritative for item catalog, price, finite/unlimited stock, and open/closed state; maps must not copy that commerce state into metadata or interface rows.

## Field effects

`fieldEffects` stores rules-state overlays for PTU battlefield-wide effects:

- `weather[]`: `sunny`, `rainy`, `hail`, `sandstorm`; normally one entry, but two can be kept for Climate Control.
- `terrains[]`: `electric`, `grassy`, `misty`, `psychic` field terrain effects.
- `rooms[]`: `magic`, `trick`, `wonder` psychic Rooms.

Each entry may track `rounds`; `null` means the duration is sustained or managed manually. These are visual/rules reminders only and do not currently automate damage rolls, initiative order, or end-of-turn ticks.

## Visibility layers

The editor supports only the active render layers:

- terrain
- shadows
- tokens
- grid
- hazards
- fieldEffects
