# Cosmetic improvements tickets

This document breaks the token-cosmetic work into commit-sized tickets. The goal is to make Pokémon sprites look more natural and three-dimensional while removing the always-on cage clutter.

## Target visual model

A rendered Pokémon token should be composed of four separate visual ideas:

1. **Sprite** — the Pokémon art itself. This remains the primary visual.
2. **Contact shadow** — the ground/planted cue. This should stay visible whenever tokens and shadows are visible.
3. **Cage** — the footprint/clearance/tactical box. This should be hidden by default and shown only when tactically useful.
4. **Sprite isometric shading** — an always-on fake-lighting treatment that gives the sprite a top/side/front dimensional read even when the cage is hidden.

The cage must no longer carry the responsibility for making the Pokémon look 3D. It should become tactical scaffolding only.

## Release note

Map renderer polish: idle Pokémon tokens now rely on sprite art, halos, contact shadows, and persistent sprite-local isometric shading for their planted 3D read. Cage faces and edges are hidden by default and return only as tactical footprint/clearance affordances for hover, selection, live-play feedback, remote attention, and targeting states where they improve clarity.

## Non-goals

- Do not change Pokémon placement, movement, targeting, combat automation, saved map data, or network payloads.
- Do not remove the invisible proxy mesh used for token picking.
- Do not remove contact shadows.
- Do not replace the existing sprite assets.
- Do not add bespoke per-Pokémon art direction or per-species lighting rules in this pass.

## Suggested implementation order

1. Split cage visibility from token visibility.
2. Hide idle cages while preserving sprite, shadow, halo, HUD, and proxy behaviour.
3. Add persistent sprite isometric shading.
4. Re-tune tactical cage opacity once the always-on cage is gone.
5. Add tests and a manual visual review checklist.

---

## COS-001 — Define token cosmetic layer semantics

**Intent:** Make the four token visual ideas explicit before changing renderer behaviour.

**Scope:**

- Add a short internal comment block or helper types describing the token cosmetic layers:
  - sprite;
  - contact shadow;
  - cage volume/edges;
  - sprite isometric shading.
- Prefer colocating this near `PokemonRenderObject` in `src/utils/isometric/types.ts` or near construction in `src/utils/isometric/tokenRenderer.ts`.
- Keep this as documentation/types only; no visual behaviour should change in this commit.

**Acceptance criteria:**

- A future reader can tell that cage visibility and sprite shading are intentionally separate concerns.
- No runtime behaviour changes.
- Existing tests pass.

---

## COS-002 — Track cage visibility separately from token layer visibility

**Intent:** Let a token be visible while its cage is hidden.

**Scope:**

- Add renderer-owned cage visibility state to `PokemonRenderObject`, for example `cageVisible: boolean` or `cageMode: 'hidden' | 'tactical' | 'invalid'`.
- Update `setPokemonRenderObjectLayerVisibility()` so `volume` and `edges` use both token-layer visibility and the renderer-owned cage state.
- Keep these behaviours independent:
  - `sprite.visible = layers.tokens`;
  - `spriteState.halo.visible = layers.tokens`;
  - `proxy.visible = layers.tokens`;
  - `shadow.visible = layers.tokens && layers.shadows`;
  - `volume.visible = layers.tokens && cageVisible`;
  - `edges.visible = layers.tokens && cageVisible`.

**Acceptance criteria:**

- Hiding the cage does not hide the sprite.
- Hiding the cage does not hide the contact shadow.
- Hiding the cage does not break pointer picking through the invisible proxy.
- The existing token layer toggle still hides the whole token stack.

---

## COS-003 — Hide idle cages by default

**Intent:** Remove the acrylic-box look from normal Pokémon tokens.

**Scope:**

- Update `paintPokemonRenderObjectStyle()` so idle, non-hovered, non-selected, non-pending, non-corrected tokens set cage visibility to hidden.
- Keep cage materials and opacity calculations available for tactical states.
- Do not delete the cage geometry; only hide the render objects when idle.

**Suggested tactical visibility rule:**

```ts
const cageVisible = selected || hovered || pending || corrected
```

This can be expanded later for explicit targeting states if those states are passed into the token style function.

**Acceptance criteria:**

- Normal idle tokens render as sprite + halo + contact shadow, with no visible cage faces or cage edges.
- Hovered tokens show a cage.
- Selected tokens show a cage.
- Pending/corrected live-play feedback still shows a cage.
- No token picking regression.

---

## COS-004 — Preserve contact shadows as the always-on grounding cue

**Intent:** Make it difficult to accidentally tie contact shadows to cage visibility in future refactors.

**Scope:**

- Add or update tests around `setPokemonRenderObjectLayerVisibility()` covering these cases:
  - `layers.tokens = true`, `layers.shadows = true`, `cageVisible = false` keeps the shadow visible;
  - `layers.tokens = true`, `layers.shadows = false` hides the shadow;
  - `layers.tokens = false` hides the shadow even if `layers.shadows = true`.
- Add a short comment near the shadow visibility assignment explaining that contact shadow is the persistent sprite-grounding cue, not part of the cage.

**Acceptance criteria:**

- Tests prove cage visibility cannot hide contact shadows.
- Manual check: an idle Pokémon still feels planted on the board with cages hidden.

---

## COS-005 — Introduce sprite isometric shading constants

**Intent:** Define the desired fake-lighting model before wiring it into rendering.

**Scope:**

- Add a small utility module, for example `src/utils/isometric/worldSpriteIsoLighting.ts`.
- Define named constants for the sprite-lighting shape, such as:
  - top brightness boost;
  - lower/front darkening;
  - side-to-side bias;
  - foot/base darkening;
  - minimum and maximum clamp values.
- Keep values subtle. This layer should make sprites feel dimensional, not visibly recoloured.

**Initial tuning target:**

```ts
topBoost: 1.08 to 1.14
lowerShade: 0.84 to 0.94
sideBias: 0.94 to 1.02
footShade: 0.78 to 0.90
```

**Acceptance criteria:**

- Constants are named around visual intent rather than magic numbers.
- No visual behaviour changes yet unless this ticket is intentionally combined with COS-006.
- Existing tests pass.

---

## COS-006 — Apply persistent isometric shading to normal sprites

**Intent:** Keep the top/side/front 3D read after cages disappear.

**Scope:**

- Extend the normal world sprite material so it applies a subtle UV-based lighting ramp to the Pokémon sprite.
- The effect should be always-on for normal tokens and should stack with the existing global sprite brightness.
- The effect should approximate:
  - upper pixels slightly brighter;
  - lower/front pixels slightly darker;
  - one lateral side subtly darker or warmer/cooler;
  - feet/base area slightly grounded.
- Prefer implementing this in the existing sprite material path rather than creating a visible cage surrogate.

**Implementation note:**

A good approach is to use a material shader hook or equivalent sprite-material extension that multiplies sampled sprite colour by a small UV-based lighting factor. Avoid a separate rectangular overlay unless it clips cleanly to sprite alpha; a visible rectangle around transparent sprite pixels would be worse than the cage.

**Acceptance criteria:**

- With cages hidden, sprites still have a visible but subtle top/side/front dimensional treatment.
- Transparent pixels around the sprite remain transparent.
- The effect respects existing sprite brightness updates.
- Ghost/invalid preview sprites continue to use their existing ghost/invalid visual language unless deliberately tuned in a later ticket.

---

## COS-007 — Keep sprite shading correct across animation, crop, and facing

**Intent:** Ensure the new sprite shading follows the same lifecycle as the sprite asset.

**Scope:**

- Verify shading still works when:
  - a static sprite texture loads;
  - an animated sprite frame changes;
  - a cropped sprite texture window is applied;
  - side-facing sprites are mirrored;
  - front/back sprite assets swap as the camera/facing changes.
- Add focused tests around the sprite texture/animation state if practical.
- If implementation uses uniforms, make sure mirror/facing changes update those uniforms when `updateSpriteFacing()` runs.

**Acceptance criteria:**

- Animated sprites do not lose the lighting ramp between frames.
- Mirrored sprites do not produce an obviously backwards or inconsistent side-lighting artefact.
- Cropped sprites do not shift the lighting ramp into the wrong part of the image.
- Existing sprite loading and disposal behaviour remains unchanged.

---

## COS-008 — Re-tune tactical cage face and edge opacity

**Intent:** Make cages feel like temporary tactical affordances rather than permanent display cases.

**Scope:**

- Once idle cages are hidden, re-tune the visible tactical cage states in `paintPokemonRenderObjectStyle()`.
- Keep the existing face palette idea: top, side, shadow, and bottom should remain distinct.
- Use lower face opacity than the old always-on cage, because the cage now appears only for interaction states.
- Keep edges more prominent than faces for hover/selected targeting readability.

**Suggested first-pass values:**

```ts
hovered face opacity: 0.14 to 0.22
hovered edge opacity: 0.55 to 0.80
selected face opacity: 0.20 to 0.30
selected edge opacity: 0.80 to 0.95
pending face opacity: 0.18 to 0.28
pending edge opacity: 0.70 to 0.90
corrected face opacity: 0.24 to 0.34
corrected edge opacity: 0.90 to 1.00
```

**Acceptance criteria:**

- Hover/selection remains easy to read.
- The Pokémon sprite remains visually dominant.
- Cage face shading still uses separate top/side/shadow values.
- Corrected/invalid feedback remains unmistakable.

---

## COS-009 — Include move-targeting states in cage visibility if needed

**Intent:** Make cages available for tactical targeting states, not only hover/selection.

**Scope:**

- Review move-targeting and move-feedback overlays to decide whether target candidates or selected targets should request cage visibility.
- If useful, pass a compact token tactical state into `paintPokemonRenderObjectStyle()` or a new token-style resolver.
- Keep reticles and existing targeting overlays authoritative; cages should support them, not replace them.

**Acceptance criteria:**

- Targeting UX remains readable with idle cages hidden.
- Candidate/selected target cages only appear when they improve clarity.
- Existing move reticles, hit chance labels, and area overlays remain visually on top.

---

## COS-010 — Add unit coverage for token cosmetic state resolution

**Intent:** Protect the new split between sprite, shadow, cage, and sprite shading.

**Scope:**

- Add tests for the cage visibility resolver introduced in COS-002/COS-003.
- Add tests for layer visibility combinations affecting sprite, shadow, volume, edges, and proxy.
- Add tests for opacity/style outputs where practical.

**Acceptance criteria:**

- Idle state resolves to cage hidden.
- Hovered, selected, pending, and corrected states resolve to cage visible.
- Shadow visibility remains tied to `layers.tokens && layers.shadows`, not cage state.
- Proxy remains available for picking while the cage is hidden.

---

## COS-011 — Add a manual visual QA checklist

**Intent:** Make the final visual pass reviewable without relying on subjective memory.

**Scope:**

- Add a checklist section to this document or a follow-up visual QA note covering:
  - small Pokémon on flat terrain;
  - large Pokémon on flat terrain;
  - Pokémon standing on voxel terrain;
  - selected token;
  - hovered token;
  - pending live-play token;
  - corrected/invalid token;
  - move targeting active;
  - animated sprite;
  - mirrored side-facing sprite;
  - dark and light app themes if both affect the scene.

**Acceptance criteria:**

- The reviewer can compare before/after with cages hidden.
- The reviewer explicitly checks that contact shadows remain visible.
- The reviewer explicitly checks that sprite isometric shading remains visible with cages hidden.
- The reviewer explicitly checks that tactical states still show cages when needed.

### Manual visual QA checklist

Use the same live-play scene, camera angle, zoom level, and token set for before/after comparisons when practical. For idle checks, cages should stay hidden while the sprite, halo, contact shadow, and sprite isometric shading remain visible. For tactical checks, cages should appear only as footprint/clearance affordances and should not obscure the sprite or sit above reticles, hit-chance labels, or area overlays.

- [ ] Small Pokémon on flat terrain: confirm the idle token has no visible cage faces or edges, the contact shadow still plants the sprite, and the subtle top/side/front shading remains visible.
- [ ] Large Pokémon on flat terrain: confirm the larger footprint reads clearly with cages hidden, the shadow scales convincingly, and the sprite remains visually dominant.
- [ ] Pokémon standing on voxel terrain: confirm elevation and terrain edges do not hide the contact shadow or make the shaded sprite look detached from the board.
- [ ] Selected token: confirm the tactical cage appears with readable edges/faces while the Pokémon art remains dominant.
- [ ] Hovered token: confirm the hover cage appears promptly, reads as temporary tactical scaffolding, and disappears when hover leaves.
- [ ] Pending live-play token: confirm pending feedback still shows a tactical cage and remains readable alongside existing live-play overlays.
- [ ] Corrected/invalid token: confirm corrected or invalid feedback is unmistakable and uses the cage as an affordance without replacing the sprite-grounding shadow.
- [ ] Move targeting active: confirm candidate/selected target cages appear only where helpful, while reticles, hit-chance labels, and area overlays remain visually on top.
- [ ] Animated sprite: confirm animation frame changes keep the isometric shading and do not reintroduce idle cage faces or edges.
- [ ] Mirrored side-facing sprite: confirm side-lighting still feels consistent after mirroring and does not visibly flip into a distracting artefact.
- [ ] Dark and light app themes, if both affect the scene: confirm contact shadows, sprite shading, and tactical cage opacity remain readable in each theme.

---

## COS-012 — Clean up comments and release note wording

**Intent:** Align code comments and user-facing language with the final renderer model.

**Scope:**

- Update comments that imply cages are the primary sprite-grounding or 3D illusion mechanism.
- Describe cages as tactical footprint/clearance affordances.
- Describe contact shadows and sprite isometric shading as the persistent visual grounding/dimensional cues.
- Add a short release note if the project has a release-note surface for map renderer polish.

**Acceptance criteria:**

- Comments match the final behaviour.
- No stale wording says idle cages are required for the isometric illusion.
- Existing tests pass.
- The release note above summarizes cages as tactical affordances, with contact shadows and sprite isometric shading as the persistent visual grounding/dimensional cues.
