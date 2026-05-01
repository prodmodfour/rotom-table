# Map prefabs and biome brushes

Phase 2 adds AI-friendly generation helpers so final maps do not require hand-authoring thousands of objects.

## Workflow

```bash
npm run generate:airship-demo
npm run validate:maps
npm run smoke:map-v2
```

Generic plan expansion is available with:

```bash
npm run generate:map-from-plan -- --plan data/map-plans/airship-habitat-atrium-phase2-demo.plan.json --out data/maps/ranger_ark/airship-habitat-atrium-phase2-demo.json
```

Plans expand into ordinary map v2 JSON: `voxels`, `decals`, `props`, `doors`, and `zones`.

## Brush definitions

Brushes live in `data/map-brushes/phase2-brushes.json`. A brush paints a rectangular region with materials, zone identity, edge decals, thematic decals, and deterministic scatter props.

```json
{
  "id": "wetland",
  "materials": {
    "primary": "wetland_bank",
    "secondary": "mud",
    "water": "shallow_water"
  },
  "waterInset": 2,
  "edgeDecals": ["shoreline_trim_soft"],
  "thematicDecals": ["water_ripple_soft"],
  "scatterProps": [
    { "propId": "reed_patch", "density": 0.1 },
    { "propId": "lily_pad", "density": 0.055 }
  ],
  "icon": "nature_water_ripple",
  "tint": "#46a9d8"
}
```

Suggested brush IDs include:

- `meadow`, `grove`, `wetland`, `deep-water-pool`
- `cave`, `burrow`, `thermal`, `cryo`, `desert-scrub`
- `electric-tech`, `poison-biosecure`, `nursery`, `medical`, `engineering`, `cargo-lift`, `observation-wood`, `aviary`, `quiet-nook`, `airship-corridor`

## Plan zones

A plan zone references a brush and bounds:

```json
{
  "id": "zone-meadow",
  "name": "Central Meadow Commons",
  "brush": "meadow",
  "bounds": { "x1": 20, "z1": 13, "x2": 44, "z2": 30 },
  "borderStyle": "quiet"
}
```

The generator writes a normal `zones[]` entry and paints floor voxels. `x2`/`z2` are exclusive upper bounds.

## Prefab definitions

Prefab JSON lives under `data/map-prefabs/`. A prefab is a small reusable bundle of relative voxels, decals, props, doors, and optional zones.

```json
{
  "id": "habitat-glass-gate-2x1",
  "dimensions": { "x": 3, "y": 3, "z": 2 },
  "decals": [
    { "id": "threshold", "decalId": "threshold_glow", "surface": "floor", "position": { "x": 1.5, "y": 0, "z": 0.5 } }
  ],
  "props": [
    { "id": "console", "propId": "habitat_door_console", "position": { "x": 0, "y": 1, "z": 1 } }
  ],
  "doors": [
    { "id": "gate", "doorId": "glass_habitat_gate", "position": { "x": 0.5, "y": 1, "z": 0 }, "state": "closed" }
  ]
}
```

Current starter prefabs include:

- `habitat-glass-gate-2x1`
- `medical-airlock-3x2`
- `wetland-corner-4x4`
- `aviary-perch-cluster`
- `electric-charging-station`
- `poison-filtration-corner`
- `cargo-lift-4x4`

## Prefab placements

Plans place prefabs like this:

```json
{
  "id": "prefab-medical-airlock",
  "prefabId": "medical-airlock-3x2",
  "position": { "x": 58, "y": 0, "z": 21 },
  "rotation": 90
}
```

The expander prefixes child object IDs with the placement id, applies 90-degree rotations, and outputs ordinary map v2 objects. `mirror` is accepted by the transformer for simple horizontal mirroring.

## Glass barriers

Plans can add simple transparent blockers without hand-authoring every voxel:

```json
{
  "x1": 19,
  "z1": 12,
  "x2": 44,
  "z2": 12,
  "height": 2,
  "openings": [{ "x1": 30, "z1": 12, "x2": 33, "z2": 12 }]
}
```

These expand to `reinforced_glass` voxels at `y=1` and above. They are transparent but still block movement.

## Campaign habitat source

`data/map-plans/airship-habitat-atrium.plan.json` is the canonical source for the campaign-ready Airship Habitat Atrium map. Edit that plan first, then regenerate the checked-in map JSON with:

```bash
npm run generate:map-from-plan -- --plan data/map-plans/airship-habitat-atrium.plan.json --out data/maps/ranger_ark/airship-habitat-atrium.json
```

Do not hand-patch `data/maps/ranger_ark/airship-habitat-atrium.json` unless the change is also promoted back into the plan, a brush, a prefab, or a reusable generator helper. The campaign plan uses `scatterScale`, `clearRegions`, `ringWalkways`, and `raisedPlatforms` to keep the generated map readable without manually writing thousands of final voxels.

## AI authoring recommendations

1. Start with large brush zones. Let materials and low-opacity zone identity do most of the visual work.
2. Add 1–3 prefabs per important area: gates, airlocks, charging stations, filtration corners, cargo lifts.
3. Use glass barriers for containment where players should still see sprites.
4. Keep scatter densities low (`0.02`–`0.12`). Dense prop fields make token feet hard to read.
5. Put tokens at `y=1` on normal floor voxels. Avoid spawning inside generated barriers, blocking props, or closed doors.
6. Re-run generation after plan edits; do not manually patch generated output unless the patch is meant to become a prefab or brush.
