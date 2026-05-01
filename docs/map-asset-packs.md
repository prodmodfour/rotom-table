# Map asset packs

Phase 2 map visuals are manifest-driven. A map declares local packs in `assetPacks`, and the client loads `/assets/map/<pack>/manifest.json` before rebuilding decals, props, doors, icons, variants, and material definitions.

## Layout

```text
public/assets/map/
  airship/
    manifest.json
    decals/
    props/
    materials/
    icons/
  nature/
    manifest.json
    decals/
    props/
    materials/
    icons/
  facility/
    manifest.json
    decals/
    props/
    materials/
    icons/
```

The built-in TypeScript registries are fallback/offline definitions. Prefer manifest data for new assets.

## Manifest essentials

Each manifest should stay AI-readable:

```json
{
  "id": "nature",
  "displayName": "Habitat Nature",
  "version": 1,
  "sources": [
    {
      "name": "Rotom Table generated stylized SVG asset vocabulary",
      "url": "local://scripts/phase2-generated-svg",
      "license": "Project-generated; private non-commercial use",
      "notes": "No remote runtime dependency."
    }
  ],
  "materials": {
    "meadow_flower_grass": {
      "displayName": "Flowering Meadow Grass",
      "color": "#68ad3d",
      "texture": "materials/meadow_flower_grass.svg",
      "tags": ["habitat", "grass", "flowers"]
    }
  },
  "props": {
    "berry_bush": {
      "displayName": "Berry Bush",
      "texture": "props/berry_bush_red.svg",
      "footprint": { "x": 1, "z": 1 },
      "height": 1.2,
      "blocksMovementDefault": false,
      "variants": [
        { "id": "red", "texture": "props/berry_bush_red.svg", "weight": 3 },
        { "id": "blue", "texture": "props/berry_bush_blue.svg", "weight": 2 }
      ],
      "tags": ["habitat", "plant"]
    }
  }
}
```

Texture paths are relative to the pack directory unless they start with `/`, `http`, `data:`, or `blob:`. Do not use remote URLs in checked-in maps.

## Variants

Maps can specify an exact prop variant:

```json
{ "id": "prop-berry-01", "propId": "berry_bush", "variant": "blue", "position": { "x": 8, "y": 1, "z": 12 } }
```

If `variant` is omitted, the renderer chooses from weighted variants deterministically using the placement id and prop id. This keeps AI-generated maps stable while avoiding repetition.

## Importing local assets

Use the local-folder importer after downloading/extracting an asset pack manually:

```bash
npm run import:map-assets -- --pack nature --from ./asset-downloads/foliage --category props \
  --source-name "Foliage pack" --source-url "local://asset-downloads/foliage" \
  --license "Review before redistribution"
```

The importer:

- copies SVG/PNG/WebP/JPG files into `public/assets/map/<pack>/<category>/`;
- normalizes filenames;
- updates `manifest.json`;
- records source/license notes;
- avoids overwriting files unless `--allow-overwrite` is supplied.

Review generated footprints, heights, blocking defaults, tags, and license notes before map generation.

## Runtime/loading notes

- Decal and prop textures are cached by URL and reference-counted while the map component is mounted.
- SVG, PNG, WebP, JPG, and JPEG can be loaded by the current texture loader.
- Voxel materials currently use manifest `color`, transparency, opacity, and tags for procedural block rendering; `texture` is stored as manifest metadata and future atlas input.
- Transparent blockers still block movement if the material/prop/door definition says they do.

## Readability rules

- Prefer stylized, clean, high-contrast assets that sit next to Pokémon pixel sprites.
- Keep props clustered in meaningful groups; avoid noise fields.
- Use decals for thresholds, safety markings, water ripples, and icons, not every tile.
- Keep source/license metadata even for generated local assets.
