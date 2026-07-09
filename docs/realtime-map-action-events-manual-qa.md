# Realtime map action events manual QA

Use this checklist to verify transient map action events in real browser sessions before releasing same-map visual sync. It complements the automated route and composable tests; it is not a replacement for a table-device pass with the GM's real campaign data.

## Automated checks before manual review

Run these commands from the Rotom Table repository before opening browser sessions:

```bash
npm run typecheck
npm test
npm run build
```

If a command fails, stop and fix or document the blocker before continuing. Keep screenshots, recordings, private campaign JSON, browser logs, and generated artifacts out of Git unless a reviewer explicitly requests sanitized evidence.

## Browser setup

1. Start the app locally with `npm run dev`. For a safe fixture pass, set `ROTOM_CAMPAIGN_ROOT` to a temporary campaign directory instead of using private table data.
2. Open the same player-visible map in two browser tabs or two separate browser contexts. A physical second device on the same trusted origin is preferred for the final table pass.
3. Open a third tab on a different map to confirm map-channel isolation.
4. Sign in as GM for broad flow coverage. If player-profile control is under review, repeat at least one move or splash flow as a player with a linked token and one denied flow with an unlinked token.
5. Prepare at least one user token, one target token, one trainer token with a Poké Ball in inventory, and one send-out option. Include enough map space for a self move, a single-target move, an area move, and a Poké Ball throw.
6. In one same-map tab, leave **Move VFX** enabled. In another same-map tab or context, turn **Move VFX** off. For accessibility coverage, run one same-map tab/context with `prefers-reduced-motion: reduce`.
7. Keep browser consoles visible. Realtime action events should not produce uncaught page errors.

## Result classification

**Blocker** means the issue should stop release until fixed:

- A remote visual event applies HP, conditions, combat stages, hazards, field effects, inventory changes, trainer roster updates, token deletion, map saves, or action logs.
- A player can publish a visual event for a token they do not control, or for a hidden/non-visible map.
- A viewer on a different map receives the first map's visual cue.
- The initiating tab or a remote tab shows duplicate splashes, roll overlays, VFX batches, or capture results for one action.
- One browser's disabled-animation or reduced-motion setting suppresses or changes another browser's configured visuals.
- Transient event ids, VFX queue entries, payloads, renderer snapshots, or visual-only result data appear in saved map, sheet, campaign, session, metadata, or log JSON.

**Polish** means the sync path is safe but a follow-up may improve clarity:

- A synced cue is readable but slightly too subtle, bright, short, long, or visually noisy.
- A remote overlay appears a little early or late but does not imply the wrong mechanical result.
- A reduced-motion variant is safe but could be more legible.

## Same-map visual coverage

Record Pass / Blocker / Polish for each row. The expected state change should happen only through the initiating action's existing map or sheet API path; remote replay is display-only.

| ID | Scenario | Action | Expected result |
| --- | --- | --- | --- |
| RT-01 | Move splash and VFX, normal hit | In tab A, use a scripted single-target damaging move until it hits. | Tabs A and B show one action splash, one local roll/feedback sequence, and the planned hit VFX according to each tab's settings. HP/log changes happen once through the initiating flow only. |
| RT-02 | Move miss | Use a scripted accuracy move until it misses. | Same-map viewers see the miss feedback and neutral miss VFX once. Remote viewers do not apply damage or status from the replay. |
| RT-03 | Crit/damage feedback | Use a scripted damaging move until a crit or visible damage callout occurs. | Same-map viewers see the crit/damage feedback phases once. Saved HP/log state reflects only the initiating action. |
| RT-04 | Self move | Use a self/healing/buff move such as **Synthesis** or **Swords Dance**. | Same-map viewers see the self-centred splash/VFX once. Remote replay does not move the token or change combat stages/HP. |
| RT-05 | Area move | Confirm a burst, blast, line, cone, or other area move covering multiple cells. | Same-map viewers see the confirmed area cue and affected-target follow-ups once. Excluded targets and cells outside the confirmed area do not receive hit visuals. |
| RT-06 | Ability splash | Use an active ability from the token context menu. | Same-map viewers see one ability splash. Remote viewers do not dispatch ability mechanics or sheet updates. |
| RT-07 | Maneuver splash | Use a maneuver from the token context menu. | Same-map viewers see one maneuver splash. Remote viewers do not apply maneuver mechanics. |
| RT-08 | Order splash | Use an order from the token context menu. | Same-map viewers see one order splash. Remote viewers do not apply order state. |
| RT-09 | Send-out splash | Send out a Pokémon from a trainer token. | Same-map viewers see one send-out splash. The sent-out placement is created only by the initiating authoritative action path. |
| RT-10 | Reaction splash | Trigger a listed reaction prompt such as Spite, Cute Charm, Poison Point, Moxie, or Celebrate when available. | Same-map viewers see one reaction splash. Remote viewers do not apply the reaction's gameplay changes. |
| RT-11 | Poké Ball throw and feedback | Throw a Poké Ball at a target. | Same-map viewers see the throw splash, arc-style throw VFX, and capture-roll feedback once. Inventory is decremented only by the initiating capture flow. |
| RT-12 | Poké Ball result | Complete a successful capture, miss, or error flow. | Same-map viewers see the result modal or error display once. Remote viewers do not update trainer sheets, delete captured tokens, consume inventory, append capture logs, or save map data. |

## Isolation, duplicate, and settings coverage

| ID | Scenario | Action | Expected result |
| --- | --- | --- | --- |
| RT-13 | Second-map isolation | Keep tab C on a different map while RT-01 or RT-11 runs on the first map. | Tab C receives no splash, VFX, feedback overlay, or capture result from the first map. |
| RT-14 | Local echo prevention | Watch the initiating tab during RT-01, RT-06, RT-09, and RT-11. | The initiating tab keeps its immediate local behaviour and does not replay a second echo copy of the same splash, feedback, VFX, or result. |
| RT-15 | Duplicate event prevention | Reconnect or reload a same-map tab during/after an action, then let the same accepted move arrive through SSE replay, HTTP retry/duplicate response, and **Check server** status recovery where practical. | The durable accepted move summary is presented at most once per operation ID. Existing visible cues are not restarted by another terminal delivery channel. |
| RT-15A | Missing transient move hint | Block or miss the transient `map-action` move-animation request in tab B while leaving accepted-command SSE/replay connected, then resolve a move in tab A. | Tab B still presents one generic accepted move cue from the durable result, including mixed hit/miss and area/pass geometry where applicable. Mechanics remain unchanged. |
| RT-16 | Disabled VFX on one client | Turn **Move VFX** off in tab B, keep it on in tab A, then run RT-01 and RT-11. | Tab B still sees splashes, roll/capture feedback, and result UI, but suppresses move VFX. Tab A still shows its configured VFX. Mechanics are unchanged. |
| RT-17 | Reduced motion on one client | Enable `prefers-reduced-motion: reduce` in tab B/context B, keep full motion in tab A, then run RT-01, RT-05, and RT-11. | Tab B receives semantic reduced-motion cues while tab A keeps full-motion cues. The preference is not saved to map/sheet/campaign/session data. |
| RT-18 | Persistence spot check | After several synced actions, save/export/reload the map or inspect its JSON file. | No transient action-event data appears in saved JSON. Existing mechanical logs or state changes that would have happened without realtime replay may remain. |

## Code-assisted browser smoke result

A same-machine browser smoke was run to exercise the map-scoped realtime path with multiple Chromium contexts. This smoke used a temporary external campaign fixture copied from public example sheets/maps, a local Nuxt dev server, GM role cookies, two tabs on the same map, one tab on a second map, one context with **Move VFX** disabled, and one context with `prefers-reduced-motion: reduce`.

| Item | Observed result |
| --- | --- |
| Date | 2026-06-09 |
| Same-map action splash | Passed: both same-map tabs displayed `Abra uses QA Splash Once`. |
| Duplicate event id | Passed: a second payload with the same event id did not replace the original splash text. |
| Second-map isolation | Passed: the second-map tab displayed no splash and no active VFX from the first map. |
| Move VFX settings | Passed: normal and reduced-motion same-map contexts reported active VFX; the disabled-VFX context reported zero active VFX. |
| Move and Poké Ball feedback payloads | Passed: transient move-feedback and Poké Ball feedback events were accepted by the same-map receivers without page or console errors. |
| Poké Ball result UI | Passed: the same-map receiver displayed the capture-result modal for the transient result payload. |
| Visual-only persistence | Passed: the temporary map JSON was unchanged after transient events and contained no action-event/VFX payload fields. |
| Browser errors | Passed: no page errors or console errors were reported; Chromium emitted only non-fatal WebGL performance warnings already seen in prior VFX review. |

Limitations of this smoke: it used direct transient event publication to cover the realtime bridge and settings/isolation behaviour, not a full human right-click/action-flow pass, and it did not use a physical second device. Run the full checklist above on real table devices before relying on the feature in play.

## Review note template

```text
Realtime map action events QA date:
Reviewer / browsers / OS:
Commands run: npm run typecheck; npm test; npm run build
Map(s), sheets, and tokens used:
Same-map sessions: tabs/contexts/devices:
Second-map isolation checked? yes/no:
Player-profile control checked? yes/no:
Rows passed:
Rows blocked:
Rows marked polish:
Persistence spot check result:
Console/network observations:
Follow-up issues to file:
```
