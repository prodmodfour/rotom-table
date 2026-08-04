# Current player and GM encounter task inventory

- Inventory: `encounter-task-baseline-v1`
- Baseline commit: `164b510d`
- Date: 2026-08-04
- Structured source: [`data/encounter-workspace/encounter-task-inventory.json`](../../data/encounter-workspace/encounter-task-inventory.json)
- Surface audit: [Current live-play surface audit](current-live-play-surface-audit.md)

## Purpose

This inventory describes what people are trying to accomplish, not which rules chapter or component currently implements it. It freezes 35 current tasks across players, GMs, public observers, authorized responders, and diagnostic operators. Each task records its present flow, authority inputs, accepted outcome, spatial needs, known problems, future experience state, and migration owner.

This is a baseline, not permission to move mechanics into the client. Every target flow continues to consume server-authorized offers, targets, choices, revisions, accepted facts, and recovery actions.

## Player/controller journey

A controller currently has to combine the tactical canvas, initiative strip, context menu, generic encounter panel, source-specific panels, and response overlays.

| Intent | Current path | Baseline | Target path |
| --- | --- | --- | --- |
| Know whose turn/decision it is | Initiative bar + scene banner + pending panels | Partial | Turn Rail + Resolution Stack |
| Select a participant | Token or initiative portrait | Partial | Participant cards with separate current/selected/inspected/target state |
| Resolve start-turn state | Blocking start-turn modal | Available | Ordered Resolution Stack |
| Discover legal actions | Right-click source submenus or generic panel | Partial | Intent-grouped Action Dock |
| Understand unavailable action | Disabled title/tooltip or generic reason | Partial | Concise reason + optional Inspector explanation |
| Declare Move/Ability/Capability/Maneuver/Order | Multiple source-specific paths | Partial | Shared action and decision anatomy |
| Choose participant targets | Map reticles or modal rows | Partial | Participant choice cards/relationship view |
| Choose cells, paths, areas, direction | Full map HUD | Available | Deliberate Tactical Lens handoff |
| Move | Canvas route preview + pending overlays | Available | Movement action → Tactical Lens → Resolution Stack |
| Answer/pass a Reaction | Three possible pending surfaces | Partial | One ordered Resolution Stack |
| Use item/capture | Target context menu → item list → result modal | Available | Actor action → target/item decision → accepted choreography |
| Send out/switch/recall | Trainer context menu and raw token mutation | Partial | Team/reserve presentation + bounded placement |
| Inspect participant | Context menu, passives, sheet navigation | Partial | Participant card + privacy-safe Inspector |
| Understand accepted result | VFX, splash, prose log, generic recent outcomes | Partial | One causal presentation queue + structured Event Feed |
| Recover uncertain command | Recovery overlay | Available semantics, weak hierarchy | Blocking System Status workflow |

### Main player findings

- **Action discovery is spatial and source-first.** The ordinary starting point is a right-click on an on-map token followed by Move, Ability, Maneuver, Order, send-out, or item submenus.
- **Equivalent choices do not look equivalent.** Participant choices may be token reticles, Capability modal rows, Ability panel controls, or generic pending options.
- **Waiting is fragmented.** Start-turn conditions, normal Move responses, Attack of Opportunity, generic interactions, and spatial pending choices do not share one ordered parent.
- **Off-map state is weak.** Reserves, boxed/team Pokémon, hidden participants, and switch/recall state do not have a persistent encounter representation.
- **Accepted history is duplicated.** VFX, splashes, capture modal, prose combat log, and generic accepted facts compete instead of settling into one chronology.
- **Safety semantics are stronger than their placement.** Exact retry and recovery exist, but they are one overlay among ordinary game overlays rather than a preemptive system state.

## GM/Director journey

The GM currently combines ordinary token actions with shortcut-only modals and direct map editing.

| Intent | Current path | Baseline | Target path |
| --- | --- | --- | --- |
| Start/end scene | Floating scene button/banner | Partial | Scene Header + Director lifecycle |
| Configure sides | GM Admin (`Ctrl+Shift+A`) | Partial | Director cast/sides workflow |
| Set and advance initiative | Initiative modal (`Ctrl+I`) + top strip | Available | Turn Rail + Director corrections |
| Add/remove participants | Sheets (`Ctrl+S`) + token delete | Partial | Cast/reserves/waves/reveal workflow |
| Manage field state | Field Effects (`Ctrl+F`) | Partial | Public summary + Director lifecycle |
| Author map hazards | Field modal + canvas edit mode | Available | Workshop authoring or mechanic-driven Tactical Lens |
| Correct HP/stages/conditions/damage/XP | Token context menu + six dialogs | Available | Explicit correction workflow and audit |
| Correct Move operation | Prose log → operation panel | Available | Structured history → correction Inspector |
| Recover stuck response | Source-specific pending panel controls | Partial | Resolution Stack + Director recovery |
| Switch setup/live mode | Hidden GM Admin mode control | Partial | Explicit Workshop/Encounter boundary |
| Maintain visibility/shops/ground/dimensions | GM Admin + map edit state | Available | Battlefield Workshop |
| Inspect diagnostics | Multiple debug overlays and details | Partial | Authorized level-5 Inspector |
| Manage objectives/phases/waves | Out-of-band notes + raw token mutation | Missing | Director objectives/phases/waves |
| Build and launch encounter | Generate/tables/maps/manual spawning | Partial | Encounter Builder |

### Main GM findings

- **Director and Workshop ownership is mixed.** Sides and interaction mode sit beside shop interfaces, map visibility, ground level, and vertical bounds.
- **High-value entry points are invisible.** Field, sheet spawn, initiative, and GM administration depend primarily on keyboard shortcuts.
- **Corrections resemble game actions.** Direct HP/status/damage edits originate from the same token menu as Moves and Orders.
- **Encounter orchestration is incomplete.** Hidden cast, reserves, reveal, waves, objectives, phases, stakes, and clocks are absent as first-class state.
- **Generation is not launch.** Current tools produce rolls/files; the GM still assembles battlefield, placements, sides, and initiative manually.

## Progressive spatiality baseline

| Level | Current task count | Interpretation |
| --- | ---: | --- |
| None | 17 | Most turn, action, response, history, correction, and Director work does not need the map. |
| Relationship | 2 | Direct target/capture tasks need server-derived ally/foe/range facts, not exact cells. |
| Exact | 5 | Areas, paths, hazard cells, placement, pings, and battlefield authoring require a tactical lens. |
| Mixed | 11 | Tasks begin as cards/choices and conditionally hand off to exact geometry. |

The current product makes the exact-spatial surface primary for all 35 tasks. The target reverses that default without hiding geometry when it matters.

## Product gaps frozen by this inventory

The following are not treated as polish because the current task is partial or missing:

- separate current actor, selected actor, inspected participant, target preview, and tactical focus;
- one priority model for start-turn, optional triggers, Interrupts, Reactions, adjudications, recovery, and system blocking;
- explicit reserves, recall, switch, hidden cast, reveal, waves, and reinforcements;
- structured objectives, stakes, phases, clocks, and public/private notes;
- one accepted-result queue and structured history;
- visible Director and Workshop entry points;
- a complete builder-to-launch workflow.

## Compatibility commitments

- Existing server command, target, pending, revision, retry, correction, and accepted-event authority remains unchanged unless an owning domain plan explicitly changes it.
- Exact movement, area targeting, placement, terrain, hazards, VFX, and presence remain available through the existing renderer.
- `/maps/:slug` remains usable while the cockpit ships behind an explicit flag.
- The target workspace may simplify steps, but it cannot silently remove a current available task or expose private choices.

## EUX-002 acceptance

- 35 tasks cover turn taking, action discovery and use, targeting, movement, responses, pass/recovery, switching, capture, inspection, accepted outcomes, field management, correction, Director work, diagnostics, and encounter launch.
- Every task names its roles, spatiality, current owners, authority inputs, accepted outcome, current problems, target experience state, future home, and migration ticket.
- Available, partial, and missing baselines are explicit.
- Player and GM tasks use shared intent language rather than rules-source navigation.
