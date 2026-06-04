# Move VFX first-playtest follow-up issues

This page records the first small follow-up issue list for the Basic Move Animations / reusable VFX layer. It is intentionally a triage document, not a scope expansion for the initial feature: blockers should be fixed before release, polish can be scheduled in small later PRs, and bespoke per-move wishes stay in the future bespoke milestone described in [Move animations implementation brief](move-animations.md#future-bespoke-per-move-animations).

## Playtest summary

- **Date:** 2026-05-31
- **Reviewer environment:** Chromium via Playwright on Linux, local Nuxt dev server, GM login.
- **Target branch:** move VFX feature branch
- **Fixture:** temporary external `ROTOM_CAMPAIGN_ROOT` under `/tmp/rotom-vfx-playtest-campaign`; no campaign fixture, screenshots, or generated files are committed.
- **Map coverage:** dark/saturated terrain, rain, electric terrain, a spike hazard, flat cells, y=1/y=2 raised platforms, and neighbouring/crowded token placements.
- **Token-size coverage:** small Charmander/Chikorita/Aipom, medium Amaura, and large Abomasnow.
- **Move/VFX coverage:** real scripted **Ember** single-target damage flow plus the `?debug=move-vfx` harness for projectile, beam, arc/lob, melee lunge, self aura, target flash, impact ring, area pulse, radial burst, line/cone sweep, dash/pass, miss puff, crit burst, status cloud, healing pulse, buff particles, badge, and **Play all primitives**.
- **Settings coverage:** full motion, `prefers-reduced-motion: reduce`, and the browser-local **Move VFX** disabled state.

## Ship-readiness result

No blocker was found in this pass.

Observed checks:

- The real **Ember** flow resolved through normal move automation and combat log output while VFX remained visual-only.
- Full-motion **Play all primitives** reported active transient effects, remained pointer-transparent to the surrounding UI, and settled without console errors.
- The **Move VFX** toggle changed to **Animations off** and suppressed new harness VFX without changing move automation state.
- Reduced-motion review completed without runtime errors and without saving an animation preference or transient event to the map document.
- A persistence spot check found no `moveAnimations`, `activeMoveAnimations`, `move-vfx-*` event ids, durations, palettes, or renderer snapshots in the map JSON; only ordinary map/sheet mechanical state changed.
- Chromium emitted WebGL driver `ReadPixels` performance warnings during one non-reduced local run, but no app exception or scheduler-stuck behaviour was observed.

## Follow-up issues

Prioritize readability, accessibility, and performance validation before novelty effects.

| ID | Priority | Type | Issue | Acceptance notes |
| --- | --- | --- | --- | --- |
| MVFX-FU-001 | P1 | Accessibility / readability | Re-review reduced-motion primitive visibility on rainy, dark maps. In the reduced-motion **Play all primitives** pass, semantic pulses were safe but easy to miss in a 1-second screenshot while the harness still reported active effects. | Reduced-motion variants should keep at least one source, target, or affected-cell cue clearly perceivable at common zoom without restoring fast travel, large sweeps, displacement, shake, persistence, or a separate animation loop. |
| MVFX-FU-002 | P2 | Timing / readability | Check fast-travel primitives against raised terrain and active rain. Projectile, dash/pass, and line/cone previews are intentionally concise, but individual 400 ms review snapshots could miss the key visual beat. | Ensure launch/contact or destination keyframes remain readable for quick moves on flat and raised cells while staying inside the documented timing guardrails. |
| MVFX-FU-003 | P2 | Clutter / visual polish | Review crowded-target opacity and weather overlap. **Play all primitives** around a large target stayed functional, but rain and stacked accents can make the target area visually busy. | Tune opacity, staggering, or sequencing only if needed; do not lower weather/field-effect quality, hide HUD/reticles, or extend effects beyond the pacing guardrails. |
| MVFX-FU-004 | P2 | Performance validation | Capture a small render-debug/performance sample for **Play all primitives** on a crowded rainy map in a headed browser. The first pass saw Chromium WebGL `ReadPixels` warnings but no app errors. | Confirm the move-vfx continuation settles, no duplicate idle loop appears, and any browser-driver warning is documented or fixed without reducing renderer quality. |
| MVFX-FU-005 | P3 | QA tooling | Make dev-harness screenshot review less prone to hover-tooltip obstruction. Several primitive screenshots included the harness button tooltip over the map, which is harmless for players but noisy for QA evidence. | Provide a documented screenshot tip or a small dev-harness affordance to suppress/avoid tooltips during visual capture; no production player UI change is required. |
| MVFX-FU-006 | P3 | Manual QA coverage | Run a human table-style playtest with actual scripted move choices after this code-assisted browser pass. Cover at least one self move, one no-accuracy target move, one area move, one pass/dash move, a miss, and a crit when practical. | File separate bugs only for mechanical/VFX regressions; keep minor choreography preferences as polish unless they hurt readability or accessibility. |

## Noted non-issues from this pass

- No missing generic primitive was identified for the reviewed basic categories.
- No generic classification mismatch was confirmed from the sampled real **Ember** flow or harness categories.
- No hidden persistence, permission expansion, renderer-quality reduction, or independent animation-loop behaviour was observed.

## Future per-move wishes kept out of this phase

The following are examples of future bespoke-animation requests that should not block the generic VFX feature:

- unique **Ember** flame choreography instead of the generic typed projectile/impact read;
- move-name-specific water, lightning, or leaf shapes;
- custom condition-specific clouds for individual statuses;
- longer cinematic sequences for iconic moves.

Track any such request under a future bespoke per-move animation milestone and reuse generic primitives first.
