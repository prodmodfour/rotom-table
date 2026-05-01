# Map v2

Map v2 stores only the data the runtime renders or uses:

- sparse `voxels[]` for terrain blocks
- `placements[]` for Pokémon/trainer sheets on the map
- optional `lights[]` for the lighting system
- optional `initiative` state

Object layers such as decals, props, zones, doors, asset packs, and transparent-object toggles have been removed from the runtime and schema.

## Terrain voxels

Each voxel is a 1×1×1 cube with integer `x`, `y`, and `z` coordinates and a `materialId` from the built-in material palette. Optional fields:

- `color`: one-off `#rrggbb` override
- `blocksMovement`: override material movement blocking
- `blocksSight`: override material sight blocking
- `tags`: map-local labels

The renderer still generates the same voxel block textures and face shading from material definitions.

## Visibility layers

The editor supports only the active render layers:

- terrain
- shadows
- tokens
- grid
