# Map v2

Map v2 stores only the data the runtime renders or uses:

- sparse `voxels[]` for terrain blocks
- optional `hazards[]` for PTU battlefield hazards on map squares
- `placements[]` for Pokémon/trainer sheets on the map
- optional `lights[]` for the lighting system
- optional `initiative` state

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

## Visibility layers

The editor supports only the active render layers:

- terrain
- shadows
- tokens
- grid
- hazards
