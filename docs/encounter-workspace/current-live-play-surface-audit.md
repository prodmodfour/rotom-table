# Current live-play surface audit

- Audit: `encounter-ui-baseline-v1`
- Route: `/maps/:slug`
- Baseline commit: `164b510d`
- Date: 2026-08-04
- Design authority: [`DESIGN.md`](../../DESIGN.md)
- Structured inventory: [`data/encounter-workspace/live-play-surface-inventory.json`](../../data/encounter-workspace/live-play-surface-inventory.json)

## Scope and method

This audit follows every surface mounted by `src/pages/maps/[slug].vue` through `MapScenePanel`, `MapSceneRenderer`, `IsometricGrid.client`, their modals, and their nested action panels. It includes visible controls, pointer/context paths, keyboard-only paths, screen-reader announcements, accepted VFX, pending choices, system recovery, diagnostics, and GM administration. It separately records preparation behaviour that must stay in the Battlefield Workshop.

The structured inventory is the migration source of truth. Every row records its current owners, audience, activation path, visual layer, capabilities, known concerns, future context/home, migration ticket, and compatibility policy. Tests reject missing owners, duplicate IDs, unknown layers, or plan links.

## Baseline shape

The route is a 3,415-line orchestration owner. It composes a full-screen Three.js battlefield with at least 31 audited surface groups and six token-state dialogs. The route currently owns or coordinates:

- map, sheet, profile, encounter, initiative, scene, field, side, and shop snapshots;
- live commands, optimistic predictions, outbox recovery, realtime events, presence, and reconnect adoption;
- Move, Ability, Capability, Maneuver, Order, Item/Capture, Edge, and Feature presentation;
- targeting, movement, pending response, correction, VFX, action splash, and capture-result flows;
- terrain, voxel, hazard, dimension, visibility, shop-interface, and placement authoring.

The existing renderer and command paths are valuable and remain authoritative. The migration problem is presentation ownership: unrelated concerns compete as absolute overlays over one mandatory spatial canvas.

## Layer findings

### World

The renderer correctly owns exact cells, paths, areas, elevation, obstruction, hazards, token positions, and presence cues. Movement preview, area aim, pending spatial choices, world attention, and accepted VFX should remain available through `EncounterTacticalLens`.

The world currently also acts as the only entry point for token actions and state correction. This violates progressive spatiality: direct participant choices and ordinary action discovery require map gestures even when the server has already computed legal participants.

### Persistent controls

`InitiativeInfoBar` is the strongest precursor to the encounter turn spine. It already presents past/current/upcoming portraits, round state, focus, and GM advancement. It lacks waiting decisions and richer participant state, and remains a map overlay.

The generic `EncounterPresentationPanel` proves that source-agnostic offers, pending views, passives, affordances, diagnostics, and accepted facts can be projected together. It also demonstrates why the cockpit needs dedicated regions: action dock, resolution stack, inspector, and event feed are currently compressed into one floating glass panel.

Navigation, scene lifecycle, combat history, presence, and connection status each occupy independent overlay positions. There is no central focus or collision arbitration.

### Decision

There are parallel decision systems:

1. token context-menu source submenus;
2. Move branch/target/area HUDs and reticles;
3. Ability-specific declaration panel;
4. Capability action and adjudication modals;
5. normal Move response panel;
6. Attack of Opportunity response overlay;
7. generic pending interactions;
8. start-turn condition modal;
9. six token-state mutation dialogs;
10. field, sheet-spawn, and initiative modals.

These paths have individually useful authority checks, but visually permit overlay soup and make source taxonomy the navigation model. The target `EncounterDecisionLayer` asks one bounded question, while `EncounterResolutionStack` orders pending rules decisions and hands exact spatial questions to the tactical lens.

### System and recovery

Exact retry/status/abandon semantics in `LivePlayCommandRecoveryPanel` should be preserved. The current route also has separate saving, reconnect/stale, token-control, correction, and action-error overlays. The cockpit needs one prioritized `EncounterSystemStatus` region that preempts rules decisions when safety requires it and never resembles a Reaction.

### Inspector and Director

The GM admin modal combines encounter sides and interaction mode with map visibility, combat-log deletion, shop interfaces, ground level, and vertical bounds. The former migrate to Director workflows; the latter stay in Battlefield Workshop. Diagnostic latency, VFX, render metrics, operation IDs, and automation details move behind explicit authorized inspector modes.

## Surface migration matrix

| Current surface group | Current problem | Future home | Ticket |
| --- | --- | --- | --- |
| Battlefield renderer and world controls | Mandatory root for spatial and non-spatial tasks | `EncounterTacticalLens` plus Battle Stage selection | EUX-063/064 |
| Movement and targeting HUDs | Bounded choices and exact geometry are mixed | Decision Layer with tactical handoff | EUX-060–065 |
| Pending spatial overlays | Detached from response causality | Resolution Stack → Tactical Lens | EUX-056/064 |
| Presence pings/intents | Split between world and floating panel | Tactical presence layer plus System Status | EUX-034/066 |
| Accepted VFX/action splash | Multiple presentation queues | Battle Stage accepted queue | EUX-026/057 |
| Initiative info and modal | Turn spine and correction split | Turn Rail plus Director | EUX-040/073 |
| Scene controls/banner | Public summary and GM command mixed | Scene Header plus Director | EUX-034/073 |
| Generic encounter panel | Actions, pending, passives, diagnostics, history compressed | Action Dock, Resolution Stack, Inspector, Feed | EUX-050–057 |
| Combat log | Prose-derived state and GM IDs in public rail | Structured Event Feed plus Inspector | EUX-057 |
| Token context menu | Right-click/source chapters; mixed action and correction | Action Dock, Inspector, Director | EUX-087/088 |
| Token mutation dialogs | Six bespoke map dialogs | Generic correction decision workflow | EUX-054/088 |
| Ability/Capability panels | Source-specific decision UI | Generic Decision Layer | EUX-054 |
| Move/AoO response panels | Duplicate pending stacks | Resolution Stack | EUX-056 |
| Start-turn modal | Detached from actor/turn context | Resolution Stack | EUX-040/056 |
| Capture result modal | Accepted result blocks as a modal | Accepted choreography and Event Feed | EUX-057 |
| Field effects modal | Inspection, live control, and authoring mixed | Scene Header, Director, Workshop | EUX-045/073 |
| Sheet spawn menu | Hidden setup shortcut | Director reserves or Workshop placement | EUX-071 |
| Recovery panel and banners | Multiple competing system overlays | Encounter System Status | EUX-034/058 |
| GM admin modal | Director and Workshop ownership mixed | Director Panel and Battlefield Workshop | EUX-070/088 |
| Debug panels | Diagnostics leak into world elevation | Authorized Inspector | EUX-022/068 |
| Terrain/voxel/hazard/map authoring | Interleaved with live orchestration | `/maps/:slug` Battlefield Workshop | EUX-038 |

## Discoverability and accessibility baseline

Positive foundations:

- generic pending interactions move focus to a response heading;
- move choices expose keyboard-accessible buttons and text summaries;
- live state, correction, and accepted events have live regions;
- reduced-motion paths exist for Move VFX and accepted presentation;
- context submenu tooltips open on focus as well as hover.

Release blockers for the target experience:

- right-click is the primary route to ordinary actions and token mutations;
- field effects, sheets, initiative, and GM administration rely primarily on shortcuts (`Ctrl+F`, `Ctrl+S`, `Ctrl+I`, `Ctrl+Shift+A`);
- the navigation rail expands on hover and may cover encounter controls;
- many absolute surfaces can overlap without decision-priority arbitration;
- source-specific modals do not share focus restoration and resolution ordering;
- continuous saving pulse and extensive glass conflict with `DESIGN.md`;
- combat-log prose remains the visible history source;
- automation badges/details appear in ordinary Move selection rather than an inspector;
- mobile users inherit a full tactical canvas and context-first action model.

## Compatibility boundary

The audit does **not** authorize removal of `/maps/:slug`. During migration it remains the reliable map-backed compatibility route and becomes the Battlefield Workshop destination. The following must not regress:

- Three.js rendering, exact movement, targets, areas, elevation, obstruction, hazards, and fields;
- token placement, terrain/voxel editing, map dimensions, ground level, visibility, and shop interfaces;
- presence, pings, VFX, movement corrections, and pending spatial responses;
- server-authoritative commands, revisions, privacy projections, retries, and recovery.

Cockpit components consume existing snapshots and generic presentation contracts first. No UI component becomes mechanics authority, and no encounter document is introduced by this audit.

## EUX-001 acceptance

- Every mounted top-level live-play surface and nested token-state dialog is represented in the structured inventory.
- Every inventory owner exists and every migration ticket exists in the plan.
- All five normative visual layers are represented.
- Player, GM, public, diagnostic, system, tactical, and preparation concerns are mapped to future homes.
- Duplicated action, pending, history, status, and Director ownership is explicit.
- The compatibility boundary preserves the current map preparation and tactical workflow.
