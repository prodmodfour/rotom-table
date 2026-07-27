# Rotom Table Design System and Product Direction

`DOCUMENT_STATUS: NORMATIVE`

`LAST_REVIEWED: 2026-07-26`

`IMPLEMENTATION_PLAN: implementation-plans/ENCOUNTER_UI_UX_PLAN.md`

## Purpose

This document defines Rotom Table's product identity, visual language, interaction hierarchy, accessibility rules, and design governance. It is the design authority for new UI work and the staged migration of existing surfaces.

It is not a mood board or a request to restyle every page immediately. It gives colour, shape, typography, motion, layout, and component choices stable meanings so future work feels like one product and remains understandable under live-play pressure.

Mechanics, permissions, privacy, persistence, and authoritative command rules remain owned by their domain contracts. When current component styling conflicts with this document, this document describes the intended destination.

## Product thesis

Rotom Table is a **living field terminal** for a Pokémon Tabletop United campaign.

It should feel like an intelligent campaign device that observes the table, surfaces the next meaningful decision, explains authoritative outcomes, and gives Pokémon and Trainers strong visual presence. It becomes tactical when exact geometry matters rather than making a map the permanent root of every interaction.

The personality is:

> **Energetic, observant, tactical, slightly playful, and never noisy.**

Rotom Table must not become:

- an imitation of one official Pokémon game UI;
- a generic neon science-fiction dashboard;
- a conventional VTT whose identity is only a map and toolbars;
- an enterprise form application with Pokémon artwork added afterward;
- a product where each new rules source creates another menu, panel, badge, or colour.

## Core principles

1. **Comprehension before ornament.** The current actor, required decision, legal options, and accepted result are understood before decorative effects are noticed.
2. **Identity through a system.** Portrait-led participants, semantic colour, a controlled electric motif, stable component anatomy, and encounter choreography create identity—not glow and blur on every panel.
3. **One decision is visually primary.** Secondary tools remain accessible without competing with the question currently blocking play.
4. **Mechanics determine durable presentation.** Selection and previews may be immediate; HP, conditions, movement, resources, and lasting effects change visually only after authoritative acceptance.
5. **Progressive spatiality.** Use participant cards when geometry is irrelevant, relationship views for adjacency/range/side facts, and the tactical lens for exact cells, paths, elevation, and obstruction.
6. **Rules sources are provenance, not navigation.** Move, Ability, Capability, Feature, Edge, Item, and other sources share interaction primitives when the human choice is equivalent.
7. **Important absence is visible.** Expected unavailable actions remain visible with a concise safe reason where authorisation allows.
8. **Density is earned.** Dense information is grouped and prioritised; many equally styled pills, paragraphs, and buttons are not useful density.
9. **Privacy is structural.** Public, owner-private, GM-private, and diagnostic projections are distinct inputs, not fields hidden ad hoc with CSS.
10. **Accessibility is completion.** Keyboard, touch, screen reader, contrast, reduced motion, zoom, and reflow are part of the component contract.

## Product contexts

One design language supports three related atmospheres.

### Field Guide

Reference pages, Pokédex, character sheets, and rules inspection.

- reading-first layouts;
- mostly opaque surfaces;
- generous line height and stable section hierarchy;
- restrained motion;
- source and category metadata used carefully.

### Workshop

Map preparation, encounter authoring, campaign settings, inventories, shops, and maintenance.

- explicit save, revision, validation, and conflict state;
- grids, split views, inspectors, and batch actions;
- compact but fully labelled controls;
- low theatrical emphasis;
- opaque or lightly translucent surfaces.

### Live Encounter

Battle Cockpit, action dock, decision surfaces, resolution stack, event feed, participant cards, and tactical lens.

- portrait-led identity;
- strong actor and decision hierarchy;
- reduced chrome;
- state-responsive layout;
- accepted-result choreography;
- exact tactical detail on demand.

## Information hierarchy

### Live Encounter

1. Decision or event currently blocking play.
2. Actor, responder, or affected participant.
3. Legal actions, targets, or response options.
4. Costs, availability, range, timing, and scope.
5. Round, scene, objective, weather, terrain, and sides.
6. Recent accepted outcomes.
7. Deep rules explanation and provenance.
8. Diagnostics and maintenance.

### Workshop

1. Object being edited.
2. Save, validation, revision, and conflict state.
3. Primary editing tools.
4. Structure and batch organisation.
5. Preview of live-play consequences.
6. Advanced metadata and diagnostics.

### Field Guide

1. Name and category.
2. Core rule or character state.
3. Commonly compared values.
4. Prerequisites, interactions, source, and advanced detail.

## Live Encounter visual layers

A component belongs to one layer, which determines elevation, focus, and urgency.

### World

Battle stage, participants, backdrop, battlefield, environmental state, and accepted VFX.

### Persistent controls

Turn rail, current actor, action dock, scene/objective summary, roster, and compact navigation.

### Decision

Targeting, authorised choices, reactions, Interrupts, confirmations, and exact spatial selection. This layer may suppress unrelated controls and owns focus while active.

### System

Reconnect, reconciliation, stale state, uncertain commands, recovery gates, and blocking errors. System state never looks like a rules reaction.

### Inspector

Formulas, contribution explanations, source references, corrections, diagnostics, performance tools, and raw identifiers when explicitly requested by an authorised user.

## Signature identity

Use three restrained motifs.

### Signal spine

A narrow strip identifies participant affiliation, current actor, selected action category, or responder ownership. It is not a decorative border for every panel.

### Notched frame

Participant, action, and decision surfaces may use one controlled corner cut. Reading cards and ordinary forms remain rectangular. Notches never reduce touch targets or make focus unclear.

### Electric pulse

A short pulse or travelling line communicates a newly available response, target lock, accepted travel, turn handoff, or reconnection progress. It never runs endlessly as ambient decoration.

## Colour system

Exact values may be adjusted during contrast validation, but meanings are fixed.

### Dark-theme baseline

| Token | Baseline | Meaning |
| --- | --- | --- |
| `--rt-bg-world` | `#07090d` | World and encounter background |
| `--rt-bg-canvas` | `#0d1117` | Application canvas |
| `--rt-surface-1` | `#131922` | Standard solid surface |
| `--rt-surface-2` | `#1a222d` | Raised or selected surface |
| `--rt-surface-3` | `#232d39` | Strong utility separation |
| `--rt-text-strong` | `#f7f3eb` | Primary text |
| `--rt-text` | `#dce2e8` | Ordinary text |
| `--rt-text-muted` | `#9ca8b5` | Secondary metadata |
| `--rt-rule` | `#35404d` | Structural border |
| `--rt-brand` | `#ff3347` | Rotom identity and committed primary action |
| `--rt-focus` | `#59d8ff` | Selection, targeting, keyboard focus, spatial attention |
| `--rt-pending` | `#ffbf52` | Unresolved choice, Reaction, Interrupt, warning |
| `--rt-success` | `#58d5a0` | Accepted positive result, healing, recovery |
| `--rt-danger` | `#ff6672` | Error, destructive action, critical HP danger |
| `--rt-info` | `#8aa8ff` | Neutral system information |

### Light-theme baseline

Use warm ivory and slate rather than pure white and black:

- world `#f4eee5`;
- canvas `#fbf7f0`;
- surface 1 `#fffdf8`;
- surface 2 `#f1e9de`;
- surface 3 `#e5dbce`;
- strong text `#171b22`;
- text `#303842`;
- muted text `#64707d`;
- rule `#c7bbae`.

Semantic tokens receive contrast-adjusted light variants without changing meaning.

### Semantic rules

- **Rotom red:** brand energy, committed primary action, dramatic identity—not universal selection or error.
- **Electric cyan:** focus, selection, targeting, spatial preview, inspectable attention.
- **Signal amber:** unresolved choice, response window, expiry, non-destructive warning.
- **Mint:** healing, accepted recovery, successful completion.
- **Danger red:** actual errors, destructive confirmation, critical HP danger.
- **Neutral surfaces:** carry most UI; participants and accepted effects provide spectacle.

### Side, Trainer, and type colours

User colours are accents rather than full backgrounds. Pair each with a name, symbol, portrait mark, pattern, or ally/foe label. Type colours identify actual Pokémon types only. No rule, permission, side, or state is communicated by colour alone.

### Contrast

- ordinary text meets WCAG AA;
- essential small text and interactive labels target 4.5:1;
- large display text targets 3:1;
- focus indicators target 3:1 against adjacent colours;
- disabled reasons remain legible and do not rely on opacity alone.

## Surfaces and elevation

Solid matte surfaces are the default for the Battle Cockpit, action dock, decision cards, resolution stack, Workshop forms, reference content, and recovery.

Glass is permitted only when a compact control physically floats over a rendered battlefield or stage, such as camera controls, a movement HUD, or tactical layer controls. Nested glass, large blurred reading panels, and universal backdrop blur are prohibited.

Decision surfaces are solid and high contrast over every possible backdrop.

Elevation scale:

- level 0: canvas or embedded content;
- level 1: ordinary card;
- level 2: selected or persistent control;
- level 3: active decision or popover;
- level 4: modal, blocking recovery, full tactical lens;
- level 5: explicitly enabled diagnostics.

Use separation, borders, and restrained shadows rather than blur and glow alone.

## Shape grammar

### Participant card

Represents a Pokémon, Trainer, subordinate entity, or group.

Required anatomy:

- portrait or sprite;
- identity and side signal;
- name and concise role;
- HP/resource strip;
- urgent conditions;
- current-turn/control state;
- inspect affordance.

Use a medium radius, one controlled notch, and a stable rectangular content area.

### Action card

Represents something the selected actor may do.

Required anatomy:

- action name;
- concise category/source marker;
- cost and timing;
- usage/frequency;
- essential range or target scope;
- availability and reason;
- optional clearly non-authoritative preview.

Use a compact rectangle and leading signal spine. The whole action is not a pill.

### Decision card

Asks one bounded question.

Required anatomy:

- owner/responder;
- action or trigger headline;
- one-sentence prompt;
- meaningful options and disabled reasons;
- primary, secondary, pass, or cancel actions;
- expiry/timing where relevant.

Use a solid surface, strong frame, clear header, and action footer. Pending rules decisions use amber unless the state is a system error.

### Status chip

Used only for short type, condition, usage, relationship, or category state. Chips contain compact nouns/values, not paragraphs. Interactive chips visibly differ from read-only status.

### Utility control

Ordinary edit, refresh, sort, expand, save, or inspect actions use simple rectangles or icon-plus-label controls. Destructive operations use danger semantics and proportional confirmation.

### Circular spatial control

Reserved for camera and battlefield operations such as centre, rotate, ping, or open tactical view. It is not used for normal rules actions or form submission.

## Spacing and density

Base unit: `4px`; named steps: 4, 8, 12, 16, 24, 32, 48, 64px.

- related metadata: 4–8px;
- action-card groups: 8–12px;
- card padding: 12–16px;
- major cockpit regions: 16–24px;
- reading surfaces: 24–32px;
- dense table rows: at least 32px;
- primary touch targets: at least 44×44px where space permits.

Use grouping and separators before nesting more cards.

## Typography

### Display

Encounter names, current actor names, major splashes, section openings, and phase titles. Expressive and sparse.

### Interface

Controls, actions, labels, descriptions, navigation, status, and system messages. Highly legible at compact sizes.

### Numeric

Use tabular numerals for HP, initiative, distance, damage, resources, quantities, currency, rounds, and durations.

Recommended scale roles: `display-xl`, `display-lg`, `heading-md`, `action-md`, `body-md`, `body-sm`, `label-sm`, `meta-xs`.

Rules:

- uppercase is reserved for short labels such as `REACTION`, `SCENE`, or `CURRENT`;
- action names and sentences use normal case;
- reading lines target roughly 55–80 characters;
- essential labels are not made tiny to force a layout to fit;
- truncation always has an accessible full-name path.

## Icons and imagery

Use one coherent icon family with consistent stroke and optical size. Important actions use icon plus text. Unicode glyphs are not the primary production icon system where rendering varies by platform.

Portraits are the primary participant identity for initiative, current actor, target choices, responses, participant cards, Trainer affiliation, and event attribution. Use stable crops and deliberate silhouettes/monograms for missing art. Full sprites may escape frames only in the world layer.

A transformed, disguised, shiny, or alternate visual remains presentation-only unless an authoritative mechanic changes effective form state.

## Component presentation rules

### Participant summary

Default: portrait, name, side, HP/temp HP, fainted/critical state, turn marker, and urgent conditions. Expanded detail may show injuries, resources, movement, effective rules, and contribution explanations.

### Action offer

Default anatomy:

```text
Action Name
category · timing · source
cost / usage          range or target scope
availability or concise unavailable reason
```

Do not show automation-completeness badges on every successful action. Reviewed automation is normal product behaviour. Coverage and runtime diagnostics belong in an inspector unless they block use.

### Target or option row

Show a portrait/icon, human-readable label, relationship/distance/scope, selection state, concise disabled reason, and optional preview/focus action. Never use placement, mode, declaration, option, or operation IDs as default labels.

### Resource strip

Show only resources relevant to the current actor and context: actions, movement, AP, frequency, once flags, setup/execute, charges, or stacks. The full ledger belongs in an inspector.

### Resolution stack

Each card states what caused the interaction, who may or must answer, what public observers may know, the authorised options, and pass/expiry/retry/recovery behaviour. The newest blocking item is primary; parent/child causality remains visible without exposing traces.

### Event feed

Use structured accepted facts: actor, source, concise headline, affected participants, important changes, prevention/miss/pass result, and expandable explanation. Do not parse free-form combat-log prose as machine state.

### System status

Non-blocking reconnect state is compact. Blocking stale or uncertain state becomes a clear system card. Exact retry language states what is known and what remains uncertain.

## Encounter choreography

### Observe

World/stage and current state dominate. Show current actor, turn order, essential participant state, scene/objective, field state, and compact actions. Collapse deep formulas and inactive targeting.

### Choose action

The selected participant becomes dominant and the action dock expands. The state answers: **What can this participant do now?** Unavailable actions remain understandable; source taxonomy stays secondary.

### Choose target, mode, or placement

Eligible options become prominent; irrelevant chrome recedes. The state answers: **To whom, where, or in which mode can this be used?** Open relationship or tactical views only when required.

### Wait for response

Amber becomes the dominant decision colour. Public observers see a bounded waiting summary; authorised responders see exact choices. The state answers: **Who must decide before play continues?**

### Resolve and settle

Accepted mechanics present in causal order: action ownership, travel/declaration, hit/miss/prevention/response, state changes, settled result, history entry, next decision. Reduced motion preserves the same sequence without travel animation.

### Recover

A command/state conflict replaces ordinary play with a system workflow for exact retry, terminal-status check, authoritative correction, abandonment, force resolution, or snapshot refresh. Recovery never masquerades as a game choice.

## Battle Cockpit layout

Default wide composition:

```text
┌──────────────── TURN RAIL / SCENE SUMMARY ──────────────────┐
├─────────────┬────────────────────────────┬───────────────────┤
│ SIDE ROSTER │ BATTLE STAGE / WORLD LENS  │ RESOLUTION/EVENT  │
├─────────────┴────────────────────────────┴───────────────────┤
│ ACTION DOCK / CURRENT DECISION / RESOURCE STRIP             │
└──────────────────────────────────────────────────────────────┘
```

This is hierarchy, not a fixed pixel template. The world receives the largest flexible area; an active decision may span regions; resolution and history share one controlled rail; Director tools use an explicit mode/drawer; global navigation does not permanently cover live controls.

## Progressive spatiality

### Participant view

Use for self, direct target, side-wide, field-wide, and server-precomputed legal targets. Present portraits, eligibility, relationship, and distance without camera work.

### Relationship view

Use for adjacency, range, ally/foe relationship, interception, aura, and zone membership when exact cells do not matter. It is derived from authoritative geometry and never becomes mechanics authority.

### Tactical lens

Use for exact movement path, destination, area origin, line/cone/burst, footprint, elevation, barriers, smoke, hazards, send-out placement, forced movement, and interruption checkpoints. It may be embedded, expanded, or full screen and returns focus to the originating decision.

## Action organisation

Organise first by intent and current relevance, not source chapter. Recommended groups:

- current-context/recommended;
- attacks and Moves;
- support and control;
- movement and positioning;
- Trainer commands and team actions;
- items and capture;
- environment/contextual actions;
- more/reference.

Source markers remain visible for reference and filtering. Passive sources do not occupy the action dock unless they create a canonical declaration.

## GM and player views

Player view prioritises linked/controllable participants, current turn, legal actions, relevant targets, private owned decisions, public encounter state, and accepted results.

GM Director view adds all/hidden participants, waves, phases, objectives, recovery, corrections, adjudication, scene/lifecycle controls, and diagnostics. Director tools live in a dedicated rail, drawer, or mode rather than being mixed into player actions.

Visual absence or redaction is determined by an authorised projection, never by local CSS.

## Encounter formats

The system supports related recipes rather than unrelated themes:

- **Trainer duel:** Trainer ownership, active Pokémon, reserves, switching, Orders.
- **Wild pack:** group summaries, disposition, capture, retreat, reveal, reinforcements.
- **Boss:** dominant participant, phase track, objectives, environment, subordinates.
- **Hunt/chase/campaign scene:** progress, relative position, contextual actions, tactical view only when exact placement matters.

## Motion

Vocabulary:

- **Pulse:** attention or new response.
- **Lock:** selection.
- **Sweep:** phase/turn/workspace transition.
- **Travel:** movement/projectile/causal transfer.
- **Impact:** accepted result.
- **Settle:** durable state entering history.
- **Correct:** authoritative reconciliation, distinct from voluntary travel.

Timing guidance:

- hover/focus: 100–160ms;
- selection/compact expansion: 140–220ms;
- panel transition: 180–280ms;
- accepted choreography: normally 300–800ms;
- urgent pulses are short and finite.

Reduced motion replaces travel with direct transition/fade, pulse with static emphasis, and camera animation with immediate focus while preserving sequence and information.

No permanent animation loop exists solely for decoration. Blur, particles, VFX, and off-screen content are bounded and measured.

## Content design

Rotom Table speaks like a competent table assistant: direct, calm under failure, concise during play, and complete when explaining rules.

Prefer verbs: `Use Intimidate`, `Choose Crobat`, `Pass`, `Open tactical view`, `Retry exact declaration`, `Adopt server state`.

Avoid player-facing implementation terms such as operation ID, declaration ID, runtime hash, handler key, projection lane, or capability bundle.

Unavailable reasons are concise: `Standard Action already spent.`, `No eligible foe is within 2m.`, `Requires a held Berry.`, `Only available during your Initiative.`

Result copy states accepted facts: `Thunder Fang hit Crobat for 18 HP.`, `Crobat is Paralyzed.`, `Static may respond.`, `The route paused before leaving Gengar's reach.`

## Accessibility

### Keyboard and focus

- every action, option, participant, turn entry, and tactical confirmation is keyboard reachable;
- focus order follows decision hierarchy;
- opening a decision moves focus to its heading/first option;
- closing/resolving restores focus to the origin or next required decision;
- drag actions have keyboard alternatives;
- focus uses electric cyan plus a visible non-colour outline;
- modal/blocking decisions trap focus correctly.

### Screen readers

- current actor, new response, accepted result, error, and correction use appropriate live-region priority;
- passive updates do not flood announcements;
- participant cards expose name, HP, current state, and relationship;
- visual target/area previews have textual summaries;
- decorative VFX and atmosphere are hidden.

### Touch, zoom, and reflow

- primary targets reach 44×44px where practical;
- hover content also opens by focus, tap, or inspect;
- right-click is never the only important path;
- spatial gestures have visible controls and cancellation;
- reading/workshop pages tolerate browser zoom;
- live regions reflow rather than shrinking essential text;
- tactical view becomes full screen on narrow devices.

### Sensory independence

Side, status, success, warning, and danger include text/icon/shape/pattern cues. Motion and colour are never the only signals. Contrast is tested against dynamic portraits and scene backgrounds.

## Responsive behaviour

### Wide desktop

Full cockpit regions, top turn rail, side roster, resolution/event rail, bottom action dock, optional Director rail.

### Laptop/tablet

Collapsible roster, resolution above history, bottom-sheet action dock, world remains visible for card-based choices.

### Mobile/narrow

Current actor and blocking decision dominate; turn rail scrolls horizontally; action dock becomes full-width bottom sheet; roster/history move to drawers/tabs; tactical lens becomes full screen; no hover/right-click dependency.

## Authority and latency presentation

Optimistic UI is allowed for local selection, focus, menus, authorised option selection before submit, and non-mechanical preview. It is not allowed for HP, conditions, resources, movement completion, item transfer, accepted targets, or trigger outcomes.

After submit, preserve exact intent while showing pending state. On acceptance, adopt authoritative changes with the same language for local and remote actions. Corrections use the `Correct` treatment rather than replaying as voluntary actions. Uncertain state clearly exposes exact retry, status check, or recovery without inviting unsafe duplicate use.

## Forbidden patterns

The following require redesign before merge:

1. overlay soup;
2. permanent chapter-specific top-level panels;
3. badge flood;
4. glass everywhere;
5. red used for brand, focus, warning, danger, and error at once;
6. raw IDs as normal labels;
7. expected actions silently disappearing;
8. hover-only important actions;
9. tiny essential text forced into dense cards;
10. broad all-uppercase hierarchy;
11. continuous decorative motion;
12. long unstructured source prose where a prompt/choice/explanation is required;
13. automation diagnostics leaking into normal player flow;
14. durable result animation before acceptance;
15. colour-only affiliation;
16. one bespoke modal per mechanic;
17. unrelated GM/player visual systems;
18. forcing map input when cards suffice;
19. hiding the map when exact geometry matters;
20. arbitrary local colours, radii, shadows, z-indexes, or font scales outside tokens.

## Implementation and governance

The UI/UX plan establishes central tokens, primitives, accessible states, role projections, design-system fixtures, and visual regression before broad migration. Domain components may extend the system for genuine needs but cannot silently redefine semantic meanings.

`DESIGN.md` is normative. `implementation-plans/ENCOUNTER_UI_UX_PLAN.md` is the implementation ledger. Automation plans own mechanics and authority.

A material change to semantic colours, component anatomy, encounter choreography, product contexts, progressive spatiality, privacy presentation, accessibility requirements, or action organisation updates this document and the decision log.

Evidence retained during implementation should include canonical visual fixtures, isolated component states, desktop/mobile captures, both themes, keyboard/screen-reader/reduced-motion coverage, contrast checks, screenshot diffs where practical, and dense-encounter performance measurements.

Migration is staged:

- current screens remain functional while automation completes;
- the presentation-contract plan supplies source-agnostic data;
- the UI/UX plan introduces the design system and Battle Cockpit behind controlled rollout;
- map-first live play retires only after parity, accessibility, recovery, and multi-client acceptance;
- Field Guide and Workshop surfaces migrate incrementally after primitives stabilise.

## Design review checklist

Before review, confirm:

- the primary task and actor/object are obvious;
- secondary tools are quieter and the component belongs to one visual layer;
- shared tokens/anatomy are used and signature motifs carry meaning;
- actions are organised by intent; passives do not become buttons;
- unavailable reasons are visible when authorised;
- preview, pending, accepted, corrected, and uncertain states differ;
- saturated colour has a semantic role and side colour has a non-colour cue;
- text contrast, type hierarchy, and numeric alignment are sound;
- the complete flow works by keyboard, touch, and without hover;
- focus and screen-reader announcements are correct;
- reduced motion preserves meaning;
- the component consumes an authorised projection;
- system recovery is distinct from game decisions;
- animation, blur, rendering, and long lists stay within budgets.

## Decision log

- **2026-07-26 — Define Rotom Table as a living field terminal.** It is an observant campaign companion, not a game-UI clone or generic science-fiction dashboard.
- **2026-07-26 — Make the encounter primary and the map conditional.** Current actor, decisions, pending resolutions, and outcomes lead; exact geometry opens through a tactical lens.
- **2026-07-26 — Use Field Guide, Workshop, and Live Encounter contexts.** They share one system while preserving reading, authoring, and play-specific atmospheres.
- **2026-07-26 — Reserve glass for world overlays.** Matte solid surfaces are the default for dense controls, decisions, reference content, and recovery.
- **2026-07-26 — Separate brand, focus, pending, success, and danger.** Rotom red remains the identity colour without carrying every state.
- **2026-07-26 — Use portraits as primary participant identity.** Turn order, choices, responses, results, and rosters share one portrait language.
- **2026-07-26 — Organise actions by intent and relevance.** Rule source remains provenance and reference metadata.
- **2026-07-26 — Let accepted mechanics drive drama.** Preview, pending, accepted, correction, and uncertain states remain visibly distinct.
- **2026-07-26 — Treat accessibility and reduced motion as release requirements.** They are not later polish.
