# Trainer sprite dataset — retained and labelled

**Distribution status:** retained by explicit owner disposition at P13-058 on 2026-08-27.

Unlike the documentary-only trees, this dataset currently has a narrow runtime role: `data/trainerCatalog.ts` imports the generated metadata and `nuxt.config.ts` mounts the sprite tree as public assets. Pruning it requires a reviewed replacement for both surfaces.

The downloaded sprites and represented Pokémon-related names are third-party material outside Rotom Table's license grant. Retention here records distribution intent only; the explicit media/notice posture remains owner-reserved at P13-062. Do not place private campaign portraits or player media in this tree.

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
