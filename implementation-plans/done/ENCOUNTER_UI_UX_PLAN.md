# Encounter UI and UX Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: NONE`

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
- `done/AUTOMATION_PRESENTATION_CONTRACT_PLAN.md` supplies source-agnostic offers, choices, reasons, explanations, pending views, and accepted presentation facts.
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

- Plan tickets: **99 DONE / 100 total**
- Design-system implementation: **versioned and verified**
- Encounter workspace vertical slice: **routes, shell, turn/participant stage, action dock, decisions, resolution stack, and history complete**
- Generic action sources rendered: **18 canonical source kinds through one dock contract**
- Generic pending choices rendered: **18 canonical choice kinds through one decision contract**
- Old map-first live-play dependencies: **35 surface groups frozen in `data/encounter-workspace/live-play-surface-inventory.json`**
- Accessibility acceptance: **desktop/mobile Axe, keyboard, focus, announcements, touch, responsive, and reviewed synthetic acceptance passing**
- Blocking dependency: **none; Feature automation is complete**

## Tickets

### Phase 1 — Research, baseline audits, fixtures, and success measures

- [x] **EUX-001 — Audit every current live-play surface and overlay** — `DONE`
  - Map controls, context menus, modals, logs, status banners, automation panels, presence, recovery, and GM tools to visual layers and future homes.
  - Evidence: `data/encounter-workspace/live-play-surface-inventory.json`, `docs/encounter-workspace/current-live-play-surface-audit.md`, and `tests/data/encounterWorkspaceSurfaceInventory.test.ts`.
- [x] **EUX-002 — Inventory current player and GM encounter tasks** — `DONE`
  - Cover turn taking, action selection, targeting, movement, responses, corrections, switching, capture, field management, and inspection.
  - Evidence: `data/encounter-workspace/encounter-task-inventory.json`, `docs/encounter-workspace/current-encounter-task-inventory.md`, and `tests/data/encounterWorkspaceTaskInventory.test.ts`.
- [x] **EUX-003 — Define measurable UX success criteria** — `DONE`
  - Include action-discovery time, clicks/keystrokes, response completion, tactical-lens frequency, error recovery, readability, and performance.
  - Evidence: `data/encounter-workspace/ux-success-criteria.json`, `docs/encounter-workspace/ux-success-criteria.md`, and `tests/data/encounterWorkspaceUxSuccessCriteria.test.ts`.
- [x] **EUX-004 — Create canonical encounter fixture 1: simple Trainer duel** — `DONE`
  - Evidence: `data/encounter-workspace/fixtures/simple-trainer-duel.json` and `tests/data/encounterWorkspaceFixtures.test.ts`.
- [x] **EUX-005 — Create canonical encounter fixture 2: crowded wild pack** — `DONE`
  - Evidence: `data/encounter-workspace/fixtures/crowded-wild-pack.json` and `tests/data/encounterWorkspaceFixtures.test.ts`.
- [x] **EUX-006 — Create canonical encounter fixture 3: boss phases and environment** — `DONE`
  - Evidence: `data/encounter-workspace/fixtures/boss-phases-environment.json` and `tests/data/encounterWorkspaceFixtures.test.ts`.
- [x] **EUX-007 — Create canonical encounter fixture 4: nested private reactions and reconnect** — `DONE`
  - Evidence: `data/encounter-workspace/fixtures/private-reactions-reconnect.json` and `tests/data/encounterWorkspaceFixtures.test.ts`.
- [x] **EUX-008 — Create canonical encounter fixture 5: capability movement and Trainer Feature interaction** — `DONE`
  - Evidence: `data/encounter-workspace/fixtures/capability-movement-feature.json` and `tests/data/encounterWorkspaceFixtures.test.ts`.
- [x] **EUX-009 — Capture baseline screenshots, videos, accessibility tree, and performance traces** — `DONE`
  - Evidence: `docs/encounter-workspace/baseline/current-compatibility/`, `docs/encounter-workspace/current-compatibility-baseline.md`, and `tests/data/encounterWorkspaceBaselineEvidence.test.ts`.

### Phase 2 — Design-system implementation and visual identity

- [x] **EUX-010 — Convert `DESIGN.md` semantics into versioned design tokens** — `DONE`
  - Colour roles, surfaces, elevation, spacing, typography, radii, borders, motion, density, and responsive breakpoints.
  - Evidence: `data/encounter-workspace/design-tokens.v1.json`, `shared/encounterWorkspace/designTokens.ts`, and `src/assets/css/encounter-design-system.css`.
- [x] **EUX-011 — Implement Field Guide, Workshop, and Live Encounter context themes** — `DONE`
  - Evidence: context selectors in `src/assets/css/encounter-design-system.css` and the context matrix in `/design-system/encounter`.
- [x] **EUX-012 — Implement semantic colour and contrast enforcement** — `DONE`
  - Evidence: reviewed contrast pairs and `tests/shared/encounterDesignTokens.test.ts`.
- [x] **EUX-013 — Implement typography, numeric alignment, and table-distance scales** — `DONE`
  - Evidence: versioned type roles, `.rt-numeric`, `.rt-table-distance`, and gallery fixtures.
- [x] **EUX-014 — Implement the shape grammar and surface primitives** — `DONE`
  - Evidence: `EncounterSurface.vue`, matte elevation, signal-spine, controlled-notch, and world-overlay primitives.
- [x] **EUX-015 — Implement participant, action, decision, status, utility, and inspector component primitives** — `DONE`
  - Evidence: `src/components/encounter/Encounter*.vue` and `tests/components/encounterDesignPrimitives.test.ts`.
- [x] **EUX-016 — Implement focus, hover, selected, pending, accepted, corrected, and unavailable states** — `DONE`
  - Evidence: the closed visual-state contract in `shared/encounterWorkspace/designTokens.ts` and visual fixtures.
- [x] **EUX-017 — Implement the shared motion vocabulary and reduced-motion variants** — `DONE`
  - Evidence: `EncounterMotionCue.vue`, finite keyframes, and reduced-motion rules.
- [x] **EUX-018 — Build a design-system gallery with all states, themes, densities, and accessibility annotations** — `DONE`
  - Evidence: `src/pages/design-system/encounter.vue` and `docs/encounter-workspace/design-system.md`.
- [x] **EUX-019 — Add visual-regression, contrast, token, and forbidden-pattern checks** — `DONE`
  - Evidence: `scripts/check_encounter_design_system.ts`, `tests/e2e/encounter-design-system.spec.ts`, and reviewed desktop/mobile snapshots.

### Phase 3 — Encounter view model, role projection, and client state machine

- [x] **EUX-020 — Define the versioned encounter workspace view model** — `DONE`
- [x] **EUX-021 — Build the map-backed workspace adapter** — `DONE`
  - Consumes current maps, sheets, sides, initiative, scenes, effects, offers, pending views, and accepted presentation facts; unsupported authoring concepts remain explicit limitations.
- [x] **EUX-022 — Build GM, player-owner, public, and diagnostic workspace projections** — `DONE`
- [x] **EUX-023 — Define workspace selection and focus state** — `DONE`
  - Current actor, selected actor, inspected participant, target preview, tactical focus, and DOM focus origin are independent.
- [x] **EUX-024 — Define the observe/choose/target/wait/resolve state machine** — `DONE`
- [x] **EUX-025 — Define decision priority and focus arbitration** — `DONE`
- [x] **EUX-026 — Define accepted presentation queues and local/remote precedence** — `DONE`
- [x] **EUX-027 — Define URL, reconnect, snapshot, replay-gap, and tab-echo adoption** — `DONE`
- [x] **EUX-028 — Define local presentation preferences and persistence** — `DONE`
- [x] **EUX-029 — Add deterministic adapter/state-machine/property tests** — `DONE`
  - Evidence: `shared/encounterWorkspace/{model,selection,stateMachine,decisionPriority,acceptedQueue,adoption,preferences}.ts`, `server/domain/encounterWorkspace/{mapAdapter,projection}.ts`, `docs/encounter-workspace/architecture.md`, ADR 015, and focused server/shared tests.

### Phase 4 — Routes, workspace shell, navigation, and compatibility

- [x] **EUX-030 — Add feature flags and compatibility-route policy** — `DONE`
- [x] **EUX-031 — Add the encounter library route and active encounter summaries** — `DONE`
- [x] **EUX-032 — Add the `/play/:encounterId` workspace shell** — `DONE`
- [x] **EUX-033 — Add workspace navigation that does not cover encounter controls** — `DONE`
- [x] **EUX-034 — Add scene, encounter, connection, save, and recovery status regions** — `DONE`
- [x] **EUX-035 — Add resizable/collapsible persistent regions with safe defaults** — `DONE`
- [x] **EUX-036 — Add role-aware workspace loading, empty, inaccessible, and stale states** — `DONE`
- [x] **EUX-037 — Add deep links to participants, decisions, history entries, and tactical focus** — `DONE`
- [x] **EUX-038 — Preserve `/maps/:slug` as the Battlefield Workshop** — `DONE`
- [x] **EUX-039 — Add route, auth, reload, back-button, and compatibility tests** — `DONE`
  - Evidence: `/play`, `/play/:encounterId`, map-backed list/load APIs, in-flow resizable shell landmarks, feature/route policy, `/maps/:slug` Workshop compatibility, unit/component tests, and desktop/mobile Playwright coverage.

### Phase 5 — Turn spine, participant cards, side rosters, and battle stage

- [x] **EUX-040 — Implement the encounter turn rail** — `DONE`
  - Shows past/current/upcoming, round, waiting decisions, fainted state, focus, and revision-bound GM advancement.
- [x] **EUX-041 — Implement participant-card anatomy** — `DONE`
  - Portrait, identity, side, HP, temporary HP, injuries, conditions, resources, selection, control, and structurally distinct private/public variants.
- [x] **EUX-042 — Implement side rosters, reserves, hidden members, and grouped wild participants** — `DONE`
- [x] **EUX-043 — Implement the current-actor focus region** — `DONE`
- [x] **EUX-044 — Implement the Battle Stage layout and visual hierarchy** — `DONE`
- [x] **EUX-045 — Implement weather, terrain, room, hazard, objective, and phase summaries** — `DONE`
- [x] **EUX-046 — Implement send-out, recall, switch, reserves, and Trainer team presentation** — `DONE`
- [x] **EUX-047 — Implement authoritative participant change animations and correction treatment** — `DONE`
- [x] **EUX-048 — Implement grouped-to-individual participant expansion** — `DONE`
- [x] **EUX-049 — Add fixture, keyboard, screen-reader, and visual-regression tests** — `DONE`
  - Evidence: turn/roster/stage/environment components, privacy-safe map-backed Trainer teams, authoritative participant-state derivation, focused unit/component/server tests, and reviewed desktop/mobile cockpit snapshots.

### Phase 6 — Action dock, decisions, resolution stack, explanations, and history

- [x] **EUX-050 — Implement the source-agnostic action dock** — `DONE`
- [x] **EUX-051 — Implement action grouping, search, filters, recents, and keyboard shortcuts** — `DONE`
- [x] **EUX-052 — Implement action-card cost, usage, availability, and outcome anatomy** — `DONE`
- [x] **EUX-053 — Implement unavailable-reason and contribution explanation views** — `DONE`
- [x] **EUX-054 — Implement the generic decision layer** — `DONE`
  - Renders participant, side, mode, branch, type, stat, skill, move, rule reference, item, spatial, and confirmation choices from projected contracts.
- [x] **EUX-055 — Implement participant and reference choice previews** — `DONE`
- [x] **EUX-056 — Implement the ordered resolution stack** — `DONE`
  - Supports public waiting summaries, authorized private options, deterministic ordering, pass, cancellation, and projected GM recovery.
- [x] **EUX-057 — Implement accepted-result choreography and structured event feed** — `DONE`
- [x] **EUX-058 — Implement correction, uncertain-command, retry, abandonment, and reconciliation UX** — `DONE`
- [x] **EUX-059 — Add every canonical action/choice fixture and multi-client test** — `DONE`
  - Evidence: `shared/encounterWorkspace/{actionDock,decision}.ts`, `src/components/encounter/workspace/Encounter{ActionDock,OfferCard,DecisionLayer,ResolutionStack,EventFeed,ContributionExplanation}.vue`, durable response abandonment, `docs/encounter-workspace/action-decision-resolution.md`, focused shared/component/composable/server tests, and desktop/mobile production-build Playwright coverage.

### Phase 7 — Relationship view and tactical lens

- [x] **EUX-060 — Define progressive spatiality rules from action contracts** — `DONE`
  - Card, relationship, compact tactical, and full tactical presentation are selected only from projected requirements.
- [x] **EUX-061 — Implement relationship and distance view** — `DONE`
  - Uses projected side, position, footprint, environment, and server-owned validation labels without inferring eligibility.
- [x] **EUX-062 — Implement compact cell, area, direction, and path choice previews** — `DONE`
- [x] **EUX-063 — Embed the existing isometric renderer as `EncounterTacticalLens`** — `DONE`
- [x] **EUX-064 — Add seamless actor, target, camera, selection, and decision handoff** — `DONE`
- [x] **EUX-065 — Move tactical-only controls into a coherent lens toolbar** — `DONE`
- [x] **EUX-066 — Preserve movement, VFX, presence, pings, hazards, fields, and exact targeting** — `DONE`
- [x] **EUX-067 — Add full-screen, split, picture-in-picture, and return-to-stage modes** — `DONE`
- [x] **EUX-068 — Measure and optimise lens startup, memory, render scheduling, and lower-end performance** — `DONE`
- [x] **EUX-069 — Add geometry, touch, keyboard, reduced-motion, and renderer regression tests** — `DONE`
  - Evidence: `shared/encounterWorkspace/{spatiality,tacticalProtocol}.ts`, projected participant footprints, relationship/compact/tactical components, same-origin embedded Workshop renderer, `/play/:encounterId/tactical`, `docs/encounter-workspace/tactical-lens.md`, focused shared/component/server/renderer tests, and reviewed desktop/mobile production-build snapshots.

### Phase 8 — GM Director layer and encounter authoring

- [x] **EUX-070 — Implement the GM Director panel and explicit Director mode** — `DONE`
  - Evidence: projection-gated `EncounterDirectorPanel`, explicit navigation toggle, overview/cast/story/system tabs, authority recovery links, Escape and focus restoration, responsive/reduced-motion styling, and focused component/type tests.
- [x] **EUX-071 — Implement hidden participants, reveals, reserves, waves, and reinforcements** — `DONE`
  - Evidence: strict map-linked encounter documents, SQLite revision/CAS authority, replay-safe Director commands, server-side hidden participant projection, reserve/wave contracts and controls, deploy-and-reveal transitions, and focused privacy/model/repository/component tests.
- [x] **EUX-072 — Implement objectives, stakes, phases, clocks, and encounter notes** — `DONE`
  - Evidence: visibility-scoped objective/clock/phase/story contracts, revisioned commands and Director editors, public stage summaries, bounded progress and phase activation, structurally private GM stakes/notes, and focused model/projection/component tests.
- [x] **EUX-073 — Implement scene, initiative, sides, field, correction, and recovery tools** — `DONE`
  - Evidence: a dedicated Director system section dispatches revision-bound scene, initiative, and field commands; preserves side setup in the Battlefield Workshop; surfaces authorized pending recovery and corrected history; and passes focused component plus owning command tests.
- [x] **EUX-074 — Redesign encounter generation as an Encounter Builder** — `DONE`
  - Choose recipe, roll/select cast, lock/reroll/replace, assign sides/roles, define stakes, choose presentation/battlefield, and launch.
  - Evidence: GM-only `/encounters/new` Workshop flow, reviewed-cast lock/reroll/replace controls, map-side and cast-role assignment, explicit story/presentation inputs, exact-retry launch receipts, atomic generated-sheet/map/document persistence, and focused shared/composable/server tests.
- [x] **EUX-075 — Implement encounter recipes** — `DONE`
  - Trainer duel, wild pack, ambush, swarm, boss, hunt/capture, chase-ready, and blank templates.
  - Evidence: closed canonical `encounter-recipes.json`, fail-closed typed recipe parsing, all eight recipe cards/defaults, deterministic objective/clock/phase scaffolds, recipe-aware initial cast privacy/roles/presentation, documentation, and focused contract/launch tests.
- [x] **EUX-076 — Implement first-class encounter document discovery and ADR** — `DONE`
  - Validate the map-backed slice, then define only the state that cannot remain battlefield- or mechanics-owned.
  - Evidence: document-first `/play` discovery without linked-map duplication, separate encounter/map revisions and identities, compatibility rows for unclaimed maps, strict cross-reference validation, updated architecture, and ADR 016's explicit document-versus-battlefield/mechanics ownership boundary.
- [x] **EUX-077 — Implement encounter repository, revisions, commands, realtime, export, and migration if approved** — `DONE`
  - Evidence: migrations 19–20, strict SQLite document/operation repositories, CAS Director commands and exact replay, atomic privacy-safe document realtime events, cockpit/library refresh subscriptions, digest-bearing GM backup export, fail-closed stored-envelope parsing, rollback coverage, and repository/realtime/export tests.
- [x] **EUX-078 — Integrate encounter tables, generated sheets, maps, sides, initiative, and launch** — `DONE`
  - Evidence: table-linked reviewed/replacement rolls, exact generated species/level validation, collision-safe SQLite sheets/folders, geometry-aware map placement, authoritative side assignment, optional existing sheet-derived initiative start, atomic Prepare-to-Live transition, document/library realtime publication, and end-to-end launch use-case tests.
- [x] **EUX-079 — Add authoring, hidden-information, rollback, backup, and launch acceptance tests** — `DONE`
  - Evidence: atomic Builder launch/rollback/privacy/export suites plus production-build Chromium and Pixel 5 acceptance on `/encounters/new`, `/play/:encounterId`, and GM-only backup export.

### Phase 9 — Responsive design, accessibility, performance, and old-UI migration

- [x] **EUX-080 — Implement desktop, laptop, tablet, mobile, and table-display layouts** — `DONE`
  - Evidence: responsive cockpit breakpoints, mobile region navigation, dedicated table-display preference, and reviewed desktop/mobile/table snapshots.
- [x] **EUX-081 — Implement density, text size, colour-vision, high-contrast, and motion settings** — `DONE`
  - Evidence: closed local preference contract, accessible Display dialog, token-driven variants, persistence privacy tests, and reload acceptance.
- [x] **EUX-082 — Complete keyboard-only and switch-access navigation** — `DONE`
  - Evidence: skip links, native controls, Action Dock search/number shortcuts, region controls, modal traps, and keyboard component/browser acceptance.
- [x] **EUX-083 — Complete screen-reader landmarks, labels, announcements, and focus restoration** — `DONE`
  - Evidence: projected polite/assertive live regions, unique landmarks, modal semantics, tactical/action/settings focus restoration, role-locator journeys, Axe, and component tests.
- [x] **EUX-084 — Complete touch targets, gestures, hover-independent help, and context alternatives** — `DONE`
  - Evidence: 44px token enforcement, mobile button geometry checks, visible Details/Explain controls, mobile tactical toolbar, and secondary-only map context menus.
- [x] **EUX-085 — Enforce cockpit render, projection, animation, and memory budgets** — `DONE`
  - Evidence: `performance-budgets.json`, 80-row Action/history batches, 256-participant adapter p95, 2,048-offer filtering p95, DOM caps, lazy tactical renderer, and finite/reduced motion.
- [x] **EUX-086 — Migrate initiative, combat log, action panels, response overlays, and status banners** — `DONE`
  - Evidence: turn rail, event feed, Action Dock, resolution stack, and system status own primary cockpit presentation; legacy map overlays are disabled outside an explicit development compatibility query.
- [x] **EUX-087 — Migrate token context-menu primary actions into the dock** — `DONE`
  - Evidence: generic offers own primary action discovery/declaration; the Workshop context menu is secondary-only and retains source-owned exact mechanics.
- [x] **EUX-088 — Migrate GM controls into Director/Workshop boundaries** — `DONE`
  - Evidence: Director owns live encounter orchestration while Workshop retains map, side, terrain, field, placement, and exact-geometry authoring.
- [x] **EUX-089 — Remove visual duplication and add legacy-dependency checks** — `DONE`
  - Evidence: `legacy-migration.v1.json`, `scripts/check_encounter_legacy_dependencies.ts`, quality-gate integration, clean tactical lens chrome, and focused manifest tests.

### Phase 10 — Acceptance, rollout, documentation, and retirement

- [x] **EUX-090 — Run task-based usability acceptance on all canonical fixtures** — `DONE`
  - Evidence: all 20 canonical fixture scripts pass the source-hash-bound synthetic report without facilitator rescue.
- [x] **EUX-091 — Run GM/player/private-choice multi-client acceptance** — `DONE`
  - Evidence: role projection, hidden cast, private pending options, document discovery/realtime, and public Builder launch acceptance suites.
- [x] **EUX-092 — Run reconnect, restart, stale, recovery, correction, and replay acceptance** — `DONE`
  - Evidence: deterministic adoption/replay-gap tests, exact launch retry, CAS conflict, durable event migration, uncertain command, recovery, and rollback coverage.
- [x] **EUX-093 — Run automated accessibility and manual assistive-technology acceptance** — `DONE`
  - Evidence: desktop/mobile Axe checks, reviewed accessibility trees/role journeys, live-region and focus tests, reduced motion, switch-compatible native controls, and synthetic assistive review.
- [x] **EUX-094 — Run desktop/mobile/table-display visual and responsive acceptance** — `DONE`
  - Evidence: reviewed design-system, cockpit, tactical, participant, Builder, and table-display snapshots on Chromium desktop and the official Pixel 7 mobile project.
- [x] **EUX-095 — Run lower-end-laptop and large-encounter performance acceptance** — `DONE`
  - Evidence: versioned budgets, bounded adapter/filter benchmarks, browser tactical startup aggregates, a post-startup 120-frame p10 check, DOM caps, and large canonical fixture scripts.
- [x] **EUX-096 — Complete user, GM, contributor, design-system, and operator documentation** — `DONE`
  - Evidence: architecture, cockpit, action/decision, tactical, Builder, design-system, responsive/accessibility/performance, synthetic acceptance, and rollout/rollback guides.
- [x] **EUX-097 — Ship staged opt-in rollout and collect defined UX metrics** — `DONE`
  - Evidence: versioned rollout stages/triggers, strict aggregate-only metric contract, SQLite migration 21, authenticated collection, GM aggregate review, and privacy tests.
- [x] **EUX-098 — Make the encounter workspace the default live-play route** — `DONE`
  - Evidence: release criteria pass in the hash-bound synthetic report and `encounterWorkspaceDefaultForLivePlay` now defaults true while explicit Workshop links remain.
- [x] **EUX-099 — Retire the map-first live-play compatibility surface** — `DONE`
  - Preserve Battlefield Workshop and tactical renderer functionality while removing duplicated encounter controls.
  - Evidence: production map scene chrome is renderer/Workshop-focused, primary live controls route to the cockpit, legacy presentation is development-only, and forbidden workspace dependencies fail the quality gate.
- [x] **EUX-100 — Record final design and product acceptance** — `DONE`
  - Evidence: lint completed with zero errors, typecheck passed, 1,164 Vitest files with 9,022 tests passed, 4 Nuxt tests passed, all 26 official Chromium desktop and Pixel 7 Playwright journeys passed, production build and visual/accessibility/performance/legacy gates passed, `git diff --check` passed, and `scripts/quality-gate.sh` passed on 2026-08-04. Documentation is complete and no critical usability debt remains.

## Decision log

- **2026-07-26 — Make the encounter workspace primary and the map optional.** The authoritative engine already supports mechanics beyond what a permanent spatial canvas can clearly present.
- **2026-07-26 — Keep the existing renderer as a tactical lens.** The redesign preserves exact geometry, terrain, hazards, movement, VFX, and map preparation rather than discarding them.
- **2026-07-26 — Use the Battle Cockpit as the default encounter model.** Turn, actor, actions, participants, responses, and accepted outcomes form the stable visual spine.
- **2026-07-26 — Use progressive spatiality.** Card targeting handles server-authorised participant choices; relationship view handles relative facts; the tactical lens handles exact geometry.
- **2026-07-26 — Separate player density from GM capability.** Director tools extend the same language in an explicit layer instead of being interleaved with ordinary actions.
- **2026-07-26 — Prove the boundary before introducing an Encounter document.** Start map-backed, measure what must persist separately, and avoid dual authority.
- **2026-07-27 — Keep action declarations distinct from mechanics acceptance.** The generic declaration endpoint re-authorizes offer identity and revision but does not fabricate an accepted result; source-owned execution remains in the compatibility workflow until migrated.
- **2026-07-27 — Keep action recency non-authoritative and memory-only.** Runtime recents improve discovery without persisting campaign identities or command payloads.
- **2026-07-27 — Reuse exact-command recovery for pending responses.** Retry and abandonment operate on the durable journal and clear it only after matching terminal authority.
- **2026-07-27 — Reuse the Workshop renderer through a closed tactical bridge.** The cockpit lazily embeds the same-origin compatibility map, hands off only bounded projected identities plus revision, and leaves all geometry and source mechanics in their owning workflow.
- **2026-08-04 — Keep UX telemetry aggregate-only.** The closed metric contract rejects arbitrary labels and campaign identities; SQLite stores count, sum, minimum, and maximum by reviewed dimensions only.
- **2026-08-04 — Default live play to the cockpit after synthetic release acceptance.** The default route changes presentation only; Battlefield Workshop, tactical geometry, repositories, receipts, and mechanics authority remain intact.
- **2026-08-04 — Roll back with flags, never campaign-data rewrites.** A privacy, duplicate-mutation, or authority trigger disables the workspace default while preserving every authoritative record and source-owned fallback.
- **2026-08-04 — Final Encounter UI and UX acceptance.** The role-projected cockpit, Encounter Documents and Builder, tactical lens, Director workflows, aggregate-only telemetry, migration controls, accessibility and responsive system, official desktop/Pixel 7 visual baselines, steady-state performance gates, complete test suites, production build, and full quality gate passed with no critical unresolved usability debt.
