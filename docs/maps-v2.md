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

Use `materialId` from the loaded asset-pack manifests (with `utils/mapMaterials.ts` as the offline fallback palette). Starter IDs include:

- airship: `airship_hull_dark`, `airship_floor_metal`, `airship_floor_plating`, `airship_wall_bulkhead`, `reinforced_glass`, `engineering_floor`, `cargo_lift_floor`, `hazard_stripe_floor`
- habitat: `meadow_grass`, `meadow_flower_grass`, `grove_leaf_litter`, `wetland_bank`, `mud`, `shoreline_pebbles`, `shallow_water`, `deep_water`, `cave_stone`, `burrow_dirt`, `thermal_rock`, `snow`, `cryo_snowpack`, `ice`, `sand`, `desert_scrub_sand`, `scrub_dirt`
- facility pods: `electric_insulated_floor`, `biosecure_poison_floor`, `medical_tile`, `facility_clean_tile`, `quarantine_tile`, `decon_grate`, `nursery_soft_pad`, `soft_nursery_mat`, `observation_wood`

Transparent materials (`reinforced_glass`, water, ice) have opacity and render after opaque terrain so sprites behind them remain visible. Unknown manifest material IDs are preserved by the server and resolved when the client loads the relevant pack manifest.

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

Props may also request an exact texture variant. If `variant` is omitted and the prop definition has weighted variants, the renderer/generator picks one deterministically from the placement id, so the same map JSON looks the same on every load:

```json
{
  "id": "prop-berry-07",
  "propId": "berry_bush",
  "variant": "blue",
  "position": { "x": 18, "y": 1, "z": 23 },
  "blocksMovement": false
}
```

Props receive contact shadows. If `position.y` is above the surface beneath them, their shadow stays on the lower surface and becomes softer/fainter.

Movement occupancy uses the prop's `position.y`, footprint, height, and scale. `blocksMovement` on the placement wins; otherwise the prop definition's default is used. Decorative props like reeds may be non-blocking, while consoles, trees, crates, railings, and similar props generally block movement.

### Zones

Zones are not just labels; they drive graphics. Each zone creates a subtle tinted floor wash, border, optional icon decal, and optional low-opacity corner markers. Keep these quiet; zones should read as environmental identity, not a UI overlay.

```json
{
  "id": "snow_ice_pod",
  "name": "Snow / Ice Pod",
  "bounds": { "x1": 41, "z1": 3, "x2": 51, "z2": 12 },
  "theme": "ice",
  "icon": "nature_snowflake",
  "cornerMarker": "nature_snowflake",
  "tint": "#a7e6ff",
  "floorWashOpacity": 0.08,
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

Closed and locked doors block token movement. Open doors do not. Transparent doors (for example `glass_habitat_gate`) still block movement while closed/locked; transparency only changes how the object renders.

## Sprites, cages, and shadows

Pokémon/trainer placements still reference sheets. The sheet controls sprite size, footprint (`base`), and clearance. The renderer uses that cage to:

- anchor the sprite bottom-center at the feet/base position;
- draw the translucent selection cage;
- sort against terrain through normal depth testing;
- project the contact shadow to the highest voxel surface below the feet.

Map v2 extends the same idea to props. Use prop `footprint` and `height` generously so AI-generated objects feel grounded in the same pseudo-3D world.

## Asset packs

Local map assets are manifest-driven in Phase 2:

```text
public/assets/map/
  airship/manifest.json
  nature/manifest.json
  facility/manifest.json
```

Runtime URLs use `/assets/map/<pack>/...`. Do not rely on remote URLs at runtime. Manifests define materials, decals, props, doors, icons, variants, and source/license metadata. The TypeScript registries remain as an offline fallback only.

For details, see [map asset packs](./map-asset-packs.md). For higher-level AI generation, see [map prefabs and brushes](./map-prefabs-and-brushes.md).

## AI generation advice

1. Start with zones and materials before props. A map should read from floor color/tint alone.
2. Use transparent barriers for containment pods instead of opaque walls when players should see inside.
3. Put icon decals at thresholds and central landmarks, not on every tile.
4. Use props in clusters of 2–5 per zone: trees for grove, reeds/ripples for wetland, pylons/coils for electric, scrubbers for poison, beds/crosses for medical.
5. Keep token feet at `y=1` on ordinary ground (`y=0` voxels). Use higher `y` only for raised platforms/perches.
6. Prefer stable IDs: `zone-wetland`, `prop-wetland-reeds-01`, `door-medical-airlock`.
7. Prefer brush plans and prefabs over hand-placing thousands of objects. Use `npm run generate:airship-demo` as a concrete workflow example.
8. Run validation before loading:

```bash
npm run generate:airship-demo
npm run validate:map -- data/maps/ranger_ark/airship-habitat-atrium-phase2-demo.json
npm run validate:maps
npm run smoke:map-v2
```

## Troubleshooting

### Validation

Use `npm run validate:map -- <path/to/map.json>` for one map, or `npm run validate:maps` for the checked-in demo map. The validator catches the mistakes most likely to come from AI-authored JSON: unknown material/decal/prop/door IDs, duplicate voxel positions, duplicate object IDs, out-of-bounds positions, bad scales, bad zone bounds, missing asset packs, and lights pointing at missing zones.

### Common coordinate mistakes

- `x` and `z` are table coordinates; `y` is elevation.
- A ground voxel at `y=0` has its top face at `y=1`, so tokens standing on normal ground usually use `position.y = 1`.
- Voxel positions must be integers. Decals, props, doors, and lights may use numeric positions, but keep anchors inside dimensions.
- Zone `x2`/`z2` are upper bounds; `x2` must be greater than `x1` and no larger than `dimensions.x`.

### Why floor decals use `position.y + 1`

A floor decal at `position.y = 0` is intended to sit on top of the voxel occupying `y=0`. The renderer lifts floor decals to `position.y + 1` plus a tiny epsilon so the decal does not z-fight with the floor top. If a decal appears one level too high or too low, check whether you authored the voxel cube's `y` or the top-surface `y`.

### Prop grounding and movement footprint

A prop's `position.y` is its base/feet height, not the bottom voxel's `y`. On ordinary floor voxels at `y=0`, most props should use `position.y = 1`. `footprint` covers grid cells in `x/z`; `height` covers cells upward from `position.y`; `scale` multiplies both. Blocking props reserve every grid cell touched by that footprint/height for movement/pathfinding.

### Doors and blocking props

Closed and locked doors block movement; open doors do not. Blocking props also affect spawning, movement preview/pathfinding, and build-mode placement checks. Transparent blockers still block if their material/object says they do — reinforced glass and closed glass gates should contain tokens without hiding them completely.

### Keeping Pokémon sprites visually grounded

- Keep token feet at the top surface: `position.y = floorVoxel.y + 1`.
- Do not put a sprite inside a blocking voxel/prop/closed door footprint; the validator and movement occupancy are designed to prevent this.
- Preserve the sheet's `base` and `clearance` values so the contact shadow, cage, HP bar, and sorting stay aligned.
- Use transparent barriers for containment walls so sprites remain visible, and avoid stacking opaque props directly in front of important token feet.
