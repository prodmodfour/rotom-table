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
- **Target flash:** a pulse around an affected target for hit, heal, buff, debuff, status, or neutral outcomes; damaging hit flashes may opt into a subtle VFX-owned shake cue.
- **Impact ring:** an expanding ring at the target or affected cell for impact readability.
- **Self aura:** a pulse centred on the move user for self-originating moves.
- **Healing pulse:** a semantic healing effect for HP restoration.
- **Buff/debuff particles:** simple rising/falling particles or rings for combat-stage and similar effects.
- **Status cloud:** a generic condition/status visual that does not require condition-specific art.
- **Optional text/symbol badge:** a restrained CSS3D label such as `Buff`, `Status`, `Heal`, or a compact condition name only when a planner/event explicitly asks for one.
- **Area pulse:** a short pulse over affected grid cells after area confirmation.
- **Radial burst:** a center-out ring/ray accent for burst or blast-style area confirmations.
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

### Optional badge evaluation

Existing roll feedback, target flashes, status clouds, buff/debuff particles, healing pulses, HP/status HUD, and combat-stage glass provide the primary read for most non-damage outcomes. Text badges therefore remain disabled by default to avoid cluttering crowded tactical maps. The renderer supports a lightweight badge primitive only for future planners or overrides that explicitly request a short `badge` event with a readable label. Empty labels, missing DOM support, and missing anchors no-op safely.

Badge labels are normalized to one compact line, capped at 12 glyphs, rendered as CSS3D sprites with `pointer-events: none`, and anchored above the affected token or target cell. They use the semantic/palette colours supplied by the event and live inside the same transient VFX lifecycle as every other primitive. Because badges are the only CSS3D move VFX, the renderer reports `needsCss3DFrame()` only while badge instances are active; generic WebGL move VFX still skip CSS3D rendering.

### Self and immediate moves

Self-targeting or immediately resolving moves should not require a fake target just to animate. They should use a self-centred aura, healing pulse, buff/debuff particles, status cloud, or neutral pulse according to the move metadata and transaction outcome. These animations should be brief enough that immediate move use still feels fast.

### Area moves

Area moves should keep the existing map-native area confirmation workflow. After confirmation, affected cells should receive an area pulse or directional sweep, and affected tokens may receive follow-up target flashes or semantic effects. The VFX layer should not imply that excluded or unaffected targets were hit unless the planner intentionally marks them as affected.

### Movement-like outcomes

Moves with pass/dash destination data may add a path or afterimage cue, but actual placement remains controlled by the existing move automation transaction logic. The VFX must never save a temporary offset as token placement.

### Optional target shake

Damaging hit target flashes can request `shake: true` for a short impact cue. The renderer implements this as a tiny offset on the VFX-owned target-flash group only; it never moves the actual token render object, saved placement, targeting state, HP/status HUD, or map data. Multiple simultaneous shake requests therefore remain isolated per VFX instance, and reduced-motion rendering disables the shake while keeping the normal target flash.

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

The shared palette lives in `src/utils/moveAnimationPalette.ts`. It is tuned for readability on dark map backgrounds, not for exact official type-colour purity, and renderer primitives should use `moveVfxColorForType()` or `moveVfxColorForTone()` instead of duplicating hue tables.

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

### Primitive-level reduced-motion implementation

`src/utils/isometric/moveVfxRenderer.ts` accepts a `reducedMotion` hint during `sync()` and each scheduler-driven `animate()` call. The Vue bridge exposes this as an optional `moveAnimationsReducedMotion` prop on `IsometricGrid.client.vue`, `MapSceneRenderer.vue`, and `MapScenePanel.vue`, so later app settings or `prefers-reduced-motion` wiring can opt into the variants without changing the primitive API.

Current primitive behaviour in reduced-motion mode:

- projectile and arc/lob effects skip travel and trails, then show one compact type-coloured pulse at the target/cell anchor;
- beam effects hide the animated line and use a target-end pulse ring;
- melee lunge and dash/pass effects hide ghost/streak/afterimage travel and keep only contact or destination pulses;
- target flash, impact ring, miss puff, and crit burst keep low-amplitude fade/pulse feedback while disabling shake, drifting clouds, and starburst spokes;
- self aura, healing, buff/debuff, and status effects collapse rising/orbiting particles into a single soft ring pulse;
- area pulse, radial burst, and line/cone sweep avoid directional or large outward motion by using all-at-once smaller cell/ring pulses.

Default animations remain unchanged when `reducedMotion` is false or omitted. The automatic OS preference hook and any user-facing enable/disable setting remain scoped to later controls/accessibility tickets; this ticket establishes the primitive variants and typed prop path only.

## Visual-only rule

Move animations are display-only. They may make an already-resolved or currently resolving move easier to read, but they must not be the source of truth for mechanics. In particular:

- Animation events must not mutate saved map, sheet, trainer, encounter, campaign, or session data.
- Animation events must not be serialized into map JSON or sheet JSON.
- Animation code must not decide whether a move hits, misses, crits, damages, heals, applies status, or moves a token.
- Existing move automation and permission checks remain authoritative.
- If animation planning or rendering fails, the move should still resolve according to the existing automation flow.

Move usage logs may continue to mention the move and its mechanical results through existing logging paths. The transient VFX event itself is not a log entry.

### Persistence, JSON, and logs boundary

Move animation events exist only in the runtime chain `planMoveAnimations()` -> `useMoveAnimationQueue()` -> the map renderer. They are not part of `SavedMap`, spawned Pokémon, trainer sheets, move automation transactions, live-session state, or any storage payload.

- Do not add `moveAnimations`, `activeMoveAnimations`, queue snapshots, `move-vfx-*` ids, palette data, VFX timings, or renderer debug snapshots to persisted map JSON, sheet JSON, campaign/session state, local storage, realtime payloads, or server API payloads.
- Do not introduce a map/schema migration for basic move animations; renderer/page integration should create a fresh per-map queue at runtime and clear it on navigation, unmount, or map reset.
- Existing move automation transactions and movement/action logs may still be saved or displayed when they would have been saved without VFX. Those records describe mechanical results; they should not store VFX ids, durations, palette data, or renderer lifecycle state.
- Manual verification for integration tickets: after resolving a move and saving/exporting/reloading a map, inspect the generated JSON for absence of `moveAnimations`, `activeMoveAnimations`, `move-vfx`, VFX `kind`, VFX `durationMs`, or palette fields outside normal move metadata.

## Technical guardrails and non-regression rules

Renderer, scheduler, primitive, and move-automation integration tickets must reference this section in their implementation notes before changing map rendering code. These rules are guardrails for the entire move VFX layer, not polish preferences.

### Scheduler integration

- Move VFX must use the existing dirty isometric render scheduler documented in `docs/render-scheduler-architecture.md`.
- Do not add a separate always-on `requestAnimationFrame`, `setInterval`, timeout loop, or component-local animation loop for move animations.
- Adding, removing, or syncing VFX events should request a focused scheduled scene frame through the same invalidation path used by other map renderer changes.
- Active VFX may keep frames alive only by participating in the existing animation-continuation model. The planned renderer contract should expose whether it still needs another frame, for example through `needsAnimationFrame()` or an equivalent resolver used by `resolveSceneAnimationContinuation()`.
- The continuation source must become inactive as soon as all VFX instances are complete, hidden-and-aged-out, removed, or disposed so an idle map returns to one-shot rendering.
- VFX that only changes WebGL objects should not force CSS3D renders. The optional badge primitive is CSS3D-only and reports CSS output through `MoveVfxRenderer.needsCss3DFrame()` so `stepIsometricAnimationFrame()` marks CSS3D dirty only while an active badge can change or hide CSS output.

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

- `MoveAnimationEvent` objects are transient client-side display requests. Their foundational TypeScript contract lives in `src/types/moveAnimation.ts`, and they must not be serialized into map JSON, sheet JSON, trainer JSON, campaign/session state, local runtime state, or server API payloads unless a future ticket explicitly changes the architecture.
- Generic visual effect kinds are centralized in `src/types/moveVfx.ts` as `MOVE_VFX_KIND`, `MoveVfxKind`, and `MoveAnimationEffectKind`. These are renderer/VFX categories, not move script kinds or move names; future per-move overrides should select from this generic catalog before adding bespoke choreography in a later milestone.
- Generic type and semantic VFX colours are centralized in `src/utils/moveAnimationPalette.ts`. Unknown or custom move types fall back to the neutral readable palette; healing, status, buff, debuff, miss, and crit outcomes should use semantic tone helpers when type colour would be misleading.
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

## Animation dependency decision

**Decision:** the initial move VFX implementation stays dependency-free and uses Three.js plus small internal math helpers. Do not add GSAP, Anime.js, `@tweenjs/tween.js`, or another direct tweening dependency for the basic move-animation phase.

### Evaluation

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| Internal helpers with Three.js | No new bundle or maintenance surface; deterministic pure functions are easy to unit-test; progress can be driven from the existing scheduler's frame time; no global ticker or hidden RAF loop; lifecycle remains owned by the VFX renderer instances. | Agents must implement a few easing, interpolation, delay, and duration helpers instead of using a timeline DSL; complex bespoke choreography may require more utility code later. | **Use for this phase.** The planned generic projectiles, beams, pulses, rings, sweeps, and afterimages are simple enough for local helpers. |
| Direct tweening package | Convenient easing presets, timelines, staggering, and callbacks; could speed a future bespoke choreography-heavy milestone. | Adds direct dependency and package-lock churn; increases bundle/API surface for a visual-only feature; may introduce a library-managed ticker or mutable timeline lifecycle that must be carefully bridged back into the dirty scheduler; adds SSR, disposal, pause/resume, and testing considerations. | **Do not add now.** Revisit only through a later ADR/ticket if future per-move animation work proves local helpers are insufficient. |

The existing app already depends on Three.js directly, and the render loop already supplies frame time, delta, and continuation state. Move VFX should compute progress from those values instead of delegating timing to an external ticker.

### Internal helper scope for VFX-009

The dependency-free helper layer should be intentionally tiny and live near the isometric renderer code. The shared implementation lives in `src/utils/isometric/moveVfxTiming.ts`; primitive and renderer code should import its easing, interpolation, progress, and default-duration helpers instead of inventing per-primitive math.

In scope:

- pure easing helpers: `clamp01`, `linear`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack`, and `pulse01`;
- `animationProgress(nowMs, startMs, durationMs)` or equivalent progress state that returns clamped progress and completion information, with safe zero/negative-duration handling;
- small interpolation helpers only when a primitive would otherwise duplicate math repeatedly, such as number lerp or bounded arc-height helpers;
- shared duration constants for quick, normal/medium, long, and linger effects;
- support for event start offsets/delays by deriving a per-instance effective start time, not by scheduling timers.

Out of scope:

- a global timeline registry, independent animation clock, always-on RAF loop, or timer queue;
- importing a tweening library through a direct package dependency;
- mutable helper state that survives map unmount unless explicitly owned and disposed by the VFX renderer.

Any future proposal to add an animation package must document bundle/runtime impact, scheduler integration, pause/resume/disposal behaviour, and why internal helpers are insufficient. That proposal should include any `package.json`/lockfile changes in the same reviewed product change.

### Anchor geometry helpers for VFX-010

The shared world-space anchor implementation lives in `src/utils/isometric/moveVfxAnchors.ts`. Primitive and renderer code should import these helpers instead of duplicating token-height or cell-centre math.

Coordinate assumptions:

- map `x`/`z` form the horizontal grid plane, and `y` is elevation;
- token foot anchors use `PokemonRenderObject.currentCenter`, which is the footprint centre at the token's current elevation;
- token horizontal centres already reflect footprint `base`; token body-anchor heights derive from the render object's sprite `height` and occupied `clearance` rather than saved move data;
- grid-cell anchors use the centre of the unit cell in `x`/`z` while keeping `y` at the cell elevation so ground effects sit on the same plane as area overlays;
- missing token render objects resolve to an explicit fallback cell or `null`, letting VFX callers skip incomplete effects without throwing.

Available helpers cover token foot, center, chest, head, and above-head anchors; single-cell centres; area centroids; and a shared start/end resolver for projectile-like and beam-like effects.

### Queue id and dedupe policy for VFX-011

The shared queue policy implementation lives in `src/composables/map-editor/moveAnimationQueuePolicy.ts`. The future `useMoveAnimationQueue` composable should use these helpers instead of inventing id or duplicate handling locally.

- Queue-owned ids use the deterministic `move-vfx` prefix and a monotonically increasing, zero-padded suffix such as `move-vfx-000001`.
- Id generators are per queue instance, not module-global state, so map pages, tests, and SSR/client setup do not leak counters across sessions.
- Move automation or planner code may still provide a caller-stable id when it can identify a specific resolution moment. Reusing that id is how repeated watchers avoid replaying the same visual event.
- The default duplicate-id policy is **ignore**: enqueueing an event whose id is already active keeps the original active event and does not append, restart, or replace it.
- Intentional multi-effect sequences must use distinct ids. Replacement is available only as an explicit corrective policy for future queue callers that need to update an active event in place.

This policy keeps transient VFX one-shot per move resolution by default while still allowing deliberate batches such as launch + impact + crit events.

### Queue composable for VFX-012

The per-map reactive queue implementation lives in `src/composables/map-editor/useMoveAnimationQueue.ts`. Each map page should create its own queue instance and pass the returned enqueue functions to later move-automation integration; the module owns no global state and imports no renderer or move-rule code.

The composable exposes `activeMoveAnimations` as a readonly computed array plus `enqueueMoveAnimation`, `enqueueMoveAnimations`, `removeMoveAnimation`, `clearMoveAnimations`, and `pruneExpiredMoveAnimations`. Enqueue helpers fill missing `id` and `createdAtMs` fields from the per-queue id generator and injected clock, then apply the VFX-011 duplicate policy. The default queue clock uses `performance.now()` in browsers so event timestamps share the renderer frame-time clock, falling back to `Date.now()` only when the Performance API is unavailable. Expiration pruning uses event `createdAtMs`/`durationMs` through the shared timing helpers and is opportunistic only; it does not create timers, a RAF loop, or persistence hooks.

Because the queue is runtime state, `activeMoveAnimations` should flow only into renderer-facing props and lifecycle cleanup. Do not pass queue contents to `useEditableMap`, sheet save helpers, move usage log builders, live-session payload builders, local-storage helpers, or schema migrations. Logs may mention that a move happened through the existing transaction/log paths, but they should not embed animation event ids, palettes, durations, or queue snapshots.

### Planner contracts for VFX-014

The pure planner contract lives in `src/utils/moveAnimationPlanner.ts`. It defines discriminated `MoveAnimationPlanInput` variants for self, single-target, and confirmed area move resolutions, plus `MoveAnimationPlanOutput` as a readonly array of transient `MoveAnimationEvent` objects.

Planner inputs carry readonly move-automation data only: the user token snapshot, target token snapshots, explicit `MoveAutomationScript`, optional transaction and roll-feedback snapshots, selected target ids, optional area cells/direction/pass destination, target hit/miss/crit summaries, and caller-supplied timing/id context. The planner boundary must stay renderer-agnostic and side-effect free: no Vue refs, DOM nodes, WebGL or Three.js objects, renderer instances, timers, scheduler ownership, or mutations to map/sheet/token/transaction state. This keeps future generic classification unit-testable without DOM or WebGL and prevents the renderer from learning move-rule concepts directly.

### Generic classification rules for VFX-015

The initial generic planner implementation lives in `planGenericMoveAnimations()` in `src/utils/moveAnimationPlanner.ts`. It is metadata-driven and deliberately avoids per-move-name choreography: target mode, damaging flags, range text, keywords, area template kinds, authored HP/stage/condition suggestions, and hit/miss/crit outcomes select reusable VFX families.

Current classifications are intentionally broad:

- self or immediate moves choose a healing pulse, buff/debuff particles, status cloud, or neutral self pulse from script suggestions and damage class;
- single-target damaging melee moves produce a melee lunge plus type-coloured target flash on hits;
- single-target damaging ranged moves choose a projectile, beam, or arc from range/keyword/area-template hints, then add type-coloured impact, neutral miss puff, and type-coloured crit accent events as outcome data requires;
- confirmed area moves produce an area pulse, with line and cone area templates adding matching sweep events;
- unusual scripts with enough user context fall back to a neutral self pulse instead of throwing.

Planner-created events may carry a palette entry from `src/utils/moveAnimationPalette.ts` so future primitives can use move-type colours for damaging effects and semantic colours for healing, status, buff/debuff, and miss effects without re-reading move automation rules. Critical-hit events carry the damaging move palette so the renderer can layer that type colour with its semantic crit accent. The planner still does not mutate gameplay state, enqueue events, schedule frames, or persist VFX data.

### Multi-target sequencing helper for VFX-051

Multi-target target flashes and semantic follow-up effects can use `src/utils/moveAnimationSequencing.ts` to assign bounded `startOffsetMs` values. `createMoveAnimationTargetStartOffsets()` accepts target ids plus optional target cells and can order by confirmed target order, distance from the user/source cell, or stable target id. The helper caps the total stagger spread by default so large area batches remain snappy instead of extending every target animation indefinitely.

`MoveAnimationEvent.startOffsetMs` is a transient renderer timing hint measured from `createdAtMs`; it does not schedule timers, mutate queue state, or persist to map/sheet JSON. `applyMoveAnimationTargetStartOffsets()` can layer target staggering on top of existing launch/impact delays without changing non-target events. The queue and renderer both compute completion from `createdAtMs + startOffsetMs + durationMs`, so delayed events are not pruned before they begin.

The move VFX renderer may create an event-owned group as soon as the event is synced, but delayed instance groups remain invisible until their effective start frame. If a delayed event is cleared before it starts, normal `sync([])` reconciliation disposes the hidden group and any owned resources.

### Future per-move override contract for VFX-016

`src/utils/moveAnimationPlanner.ts` now exposes a future per-move extension contract without adding any bespoke production choreography:

- `MoveAnimationPreset` describes an optional future planner hook that can return a renderer-ready event list, return an empty list to intentionally suppress VFX, or return `null`/`undefined` to fall back to generic planning.
- `MoveAnimationOverrideRegistry` is keyed by `canonicalMoveAnimationOverrideKey(moveName)`, for example `Solar Beam` becomes `solar-beam`.
- `MOVE_ANIMATION_OVERRIDE_REGISTRY` is the production registry and is deliberately empty for this phase. No canonical move receives unique choreography in the basic move-animation implementation.
- `createMoveAnimationPlanner()` and the public `planMoveAnimations()` entry point check the registry first and then fall back to `planGenericMoveAnimations()`.

Future bespoke per-move work should fill the registry only in a later milestone with focused review, tests, fan-project asset-boundary checks, and a preference for reusing the generic primitives before adding new choreography.

### Safe no-op and fallback behaviour for VFX-017

The planner is hardened so incomplete animation data cannot break move resolution. The public `planMoveAnimations()` pipeline catches override and generic-planner failures, optionally logs a development warning, and returns a safe fallback plan instead of throwing.

Current fallback rules:

- missing user/source token: return an empty plan because there is no trustworthy visual anchor;
- missing single-target id: return a neutral self pulse on the user rather than inventing a target;
- selected target id with no target token snapshot: keep a target-id-only event with no `targetCell`, allowing the renderer to resolve the live token later or skip safely;
- empty or invalid area cells: return a neutral self pulse on the user;
- unknown/custom move type: use the neutral readable palette;
- missing or invalid event duration: normalize to the normal timing tier.

These fallbacks are visual-only. They do not change hit/miss, targeting, HP, status, placement, logs, permissions, or persisted data.

### Renderer shell for VFX-019

The initial renderer shell lives in `src/utils/isometric/moveVfxRenderer.ts`. It exports `createMoveVfxRenderer(scene)` and `createMoveVfxRenderer({ scene, group })`, creating a dedicated `THREE.Group` named `move-vfx-root` for all future move VFX objects.

The shell exposes the renderer contract needed by later integration tickets: `sync(events, context)`, `animate(frameContext)`, `needsAnimationFrame()`, `activeCount()`, and `dispose()`. This preserves the dirty-scheduler guardrail: VFX renderer work must be advanced by the existing isometric render loop and must not add a separate RAF or timer loop.

### Renderer lifecycle for VFX-020

The renderer now tracks one lifecycle instance root group per active `MoveAnimationEvent.id` under `move-vfx-root`. These groups are intentionally empty until later primitive tickets add meshes, materials, geometries, or CSS3D elements, but they establish the resource ownership boundary: primitives should attach their objects to the per-event group and let renderer lifecycle cleanup remove them.

`sync(events, context)` creates lifecycle groups for new event ids, keeps existing groups for repeated ids, and disposes groups whose ids are no longer present. `animate(frameContext)` uses scheduler-provided frame time with the shared timing helper to dispose completed events. Completed ids are not recreated while the same expired event remains in the synced input; once an id disappears from input, a future event can reuse that id normally. `needsAnimationFrame()` reports whether any lifecycle instance is still active; the renderer itself never schedules frames directly and exposes this signal to the existing render-loop continuation model.

Disposing the renderer removes every active per-event group, then removes the dedicated root group from the scene, and is safe to call more than once. Cleanup uses the shared `disposeObject3D()` helper so primitive-owned Three.js children are detached and their owned geometries/materials are disposed when an event is removed, completes, or the map scene unmounts.

### Per-effect renderer instance abstraction for VFX-021

`src/utils/isometric/moveVfxRenderer.ts` now has an internal `MoveVfxInstance` seam with an owned group, `animate(frameContext)`, `complete`, and idempotent `dispose()` for each active event. The top-level renderer only reconciles ids, delegates frame advancement to active instances, prunes completed instances, and reports `needsAnimationFrame()`; primitive-specific animation math belongs in per-kind builders instead of the sync loop.

A factory switch maps every current `MOVE_VFX_KIND` to a per-kind builder. These builders intentionally return safe no-op placeholder instances until the primitive tickets add visible projectile, beam, flash, pulse, and area implementations. Unknown runtime effect kinds also fall back to the same no-op instance, so malformed or future events do not crash production rendering. The placeholders still age out from scheduler-provided frame time and release their groups through `disposeObject3D()`, preserving the lifecycle and no-independent-RAF guardrails.

### Render-loop continuation source for VFX-022

`src/utils/isometric/renderLoop.ts` includes the `move-vfx-animation` continuation source and the `resolveIsometricMoveVfxAnimationContinuationSources(renderer)` helper. The helper is intentionally small: it returns the source only when a move VFX renderer exists and its `needsAnimationFrame()` method reports active work.

This preserves idle performance because no move VFX source is reported for absent, disposed, or inactive renderers, and the source participates in the same validation and first-seen dedupe path as token motion, sprite animation, movement preview, and field-effect animation. Move VFX remains WebGL-only for CSS3D dirty tracking until a later CSS3D primitive explicitly needs CSS output invalidation.

### Scheduler frame stepping for VFX-023

`src/utils/isometric/animationFrame.ts` now accepts an optional move VFX renderer frame hook. When a renderer is present and `needsAnimationFrame()` reports active work, `stepIsometricAnimationFrame()` calls `moveVfxRenderer.animate(...)` before the WebGL render with the scheduler's `frameNowMs`, clamped `delta`, clock `elapsedTime`, active camera, optional live token render-object map, and optional visibility flag.

`src/components/IsometricGrid.client.vue` includes the dormant move VFX renderer slot in both `resolveSceneAnimationContinuation()` and the per-frame call into `stepIsometricAnimationFrame()`. Until the later prop-plumbing ticket instantiates and syncs the renderer, the slot is `null` and produces no continuation source or animation work. This keeps VFX advancement on the existing dirty-scheduled frame path without introducing an independent RAF loop.

The current move VFX path is pure WebGL: stepping the renderer does not mark CSS3D dirty, and `CSS3DRenderer.render()` still runs only when the existing dirty tracker reports CSS-visible changes. If a future primitive uses CSS3D badges or labels, that primitive must add an explicit CSS dirty signal instead of relying on the WebGL-only move VFX continuation source.

### Isometric grid prop bridge for VFX-024

`src/components/IsometricGrid.client.vue` now accepts an optional `moveAnimations?: MoveAnimationEvent[]` prop and owns a `createMoveVfxRenderer(scene)` instance alongside the existing targeting, area-template, and feedback renderers. The prop remains optional so existing map callers can omit it until `MapSceneRenderer.vue` and the map page are wired in later tickets.

When the prop changes, the grid syncs the event list into the renderer with the live token render-object map, then requests one WebGL-only scheduled frame using the broad `scene-state` debug reason. The renderer's `needsAnimationFrame()` signal is still the only way active move VFX keeps subsequent frames alive, so adding or removing events wakes the existing dirty scheduler without adding any independent RAF loop or CSS3D work.

### Map scene prop bridge for VFX-025

`src/components/map/MapSceneRenderer.vue` now accepts the same optional `moveAnimations?: MoveAnimationEvent[]` prop and forwards `moveAnimations ?? []` to `IsometricGrid.client.vue`. This keeps the wrapper backward-compatible for existing callers while exposing the renderer-facing event list to later page-level queue wiring.

The prop remains a transient runtime bridge only. `MapSceneRenderer.vue` does not own, serialize, mutate, or persist animation events; it simply forwards caller-owned active events into the existing isometric grid scheduler path added by VFX-024.

### Map page queue wiring for VFX-026

`src/pages/maps/[slug].vue` now creates one `useMoveAnimationQueue()` instance for the mounted map page. Its `activeMoveAnimations` computed value is passed through `src/components/map/MapScenePanel.vue` into `MapSceneRenderer.vue`, then onward to `IsometricGrid.client.vue` and the scheduler-owned move VFX renderer. The page also passes the queue's `enqueueMoveAnimations` function into `useMoveAutomationPanel` through a renderer-agnostic typed option so later move automation tickets can request VFX without importing Three.js or renderer utilities.

The queue remains page-local runtime state. The map page clears active move animations when the route map slug changes and during unmount/navigation cleanup, preventing stale events from following users between maps. These cleanup hooks do not create timers, persistence hooks, server payloads, gameplay mutations, or an independent animation loop.

### Layer visibility handling for VFX-027

Move VFX follow the resolved token layer. `src/utils/isometric/layerVisibility.ts` exposes `resolveMoveVfxLayerVisibility(layers)`, and `src/components/IsometricGrid.client.vue` passes that result into `moveVfxRenderer.sync(...)` and each scheduled animation frame. The policy is intentionally conservative for this basic phase: hiding tokens also hides token-anchored VFX and area-only move confirmations so VFX cannot reveal or imply action around hidden tokens.

Hidden VFX still keep their normal transient lifecycle. The renderer retains active event instances while `visible` is false, advances them from scheduler frame time, disposes completed instances, and does not recreate completed ids just because the token layer becomes visible again. Layer visibility changes request the existing `layer-visibility` render invalidation and do not add any independent timers, persistence, gameplay mutations, or renderer-quality reductions.

### Hidden-tab pause/resume for VFX-028

Move VFX use wall-clock event lifetimes while the document is hidden. When the browser hides the tab, `IsometricGrid.client.vue` continues to pause the dirty render scheduler through the existing document visibility lifecycle hook; no move VFX RAF, timer, or synthetic catch-up loop runs in the background. When the tab becomes visible again, the grid asks `moveVfxRenderer.expireCompleted(Date.now())` to dispose any effects whose `createdAtMs + durationMs` elapsed while hidden before the first resumed render frame. This prevents expired effects from briefly jumping to a final catch-up visual.

The map page also prunes expired `useMoveAnimationQueue()` entries on `visibilitychange` resume so renderer input does not retain stale wall-clock-expired events. If the tab was hidden only briefly and an effect has not expired, it resumes from its normal elapsed wall-clock progress on the scheduler's `hidden-tab-resume` frame. This policy keeps transient animations from getting stuck after a hidden-tab pause without adding persistence, gameplay mutations, renderer quality changes, or independent timers.

### Unmount disposal for VFX-029

`src/components/IsometricGrid.client.vue` now includes the move VFX renderer in the same unmount resource cleanup path as the other isometric renderer-owned resources. `disposeIsometricRendererResources()` calls `moveVfxRenderer.dispose()` before token render objects and WebGL/CSS3D renderer references are released, so leaving the map scene removes the dedicated `move-vfx-root` group, clears active VFX instances, and disposes primitive-owned Three.js children through the renderer's existing idempotent disposal path.

This cleanup remains runtime-only. It does not clear or save map data, mutate token placement, change move automation outcomes, add timers, or affect renderer quality; it only guarantees transient VFX resources are detached when the grid unmounts.

### Development metrics for VFX-030

`src/utils/isometric/moveVfxRenderer.ts` exposes `activeCount()` for the cheap hot-path count and `debugSnapshot()` for opt-in diagnostics. The snapshot reports the active VFX count, instance root-group count, whether move VFX is currently keeping the scheduler active, root/layer visibility, and disposal state. It intentionally avoids event-id arrays or per-frame renderer walks so normal production animation paths do not allocate debug data.

When the map route is opened in development with `?debug=render`, `?debug=render-metrics`, or `?debug=isometric-render`, `src/components/isometric/RenderMetricsOverlay.vue` now includes a **Move VFX** section. Use **Active VFX** and **Keeps scheduler active** to confirm whether transient move animations are responsible for continued `animation` frames; after effects complete, both should return to `0`/`no` and the idle scheduler should settle. The overlay samples this only behind the existing render-debug gate and does not alter visual output, persistence, move mechanics, renderer quality, or scheduling policy.

### Projectile primitive for VFX-031

`src/utils/isometric/moveVfxRenderer.ts` now replaces the projectile placeholder with a lightweight visible primitive. Projectile events resolve and lock a start/end anchor when the renderer instance is created, using the user's chest anchor and the target's chest anchor or explicit grid-cell fallbacks. Locking endpoints keeps an in-flight projectile stable if another renderer update moves the target token before the projectile completes.

The primitive attaches a small palette-coloured core sphere plus a translucent glow sphere to the event-owned lifecycle group, scales the radius from the available user/target token dimensions with a bounded default fallback, and advances position, pulse scale, and opacity from scheduler-provided frame time only. Missing anchors fall back to the existing no-op instance so move resolution and renderer scheduling remain safe.

Projectile geometry and materials are owned by the event instance and are disposed through the existing `disposeObject3D()` cleanup path when the event is removed, completes, or the map scene unmounts. The primitive adds no timers, no independent RAF loop, no persistence, no gameplay mutation, no renderer-quality reduction, and no new dependencies.

### Projectile trail rendering for VFX-032

Projectile events now include a lightweight chained-sphere trail. Each projectile instance creates exactly four small glow-coloured trail segments at construction time, keeps them as children of the same event-owned lifecycle group as the projectile core/glow, and updates only their transforms, scale, visibility, and material opacity during scheduler-driven animation frames. The segment count is constant and no trail geometry is created per frame.

The trail follows the same locked start/end anchors as the projectile, staggers each segment slightly behind the current eased travel point, and fades with the projectile's normal fade-in/fade-out window so the motion direction is easier to read without adding a bespoke asset or extra animation loop. Trail geometries and materials are disposed by the existing `disposeObject3D()` path when the projectile completes, is removed, or the map scene unmounts.

### Arc/lob primitive for VFX-034

`src/utils/isometric/moveVfxRenderer.ts` now replaces the arc placeholder with a projectile-style lob primitive for thrown, rock, seed, blob, or other arcing generic moves. Arc events resolve the same user chest and target chest/grid-cell fallback anchors as projectiles, then lock those endpoints for the event lifetime so target movement during the scheduler-driven animation does not stretch the visual.

Arc motion uses the existing projectile core/glow material helpers and constant-count trail segments, but samples the projectile path along a bounded vertical sine offset. `MoveArcAnimationEvent.arcHeight` may request a lob height in world units; the renderer clamps unsafe values and otherwise derives a deterministic default from horizontal distance with a hard maximum so long-range attacks do not arc absurdly high above the tactical scene.

Arc meshes, materials, and trail segments are owned by the same event lifecycle group and dispose through `disposeObject3D()` on completion, removal, or map unmount. The primitive is visual-only: it adds no timers, no independent RAF loop, no persistence, no gameplay/placement mutation, no permission changes, no renderer-quality reduction, and no new dependencies.

### Melee lunge primitive for VFX-035

`src/utils/isometric/moveVfxRenderer.ts` now replaces the melee-lunge placeholder with a short VFX-owned contact motion for generic melee attacks. Melee lunge events resolve and lock the user's chest anchor plus the first target's chest/foot anchors at instance creation, with the same grid-cell fallback policy used by other primitives. The effect derives a bounded horizontal lunge distance from the locked user-to-target direction so it reads as a forward-and-back contact cue without crossing the target or stretching if either token moves during the animation.

The primitive intentionally does **not** offset the real token sprite, render object, placement, or saved map data. Instead, it renders a translucent palette-coloured ghost/afterimage, a short glow streak, and a small target-foot impact ring inside the event-owned VFX group. Scheduler frame time drives their position, scale, opacity, and completion; clearing the event or unmounting the grid disposes all owned geometry/materials through `disposeObject3D()` and leaves token placement untouched.

Melee lunge VFX remain visual-only runtime resources. They add no timers, no independent RAF loop, no persistence, no gameplay/placement mutation, no permission changes, no renderer-quality reduction, and no new dependencies.

### Beam primitive for VFX-033

`src/utils/isometric/moveVfxRenderer.ts` now replaces the beam placeholder with a lightweight straight-line energy primitive. Beam events lock their user chest anchor and target chest anchor at creation time, with existing grid-cell fallbacks and an area-cell centroid fallback when no target token is supplied. This makes a beam stable for the event lifetime even if token render objects move before the VFX completes.

Each beam instance owns two transparent additive cylinder meshes: a bright accent-coloured core and a wider primary-coloured glow. Scheduler frame time drives only opacity and thickness pulsing, so the beam appears quickly, holds briefly, fades, and then disposes through the same event-owned lifecycle group as other primitives. Beam events may also set `impact: true` to add a small target-end ring owned by the beam instance; the reusable impact-ring mesh/material helpers added in VFX-037 now share the same transparent depth-safe ring setup.

Beam VFX remain visual-only runtime resources. They add no timers, no independent RAF loop, no persistence, no gameplay mutation, no permission changes, no renderer-quality reduction, and no new dependencies.

### Target flash primitive for VFX-036

`src/utils/isometric/moveVfxRenderer.ts` now replaces the target-flash placeholder with a compact target readability primitive. Target flash events resolve the first `targetId`/`targetIds` entry to token foot and body-center anchors, with `targetCell` fallback support when a token render object is unavailable. The anchors are locked when the instance is created so the short flash stays tied to the move-resolution moment if the token moves before the effect completes.

Each target flash instance owns a translucent body shell plus a small footprint ring. Scheduler frame time drives only opacity and scale pulses; multiple target-flash events therefore create independent geometry/materials and can run in the same frame without shared mutable material state. `MoveTargetFlashAnimationEvent.tone` supports `hit`, `heal`/`healing`, `buff`, `debuff`, `status`, and `neutral` styling, with unknown runtime tones falling back to the neutral palette. If no tone is supplied, the renderer uses the event palette so damaging hits can remain type-coloured.

Target flash VFX remain visual-only runtime resources. They add no timers, no independent RAF loop, no persistence, no gameplay mutation, no permission changes, no renderer-quality reduction, and no new dependencies.

### Impact ring primitive for VFX-037

`src/types/moveVfx.ts` and `src/types/moveAnimation.ts` now include the generic `impact-ring` event kind for reusable hit/contact pulses. `src/utils/isometric/moveVfxRenderer.ts` resolves the first target id to a locked token foot anchor, or to `targetCell` when the token render object is unavailable, then renders one event-owned ground-plane ring named `move-vfx-impact-ring`.

Impact rings use a small y-offset above the target/cell plane, transparent additive material, `depthTest: true`, `depthWrite: false`, and a ground-effect render order so the ring reads above flat or raised terrain without covering CSS3D HP bars, roll feedback, or token HUDs. Scheduler frame time drives the ring expansion and opacity fade; completion, event removal, or map unmount disposes the owned ring geometry/material through the existing VFX lifecycle.

`MoveImpactRingAnimationEvent.tone` may request semantic colours such as `heal`/`healing`, `status`, `buff`, `debuff`, `miss`, `crit`, or `neutral`; `hit`/`damage` tones and omitted tones use the event palette so damaging type-coloured hits remain available. Unknown runtime tones fall back to the neutral palette. The same ring mesh/material helper is used by beam and melee impact accents and can be reused by projectile follow-up effects later without changing scheduler or persistence behaviour.

Impact ring VFX remain visual-only runtime resources. They add no timers, no independent RAF loop, no persistence, no gameplay mutation, no token placement mutation, no permission changes, no renderer-quality reduction, and no new dependencies.

### Miss puff primitive for VFX-038

`src/utils/isometric/moveVfxRenderer.ts` now replaces the miss placeholder with a small neutral puff/ring primitive. Miss events resolve the first target id to a locked token-foot anchor, or use `targetCell` when the token render object is unavailable, then place the puff just past the target from the user's direction. If the user anchor is unavailable, the primitive uses a small deterministic fallback offset so grid-cell-only miss events still appear beside the affected cell.

Miss puffs intentionally ignore type-coloured event palettes and use the shared semantic `miss` palette from `src/utils/moveAnimationPalette.ts`. Each instance owns one low-opacity ground ring plus three soft cloud puffs, all using transparent additive materials with `depthTest: true`, `depthWrite: false`, disabled raycasting, and render orders below stronger hit/target-flash accents. Scheduler frame time drives expansion, slight upward cloud drift, opacity fade, completion, and disposal.

Miss puff VFX remain visual-only runtime resources. They add no timers, no independent RAF loop, no persistence, no gameplay mutation, no token placement mutation, no permission changes, no renderer-quality reduction, no new dependencies, and no damaging hit/crit colour styling for miss outcomes.

### Crit burst primitive for VFX-039

`src/utils/isometric/moveVfxRenderer.ts` now replaces the crit placeholder with a short double-ring and starburst primitive. Crit events resolve the first target id to a locked token-foot/body anchor, or use `targetCell` when the token render object is unavailable. If no target anchor can be resolved, the renderer falls back to the safe no-op lifecycle instance so move resolution is unaffected.

Each crit burst instance owns two ground-plane rings plus eight lightweight starburst spokes around the target body. The renderer combines the event palette, usually the damaging move type from `planGenericMoveAnimations()`, with the semantic `crit` palette so critical hits read as stronger than normal target flashes without replacing the move's type colour entirely. Transparent additive materials use `depthTest: true`, `depthWrite: false`, disabled raycasting, and render orders above the normal impact/target-flash rings while remaining below CSS3D HUD and roll feedback.

Crit burst VFX remain visual-only runtime resources. They are planned only when target outcome data marks `crit: true`; ordinary hits keep the normal launch plus target-flash plan. Scheduler frame time drives burst expansion, opacity fade, completion, and disposal through the existing move VFX lifecycle. The primitive adds no timers, no independent RAF loop, no persistence, no gameplay mutation, no token placement mutation, no permission changes, no renderer-quality reduction, and no new dependencies.

### Self aura pulse primitive for VFX-040

`src/utils/isometric/moveVfxRenderer.ts` now replaces the self-pulse placeholder with a user-centred aura primitive. Self-pulse events resolve the move user's token-foot anchor, or use `originCell` when the token render object is unavailable, then lock that anchor for the event lifetime so normal token motion or placement updates do not stretch the aura.

Each self aura instance owns two horizontal ring meshes plus a translucent body shell. The renderer scales the aura from the user's token footprint and body height/clearance, with bounded defaults for grid-cell fallback events, so small and large tokens receive readable but not map-obscuring pulses. `MoveSelfPulseAnimationEvent.tone` may request semantic `heal`/`healing`, `buff`, `debuff`, `status`, or `neutral` colours; omitted tones use the event palette so type-coloured self-originating moves can still be represented.

Self aura VFX remain visual-only runtime resources. They are VFX-owned overlay geometry and do not alter token selection, hover, sprite, placement, permissions, or saved state. Scheduler frame time drives ring expansion, a short rising-ring pulse, shell opacity/scale, completion, and disposal through the existing move VFX lifecycle. The primitive adds no timers, no independent RAF loop, no persistence, no gameplay mutation, no token placement mutation, no renderer-quality reduction, no external assets, and no new dependencies.

### Healing pulse/swirl primitive for VFX-041

`src/utils/isometric/moveVfxRenderer.ts` now replaces the healing placeholder with a distinct semantic HP-restoration primitive. Healing events resolve the first `targetId`/`targetIds` entry to a token-foot anchor, fall back to `targetCell` when a target render object is unavailable, and use the move user as the anchor when no target id is supplied for self-healing events. The anchor is locked when the instance is created so token movement during the brief effect does not stretch or reassign the visual.

Each healing instance owns two horizontal ring meshes plus six small swirl motes. The default palette is the shared semantic healing palette from `src/utils/moveAnimationPalette.ts`; an explicit event palette can override it for future planner/override cases. The renderer scales the rings and motes from the affected token footprint and body height/clearance with bounded grid-cell defaults, keeping particle count constant and avoiding per-frame geometry allocation.

Healing VFX remain visual-only runtime resources. They do not decide or apply HP changes, mutate token placement/style/selection, change permissions, persist data, add dependencies, lower renderer quality, or create an independent RAF/timer loop. Scheduler frame time drives ring expansion, a short upward ring, mote swirl/rise, completion, and disposal through the existing move VFX lifecycle. A primitive-level reduced-motion hint swaps the swirl into a single soft fade/pulse ring; the prop path is available now, while automatic app/OS preference wiring remains scoped to later controls/accessibility tickets.

### Buff/debuff particles primitive for VFX-042

`src/utils/isometric/moveVfxRenderer.ts` now replaces the `buff-debuff` placeholder with a semantic combat-stage-style primitive. Buff/debuff events resolve the first `targetId`/`targetIds` entry to the affected token foot anchor, fall back to `targetCell` when the token render object is unavailable, and use the move user as the anchor only when no target id is supplied. Anchors are locked when the instance is created so the brief effect stays tied to the affected token/cell rather than stretching if live token motion updates.

Each buff/debuff instance owns one horizontal ring plus five constant-count cone particles. `tone`/`direction: "buff"` uses the shared semantic buff palette with rising particles; `tone`/`direction: "debuff"` uses the debuff palette with inverted sinking particles. Explicit palettes remain available for future override/debug events, but planner-created combat-stage events now carry both `tone` and `direction` so the renderer can distinguish positive and negative non-damage outcomes without per-stat icons or external assets.

Buff/debuff VFX remain visual-only runtime resources. They do not decide or apply combat-stage changes, mutate token placement/style/selection, change permissions, persist data, add dependencies, lower renderer quality, or create an independent RAF/timer loop. Scheduler frame time drives particle motion, ring opacity/scale, completion, and disposal through the existing move VFX lifecycle. A primitive-level reduced-motion hint swaps the moving particles into a single soft fade/pulse ring; the prop path is available now, while automatic app/OS reduced-motion wiring remains scoped to later controls/accessibility tickets.

### Status cloud primitive for VFX-043

`src/utils/isometric/moveVfxRenderer.ts` now replaces the `status` placeholder with a generic condition/status cloud primitive. Status events resolve the first `targetId`/`targetIds` entry to the affected token foot anchor, fall back to `targetCell` when the token render object is unavailable, and use the move user only when no target id is supplied. The anchor is locked at instance creation so the brief status read stays tied to the affected token or cell instead of stretching if live token motion updates.

Each status instance owns one low ground ring, one soft body cloud shell, and five constant-count orbiting motes. Optional `conditionName`/`conditionNames` fields on `MoveStatusAnimationEvent` are colour hints only: known condition families such as Burned, Poisoned, Paralysis, Frozen, Sleep, and Confused may tint the generic cloud through `src/utils/moveAnimationStatusPalette.ts`, while unknown/custom condition names fall back to the shared semantic status palette. The renderer still creates one compact combined status cloud per event rather than one noisy effect per condition, and it does not add text badges or condition-specific choreography in this phase.

Status VFX remain visual-only runtime resources. They do not decide or apply conditions, mutate HP/combat stages/token placement/style/selection, change permissions, persist data, add dependencies, lower renderer quality, or create an independent RAF/timer loop. Scheduler frame time drives ring expansion, cloud/mote opacity, orbiting motion, completion, and disposal through the existing move VFX lifecycle. A primitive-level reduced-motion hint swaps the orbiting cloud into a single soft fade/pulse ring; the prop path is available now, while automatic app/OS reduced-motion wiring remains scoped to later controls/accessibility tickets.

### Area cell pulse primitive for VFX-044

`src/utils/isometric/moveVfxRenderer.ts` now replaces the `area-pulse` placeholder with a confirmed-area cell overlay primitive. Area pulse events read the event's `areaCells` list, ignore invalid/non-finite runtime cells, and no-op safely when the cell set is empty. Non-empty events lock the confirmed cell centers when the instance is created so burst, cone, line, blast, or arbitrary area shapes remain tied to the resolution moment instead of following later targeting changes.

Each area pulse instance owns one `THREE.InstancedMesh` named `move-vfx-area-pulse-cells` with a constant plane geometry/material and one instance per affected cell. Scheduler frame time updates only instance transforms, shared material opacity, and visibility; the primitive does not rebuild geometry per frame and does not create timers or an independent RAF loop. The overlay uses the event palette supplied by the planner, which may be move-type coloured for damaging areas or semantic for non-damage area confirmations, with the neutral palette as a fallback.

Area pulse VFX remain visual-only runtime resources. They do not re-run area targeting, decide who was affected, mutate terrain/token placement/HP/status/combat stages, change permissions, persist data, lower renderer quality, add dependencies, or alter existing map overlays. Completion, event removal, layer-hidden aging, hidden-tab expiry, and map unmount all dispose the owned instanced mesh through the existing move VFX lifecycle. A primitive-level reduced-motion hint keeps the same cells readable with a smaller fade/pulse; the prop path is available now, while automatic app/OS preference wiring remains scoped to later controls/accessibility tickets.

### Radial burst primitive for VFX-045

`src/types/moveVfx.ts` and `src/types/moveAnimation.ts` now include the generic `radial-burst` event kind for burst/blast-style area confirmations. The generic planner emits this event, alongside the area cell pulse, for metadata-driven `burst`, `close-blast`, `ranged-blast`, or range-text blast/burst area scripts; it does not key off exact move names.

`src/utils/isometric/moveVfxRenderer.ts` resolves each radial burst from finite `areaCells`. User-centred close bursts lock to the user's foot/origin anchor when the origin is part of the affected cells or the computed centroid lands nearly on the user; remote or irregular shapes use the area-cell centroid. The radius is bounded from the farthest affected cell so irregular cell sets stay readable without expanding across the whole map.

Each radial burst instance owns two ground-plane rings plus eight lightweight outward rays using transparent additive materials, disabled raycasting, `depthTest: true`, `depthWrite: false`, and render orders just above area cell pulses. Scheduler frame time drives only opacity, scale, ray length, completion, and disposal; there is no geometry rebuild per frame, no timer, and no independent RAF loop. The primitive-level reduced-motion hint hides the rays and keeps a small opacity pulse so the event remains readable without large directional motion.

Radial burst VFX remain visual-only runtime resources. They do not re-run area targeting, decide affected tokens, mutate terrain/token placement/HP/status/combat stages, change permissions, persist data, reduce renderer quality, add dependencies, or alter existing targeting/roll-feedback overlays. Completion, event removal, hidden-tab expiry, layer-hidden aging, and map unmount dispose all owned ring/ray geometry and materials through the existing VFX lifecycle.

### Line and cone sweep primitives for VFX-046

`src/types/moveAnimation.ts` now lets area-based animation events carry optional `areaDirection` metadata from the area confirmation flow. The generic planner copies that direction onto metadata-driven `line-sweep` and `cone-sweep` events while still emitting the baseline `area-pulse`, so line/cone moves can resolve through one shared directional primitive without move-name-specific choreography.

`src/utils/isometric/moveVfxRenderer.ts` replaces the line/cone placeholders with one instanced ground-cell sweep primitive. The renderer filters invalid cells, locks the confirmed cell centers at instance creation, orders cells by projecting them along the supplied direction from the user/origin cell, and reveals them outward over the existing long VFX duration. If direction metadata is missing or invalid, the primitive safely falls back to an all-at-once area-pulse-style cell overlay instead of failing the move animation.

Each sweep instance owns one `THREE.InstancedMesh` named `move-vfx-area-sweep-cells` with constant plane geometry/material, disabled raycasting, transparent additive material settings, and render order just above area pulses. Scheduler frames update only instance transforms, shared material opacity, visibility, completion, and disposal; there is no geometry rebuild per frame, timer, independent RAF loop, or map/targeting recomputation. The primitive-level reduced-motion hint also uses the all-at-once pulse variant so users do not get a directional sweep while still seeing the confirmed area outcome.

Line/cone sweep VFX remain visual-only runtime resources. They do not decide affected cells/targets, mutate terrain/token placement/HP/status/combat stages, change permissions, persist data, lower renderer quality, add dependencies, or alter existing targeting/roll-feedback overlays. Completion, event removal, hidden-tab expiry, layer-hidden aging, and map unmount dispose the owned instanced geometry and material through the existing VFX lifecycle.

### Dash/pass afterimage primitive for VFX-047

`src/utils/isometric/moveVfxRenderer.ts` now replaces the `dash` placeholder with a generic movement-path cue for pass/dash-style outcomes. Dash events resolve and lock the move user's current foot/origin anchor plus the destination grid cell supplied by `destinationCell`; when only `pathCells` are present, the last valid path cell is used as the destination. The primitive renders a lightweight path streak, four constant-count afterimage glows, and a destination ring using the event palette or the neutral fallback.

Dash VFX deliberately do not move, offset, or mutate the real token render object. Existing move automation and token center interpolation remain the only systems that change saved placement or live token motion; the dash primitive is just an event-owned overlay that complements those systems. Missing destination data falls back to the existing self-pulse primitive on the user so movement-like events still communicate a resolved move without inventing a path, while a supplied destination with no resolvable start anchor no-ops safely.

Dash meshes and materials are runtime-only resources owned by the event lifecycle group and disposed through `disposeObject3D()` on completion, event removal, hidden-tab expiry, layer-hidden aging, or map unmount. Scheduler frame time drives reveal, opacity, completion, and reduced-motion handling; no independent RAF/timer loop, persistence, gameplay mutation, permission change, renderer-quality reduction, external asset, or new dependency is introduced.

### Shared material factory for VFX-049

`src/utils/isometric/moveVfxMaterials.ts` centralizes material creation for move VFX primitives. It provides fresh per-call factories for solid mesh cores, translucent overlay meshes, ring/line-style surfaces, future `THREE.Line` materials, and future sprite-like materials. All default to transparent additive styling with `depthTest: true`, `depthWrite: false`, and `toneMapped: false`; ring/translucent helpers default to double-sided rendering while solid projectile-style cores remain front-sided. Ring/ground-surface materials also default to a small negative polygon offset so flat VFX decals read above terrain, field-effect surfaces, and hazard decals while keeping depth testing enabled against raised geometry.

The material factory intentionally does not cache or share material instances. Each primitive owns the materials it creates inside its event lifecycle group, so `disposeObject3D()` can dispose geometries and materials once when an effect completes, is removed, expires while hidden, or the map unmounts. Future primitives should import these helpers instead of duplicating low-level `THREE.MeshBasicMaterial`, `THREE.LineBasicMaterial`, or `THREE.SpriteMaterial` configuration, and should document any deliberate override of the default transparency/depth policy.

### Render order and depth tuning for VFX-050

`src/utils/isometric/moveVfxRenderer.ts` now uses named render-order bands instead of independent per-primitive magic numbers. The reviewed WebGL stack is: terrain/voxel meshes at orders 0-8, field-effect and hazard surfaces around 9-18, weather/previews up to 30, move VFX ground/path/body effects at 32-36, and crit/above-token accents at 38-39. CSS3D HP bars, targeting reticles, and roll feedback remain in the existing CSS3D overlay rather than being reordered by move VFX.

Ground and cell effects use slightly higher world-space y offsets than hazards and field-effect decals, plus the ring-material polygon offset, so flat maps and raised terrain avoid most z-fighting without turning off `depthTest`. Projectile, beam, lunge, shell, mote, and afterimage materials keep `depthTest: true` and `depthWrite: false` so they stay world-space and do not create transparent-depth occlusion for tokens, HUDs, or later VFX in the same frame.

This tuning remains visual-only: it adds no scheduler source, timer, persistence hook, map/schema change, gameplay mutation, pointer target, dependency, or renderer quality reduction. Manual browser review should still cover flat maps, raised terrain, crowded tokens, active hazards/field effects, targeting overlays, and roll feedback, but the focused material/renderer tests now lock the default ring depth policy, render-order bands, and raised y offsets.

## Implementation labels, milestones, and ticket ordering

Use this section as the markdown project-board for the move VFX feature when GitHub labels or milestones have not been created yet. The goal is to keep implementation PRs small, dependency-aware, and reviewable. Every PR in this feature should carry the `move-vfx` label plus one or more focus labels from the list below.

### Suggested labels

| Label | Use for |
| --- | --- |
| `move-vfx` | All work for basic move animations and the reusable VFX layer. |
| `docs` | Scope, architecture, QA, release-note, and future-follow-up documentation. |
| `renderer` | Isometric grid, Three.js renderer utilities, primitive objects, render order, disposal, and scheduler hooks. |
| `move-automation` | Planner inputs, move automation enqueue callbacks, targeting/result integration, and transaction-derived semantic effects. |
| `testing` | Unit, integration, render-loop, lifecycle, and manual QA checklist work. |
| `accessibility` | Reduced-motion behaviour and animation enable/disable controls. |
| `performance` | Dirty-scheduler continuation, metrics, active-count diagnostics, allocation review, and bundle/runtime checks. |

### Milestones and hard ordering

| Milestone / section | Tickets | Primary labels | Hard ordering and exit criteria |
| --- | --- | --- | --- |
| **Foundations** | VFX-006 through VFX-018 | `move-vfx`, `docs`, `testing` | Start with `MoveAnimationEvent` contracts in VFX-006. After the event type exists, palette, anchors, ID policy, and planner contracts may proceed in parallel with VFX-009 timing helpers, but the queue must wait for the event, timing, and dedupe policy. Exit when typed events, palette/timing/anchor helpers, queue, planner contracts, generic classification, fallback/no-op behaviour, and non-persistence notes are present and tested where required. |
| **Renderer** | VFX-019 through VFX-030 | `move-vfx`, `renderer`, `performance` | Start with the `createMoveVfxRenderer` shell. Lifecycle/disposal, instance abstraction, scheduler continuation, frame stepping, prop plumbing, queue-to-page wiring, layer visibility, hidden-tab behaviour, unmount disposal, and optional metrics should land in that order or behind safe no-op guards. Exit when the renderer can receive events, animate only through the existing scheduler, and dispose cleanly. |
| **Primitives** | VFX-031 through VFX-054 | `move-vfx`, `renderer`, `accessibility` | Build a minimum visible set first: projectile, target flash, self aura, area pulse, shared material factory, render-order tuning, and reduced-motion variants. Richer effects such as trails, beams, arcs, lunge, miss, crit, healing, buff/debuff, status, radial/line/cone/dash, shake, badges, and the dev harness may follow once the primitive factory and lifecycle patterns are stable. Exit when common self, single-target, and area moves have reusable visual building blocks. |
| **Integration** | VFX-055 through VFX-068 | `move-vfx`, `move-automation`, `testing` | Add the enqueue callback before any automation path emits events. Then wire self, single-target hit/miss/no-accuracy, area, pass/dash, semantic transaction follow-up, field/hazard confirmations, cancellation guards, timing alignment, permission review, future non-move helper notes, debug logs, and map-reset cleanup. Exit when actual move automation can enqueue VFX without changing mechanics or permissions. |
| **Polish** | VFX-069 through VFX-075 | `move-vfx`, `accessibility`, `performance`, `docs` | Add the enable/disable control and automatic reduced-motion handling before final timing/heuristic/color/readability polish. Keep this milestone focused on behaviour visible to users and reviewers, not new mechanics. Exit when users can reduce or disable motion and the visuals are tuned enough for QA. |
| **QA and release readiness** | VFX-076 through VFX-086 | `move-vfx`, `testing`, `docs`, `performance` | Planner, renderer, continuation, and automation integration tests should land before the full verification pass. Manual QA, performance review, final architecture docs, future bespoke-animation backlog, PR checklist, and follow-up issue list close the phase. Exit when typecheck, tests, build, docs, and manual review notes all match the shipped implementation. |

### Tickets that can run in parallel

Parallel work is safe only after its shared contracts are merged. When in doubt, prefer the lowest-numbered dependency ticket and keep follow-up branches rebased on it.

- After VFX-006 lands, VFX-008 palette helpers, VFX-010 anchor helpers, VFX-011 ID policy, and VFX-014 planner contracts can be split into separate PRs. VFX-009 can proceed in parallel because its dependency is the VFX-004 dependency decision.
- After VFX-009 and VFX-011 land, VFX-012 queue work can proceed; VFX-013 should remain paired with or immediately after the queue implementation.
- After VFX-014 and VFX-008 land, VFX-015 planner classification can proceed; VFX-016 extension contracts and VFX-017 fallback rules should wait for the planner shape.
- After VFX-019, VFX-020, VFX-021, and VFX-010 establish renderer lifecycle, instance, and anchor contracts, independent primitive PRs may be split by effect family. Shared material/render-order tickets should stay early so primitive PRs do not duplicate low-level material settings.
- After VFX-024 through VFX-026 complete prop plumbing and page queue wiring, layer visibility, hidden-tab handling, unmount disposal, and development metrics can be reviewed independently if they do not change the renderer contract.
- After VFX-055 adds the automation callback and VFX-015 supplies planner output, self, single-target, no-accuracy, and area integration paths can be tested in focused PRs as long as cancellation/record-failure guards remain intact.
- QA documentation can be drafted early, but VFX-080 through VFX-086 should be finalized only against the playable implementation that reviewers will actually test.

### Recommended PR batches

| Batch | Tickets | Review focus |
| --- | --- | --- |
| **PR 1: Foundations and contracts** | VFX-006 through VFX-018 | Types, palette, timing, anchors, queue, planner contracts, generic classification, fallback/no-op behaviour, and transient/non-persisted data boundary. |
| **PR 2: Renderer integration** | VFX-019 through VFX-030 | Renderer shell, lifecycle, instance abstraction, scheduler continuation, frame stepping, Vue prop plumbing, page queue wiring, layer visibility, pause/resume, unmount disposal, and metrics. |
| **PR 3: Minimum visible primitives** | VFX-031, VFX-036, VFX-040, VFX-044, VFX-049, VFX-050, VFX-052 | Projectile, target flash, self aura, area pulse, shared materials, depth/render-order tuning, and reduced-motion variants. |
| **PR 4: Move automation integration** | VFX-055 through VFX-064 | Enqueue callback, self/single-target/no-accuracy/area animation triggers, pass/dash handoff, semantic transaction effects, field/hazard confirmations, cancellation guards, and timing alignment. |
| **PR 5: Richer primitives and sequencing** | VFX-032 through VFX-048, VFX-051, VFX-053, VFX-054 | Trails, beams, arcs, lunge, miss, crit, heal, buff/debuff, status, radial/line/cone/dash effects, optional shake/badge, multi-target staggering, and dev harness. |
| **PR 6: Controls, polish, and verification** | VFX-069 through VFX-082 | Enable/disable and reduced-motion controls, duration/classification/color/overlay polish, help text, planner/renderer/render-loop/automation tests, QA checklist, full verification, and performance review. |
| **PR 7: Final docs and future follow-up** | VFX-083 through VFX-086 | Implemented architecture docs, future bespoke per-move animation backlog, reusable PR checklist, and first-playtest follow-up issues. |

Do not merge a later batch ahead of a hard dependency unless the PR explicitly no-ops without the dependency and documents that temporary state. Avoid mixing unrelated batches in one PR; visual polish should not be bundled with foundation type changes unless required to fix the same ticket.

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
| Queue/state | `src/composables/map-editor/moveAnimationQueuePolicy.ts`, `src/composables/map-editor/useMoveAnimationQueue.ts` |
| Planner, palettes, and sequencing | `src/utils/moveAnimationPlanner.ts`, `src/utils/moveAnimationPalette.ts`, `src/utils/moveAnimationSequencing.ts` |
| Timing and anchors | `src/utils/isometric/moveVfxTiming.ts`, `src/utils/isometric/moveVfxAnchors.ts` |
| Renderer | `src/utils/isometric/moveVfxRenderer.ts` plus primitive helpers under `src/utils/isometric/` if split out |
| Render scheduling | `src/utils/isometric/renderLoop.ts`, `src/utils/isometric/animationFrame.ts`, and scheduler-related tests when a VFX continuation source is added |
| Vue prop plumbing | `src/components/IsometricGrid.client.vue`, `src/components/map/MapSceneRenderer.vue`, `src/components/map/MapScenePanel.vue`, `src/pages/maps/[slug].vue` |
| Move automation integration | `src/composables/map-editor/useMoveAutomationPanel.ts` |
| Tests | focused Vitest files for the queue, planner, renderer lifecycle, render-loop continuation, and move automation enqueue integration |

The exact file list may evolve as implementation details are discovered, but product changes should stay in the Rotom Table repository and should not introduce autonomous build-controller files.

## Follow-up documents and decisions

This brief now records the initial scope, visual style guardrails, and technical non-regression rules. Later tickets should refine it with:

- any future ADR that reopens the dependency-free decision for bespoke per-move animation work;
- final implemented API details once types, planner, renderer, and settings exist;
- timing, colour, render-order, and reduced-motion adjustments discovered during playable review;
- a manual QA checklist and future bespoke per-move animation backlog.
