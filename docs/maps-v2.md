# Rotom Table map schema v2

Map v2 makes map visuals explicit and AI-writable. Terrain is still a sparse list of 1×1×1 voxels, but voxels now point at visual-first material IDs. Readability comes from combining materials, decals, props, doors, zones, and transparent barriers.

## Minimal example

```json
{
  "schemaVersion": 2,
  "slug": "example-habitat",
  "name": "Example Habitat",
  "dimensions": { "x": 12, "y": 6, "z": 12 },
  "assetPacks": ["airship"],
  "voxels": [
    { "x": 0, "y": 0, "z": 0, "materialId": "airship_floor_metal" },
    { "x": 1, "y": 0, "z": 0, "materialId": "meadow_grass" }
  ],
  "placements": [],
  "decals": [
    {
      "id": "decal-center",
      "decalId": "ranger_insignia",
      "surface": "floor",
      "position": { "x": 6, "y": 0, "z": 6 },
      "scale": { "x": 2, "z": 2 },
      "opacity": 0.75
    }
  ],
  "props": [
    {
      "id": "prop-tree-1",
      "propId": "small_tree",
      "position": { "x": 2, "y": 1, "z": 3 },
      "footprint": { "x": 1, "z": 1 },
      "height": 2.4
    }
  ],
  "zones": [
    {
      "id": "meadow",
      "name": "Meadow",
      "bounds": { "x1": 1, "z1": 1, "x2": 8, "z2": 8 },
      "theme": "grass",
      "icon": "pawprints",
      "tint": "#6fb33f"
    }
  ],
  "doors": [
    {
      "id": "door-main",
      "doorId": "glass_habitat_gate",
      "position": { "x": 8, "y": 1, "z": 4 },
      "state": "closed"
    }
  ],
  "lights": []
}
```

## Coordinate system

- `x` = width across the table.
- `z` = depth across the table.
- `y` = height/elevation.
- A voxel at `{ "x": 4, "y": 0, "z": 7 }` occupies the cube from `y=0` to `y=1`.
- Tokens and most props stand with their feet/base at the top of the floor voxel, so a token standing on ground voxels at `y=0` normally has placement `position.y = 1`.
- Floor decals use `position` as the decal center and render slightly above the top face at `position.y + 1` to avoid z-fighting.
- Zone `bounds.x2` / `bounds.z2` are exclusive-style upper bounds for generation: width is `x2 - x1`, depth is `z2 - z1`.

## Visual grammar

### Materials

Use `materialId` from `utils/mapMaterials.ts`. Starter IDs include:

- airship: `airship_hull_dark`, `airship_floor_metal`, `airship_wall_bulkhead`, `reinforced_glass`, `engineering_floor`, `cargo_lift_floor`, `hazard_stripe_floor`
- habitat: `meadow_grass`, `wetland_bank`, `mud`, `shallow_water`, `deep_water`, `cave_stone`, `burrow_dirt`, `thermal_rock`, `snow`, `ice`, `sand`, `scrub_dirt`
- special pods: `electric_insulated_floor`, `biosecure_poison_floor`, `medical_tile`, `soft_nursery_mat`, `observation_wood`

Transparent materials (`reinforced_glass`, water, ice) have opacity and render after opaque terrain so sprites behind them remain visible.

### Decals

Decals are flat overlays attached to a face:

```json
{
  "id": "thermal-warning",
  "decalId": "hazard_stripes",
  "surface": "floor",
  "position": { "x": 22, "y": 0, "z": 10 },
  "rotation": 90,
  "scale": { "x": 3, "z": 1 },
  "tint": "#ffb703",
  "opacity": 0.85,
  "renderOrder": 2
}
```

Supported surfaces are `floor`, `ceiling`, `north`, `south`, `east`, and `west`.

### Props

Props are anchored map objects separate from voxels. They have a grid position, footprint, and height so they can share the token grounding model:

```json
{
  "id": "aviary-perch-high",
  "propId": "perch_tower",
  "position": { "x": 24, "y": 3, "z": 30 },
  "footprint": { "x": 1, "z": 1 },
  "height": 4.2,
  "blocksMovement": true
}
```

Props receive contact shadows. If `position.y` is above the surface beneath them, their shadow stays on the lower surface and becomes softer/fainter.

### Zones

Zones are not just labels; they drive graphics. Each zone creates a subtle tinted floor fill, border, and optional icon decal.

```json
{
  "id": "snow_ice_pod",
  "name": "Snow / Ice Pod",
  "bounds": { "x1": 41, "z1": 3, "x2": 51, "z2": 12 },
  "theme": "ice",
  "icon": "snowflake",
  "tint": "#a7e6ff",
  "ambientLight": "#a7e6ff"
}
```

### Doors

Doors are visual objects with state:

```json
{
  "id": "quarantine-door",
  "doorId": "biosecure_quarantine_door",
  "position": { "x": 38, "y": 1, "z": 34 },
  "rotation": 90,
  "state": "locked",
  "connectsTo": "poison_safe_pod"
}
```

States: `open`, `closed`, `locked`.

## Sprites, cages, and shadows

Pokémon/trainer placements still reference sheets. The sheet controls sprite size, footprint (`base`), and clearance. The renderer uses that cage to:

- anchor the sprite bottom-center at the feet/base position;
- draw the translucent selection cage;
- sort against terrain through normal depth testing;
- project the contact shadow to the highest voxel surface below the feet.

Map v2 extends the same idea to props. Use prop `footprint` and `height` generously so AI-generated objects feel grounded in the same pseudo-3D world.

## Asset packs

Local map assets live under:

```text
public/assets/map/airship/
  manifest.json
  decals/*.svg
  props/*.svg
```

Runtime URLs use `/assets/map/airship/...`. Do not rely on remote URLs at runtime. Source/license metadata is in `manifest.json`.

## AI generation advice

1. Start with zones and materials before props. A map should read from floor color/tint alone.
2. Use transparent barriers for containment pods instead of opaque walls when players should see inside.
3. Put icon decals at thresholds and central landmarks, not on every tile.
4. Use props in clusters of 2–5 per zone: trees for grove, reeds/ripples for wetland, pylons/coils for electric, scrubbers for poison, beds/crosses for medical.
5. Keep token feet at `y=1` on ordinary ground (`y=0` voxels). Use higher `y` only for raised platforms/perches.
6. Prefer stable IDs: `zone-wetland`, `prop-wetland-reeds-01`, `door-medical-airlock`.
7. Run validation before loading:

```bash
node scripts/validate-map-v2.mjs data/maps/ranger_ark/airship-habitat-atrium-v2.json
```
