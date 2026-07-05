# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one ticket from the supplied planning file; build ticket numbers follow that document's suggested order when present.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (`015`) may also set `AUTOMATION_STATUS: DONE` after all 15 refreshed tickets are complete.

---

# Hover/floating sprite centering tickets

Goal: make Pokémon that visibly hover or float inside their source sprite appear with the centre of the Pokémon's visible body aligned to the centre of the sprite cage, without moving the tactical footprint, contact shadow, picking proxy, or occupied map volume.

Implementation invariant: the cage stays semantically correct. The artwork may receive a visual-only offset; base, clearance, shadow projection, selection cages, targeting, and movement rules should continue to use the existing placement dimensions.

## 001 — Define the visual-bounds metadata contract

Status: DONE

**Commit size:** type-only/schema-only change.

- Add a `SpriteVisualBounds` type in `src/types/pokemon.ts` with `canvasWidth`, `canvasHeight`, `left`, `top`, `width`, `height`, and `floating` fields.
- Add a matching manifest record type if the JSON uses snake_case fields, for example `SpriteVisualBoundsRecord`.
- Extend `SpriteManifestRecord`, `BackSpriteManifestRecord`, and `PokemonCatalogEntry` with optional visual-bounds fields.
- Keep the field optional so old manifests, tests, and partial fixtures continue to load.

**Acceptance criteria**

- TypeScript accepts Pokémon and trainer catalog entries without visual-bounds metadata.
- No runtime behaviour changes yet.

## 002 — Add a reusable sprite visual-bounds extractor

Status: DONE

**Commit size:** new Python helper plus focused tests/fixtures if practical.

- Add a helper module under `scripts/`, for example `scripts/sprite_visual_bounds.py`.
- Implement alpha bounding-box extraction for static RGBA images.
- Implement animated GIF support by inspecting full composited frames, then producing one stable union bounding box across all frames.
- Return dimensions in source-canvas pixels, not scaled CSS/world units.
- Add a derived `floating` boolean based on transparent bottom gap, with a named threshold constant.

**Acceptance criteria**

- Static PNGs and animated GIFs produce deterministic metadata.
- Empty/fully transparent images fall back to the full canvas and `floating: false`.
- The threshold is centralized and documented.

## 003 — Wire front-sprite downloads to write visual bounds

Status: DONE

**Commit size:** update the front sprite downloader/converter only.

- Update `scripts/download_pokemon_sprites.py` so every manifest entry receives front `visual_bounds` metadata after the sprite is downloaded or converted.
- Ensure `--convert-existing` also backfills visual bounds for existing local assets.
- For GIF assets, compute bounds from the same full logical-screen interpretation used for spritesheet animation metadata.
- Keep the manifest sorted exactly as before.

**Acceptance criteria**

- Fresh downloads and `--convert-existing` both write visual-bounds metadata.
- Existing animation metadata remains unchanged except for the new field.
- Generated JSON remains stable across repeated runs.

## 004 — Wire back-sprite downloads to write visual bounds

Status: DONE

**Commit size:** update the back sprite downloader/converter only.

- Update `scripts/download_pokemon_back_sprites.py` to emit visual-bounds metadata for back-facing sprites.
- Add a convert/backfill path if the back-sprite script has an existing-manifest mode; otherwise add one matching the front-sprite workflow.
- Preserve compatibility when a species has a front sprite but no back sprite.

**Acceptance criteria**

- Back-sprite manifest entries can carry their own visual-bounds metadata.
- Map facing can eventually choose front/back-specific offsets instead of assuming both views share the same body centre.

## 005 — Add manual visual-bounds overrides for outliers

Status: DONE

**Commit size:** data contract plus override application, no renderer changes.

- Add a small optional override file, for example `data/spriteVisualBoundsOverrides.json`.
- Support per-species override of `floating`, bbox fields, or both.
- Apply overrides inside the manifest-generation helper so the runtime receives final metadata and does not need to know about overrides.
- Document examples for awkward silhouettes such as wide wings, tails, smoke, disconnected particles, or sprites whose alpha bbox includes decorative effects.

**Acceptance criteria**

- Overrides can force `floating: true` or `floating: false` without changing code.
- Overrides can adjust bbox values for known visual outliers.
- Missing override file behaves as an empty override map.

## 006 — Regenerate sprite manifests with visual bounds

Status: DONE

**Commit size:** generated data only, after the scripts are ready.

- Run the front sprite manifest conversion/backfill.
- Run the back sprite manifest conversion/backfill.
- Commit the regenerated manifest JSON files.
- Review the diff for suspicious all-canvas bounds, negative values, or very high floating rates.

**Acceptance criteria**

- Every Pokémon front-sprite manifest entry has visual-bounds metadata.
- Every available back-sprite manifest entry has visual-bounds metadata.
- No unrelated sprite assets are rewritten unless the script intentionally regenerates them.

## 007 — Propagate visual bounds through catalogs and Pokédex APIs

Status: DONE

**Commit size:** TypeScript data plumbing only.

- Update `data/pokemonCatalog.ts` to map manifest visual bounds onto `PokemonCatalogEntry`.
- Update the server Pokédex repository detail response so `spriteVisualBounds` and `backSpriteVisualBounds` are available to the client.
- Update `src/utils/pokedex/entryIndex.ts` or related detail types so the new fields are typed on `PokedexEntryDetail`.
- Ensure trainer catalog behaviour stays unchanged unless trainer visual bounds are deliberately added later.

**Acceptance criteria**

- The Pokédex detail endpoint returns visual-bounds metadata for Pokémon with manifest metadata.
- Existing consumers can ignore the fields safely.
- Typecheck passes.

## 008 — Add shared body-centre math helpers

Status: DONE

**Commit size:** pure utility plus unit tests.

- Add a utility module such as `src/utils/spriteVisualBounds.ts` or `src/utils/isometric/spriteVisualBounds.ts`.
- Implement helpers that compute the visible body centre as normalized canvas coordinates.
- Implement a 2D frame translation helper that returns CSS-friendly percentages for centring the body inside a square cage.
- Implement a world-space Y offset helper that aligns body centre to `clearance / 2` for floating sprites only.
- Clamp extreme offsets so broken metadata cannot throw artwork far outside the cage.

**Acceptance criteria**

- Non-floating or missing bounds return zero offset.
- Floating bounds above centre produce a downward visual offset when appropriate.
- Tests cover centred sprites, bottom-grounded sprites, hover sprites, and malformed/zero-size bounds.

## 009 — Centre floating sprites in the Pokédex sprite frame

Status: DONE

**Commit size:** Pokédex component/style change only.

- Pass visual-bounds metadata from `usePokedexBrowser` through `PokedexEntryDetail`, `PokedexProfileColumn`, and `PokedexProfileSpriteFrame`.
- Update `PokedexProfileSpriteFrame.vue` to compute CSS variables from the shared helper.
- Update `pokedexDetail.css` so the `<img>` uses `transform: translate(...)` to align the visible body centre with the cage centre.
- Keep non-floating sprites visually unchanged.

**Acceptance criteria**

- Floating Pokémon shift inside the Pokédex cage so their body centre is visually centred.
- Grounded Pokémon keep the current centered-canvas behaviour.
- Missing sprites and missing metadata render as before.

## 010 — Carry visual bounds into spawned Pokémon render state

Status: DONE

**Commit size:** data plumbing for map tokens only.

- Ensure `SpawnedPokemon` carries front and back visual-bounds metadata from catalog entries.
- Update `PokemonRenderSpawnState` and `PokemonRenderObject` types to remember the active bounds.
- Update `updatePokemonRenderObjectFromSpawn` so metadata changes propagate without recreating the token.
- Do not change positioning yet in this ticket.

**Acceptance criteria**

- Render objects contain visual-bounds metadata after creation and after spawn updates.
- Existing tests that build minimal spawned Pokémon continue to pass with optional fields.

## 011 — Apply visual-only map offsets to sprite and halo

Status: DONE

**Commit size:** map-renderer positioning change plus tests.

- In `applyPokemonRenderObjectPosition`, compute a visual Y offset from the active sprite bounds and token dimensions.
- Apply the offset only to `renderObject.sprite` and `renderObject.spriteState.halo`.
- Leave `volume`, `edges`, `proxy`, `combatStageGlass`, and `shadow` positioned from the unmodified token centre.
- Ensure selection lift and motion polish compose on top of the visual offset rather than replacing it.

**Acceptance criteria**

- Floating sprites appear centred in the tactical cage.
- The cage, picking proxy, contact shadow, and targeting footprint do not move.
- Unit tests assert sprite/halo move while cage/proxy/shadow remain anchored.

## 012 — Choose front/back bounds when facing changes

Status: DONE

**Commit size:** facing-specific metadata selection only.

- Extend the sprite-facing update path so the render object knows whether the front or back asset is active.
- Use back visual bounds when the back sprite is selected and front visual bounds otherwise.
- If the active facing has no bounds, fall back to front bounds only when the asset canvas is known to be equivalent; otherwise use zero offset.
- Keep horizontal mirroring unaffected because mirroring should not change vertical body-centre alignment.

**Acceptance criteria**

- Turning a token to a back-facing sprite does not apply incorrect front-only vertical offsets.
- Pokémon without back sprites or back metadata remain stable.
- Existing facing/mirroring tests continue to pass.

## 013 — Keep HUD/head placement visually attached

Status: TODO

**Commit size:** HUD positioning adjustment only.

- Update HP/status-bar placement so it uses the visual sprite top after applying the floating offset.
- Avoid moving elevation badges unless visual QA shows they should follow the artwork; the elevation badge represents tactical elevation, not sprite body position.
- Add tests covering selected-token lift plus visual sprite offset so the status bar does not accumulate or drift.

**Acceptance criteria**

- HP/status bars stay close to the visible sprite head for floating Pokémon.
- Selected-token lift still raises the sprite and HUD together.
- Grounded Pokémon HUD placement remains unchanged.

## 014 — Add a visual QA/dev overlay for body bounds

Status: TODO

**Commit size:** optional debug UI guarded behind a dev flag.

- Add a temporary or dev-only way to inspect sprite canvas centre, visual bbox, body centre, and final cage centre.
- This can be a Pokédex-only overlay, a query-param flag, or a small internal debug component.
- Make it easy to identify species that need manual overrides.

**Acceptance criteria**

- The overlay is not visible in normal use.
- A developer can quickly compare body centre vs cage centre for a selected species.
- The overlay can be removed or left guarded after QA.

## 015 — Final QA, overrides, and cleanup

Status: TODO

**Commit size:** polish/data cleanup only.

- Review representative grounded, flying, levitating, ghost, fish, winged, and unusually wide Pokémon.
- Add manual overrides for species whose alpha bbox does not match perceived body centre.
- Remove temporary debug code if it was not designed to remain.
- Update any nearby comments so future maintainers understand that offsets are visual-only.

**Acceptance criteria**

- Floating Pokémon read as centred in the sprite cage and map cage.
- Grounded Pokémon still read as planted.
- Tactical interaction semantics remain unchanged.
- Typecheck and relevant unit tests pass.
