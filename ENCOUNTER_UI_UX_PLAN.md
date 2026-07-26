# Encounter UI and UX Implementation Plan

`PLAN_STATUS: QUEUED`

`CURRENT_TICKET: EUX-001`

`BLOCKED_BY: FEATURE_AUTOMATION_PLAN.md — PLAN_STATUS: DONE`

`DESIGN_AUTHORITY: DESIGN.md`

## Goal

Replace Rotom Table’s map-first live-play experience with a coherent encounter workspace in which the current actor, available actions, participant state, pending resolutions, accepted outcomes, and encounter story are primary. The existing isometric map remains available as a tactical lens for exact geometry rather than serving as the mandatory root interface for every action.

The target experience is a **Battle Cockpit**: portrait-led, visually distinctive, state-responsive, readable at table distance, efficient for keyboard and pointer use, safe for multiplayer, and capable of presenting the complete Move, Ability, Capability, Edge, Feature, Maneuver, Order, Item, Capture, and system automation vocabulary.

This file is the durable implementation ledger for the encounter redesign. It starts only after the automation sequence and generic presentation contracts are complete.

## Product outcome

The completed product provides:

- a first-class encounter workspace for GM and players;
- a turn timeline that acts as the encounter spine;
- participant and side rosters with authoritative effective state;
- a persistent source-agnostic action dock;
- one decision layer for targets, modes, branches, items, references, and confirmations;
- one ordered resolution stack for optional triggers, Interrupts, Reactions, adjudications, and recovery;
- a battle stage for participant-led presentation;
- relationship and tactical lenses selected by the mechanic’s spatial needs;
- a structured event feed driven by accepted presentation facts;
- an explicit GM Director layer for hidden participants, waves, objectives, phases, corrections, and scene control;
- encounter authoring that launches a complete encounter rather than merely generating files or spawning tokens;
- clear visual identity and component grammar defined by `DESIGN.md`;
- responsive, accessible, reduced-motion, and lower-end-laptop support;
- a measured migration path that preserves the existing map preparation workflow.

## Scope and baseline

- `/maps/:slug` currently combines preparation, live play, Three.js rendering, targeting, initiative, scene state, presence, combat log, pending responses, recovery, ability panels, field effects, token context menus, and GM controls.
- The authoritative engine already owns map/sheet state, encounter state, initiative, effects, zones, resources, pending resolutions, accepted results, realtime convergence, and recovery.
- `AUTOMATION_PRESENTATION_CONTRACT_PLAN.md` supplies source-agnostic offers, choices, reasons, explanations, pending views, and accepted presentation facts.
- `DESIGN.md` is normative for identity, semantic colour, shape grammar, typography, visual layers, component anatomy, choreography, accessibility, and responsive behaviour.
- Map preparation, terrain editing, voxel work, hazard authoring, shop interface placement, and other battlefield setup remain map-workshop concerns.
- The redesign includes encounter authoring and may introduce a first-class encounter document after a map-backed vertical slice proves the required boundary.
- The old map-first live-play UI remains available behind a compatibility route or feature flag until final acceptance.

## Non-negotiable product rules

1. **The encounter is the product; the map is a lens.**
2. **Only one decision is visually primary at a time.**
3. **The user chooses an action, not a rules-book chapter.**
4. **Passives and effective facts do not become action buttons.**
5. **Exact geometry appears only when the mechanic requires it.**
6. **Accepted mechanics drive dramatic presentation.**
7. **Public, owner-private, GM-private, and diagnostic views are structurally separate.**
8. **Unavailable actions remain visible when their absence matters and always explain why.**
9. **GM tools extend the same visual language without overwhelming the player surface.**
10. **No internal IDs, hashes, traces, or automation implementation labels appear by default.**
11. **Colour is semantic, never the only cue, and never used indiscriminately.**
12. **Glass is reserved for surfaces floating over the tactical battlefield.**
13. **Keyboard, touch, screen reader, reduced motion, zoom, and table-distance readability are release requirements.**
14. **The redesign ships incrementally behind explicit flags and measurable compatibility gates.**
15. **Preparation workflows remain reliable throughout migration.**

## Experience model

The workspace has five primary encounter states:

1. **Observe** — stage, current actor, timeline, essential state, and compact actions.
2. **Choose action** — selected actor and legal actions become dominant.
3. **Choose target or placement** — irrelevant chrome recedes; legal candidates and spatial requirements become clear.
4. **Wait for response** — the resolution stack identifies who must decide and what the public table is waiting on.
5. **Resolve and settle** — accepted action presentation, state changes, VFX, and history occur in a deliberate sequence.

The workspace has five visual layers:

1. world/stage;
2. persistent encounter controls;
3. decision and resolution;
4. system and recovery;
5. inspector and Director tools.

A component belongs to one layer and follows its elevation, urgency, focus, and motion rules.

## Target information architecture

```text
/encounters
  Encounter library, active/recent encounters, blueprints, and launch actions

/encounters/new
  Encounter builder and table-roll workflow

/play/:encounterId
  Default Battle Cockpit workspace

/play/:encounterId/tactical
  Deep-linkable full tactical lens

/maps
  Battlefield library and preparation

/maps/:slug
  Battlefield workshop / maintenance
```

The exact route names may change only through a recorded decision. Existing `/generate` and `/encounter-tables` receive redirects or clear successor links after migration.

## Target architecture

```text
authoritative snapshots + generic automation presentation bundle
  -> encounter workspace adapter
  -> role-specific encounter view model
  -> persistent cockpit surfaces
  -> decision / resolution state machine
  -> optional relationship or tactical lens
  -> accepted presentation choreography
```

Proposed component families:

```text
EncounterWorkspace
├── EncounterTurnRail
├── EncounterSceneHeader
├── EncounterSideRoster
├── EncounterParticipantCard
├── EncounterBattleStage
├── EncounterActionDock
├── EncounterDecisionLayer
├── EncounterResolutionStack
├── EncounterEventFeed
├── EncounterSystemStatus
├── EncounterInspector
├── EncounterDirectorPanel
└── EncounterTacticalLens
    └── existing MapSceneRenderer
```

## Encounter data boundary

The first vertical slice remains map-backed and consumes the existing authoritative map, sheets, initiative, sides, scenes, effects, pending resolutions, and action contracts.

A later migration introduces explicit separation only after the vertical slice validates requirements:

- **Battlefield document** — dimensions, voxels, terrain, placements, shop interfaces, static map configuration.
- **Encounter document** — participants, sides, reserves, waves, phases, objectives, scene lifecycle, hidden/revealed state, linked battlefield, and encounter-level presentation defaults.
- **Presentation preferences** — user-local layout, motion, density, selected lens, expanded inspectors, and accessibility settings.
- **Authoritative mechanics state** — remains in the existing versioned encounter state/repositories unless a dedicated store is proven necessary.

No new document may duplicate authoritative mechanics or create dual map/encounter write ownership.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless the decision log permits parallel visual and data-contract work.
- Mark a ticket `DONE` only after focused automated tests, required visual fixtures, and accessibility checks pass.
- Any deviation from `DESIGN.md` requires a recorded design decision and corresponding document update.
- Every vertical slice must preserve a working compatibility route.
- Measure task completion, tactical-lens invocation, pending-choice completion, error recovery, and render performance before removing old surfaces.
- Set `PLAN_STATUS: DONE` only after EUX-100, production-like acceptance, migration, documentation, and `scripts/quality-gate.sh` pass.

## Progress snapshot

- Plan tickets: **0 DONE / 100 total**
- Design-system implementation: **not started**
- Encounter workspace vertical slice: **not started**
- Generic action sources rendered: **0**
- Generic pending sources rendered: **0**
- Old map-first live-play dependencies: **baseline audit pending**
- Accessibility acceptance: **not started**
- Blocking dependency: **Feature automation final acceptance**

## Tickets

### Phase 1 — Research, baseline audits, fixtures, and success measures

- [ ] **EUX-001 — Audit every current live-play surface and overlay** — `TODO`
  - Map controls, context menus, modals, logs, status banners, automation panels, presence, recovery, and GM tools to visual layers and future homes.
- [ ] **EUX-002 — Inventory current player and GM encounter tasks** — `TODO`
  - Cover turn taking, action selection, targeting, movement, responses, corrections, switching, capture, field management, and inspection.
- [ ] **EUX-003 — Define measurable UX success criteria** — `TODO`
  - Include action-discovery time, clicks/keystrokes, response completion, tactical-lens frequency, error recovery, readability, and performance.
- [ ] **EUX-004 — Create canonical encounter fixture 1: simple Trainer duel** — `TODO`
- [ ] **EUX-005 — Create canonical encounter fixture 2: crowded wild pack** — `TODO`
- [ ] **EUX-006 — Create canonical encounter fixture 3: boss phases and environment** — `TODO`
- [ ] **EUX-007 — Create canonical encounter fixture 4: nested private reactions and reconnect** — `TODO`
- [ ] **EUX-008 — Create canonical encounter fixture 5: capability movement and Trainer Feature interaction** — `TODO`
- [ ] **EUX-009 — Capture baseline screenshots, videos, accessibility tree, and performance traces** — `TODO`

### Phase 2 — Design-system implementation and visual identity

- [ ] **EUX-010 — Convert `DESIGN.md` semantics into versioned design tokens** — `TODO`
  - Colour roles, surfaces, elevation, spacing, typography, radii, borders, motion, density, and responsive breakpoints.
- [ ] **EUX-011 — Implement Field Guide, Workshop, and Live Encounter context themes** — `TODO`
- [ ] **EUX-012 — Implement semantic colour and contrast enforcement** — `TODO`
- [ ] **EUX-013 — Implement typography, numeric alignment, and table-distance scales** — `TODO`
- [ ] **EUX-014 — Implement the shape grammar and surface primitives** — `TODO`
- [ ] **EUX-015 — Implement participant, action, decision, status, utility, and inspector component primitives** — `TODO`
- [ ] **EUX-016 — Implement focus, hover, selected, pending, accepted, corrected, and unavailable states** — `TODO`
- [ ] **EUX-017 — Implement the shared motion vocabulary and reduced-motion variants** — `TODO`
- [ ] **EUX-018 — Build a design-system gallery with all states, themes, densities, and accessibility annotations** — `TODO`
- [ ] **EUX-019 — Add visual-regression, contrast, token, and forbidden-pattern checks** — `TODO`

### Phase 3 — Encounter view model, role projection, and client state machine

- [ ] **EUX-020 — Define the versioned encounter workspace view model** — `TODO`
- [ ] **EUX-021 — Build the map-backed workspace adapter** — `TODO`
  - Consume current maps, sheets, sides, initiative, scenes, effects, offers, pending views, and accepted presentation facts.
- [ ] **EUX-022 — Build GM, player-owner, public, and diagnostic workspace projections** — `TODO`
- [ ] **EUX-023 — Define workspace selection and focus state** — `TODO`
  - Separate current actor, selected actor, inspected participant, target preview, and tactical focus.
- [ ] **EUX-024 — Define the observe/choose/target/wait/resolve state machine** — `TODO`
- [ ] **EUX-025 — Define decision priority and focus arbitration** — `TODO`
- [ ] **EUX-026 — Define accepted presentation queues and local/remote precedence** — `TODO`
- [ ] **EUX-027 — Define URL, reconnect, snapshot, replay-gap, and tab-echo adoption** — `TODO`
- [ ] **EUX-028 — Define local presentation preferences and persistence** — `TODO`
- [ ] **EUX-029 — Add deterministic adapter/state-machine/property tests** — `TODO`

### Phase 4 — Routes, workspace shell, navigation, and compatibility

- [ ] **EUX-030 — Add feature flags and compatibility-route policy** — `TODO`
- [ ] **EUX-031 — Add the encounter library route and active encounter summaries** — `TODO`
- [ ] **EUX-032 — Add the `/play/:encounterId` workspace shell** — `TODO`
- [ ] **EUX-033 — Add workspace navigation that does not cover encounter controls** — `TODO`
- [ ] **EUX-034 — Add scene, encounter, connection, save, and recovery status regions** — `TODO`
- [ ] **EUX-035 — Add resizable/collapsible persistent regions with safe defaults** — `TODO`
- [ ] **EUX-036 — Add role-aware workspace loading, empty, inaccessible, and stale states** — `TODO`
- [ ] **EUX-037 — Add deep links to participants, decisions, history entries, and tactical focus** — `TODO`
- [ ] **EUX-038 — Preserve `/maps/:slug` as the Battlefield Workshop** — `TODO`
- [ ] **EUX-039 — Add route, auth, reload, back-button, and compatibility tests** — `TODO`

### Phase 5 — Turn spine, participant cards, side rosters, and battle stage

- [ ] **EUX-040 — Implement the encounter turn rail** — `TODO`
  - Show past/current/upcoming, round, waiting decisions, fainted state, focus, and GM advancement.
- [ ] **EUX-041 — Implement participant-card anatomy** — `TODO`
  - Portrait, identity, side, HP, temporary HP, injuries, conditions, resources, selection, control, and private/public variants.
- [ ] **EUX-042 — Implement side rosters, reserves, hidden members, and grouped wild participants** — `TODO`
- [ ] **EUX-043 — Implement the current-actor focus region** — `TODO`
- [ ] **EUX-044 — Implement the Battle Stage layout and visual hierarchy** — `TODO`
- [ ] **EUX-045 — Implement weather, terrain, room, hazard, objective, and phase summaries** — `TODO`
- [ ] **EUX-046 — Implement send-out, recall, switch, reserves, and Trainer team presentation** — `TODO`
- [ ] **EUX-047 — Implement authoritative participant change animations and correction treatment** — `TODO`
- [ ] **EUX-048 — Implement grouped-to-individual participant expansion** — `TODO`
- [ ] **EUX-049 — Add fixture, keyboard, screen-reader, and visual-regression tests** — `TODO`

### Phase 6 — Action dock, decisions, resolution stack, explanations, and history

- [ ] **EUX-050 — Implement the source-agnostic action dock** — `TODO`
- [ ] **EUX-051 — Implement action grouping, search, filters, recents, and keyboard shortcuts** — `TODO`
- [ ] **EUX-052 — Implement action-card cost, usage, availability, and outcome anatomy** — `TODO`
- [ ] **EUX-053 — Implement unavailable-reason and contribution explanation views** — `TODO`
- [ ] **EUX-054 — Implement the generic decision layer** — `TODO`
  - Render participant, side, mode, branch, type, stat, skill, move, rule reference, item, and confirmation choices.
- [ ] **EUX-055 — Implement participant and reference choice previews** — `TODO`
- [ ] **EUX-056 — Implement the ordered resolution stack** — `TODO`
  - Support public waiting summaries, authorised private options, competing responses, pass, expiry, and GM recovery.
- [ ] **EUX-057 — Implement accepted-result choreography and structured event feed** — `TODO`
- [ ] **EUX-058 — Implement correction, uncertain-command, retry, abandonment, and reconciliation UX** — `TODO`
- [ ] **EUX-059 — Add every canonical action/choice fixture and multi-client test** — `TODO`

### Phase 7 — Relationship view and tactical lens

- [ ] **EUX-060 — Define progressive spatiality rules from action contracts** — `TODO`
  - Choose card targeting, relationship view, compact tactical preview, or full tactical lens based on authoritative requirements.
- [ ] **EUX-061 — Implement relationship and distance view** — `TODO`
  - Show ally/foe/side, range, adjacency, visibility, eligibility, and relevant zones around the actor.
- [ ] **EUX-062 — Implement compact cell, area, direction, and path choice previews** — `TODO`
- [ ] **EUX-063 — Embed the existing isometric renderer as `EncounterTacticalLens`** — `TODO`
- [ ] **EUX-064 — Add seamless actor, target, camera, selection, and decision handoff** — `TODO`
- [ ] **EUX-065 — Move tactical-only controls into a coherent lens toolbar** — `TODO`
- [ ] **EUX-066 — Preserve movement, VFX, presence, pings, hazards, fields, and exact targeting** — `TODO`
- [ ] **EUX-067 — Add full-screen, split, picture-in-picture, and return-to-stage modes** — `TODO`
- [ ] **EUX-068 — Measure and optimise lens startup, memory, render scheduling, and lower-end performance** — `TODO`
- [ ] **EUX-069 — Add geometry, touch, keyboard, reduced-motion, and renderer regression tests** — `TODO`

### Phase 8 — GM Director layer and encounter authoring

- [ ] **EUX-070 — Implement the GM Director panel and explicit Director mode** — `TODO`
- [ ] **EUX-071 — Implement hidden participants, reveals, reserves, waves, and reinforcements** — `TODO`
- [ ] **EUX-072 — Implement objectives, stakes, phases, clocks, and encounter notes** — `TODO`
- [ ] **EUX-073 — Implement scene, initiative, sides, field, correction, and recovery tools** — `TODO`
- [ ] **EUX-074 — Redesign encounter generation as an Encounter Builder** — `TODO`
  - Choose recipe, roll/select cast, lock/reroll/replace, assign sides/roles, define stakes, choose presentation/battlefield, and launch.
- [ ] **EUX-075 — Implement encounter recipes** — `TODO`
  - Trainer duel, wild pack, ambush, swarm, boss, hunt/capture, chase-ready, and blank templates.
- [ ] **EUX-076 — Implement first-class encounter document discovery and ADR** — `TODO`
  - Validate the map-backed slice, then define only the state that cannot remain battlefield- or mechanics-owned.
- [ ] **EUX-077 — Implement encounter repository, revisions, commands, realtime, export, and migration if approved** — `TODO`
- [ ] **EUX-078 — Integrate encounter tables, generated sheets, maps, sides, initiative, and launch** — `TODO`
- [ ] **EUX-079 — Add authoring, hidden-information, rollback, backup, and launch acceptance tests** — `TODO`

### Phase 9 — Responsive design, accessibility, performance, and old-UI migration

- [ ] **EUX-080 — Implement desktop, laptop, tablet, mobile, and table-display layouts** — `TODO`
- [ ] **EUX-081 — Implement density, text size, colour-vision, high-contrast, and motion settings** — `TODO`
- [ ] **EUX-082 — Complete keyboard-only and switch-access navigation** — `TODO`
- [ ] **EUX-083 — Complete screen-reader landmarks, labels, announcements, and focus restoration** — `TODO`
- [ ] **EUX-084 — Complete touch targets, gestures, hover-independent help, and context alternatives** — `TODO`
- [ ] **EUX-085 — Enforce cockpit render, projection, animation, and memory budgets** — `TODO`
- [ ] **EUX-086 — Migrate initiative, combat log, action panels, response overlays, and status banners** — `TODO`
- [ ] **EUX-087 — Migrate token context-menu primary actions into the dock** — `TODO`
- [ ] **EUX-088 — Migrate GM controls into Director/Workshop boundaries** — `TODO`
- [ ] **EUX-089 — Remove visual duplication and add legacy-dependency checks** — `TODO`

### Phase 10 — Acceptance, rollout, documentation, and retirement

- [ ] **EUX-090 — Run task-based usability acceptance on all canonical fixtures** — `TODO`
- [ ] **EUX-091 — Run GM/player/private-choice multi-client acceptance** — `TODO`
- [ ] **EUX-092 — Run reconnect, restart, stale, recovery, correction, and replay acceptance** — `TODO`
- [ ] **EUX-093 — Run automated accessibility and manual assistive-technology acceptance** — `TODO`
- [ ] **EUX-094 — Run desktop/mobile/table-display visual and responsive acceptance** — `TODO`
- [ ] **EUX-095 — Run lower-end-laptop and large-encounter performance acceptance** — `TODO`
- [ ] **EUX-096 — Complete user, GM, contributor, design-system, and operator documentation** — `TODO`
- [ ] **EUX-097 — Ship staged opt-in rollout and collect defined UX metrics** — `TODO`
- [ ] **EUX-098 — Make the encounter workspace the default live-play route** — `TODO`
- [ ] **EUX-099 — Retire the map-first live-play compatibility surface** — `TODO`
  - Preserve Battlefield Workshop and tactical renderer functionality while removing duplicated encounter controls.
- [ ] **EUX-100 — Record final design and product acceptance** — `TODO`
  - Require typecheck, tests, build, visual/a11y/performance gates, `scripts/quality-gate.sh`, complete documentation, and no critical unresolved usability debt.

## Decision log

- **2026-07-26 — Make the encounter workspace primary and the map optional.** The authoritative engine already supports mechanics beyond what a permanent spatial canvas can clearly present.
- **2026-07-26 — Keep the existing renderer as a tactical lens.** The redesign preserves exact geometry, terrain, hazards, movement, VFX, and map preparation rather than discarding them.
- **2026-07-26 — Use the Battle Cockpit as the default encounter model.** Turn, actor, actions, participants, responses, and accepted outcomes form the stable visual spine.
- **2026-07-26 — Use progressive spatiality.** Card targeting handles server-authorised participant choices; relationship view handles relative facts; the tactical lens handles exact geometry.
- **2026-07-26 — Separate player density from GM capability.** Director tools extend the same language in an explicit layer instead of being interleaved with ordinary actions.
- **2026-07-26 — Prove the boundary before introducing an Encounter document.** Start map-backed, measure what must persist separately, and avoid dual authority.
