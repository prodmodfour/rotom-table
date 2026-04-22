# Trainer sprite dataset

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
