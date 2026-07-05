# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Cosmetic Improvements ticket from `docs/cosmetic-improvements.md`; build ticket numbers follow the suggested implementation order from that document.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#012) may also set `AUTOMATION_STATUS: DONE` after all Cosmetic Improvements tickets are complete.

---

# Cosmetic Improvements Tickets

## Wave goal

Make Pokémon sprites look more natural and three-dimensional while removing the always-on cage clutter. The cage should become a tactical footprint/clearance affordance only; the sprite, contact shadow, and sprite isometric shading should carry the idle visual read.

A rendered Pokémon token is composed of four separate visual ideas:

1. **Sprite** — the Pokémon art itself. This remains the primary visual.
2. **Contact shadow** — the ground/planted cue. This should stay visible whenever tokens and shadows are visible.
3. **Cage** — the footprint/clearance/tactical box. This should be hidden by default and shown only when tactically useful.
4. **Sprite isometric shading** — an always-on fake-lighting treatment that gives the sprite a top/side/front dimensional read even when the cage is hidden.

The cage must no longer carry the responsibility for making the Pokémon look 3D. It should become tactical scaffolding only.

## Non-goals for this wave

- Do not change Pokémon placement, movement, targeting, combat automation, saved map data, or network payloads.
- Do not remove the invisible proxy mesh used for token picking.
- Do not remove contact shadows.
- Do not replace the existing sprite assets.
- Do not add bespoke per-Pokémon art direction or per-species lighting rules in this pass.
- Do not broaden this work into unrelated map renderer, live-play, encounter, sheet, or inventory changes.

## Commit sizing rule

Each ticket should fit in one focused commit. Keep documentation/type-only tickets behaviour-free, keep renderer state changes separate from visual tuning where practical, and prefer focused utility tests over broad visual rewrites.

---

## 001 — COS-001 — Define token cosmetic layer semantics

Status: TODO

**Goal:** Make the four token visual ideas explicit before changing renderer behaviour.

**Primary files:**

- `src/utils/isometric/types.ts`
- `src/utils/isometric/tokenRenderer.ts`
- nearby token renderer documentation/comments

**Work:**

- Add a short internal comment block or helper types describing the token cosmetic layers:
  - sprite;
  - contact shadow;
  - cage volume/edges;
  - sprite isometric shading.
- Prefer colocating this near `PokemonRenderObject` in `src/utils/isometric/types.ts` or near construction in `src/utils/isometric/tokenRenderer.ts`.
- Keep this as documentation/types only; no visual behaviour should change in this commit.

**Acceptance:**

- A future reader can tell that cage visibility and sprite shading are intentionally separate concerns.
- No runtime behaviour changes.
- Existing tests pass.

---

## 002 — COS-002 — Track cage visibility separately from token layer visibility

Status: TODO

**Goal:** Let a token be visible while its cage is hidden.

**Primary files:**

- `src/utils/isometric/types.ts`
- `src/utils/isometric/tokenRenderer.ts`
- focused renderer/layer visibility tests

**Work:**

- Add renderer-owned cage visibility state to `PokemonRenderObject`, for example `cageVisible: boolean` or `cageMode: 'hidden' | 'tactical' | 'invalid'`.
- Update `setPokemonRenderObjectLayerVisibility()` so `volume` and `edges` use both token-layer visibility and the renderer-owned cage state.
- Keep these behaviours independent:
  - `sprite.visible = layers.tokens`;
  - `spriteState.halo.visible = layers.tokens`;
  - `proxy.visible = layers.tokens`;
  - `shadow.visible = layers.tokens && layers.shadows`;
  - `volume.visible = layers.tokens && cageVisible`;
  - `edges.visible = layers.tokens && cageVisible`.

**Acceptance:**

- Hiding the cage does not hide the sprite.
- Hiding the cage does not hide the contact shadow.
- Hiding the cage does not break pointer picking through the invisible proxy.
- The existing token layer toggle still hides the whole token stack.

---

## 003 — COS-003 — Hide idle cages by default

Status: TODO

**Goal:** Remove the acrylic-box look from normal Pokémon tokens.

**Primary files:**

- `src/utils/isometric/tokenRenderer.ts`
- `src/utils/isometric/types.ts` if needed
- focused style/cage visibility tests

**Work:**

- Update `paintPokemonRenderObjectStyle()` so idle, non-hovered, non-selected, non-pending, non-corrected tokens set cage visibility to hidden.
- Keep cage materials and opacity calculations available for tactical states.
- Do not delete the cage geometry; only hide the render objects when idle.
- Use the first-pass rule `selected || hovered || pending || corrected` unless the existing architecture offers a clearer tactical-state resolver.

**Acceptance:**

- Normal idle tokens render as sprite + halo + contact shadow, with no visible cage faces or cage edges.
- Hovered tokens show a cage.
- Selected tokens show a cage.
- Pending/corrected live-play feedback still shows a cage.
- No token picking regression.

---

## 004 — COS-004 — Preserve contact shadows as the always-on grounding cue

Status: TODO

**Goal:** Make it difficult to accidentally tie contact shadows to cage visibility in future refactors.

**Primary files:**

- `src/utils/isometric/tokenRenderer.ts`
- focused layer visibility tests

**Work:**

- Add or update tests around `setPokemonRenderObjectLayerVisibility()` covering these cases:
  - `layers.tokens = true`, `layers.shadows = true`, `cageVisible = false` keeps the shadow visible;
  - `layers.tokens = true`, `layers.shadows = false` hides the shadow;
  - `layers.tokens = false` hides the shadow even if `layers.shadows = true`.
- Add a short comment near the shadow visibility assignment explaining that contact shadow is the persistent sprite-grounding cue, not part of the cage.

**Acceptance:**

- Tests prove cage visibility cannot hide contact shadows.
- Manual check: an idle Pokémon still feels planted on the board with cages hidden.

---

## 005 — COS-005 — Introduce sprite isometric shading constants

Status: TODO

**Goal:** Define the desired fake-lighting model before wiring it into rendering.

**Primary files:**

- `src/utils/isometric/worldSpriteIsoLighting.ts` (new, suggested)
- focused utility tests if useful

**Work:**

- Add a small utility module for sprite-lighting constants.
- Define named constants for the sprite-lighting shape, such as:
  - top brightness boost;
  - lower/front darkening;
  - side-to-side bias;
  - foot/base darkening;
  - minimum and maximum clamp values.
- Keep values subtle. This layer should make sprites feel dimensional, not visibly recoloured.
- Use visual-intent names rather than magic numbers.

**Acceptance:**

- Constants are named around visual intent rather than implementation accident.
- No visual behaviour changes yet unless this ticket is intentionally combined with COS-006 because the implementation is trivial.
- Existing tests pass.

---

## 006 — COS-006 — Apply persistent isometric shading to normal sprites

Status: TODO

**Goal:** Keep the top/side/front 3D read after cages disappear.

**Primary files:**

- existing world sprite material utilities
- `src/utils/isometric/worldSpriteIsoLighting.ts`
- renderer/material tests where practical

**Work:**

- Extend the normal world sprite material so it applies a subtle UV-based lighting ramp to the Pokémon sprite.
- Make the effect always-on for normal tokens and stack it with existing global sprite brightness.
- Approximate:
  - upper pixels slightly brighter;
  - lower/front pixels slightly darker;
  - one lateral side subtly darker or warmer/cooler;
  - feet/base area slightly grounded.
- Prefer implementing this in the existing sprite material path rather than creating a visible cage surrogate.
- Avoid a separate rectangular overlay unless it clips cleanly to sprite alpha.

**Acceptance:**

- With cages hidden, sprites still have a visible but subtle top/side/front dimensional treatment.
- Transparent pixels around the sprite remain transparent.
- The effect respects existing sprite brightness updates.
- Ghost/invalid preview sprites continue to use their existing ghost/invalid visual language unless deliberately tuned in a later ticket.

---

## 007 — COS-007 — Keep sprite shading correct across animation, crop, and facing

Status: TODO

**Goal:** Ensure the new sprite shading follows the same lifecycle as the sprite asset.

**Primary files:**

- sprite texture/material lifecycle utilities
- `src/utils/isometric/tokenRenderer.ts`
- focused sprite animation/facing tests where practical

**Work:**

- Verify shading still works when:
  - a static sprite texture loads;
  - an animated sprite frame changes;
  - a cropped sprite texture window is applied;
  - side-facing sprites are mirrored;
  - front/back sprite assets swap as the camera/facing changes.
- Add focused tests around the sprite texture/animation state if practical.
- If implementation uses uniforms, make sure mirror/facing changes update those uniforms when `updateSpriteFacing()` runs.

**Acceptance:**

- Animated sprites do not lose the lighting ramp between frames.
- Mirrored sprites do not produce an obviously backwards or inconsistent side-lighting artefact.
- Cropped sprites do not shift the lighting ramp into the wrong part of the image.
- Existing sprite loading and disposal behaviour remains unchanged.

---

## 008 — COS-008 — Re-tune tactical cage face and edge opacity

Status: TODO

**Goal:** Make cages feel like temporary tactical affordances rather than permanent display cases.

**Primary files:**

- `src/utils/isometric/tokenRenderer.ts`
- focused token style tests where practical

**Work:**

- Once idle cages are hidden, re-tune the visible tactical cage states in `paintPokemonRenderObjectStyle()`.
- Keep the existing face palette idea: top, side, shadow, and bottom should remain distinct.
- Use lower face opacity than the old always-on cage, because the cage now appears only for interaction states.
- Keep edges more prominent than faces for hover/selected targeting readability.
- Start from these suggested ranges and adjust only as needed:
  - hovered face opacity: `0.14` to `0.22`;
  - hovered edge opacity: `0.55` to `0.80`;
  - selected face opacity: `0.20` to `0.30`;
  - selected edge opacity: `0.80` to `0.95`;
  - pending face opacity: `0.18` to `0.28`;
  - pending edge opacity: `0.70` to `0.90`;
  - corrected face opacity: `0.24` to `0.34`;
  - corrected edge opacity: `0.90` to `1.00`.

**Acceptance:**

- Hover/selection remains easy to read.
- The Pokémon sprite remains visually dominant.
- Cage face shading still uses separate top/side/shadow values.
- Corrected/invalid feedback remains unmistakable.

---

## 009 — COS-009 — Include move-targeting states in cage visibility if needed

Status: TODO

**Goal:** Make cages available for tactical targeting states, not only hover/selection.

**Primary files:**

- `src/pages/maps/[slug].vue`
- `src/utils/isometric/tokenRenderer.ts`
- move-targeting overlay/style utilities
- focused map renderer tests where practical

**Work:**

- Review move-targeting and move-feedback overlays to decide whether target candidates or selected targets should request cage visibility.
- If useful, pass a compact token tactical state into `paintPokemonRenderObjectStyle()` or a new token-style resolver.
- Keep reticles and existing targeting overlays authoritative; cages should support them, not replace them.

**Acceptance:**

- Targeting UX remains readable with idle cages hidden.
- Candidate/selected target cages only appear when they improve clarity.
- Existing move reticles, hit chance labels, and area overlays remain visually on top.

---

## 010 — COS-010 — Add unit coverage for token cosmetic state resolution

Status: TODO

**Goal:** Protect the new split between sprite, shadow, cage, and sprite shading.

**Primary files:**

- focused token cosmetic state tests
- `src/utils/isometric/tokenRenderer.ts`
- helper modules introduced by earlier tickets

**Work:**

- Add tests for the cage visibility resolver introduced in COS-002/COS-003.
- Add tests for layer visibility combinations affecting sprite, shadow, volume, edges, and proxy.
- Add tests for opacity/style outputs where practical.

**Acceptance:**

- Idle state resolves to cage hidden.
- Hovered, selected, pending, and corrected states resolve to cage visible.
- Shadow visibility remains tied to `layers.tokens && layers.shadows`, not cage state.
- Proxy remains available for picking while the cage is hidden.

---

## 011 — COS-011 — Add a manual visual QA checklist

Status: TODO

**Goal:** Make the final visual pass reviewable without relying on subjective memory.

**Primary files:**

- `docs/cosmetic-improvements.md`
- optional renderer visual QA documentation if a better home exists

**Work:**

- Add a checklist section covering:
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

**Acceptance:**

- The reviewer can compare before/after with cages hidden.
- The reviewer explicitly checks that contact shadows remain visible.
- The reviewer explicitly checks that sprite isometric shading remains visible with cages hidden.
- The reviewer explicitly checks that tactical states still show cages when needed.

---

## 012 — COS-012 — Clean up comments and release note wording

Status: TODO

**Goal:** Align code comments and user-facing language with the final renderer model.

**Primary files:**

- renderer comments and documentation touched by this wave
- release-note or README surface if one exists
- `docs/cosmetic-improvements.md` if it remains the best summary

**Work:**

- Update comments that imply cages are the primary sprite-grounding or 3D illusion mechanism.
- Describe cages as tactical footprint/clearance affordances.
- Describe contact shadows and sprite isometric shading as the persistent visual grounding/dimensional cues.
- Add a short release note if the project has a release-note surface for map renderer polish.

**Acceptance:**

- Comments match the final behaviour.
- No stale wording says idle cages are required for the isometric illusion.
- Existing tests pass.
- If all Cosmetic Improvements tickets are complete and the final quality gate passes, set `AUTOMATION_STATUS: DONE`.

---

## Suggested implementation order

1. `COS-001`
2. `COS-002`
3. `COS-003`
4. `COS-004`
5. `COS-005`
6. `COS-006`
7. `COS-007`
8. `COS-008`
9. `COS-009`
10. `COS-010`
11. `COS-011`
12. `COS-012`

## Wave exit criteria

- Idle Pokémon tokens render without visible cage faces or cage edges.
- Sprites, halos, invisible picking proxies, and contact shadows continue to work when cages are hidden.
- Hovered, selected, pending, corrected, and useful targeting states can still show cages as tactical affordances.
- Contact shadows remain independent from cage visibility.
- Normal sprites have subtle persistent isometric shading that respects transparency, brightness, animation, crop, and facing lifecycle.
- Tactical cage opacity is tuned so the sprite remains visually dominant.
- Unit coverage protects layer visibility, cage visibility resolution, and relevant style/shading helpers.
- Manual visual QA covers small/large Pokémon, terrain, interaction states, targeting, animation, mirroring, and theme-relevant scene checks.
