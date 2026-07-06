# Sprite visual-bounds overrides

Pokémon sprite visual bounds are generated from source-canvas alpha pixels by the front and back sprite manifest scripts. Most species should use the generated bounds unchanged. Use `data/spriteVisualBoundsOverrides.json` only for outliers where the alpha box does not match the perceived body centre.

The override file is optional. If it is missing, manifest generation treats it as an empty map. A present file is keyed by the exact Pokémon species name used in the sprite manifest and may set any subset of these manifest fields:

- `floating` — force the generated hover/floating classification to `true` or `false`.
- `left`, `top`, `width`, `height` — adjust the visual alpha bounding box in source-canvas pixels.
- `canvas_width`, `canvas_height` — override canvas dimensions only if the generated metadata is wrong.
- `front` and `back` — apply facing-specific overrides when front and back sprites need different corrections.

Common fields on a species apply to both views. `front` or `back` fields override the common values for that view.

```json
{
  "$schema": "../schemas/spriteVisualBoundsOverrides.schema.json",
  "Koffing": {
    "floating": true
  },
  "Haunter": {
    "front": {
      "floating": true,
      "left": 6,
      "width": 42
    },
    "back": {
      "floating": true
    }
  },
  "Gastly": {
    "top": 12,
    "height": 38,
    "floating": false
  }
}
```

Good override candidates include wide wings, long tails, smoke clouds, disconnected particles, glow effects, or sprites whose alpha bbox includes decorative elements far away from the visible body. Animated sprites can also need overrides when their full-frame union covers the entire canvas even though the representative resting pose clearly hovers or swims above the tactical centre. Keep overrides minimal: prefer forcing `floating` alone when the bbox is already good, and only edit bbox coordinates when the perceived body centre is visibly wrong.

The checked-in overrides are a curated QA set for representative ghost/smoke, levitating, flying/winged, swimming/fish, and unusually wide silhouettes. They are still source-art metadata only: generated runtime offsets remain visual-only and must not move the tactical cage, footprint, contact shadow, picking proxy, or occupied map volume.

After changing overrides, run the front and/or back sprite manifest conversion scripts so the runtime receives final `visual_bounds` metadata and does not need to know that an override was used:

```bash
python3 scripts/download_pokemon_sprites.py --convert-existing
python3 scripts/download_pokemon_back_sprites.py --convert-existing
```

## Dev overlay for QA

In a local/dev Nuxt build, append `?spriteBoundsDebug=1` to a Pokédex detail route, for example `/pokedex/haunter?spriteBoundsDebug=1`, to show the sprite visual-bounds QA overlay. The overlay is hidden in normal use and is disabled outside dev builds.

The overlay draws the source canvas box, visual bounding box, canvas/body centre markers, the final cage centre target, and a small readout with the active translate percentages. Use it to spot species whose alpha bounds do not match the perceived body centre before adding minimal overrides.
