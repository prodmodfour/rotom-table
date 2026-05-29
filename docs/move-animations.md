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

## Visual-only rule

Move animations are display-only. They may make an already-resolved or currently resolving move easier to read, but they must not be the source of truth for mechanics. In particular:

- Animation events must not mutate saved map, sheet, trainer, encounter, campaign, or session data.
- Animation events must not be serialized into map JSON or sheet JSON.
- Animation code must not decide whether a move hits, misses, crits, damages, heals, applies status, or moves a token.
- Existing move automation and permission checks remain authoritative.
- If animation planning or rendering fails, the move should still resolve according to the existing automation flow.

Move usage logs may continue to mention the move and its mechanical results through existing logging paths. The transient VFX event itself is not a log entry.

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

Later tickets should refine this brief with:

- visual style, duration, render-order, and reduced-motion guardrails;
- an explicit dependency decision for tweening versus internal math helpers;
- final implemented API details once types, planner, renderer, and settings exist;
- a manual QA checklist and future bespoke per-move animation backlog.
