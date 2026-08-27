# Trainer sprite dataset — retained and labelled

**Distribution status:** retained by explicit owner disposition at P13-058 on 2026-08-27.

Unlike the documentary-only trees, this dataset currently has a narrow runtime role: `data/trainerCatalog.ts` imports the generated metadata and `nuxt.config.ts` mounts the sprite tree as public assets. Pruning it requires a reviewed replacement for both surfaces.

The downloaded sprites and represented Pokémon-related names are third-party material outside Rotom Table's license grant. P13-062 retained the source set with per-row artist/source attribution and disclosed that explicit redistribution permission remains uncertain. The generated `public/profile-sprites/trainers/` crops conflict with the source index's do-not-edit warning; the owner explicitly accepted that risk instead of implementing recommendation 5. See [`../NOTICE.md`](../NOTICE.md) and [`../docs/media-attribution.md`](../docs/media-attribution.md). Do not place private campaign portraits or player media in this tree.

Source:
- https://play.pokemonshowdown.com/sprites/trainers/?view=sprites

Generated files:
- `sprite_manifest.json` — downloaded trainer sprite metadata
- `trainers.json` — derived tabletop dimensions
- `sprites/showdown/trainers/*.png` — downloaded trainer sprites

Sizing heuristic:
- non-transparent sprite bounds are measured from each PNG
- the tallest trainer sprite silhouette is normalized to `2.0m`
- each trainer's `height` and `width` are scaled from that same metre-per-pixel ratio
- `base` is always `1`
- `clearance` is `1` if `height < 1.5`, otherwise `2`

Regenerate with:
```bash
python3 trainer_sizes/download_trainers.py
```
