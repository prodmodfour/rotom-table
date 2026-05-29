# Move animations implementation brief

This brief is the source-of-truth scope document for the Basic Move Animations and reusable VFX layer work. The first phase should make move use feel more responsive on the isometric map through generic, reusable visual effects. It must not attempt full Pokémon-style bespoke choreography for individual moves.

## Goals for this phase

- Add satisfying generic move animations for common self, single-target, and area move flows.
- Build the feature around transient, typed client-side animation events that can be planned by move automation and consumed by the map renderer.
- Reuse the existing Three.js isometric scene, map targeting UI, roll feedback UI, and dirty render scheduler.
- Leave clear extension points for future per-move animation presets without creating those presets now.
- Keep all animation work visual-only unless a later ticket explicitly changes behaviour.

## In-scope generic effects

The initial VFX library may use the following reusable effect families. These are renderer concepts, not promises of unique art for individual move names.

- **Projectile:** a small type-coloured object travelling from the user toward a target.
- **Beam:** a short-lived straight-line energy effect between user and target or area centroid.
- **Arc/lob:** a projectile variant with a bounded vertical arc for thrown or lob-like moves.
- **Melee lunge:** a brief visual nudge toward a target that resets without changing placement.
- **Target flash:** a pulse around an affected target for hit, heal, buff, debuff, status, or neutral outcomes.
- **Impact ring:** an expanding ring at the target or affected cell for impact readability.
- **Self aura:** a pulse centred on the move user for self-originating moves.
- **Healing pulse:** a semantic healing effect for HP restoration.
- **Buff/debuff particles:** simple rising/falling particles or rings for combat-stage and similar effects.
- **Status cloud:** a generic condition/status visual that does not require condition-specific art.
- **Area pulse:** a short pulse over affected grid cells after area confirmation.
- **Line/cone sweep:** a directional cell sequence for line-like and cone-like area moves.
- **Dash/pass afterimage:** a movement-path cue for movement-like move outcomes.
- **Miss puff:** a neutral understated effect near or just past the target for misses.
- **Crit burst:** a short extra accent for critical hits.

## Out of scope

The following are explicitly deferred or prohibited for this implementation phase:

- Unique per-move animation choreography such as a custom Thunderbolt, Flamethrower, or Solar Beam sequence.
- Imported copyrighted animation assets, sprite sheets, model packs, or copied game animation data.
- Audio.
- Server persistence, map JSON persistence, sheet persistence, campaign/session persistence, or migrations for transient VFX events.
- Gameplay rule changes, damage changes, accuracy changes, status changes, permission changes, or targeting rule changes caused by animation code.
- New network protocols or realtime message types solely for transient VFX.

Future bespoke per-move work should be planned as a later milestone, should reuse the generic primitives where practical, and must respect the repository fan-project notice and asset boundaries.

## Desired user experience

### Single-target moves

A user should select and resolve a target through the existing move automation flow. Once the move is actually resolved, the map should play a concise visual sequence that makes the outcome legible:

1. A launch or contact cue starts at the user's token when appropriate.
2. The effect travels, beams, lunges, or otherwise points toward the selected target.
3. Hit outcomes show target flash and/or impact styling.
4. Miss outcomes show a miss puff and do not use damaging impact styling by default.
5. Critical hits add a brief crit burst on top of the normal hit read.
6. Healing, status, buff, or debuff outcomes use semantic follow-up effects when transaction data supports that classification.

The existing roll feedback and targeting overlays must remain readable; animation should enhance the flow, not replace the current feedback UI.

### Self and immediate moves

Self-targeting or immediately resolving moves should not require a fake target just to animate. They should use a self-centred aura, healing pulse, buff/debuff particles, status cloud, or neutral pulse according to the move metadata and transaction outcome. These animations should be brief enough that immediate move use still feels fast.

### Area moves

Area moves should keep the existing map-native area confirmation workflow. After confirmation, affected cells should receive an area pulse or directional sweep, and affected tokens may receive follow-up target flashes or semantic effects. The VFX layer should not imply that excluded or unaffected targets were hit unless the planner intentionally marks them as affected.

### Movement-like outcomes

Moves with pass/dash destination data may add a path or afterimage cue, but actual placement remains controlled by the existing move automation transaction logic. The VFX must never save a temporary offset as token placement.

## Visual quality and style guardrails

Move VFX should look like part of the existing dark tactical map: luminous, concise, semi-transparent, and world-anchored. Effects should support the token sprites, cages, HP bars, targeting reticles, area templates, roll feedback, weather, hazards, and field effects instead of competing with them.

### Default timing tiers

Use these tiers as the initial implementation defaults. Individual primitives may tune within the ranges, but a normal move resolution should usually settle within about 1.2 seconds and should not linger just to feel more dramatic.

| Tier | Default range | Use for |
| --- | ---: | --- |
| **Quick** | 180-320 ms | Target flashes, impact rings, miss puffs, crit accents, one-shot semantic pulses. |
| **Medium** | 450-700 ms | Projectiles, beams, arcs/lobs, melee lunges, self auras, healing/status/buff pulses, area cell pulses. |
| **Long** | 850-1200 ms | Multi-target stagger sequences, dash/pass afterimages, line/cone sweeps, larger radial bursts, and combined launch-plus-follow-up sequences. |

Long effects should still feel table-snappy. Prefer short start offsets and capped staggering over extending every target effect. Follow-up semantic effects should be delayed only enough to read after the launch/impact cue.

### Opacity, scale, glow, and render order

- **Opacity:** Use transparent VFX materials by default. Most broad ground/cell overlays should peak around 18-40% opacity; body flashes and rings around 35-70%; projectile cores may be brighter but should remain small; trails, puffs, and afterimages should fade through 15-45%. Avoid full-screen or fully opaque effects.
- **Scale:** Scale to map space, not to a move name. Projectile cores should be small relative to a grid cell, beams should stay narrow enough to show the target beneath, target rings should start near the token footprint and expand modestly, and area overlays should stay inside or just within each affected cell. Large tokens may scale effects from token footprint/height, but the effect should not cover adjacent unrelated tokens by default.
- **Glow:** Prefer simple emissive colours, additive-looking transparent layers, or duplicated soft shells over expensive post-processing. Glow should improve readability on dark terrain without washing out token sprites, HP bars, status glass, targeting reticles, or roll feedback.
- **Render order:** Keep VFX in predictable layers. Ground/cell effects should render above terrain, hazards, and field-effect surfaces but below or behind CSS3D HUD/feedback. Body, projectile, and beam effects may render above token geometry for readability, with `depthTest` enabled where practical and `depthWrite` disabled for transparent materials. Use named render-order constants when implemented; do not scatter magic numbers through primitives. If active targeting or roll feedback would be obscured, lower opacity, sequence the VFX after confirmation, or shorten the effect rather than hiding existing UI.
- **Pointer behaviour:** VFX objects are visual only and must not intercept map pointer interactions, targeting clicks, context menus, or camera controls.

### Type-coloured versus neutral or semantic colour

Use type colour when it helps players connect a damaging or typed move to the effect without bespoke art. Use semantic or neutral colour when type colour would mislead the outcome.

| Situation | Colour rule |
| --- | --- |
| Damaging projectile, beam, arc, melee impact, or damaging area pulse | Use the move type colour as the primary hue, with a neutral outline/core if contrast needs help. |
| Healing or HP restoration | Prefer the healing semantic palette even if the move has a type, unless a future explicit override asks for type emphasis. |
| Buffs, debuffs, combat-stage changes, and status/condition effects | Prefer semantic buff/debuff/status colours so the outcome reads correctly. |
| Misses, avoided targets, cancelled/failed flows | Use neutral understated styling; do not show damaging impact colours. |
| Critical hits | Add a brief crit accent that can sit on top of the type-coloured hit without replacing it. |
| Unknown, custom, or low-contrast types | Fall back to the neutral readable palette rather than throwing or producing a near-invisible effect. |

The palette added in later implementation tickets should be tuned for readability on dark map backgrounds, not for exact official type-colour purity.

### Token layer visibility

Move VFX should follow the token layer by default because most effects are anchored to token users, targets, token HUD context, or token-derived outcomes. If the token layer is hidden:

- new token-anchored move VFX should be skipped or hidden rather than revealing action around hidden tokens;
- active VFX should become invisible immediately, continue aging, and dispose normally instead of freezing until the layer is shown again;
- restoring the token layer should not resurrect completed effects;
- area-only confirmation effects should also remain hidden for this basic move-animation phase unless a later ticket explicitly gives non-token field/hazard confirmations their own visibility rule.

### Reduced-motion alternatives

Reduced-motion mode should preserve outcome readability while removing fast travel, large displacement, repeated oscillation, and shake.

| Effect family | Default animation | Reduced-motion alternative |
| --- | --- | --- |
| Projectile / arc / lob | Object travels from user to target, optionally with a small trail or bounded arc. | Skip travel; show a brief source flash followed by a target or miss pulse. |
| Beam | Line appears, holds briefly, then fades with modest thickness animation. | Show a static short fade or replace with target pulse if the line would feel too active. |
| Melee lunge / dash / pass afterimage | Visual offset, streak, or afterimage moves along a path. | Disable displacement/path motion; use a small contact flash or destination pulse. |
| Target flash / impact ring / miss puff / crit burst | Scale and opacity pulse around the target or nearby miss point. | Keep a single low-amplitude fade/pulse with reduced scale expansion. |
| Self aura / healing / buff / debuff / status | Rings, particles, motes, or clouds rise/orbit/pulse around the token. | Use one soft opacity pulse or short-lived ring; avoid orbiting/rising particle motion. |
| Area pulse / radial burst / line-cone sweep | Cells pulse, burst outward, or light sequentially through the area. | Fade affected cells in and out together; avoid directional sweep or large radial expansion. |
| Shake / repeated afterimages | Subtle impact shake or repeated ghost images. | Disable entirely. |

Reduced-motion variants should use the same semantic colour choices and should still complete through the same transient VFX lifecycle as default animations.

## Visual-only rule

Move animations are display-only. They may make an already-resolved or currently resolving move easier to read, but they must not be the source of truth for mechanics. In particular:

- Animation events must not mutate saved map, sheet, trainer, encounter, campaign, or session data.
- Animation events must not be serialized into map JSON or sheet JSON.
- Animation code must not decide whether a move hits, misses, crits, damages, heals, applies status, or moves a token.
- Existing move automation and permission checks remain authoritative.
- If animation planning or rendering fails, the move should still resolve according to the existing automation flow.

Move usage logs may continue to mention the move and its mechanical results through existing logging paths. The transient VFX event itself is not a log entry.

## Technical guardrails and non-regression rules

Renderer, scheduler, primitive, and move-automation integration tickets must reference this section in their implementation notes before changing map rendering code. These rules are guardrails for the entire move VFX layer, not polish preferences.

### Scheduler integration

- Move VFX must use the existing dirty isometric render scheduler documented in `docs/render-scheduler-architecture.md`.
- Do not add a separate always-on `requestAnimationFrame`, `setInterval`, timeout loop, or component-local animation loop for move animations.
- Adding, removing, or syncing VFX events should request a focused scheduled scene frame through the same invalidation path used by other map renderer changes.
- Active VFX may keep frames alive only by participating in the existing animation-continuation model. The planned renderer contract should expose whether it still needs another frame, for example through `needsAnimationFrame()` or an equivalent resolver used by `resolveSceneAnimationContinuation()`.
- The continuation source must become inactive as soon as all VFX instances are complete, hidden-and-aged-out, removed, or disposed so an idle map returns to one-shot rendering.
- VFX that only changes WebGL objects should not force CSS3D renders. If a later badge or CSS3D primitive is added, it must mark CSS3D dirty only when that CSS output changes.

### Renderer quality and map behaviour

- Renderer quality must not be degraded to pay for move VFX. Do not lower device pixel ratio caps, canvas resolution, antialiasing, renderer precision, shadow/lighting assumptions, terrain visibility, token quality, weather, hazards, field effects, targeting overlays, or HUD behaviour.
- Performance work should reduce duplicate work, allocations, or idle frames; it must not hide existing visuals or disable map features.
- VFX objects are decorative and must not intercept pointer picking, map editing, camera controls, targeting clicks, context menus, or token controls.
- Existing permission, visibility, targeting, roll-feedback, movement-preview, field-effect, weather, and layer-visibility behaviours remain authoritative. If VFX conflicts visually, tune opacity, duration, render order, or sequencing rather than weakening existing UI.

### Lifecycle and disposal

- Every VFX instance must own or explicitly share its Three.js resources with a documented disposal policy.
- Meshes, groups, geometries, materials, textures, CSS3D elements, and event listeners created for VFX must be disposed or detached when the effect completes, when its event is removed from the active queue, when the map scene unmounts, and when map data changes or the scene rebuilds.
- Disposal must be idempotent: repeated completion, removal, unmount, or scene-reset cleanup should be safe and should not throw.
- Hidden-tab pause/resume and layer-hidden cases must not freeze VFX forever. Effects should either age out or resume under a documented policy and then release their resources.
- Development metrics may expose active counts or snapshots, but production animation paths should avoid per-frame debug allocations unless debug mode is explicitly enabled.

### Data and mechanics boundary

- `MoveAnimationEvent` objects are transient client-side display requests. They must not be serialized into map JSON, sheet JSON, trainer JSON, campaign/session state, local runtime state, or server API payloads unless a future ticket explicitly changes the architecture.
- VFX code must not directly mutate saved token placement, HP, combat stages, statuses, hazards, weather, field effects, move usage logs, or permissions.
- The only allowed saved-state mutations during an animated move are the existing move automation transactions and logging paths that would have run without VFX.
- Temporary visual offsets such as melee lunges, shakes, dash afterimages, or impact pulses must reset every frame or live in VFX-owned overlay objects; they must never be persisted as token placement.
- Animation planning and rendering failures must be no-op safe. A bad palette lookup, missing token render object, deleted target, empty area cell list, or renderer disposal race must not prevent the move automation flow from resolving.

### Implementation note checklist for later tickets

For each later renderer or integration ticket, include a brief note in code comments, tests, docs, or the PR summary confirming:

1. which scheduler invalidation or continuation path the change uses;
2. how the renderer reports whether another animation frame is needed;
3. why renderer quality and existing map visuals are unchanged;
4. when created VFX resources are disposed;
5. why no saved map, sheet, session, or campaign data is mutated by the VFX layer.

## Architecture direction

The implementation should follow this one-way data flow:

```text
useMoveAutomationPanel
  -> pure move animation planner
  -> per-map transient animation queue
  -> MapSceneRenderer moveAnimations prop
  -> IsometricGrid.client.vue
  -> createMoveVfxRenderer
  -> existing isometric render scheduler continuation source
```

Key architecture constraints:

- The VFX renderer should be an isolated utility under `src/utils/isometric/`, similar to existing map renderer factories.
- Active VFX should keep rendering alive only through the existing animation-continuation model described in `docs/render-scheduler-architecture.md`.
- No separate always-on `requestAnimationFrame` loop should be added for move animations.
- Renderer quality must not be reduced to pay for VFX. Do not lower DPR, disable antialiasing, remove map features, or simplify weather/field effects.
- VFX objects must be disposed when complete, when removed from the queue, and when the map scene unmounts.

## Expected first implementation files

This brief changes only documentation. As the feature tickets land, the first implementation pass is expected to touch or add the following product files:

| Area | Expected files |
| --- | --- |
| Documentation | `docs/move-animations.md`, later updates to `docs/render-scheduler-architecture.md` when scheduler hooks are added |
| Domain types | `src/types/moveAnimation.ts` |
| Queue/state | `src/composables/map-editor/useMoveAnimationQueue.ts` |
| Planner and palettes | `src/utils/moveAnimationPlanner.ts`, `src/utils/moveAnimationPalette.ts` |
| Timing and anchors | `src/utils/isometric/moveVfxTiming.ts`, `src/utils/isometric/moveVfxAnchors.ts` |
| Renderer | `src/utils/isometric/moveVfxRenderer.ts` plus primitive helpers under `src/utils/isometric/` if split out |
| Render scheduling | `src/utils/isometric/renderLoop.ts`, `src/utils/isometric/animationFrame.ts`, and scheduler-related tests when a VFX continuation source is added |
| Vue prop plumbing | `src/components/IsometricGrid.client.vue`, `src/components/map/MapSceneRenderer.vue`, `src/components/map/MapScenePanel.vue`, `src/pages/maps/[slug].vue` |
| Move automation integration | `src/composables/map-editor/useMoveAutomationPanel.ts` |
| Tests | focused Vitest files for the queue, planner, renderer lifecycle, render-loop continuation, and move automation enqueue integration |

The exact file list may evolve as implementation details are discovered, but product changes should stay in the Rotom Table repository and should not introduce autonomous build-controller files.

## Follow-up documents and decisions

This brief now records the initial scope, visual style guardrails, and technical non-regression rules. Later tickets should refine it with:

- an explicit dependency decision for tweening versus internal math helpers;
- final implemented API details once types, planner, renderer, and settings exist;
- timing, colour, render-order, and reduced-motion adjustments discovered during playable review;
- a manual QA checklist and future bespoke per-move animation backlog.
