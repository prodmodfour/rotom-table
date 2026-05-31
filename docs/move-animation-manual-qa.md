# Move animation manual QA checklist

Use this checklist for the Basic Move Animations / reusable VFX layer before merging or releasing the feature. The checklist is text-only by design; add screenshots or short screen recordings only if a reviewer explicitly asks for them and follow the existing [screenshots guide](screenshots.md).

## Automated checks before manual review

Run these commands from the Rotom Table repository before opening the browser review:

```bash
npm run typecheck
npm test
npm run build
```

If any command fails, stop and treat the run as blocked until the failure is understood. `npm run check:move-automation` is still optional for this feature because the explicit move automation registry is intentionally incomplete.

## Browser setup

1. Start the app locally with `npm run dev`.
2. Sign in as GM, open a map, and use at least two controllable tokens. Three or more tokens are recommended for area and crowded-map passes.
3. Put one user token on normal flat terrain, one target token on a neighbouring/open cell, and at least one target on or near raised terrain.
4. Make sure the user token has representative scripted moves available. Good examples from the current explicit automation set:
   - single-target damaging: **Tackle**, **Ember**, **Water Gun**, **Rock Throw**, **Thunderbolt**;
   - no-accuracy single target: **Helping Hand**;
   - self/healing/buff: **Synthesis**, **Swords Dance**, **Hone Claws**, **Reflect**;
   - status or condition: **Will-O-Wisp**, **Nuzzle**, **Supersonic**, **Sand Tomb**;
   - debuff: **Growl**, **Charm**, **Scary Face**, **Mud-Slap**;
   - area/burst: **Discharge**, **Rock Slide**, **Boomburst**, **Howl**;
   - line/cone-like area: **Origin Pulse**, **Precipice Blades** when their confirmed area template is available;
   - pass/dash: **Scratch**, **Aqua Tail**, **Leaf Blade**, **Slash**.
5. For deterministic primitive review, open the same map with `?debug=move-vfx` in a development build, select a controllable token, and use the bottom-right Move VFX harness. The harness is especially useful for miss, crit, line/cone, field/hazard confirmation, reduced-motion, and crowded/raised-terrain checks when random move rolls or current scripted move coverage do not produce that exact scenario quickly.
6. Keep the browser devtools console visible. Move VFX should not produce uncaught errors during normal play.

## Result classification

Use these labels when recording the manual pass.

**Blocker** means the issue should stop merge/release until fixed:

- move automation mechanics change because of VFX, or a successful move cannot resolve when VFX fails;
- the map, sheet, log, or saved JSON gains transient VFX event data;
- VFX intercepts targeting clicks, context menus, token controls, camera controls, or map editing;
- VFX reveals hidden-token information when the token layer is hidden;
- the **Move VFX** toggle or `prefers-reduced-motion` behaviour is ignored;
- active effects never settle and keep the render scheduler alive after the VFX should be complete;
- map switch, hidden-tab resume, or unmount leaves stale VFX objects visible or causes console errors;
- renderer quality or existing map features are degraded to make VFX work.

**Polish** means the feature can still function but should be logged for follow-up:

- a type colour is readable but not ideal against a specific terrain surface;
- an effect is slightly too subtle, bright, short, long, or visually noisy;
- a generic classification is understandable but not the best long-term choreography for that exact move;
- minor overlap with roll feedback, HP bars, terrain edges, weather, hazards, or neighbouring tokens remains readable;
- a sequence feels slightly early/late but does not misrepresent the mechanical result.

## Core move-flow checklist

Record Pass / Blocker / Polish for each row. If a real scripted move cannot produce the exact visual state in a reasonable time, use the Move VFX dev harness fallback named in the row and mark that the coverage was harness-based.

| ID | Scenario | Action | Expected visual behaviour | Blocker versus polish guidance |
| --- | --- | --- | --- | --- |
| QA-01 | Single-target hit | Use **Tackle**, **Ember**, **Water Gun**, **Rock Throw**, or another scripted damaging move on a visible target. Repeat until a normal hit is observed if the first roll misses. | A concise launch/contact cue starts from the user, points to the selected target, then a type-coloured target flash or impact ring appears only on that target. Roll feedback and HP/log updates remain readable and authoritative. | Blocker if the wrong target flashes, mechanics/logs change, targeting clicks are intercepted, or no VFX plays for a successful scripted hit. Polish if the chosen generic primitive could better match the move. |
| QA-02 | Single-target miss | Use a scripted accuracy move until a miss occurs, or use the dev harness **Miss puff** preview from a selected token. | The target does not receive damaging impact styling. A neutral, understated miss puff/ring appears near or just past the intended target and fades quickly. The move log/feedback says miss and HP is unchanged unless the move's script says otherwise. | Blocker if a miss looks like a damaging hit, mutates HP incorrectly, or shows a hit/crit accent. Polish if puff placement is slightly hard to read. |
| QA-03 | Critical hit | Use a scripted damaging move until a crit occurs, or use the dev harness **Crit burst** preview. | The normal hit read remains, with a short extra crit burst/accent at the affected target. The crit accent layers above the hit without hiding HP bars or roll feedback. | Blocker if non-crits show the crit burst, crits lose normal hit feedback, or the accent hides authoritative UI. Polish if the burst is readable but too subtle/strong. |
| QA-04 | No-accuracy single target | Use **Helping Hand** on a visible target. | The flow does not show fake accuracy-roll feedback. The target receives a semantic status/buff-style cue and the condition/log update remains unchanged. | Blocker if the no-accuracy move opens an unnecessary roll, skips the mechanical update, or enqueues VFX after cancellation. Polish if semantic colour could be clearer. |
| QA-05 | Self move | Use **Swords Dance**, **Hone Claws**, or **Reflect** from the selected token. | A self-centred aura or buff/status cue appears around the user, not around a fake target. It resolves quickly and does not move the token. | Blocker if self VFX requires target selection, moves placement, or changes permissions. Polish if the aura is readable but obscures the token briefly. |
| QA-06 | Healing | Lower the user's HP, then use **Synthesis** or use a damaging drain move such as **Absorb** when available. | A green/healing semantic pulse appears on the healed token after/with the mechanical heal. HP changes still come from the transaction, not the VFX. | Blocker if healing VFX appears without a heal transaction or HP changes are wrong. Polish if the swirl/pulse is a little too busy. |
| QA-07 | Status/condition | Use **Will-O-Wisp**, **Nuzzle**, **Supersonic**, **Sand Tomb**, **Poison Gas**, or the dev harness **Status cloud** preview. | A compact status cloud/semantic pulse appears at the affected token or confirmed area cells after a successful condition outcome. It should not add condition-specific bespoke art or text unless the event explicitly asks for it. | Blocker if status VFX appears on unaffected targets or conditions mutate incorrectly. Polish if condition tint could be more distinct. |
| QA-08 | Buff/debuff | Use **Swords Dance**/**Hone Claws** for a buff and **Growl**, **Charm**, **Scary Face**, or **Mud-Slap** for a debuff. | Buffs read as rising/positive semantic particles or aura; debuffs read as falling/negative semantic particles. Combat-stage glass/logs remain authoritative. | Blocker if the direction/tone is reversed for applied stage changes or stages are changed by VFX. Polish if particle count or opacity needs tuning. |
| QA-09 | Area burst / blast | Use **Discharge**, **Rock Slide**, **Boomburst**, **Howl**, or the harness **Area pulse** + **Radial burst** previews. Confirm an area covering multiple cells and at least one target. | Confirmed cells pulse after the area overlay is accepted. Burst/blast-style moves add a centre-out accent. Only affected/selected targets receive follow-up flashes, misses, or semantic cues. | Blocker if excluded/friendly/unaffected targets get hit VFX, area overlays remain clickable over impacts, or cells outside the confirmed area light up. Polish if cell opacity or stagger needs tuning. |
| QA-10 | Line/cone | Use a scripted line/cone-like area move when available, or use harness **Line sweep** and **Cone sweep**. | Cells reveal in the confirmed direction without recomputing targeting. Reduced-motion mode should turn this into an all-at-once fade/pulse. | Blocker if the sweep points opposite the confirmed direction, ignores confirmed cells, or makes targeting UI unusable. Polish if the sweep speed feels slightly off. |
| QA-11 | Pass/dash | Use **Scratch**, **Aqua Tail**, **Leaf Blade**, **Slash**, or harness **Dash / pass**. Pick a pass destination/path when prompted. | A path streak/afterimage and destination pulse appear as a VFX overlay. The real token placement changes only through the existing move automation/token movement path, not because VFX offsets it. | Blocker if VFX moves/saves the token independently, destination pulses on the wrong cell, or stale afterimages remain after completion. Polish if the path read is subtle. |
| QA-12 | Field/hazard confirmation | Use any currently scripted field/hazard move if one is enabled in the move menu; otherwise use harness **Area pulse**, **Status cloud**, or **Self aura** to verify the lightweight confirmation visuals. | Field/weather/room confirmations read as a brief semantic pulse at the user; hazard confirmations read as a short status-toned area pulse over finite hazard cells. Existing persistent weather/field/hazard renderers remain authoritative after the transaction. | Blocker if transient VFX replaces or corrupts persistent hazard/field state, persists VFX data, or cannot safely no-op when hazard cells are missing. Polish if the confirmation cue needs clearer tone. |

## Accessibility and settings checklist

| ID | Scenario | Action | Expected visual behaviour | Blocker versus polish guidance |
| --- | --- | --- | --- | --- |
| QA-13 | Reduced motion | Enable OS/browser `prefers-reduced-motion: reduce`, reload the map, then run QA-01, QA-09, QA-10, and QA-11 or the matching harness previews. | Semantic cues still appear, but fast travel, large sweeps, repeated orbiting, afterimage displacement, and shake are reduced or disabled. No saved map/campaign setting changes. | Blocker if full-motion variants still play, animations disappear entirely for semantic outcomes, or the preference causes hydration/runtime errors. Polish if reduced pulse is readable but could be gentler. |
| QA-14 | Disabled animations | Use the map overlay **Move VFX** toggle to turn animations off, then resolve **Tackle** or **Swords Dance**. Turn it back on and repeat. | While off, move automation, targeting, roll feedback, HP/status/stage updates, field/hazard state, and logs still work; no move VFX appears and active VFX clears. When re-enabled, future moves animate normally. | Blocker if disabling VFX changes mechanics, leaves old VFX active, or fails to re-enable later. Polish if the label/placement of the toggle is unclear. |
| QA-15 | Layer visibility | Hide the token layer while VFX would be active, then show it again after the effect duration. | Move VFX hide with tokens, keep aging, and do not resurrect after they have completed. Hidden-token action is not revealed by VFX. | Blocker if VFX stays visible while tokens are hidden or completed effects reappear. Polish if the transition is visually abrupt but safe. |

## Lifecycle, edge-case, and map-UX checklist

| ID | Scenario | Action | Expected visual behaviour | Blocker versus polish guidance |
| --- | --- | --- | --- | --- |
| QA-16 | Map switch/reset | Start a visible VFX, immediately navigate to another map or reload/adopt a different map payload, then return. | The old VFX clears with the old map scene. No stale effects, console errors, or saved VFX fields appear on either map. | Blocker if VFX persists across maps, floats at old coordinates, or crashes during unmount. Polish if cleanup causes a harmless visual cut. |
| QA-17 | Hidden tab pause/resume | Start a long/harness **Play all primitives** sequence, hide the browser tab for longer than the effect duration, then return. Repeat with a brief hide shorter than the duration. | Long-hidden effects expire before the first resumed frame and do not jump to a final catch-up pose. Briefly hidden effects resume from wall-clock progress. No background VFX loop runs while hidden. | Blocker if effects freeze forever, jump through large catch-up motion, or keep console/reporting active while hidden. Polish if resume fade is slightly abrupt. |
| QA-18 | Crowded map | Place 5+ tokens in adjacent cells with HP/status HUD visible. Run **Discharge**, **Rock Slide**, harness **Play all primitives**, or several single-target moves in quick succession. | VFX remains readable but does not hide token identity, HP bars, reticles, roll feedback, or context menus. Events complete and the scene returns to idle. | Blocker if controls become unusable, HUD is hidden, or scheduler never settles. Polish if opacity/stagger should be tuned for crowded encounters. |
| QA-19 | Raised terrain | Put the user or target on raised terrain/voxels and run **Rock Throw**, **Water Gun**, **Area pulse**, **Dash / pass**, and **Impact ring** previews. | Anchors follow token/cell elevation. Ground rings and cell overlays sit above terrain without obvious z-fighting, while projectiles/beams remain world-space and do not clip through tokens badly. | Blocker if VFX appears on the wrong elevation/cell or breaks interaction with raised terrain. Polish if small z-fighting or clipping is visible but rare/readable. |
| QA-20 | Targeting and roll feedback overlays | Start a targeting move, cancel it, then start another and resolve it. Also watch the result phases for an accuracy move. | Cancelling does not enqueue VFX. On resolution, targeting reticles clear before impacts, and hit/miss/crit/semantic follow-ups align with the existing roll-feedback phases. | Blocker if cancelled moves animate, stale reticles remain clickable over impacts, or VFX desynchronizes enough to imply the wrong result. Polish if timing is close but could feel snappier. |
| QA-21 | Permission boundary | As a player profile, try to animate with a token the profile does not control, then with a linked/controllable token. | The move menu/VFX path follows existing token-control permissions. Dev harness previews require a controllable selected token. | Blocker if a player can create gameplay-looking VFX around an uncontrolled token. Polish if disabled menu affordance needs clearer copy. |
| QA-22 | Persistence spot check | After resolving several moves, save/export/reload the map or inspect the map JSON under `data/maps/`. | No transient VFX fields appear: no `moveAnimations`, `activeMoveAnimations`, `move-vfx-*` ids, VFX durations, palettes, or renderer debug snapshots. Existing mechanical logs/transactions may remain as usual. | Blocker if VFX event data is persisted. Polish if documentation should clarify an allowed mechanical log entry. |

## Suggested review note template

Record blocker and polish triage in the relevant PR, issue tracker, or a focused follow-up document such as [Move VFX first-playtest follow-up issues](move-vfx-follow-up-issues.md).

```text
Move VFX manual QA date:
Reviewer / browser / OS:
Commands run: npm run typecheck; npm test; npm run build
Map and tokens used:
Harness used? yes/no; URL query:
Rows passed:
Rows blocked:
Rows marked polish:
Persistence spot check result:
Scheduler/debug observations, if render debug was enabled:
Follow-up issues to file:
```
