# Automation Presentation Contract Implementation Plan

`PLAN_STATUS: QUEUED`

`CURRENT_TICKET: APC-001`

`BLOCKED_BY: ABILITY_AUTOMATION_PLAN.md — PLAN_STATUS: DONE`

## Goal

Create one source-agnostic, server-authoritative interaction and presentation contract for Moves, Maneuvers, Abilities, Capabilities, Edges, Features, Orders, Items, Capture actions, and system actions before further rules catalogs are automated.

The contract must let later automation expose actions, passive contributions, contextual affordances, authorised choices, pending responses, accepted outcomes, explanations, and recovery state without creating one permanent UI panel or command shape per rules chapter. It is an API and domain-contract initiative, not the encounter UI redesign itself.

This file is the durable implementation ledger for the contract initiative. It must be completed after `ABILITY_AUTOMATION_PLAN.md` and before `CAPABILITY_AUTOMATION_PLAN.md`.

## Scope and baseline

- Existing authoritative inputs:
  - MoveSpec v2 declarations and accepted/pending results.
  - AbilitySpec v1 declarations, event subscriptions, passive providers, accepted/pending results, and authorised response views.
  - Maneuver, Order, Poké Ball, item, movement, initiative, and direct table command paths.
- Existing temporary presentation inputs:
  - token context-menu option collections;
  - move and ability capability bundles;
  - move targeting overlays and pending response views;
  - action splashes, move feedback, move VFX, combat-log metadata, and recovery panels.
- Required new shared outputs:
  - source-agnostic action offers;
  - passive and contextual affordance summaries;
  - typed choice offers and safe option presentation;
  - unavailable-reason and contribution-explanation contracts;
  - accepted encounter presentation facts;
  - public, owner-private, GM-private, and diagnostic projections.
- This plan does not replace the existing encounter page. It creates the complete stable seam that the later UI/UX plan will consume.
- No automation catalog may invent a bespoke client command or permanent panel merely because its source kind is new.

## Non-negotiable rules

1. **Mechanics remain authoritative.** Presentation data never determines legal actors, targets, costs, rolls, branches, effects, or persistence.
2. **Intent and stable IDs only.** Clients submit exact offer, declaration, option, and response identities, never executable rule programs or state patches.
3. **One interaction vocabulary.** Equivalent choices use the same bounded contract regardless of whether the source is a Move, Ability, Capability, Edge, Feature, Item, or system action.
4. **Source is provenance, not navigation.** `sourceKind` supports references and filtering; it does not force a separate user workflow.
5. **Passives do not become buttons.** Passive providers and derived facts surface through participant state and explanations unless the canonical rule includes a declaration.
6. **Unavailable is explainable.** Important unavailable actions remain projectable with stable reason codes and concise safe labels.
7. **Privacy is projection-specific.** Public summaries, owner choices, GM recovery data, and diagnostics are distinct schemas, not fields hidden ad hoc in Vue.
8. **Accepted facts drive drama.** HP, conditions, movement, VFX, result copy, and history presentation derive from accepted mechanics, never optimistic guesses.
9. **Retry is exact.** Reconnect, replay, duplicate submit, and recovery reuse identities, rolls, spends, and terminal results.
10. **No raw internal labels.** Operation IDs, placement IDs, mode IDs, declaration IDs, hashes, and trace values are never the default player-facing copy.
11. **Accessibility is contractual.** Every visual cue has text, focus order, live-region priority, and reduced-motion-compatible presentation data.
12. **Compatibility is temporary and measured.** Adapters may bridge existing paths, but the final gate removes production UI dependence on source-specific legacy shapes.

## Completion contract

This plan is complete only when all of the following are true:

- every normal live-play action source can be projected as an `EncounterActionOffer` or is explicitly classified as passive-only, contextual-only, system-only, or out-of-encounter;
- every human choice uses a closed choice kind with server-issued option IDs and authorised presentation;
- every pending interaction has public and authorised-private views, exact retry semantics, pass/cancel/expiry rules, and GM recovery where applicable;
- every unavailable offer has a stable reason code, safe label, source evidence, and optional diagnostic detail;
- every accepted operation can produce bounded structured presentation facts without parsing combat-log prose;
- passive calculations can expose ordered contributions and prevention evidence without leaking private rules;
- Moves, Maneuvers, Abilities, Orders, Items, Capture, movement, initiative, and direct table actions have migrated or have an explicit blocked migration ticket;
- realtime, snapshot, reconnect, replay-gap, correction, and recovery flows use the same projection contracts;
- component and API tests prove that public, player-owner, GM, and diagnostic views reveal only authorised information;
- the final contract is documented, versioned, performance-bounded, and used by every later automation plan.

## Target architecture

```text
canonical rule sources + authoritative encounter state
  -> source-owned spec/runtime and legality
  -> source-agnostic offer / passive / contextual projection
  -> authorised choice or immediate intent
  -> authoritative plan, commit, or durable suspension
  -> accepted mechanics result
  -> structured encounter presentation facts
  -> role-specific UI projection
```

Core contract families:

```text
RuleSourceRef
EncounterActionOffer
EncounterPassiveSummary
EncounterContextualAffordance
EncounterChoiceOffer / EncounterChoiceOption
EncounterPendingInteractionView
EncounterAvailabilityReason
EncounterContributionExplanation
AcceptedEncounterPresentation
EncounterPresentationProjection
```

## Source and interaction classifications

Every catalog row or system action must resolve to one or more of these roles:

| Role | Meaning | Future primary UI home |
| --- | --- | --- |
| `passive-provider` | Always-on or conditional derived mechanic | Participant state / inspector |
| `activated-action` | User intentionally declares the rule | Action dock |
| `contextual-affordance` | Action exists only in a matching context | Relevant task or encounter surface |
| `triggered-automatic` | Server applies at an accepted event checkpoint | Result presentation / history |
| `triggered-optional` | Authorised participant may accept or pass | Resolution stack |
| `interrupt-reaction` | Time-sensitive competing response | Urgent resolution stack |
| `choice-only` | Rule modifies another action by a typed choice | Decision layer |
| `spatial-choice` | Exact cell, area, path, direction, or placement required | Tactical lens |
| `campaign-operation` | Crafting, training, rest, research, calendar, or maintenance | Workshop / sheet workflow |
| `diagnostic-only` | Provenance, trace, hashes, and recovery evidence | GM inspector |

A source may have several roles, but each role must have a stable owning runtime and presentation projection.

## Versioning and compatibility

- Contracts are strict, JSON-only, explicitly versioned shared schemas.
- Unknown enum values, oversized arrays, unsafe text, ambiguous ownership, and duplicate stable IDs fail closed.
- Server projections may add optional fields only under documented compatibility rules.
- Clients must tolerate missing optional decorative fields but must reject unknown mechanic-bearing choice kinds.
- Existing move and ability result shapes remain available only through explicit adapters during migration.
- No compatibility adapter may infer legality from labels or reconstruct hidden options from public summaries.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless a decision-log entry explicitly permits parallel work.
- Mark a ticket `DONE` only after focused tests and the applicable strict checker pass.
- Add a new interaction primitive only through the closed-catalog governance ticket; do not smuggle source-specific fields into generic payloads.
- Record contract and privacy decisions in the decision log.
- Set `PLAN_STATUS: DONE` only after APC-070 and `scripts/quality-gate.sh` pass.

## Progress snapshot

- Plan tickets: **0 DONE / 70 total**
- Shared contract version: **not created**
- Migrated action sources: **0**
- Migrated pending interaction sources: **0**
- Legacy source-specific UI dependencies: **baseline audit pending**
- Blocking dependency: **Ability automation final acceptance**

## Tickets

### Phase 1 — Governance, inventory, and architecture

- [ ] **APC-001 — Inventory every live-play action and presentation source** — `TODO`
  - Produce a checked-in machine-readable inventory of commands, option builders, overlays, pending views, result shapes, logs, VFX, and recovery surfaces.
- [ ] **APC-002 — Freeze the interaction-role taxonomy** — `TODO`
  - Define closed roles for passive, activated, contextual, automatic, optional, reaction, choice, spatial, campaign, and diagnostic behaviour.
- [ ] **APC-003 — Freeze the source-kind and provenance contract** — `TODO`
  - Define canonical source references for Move, Maneuver, Ability, Capability, Edge, Feature, Order, Item, Capture, and system actions.
- [ ] **APC-004 — Define the presentation privacy matrix** — `TODO`
  - Specify public, actor-owner, responder-owner, GM, and diagnostic visibility for offers, choices, rolls, reasons, traces, and outcomes.
- [ ] **APC-005 — Define contract limits and abuse budgets** — `TODO`
  - Bound offers, options, text, affected recipients, contribution rows, nested decisions, result changes, and realtime payload size.
- [ ] **APC-006 — Record the interaction/presentation ADR** — `TODO`
  - Lock authority, state ownership, versioning, privacy, compatibility, and why source kind cannot dictate UI structure.
- [ ] **APC-007 — Add a durable contributor guide** — `TODO`
  - Document how a new rule source chooses roles, offers, choices, reasons, accepted facts, tests, and presentation metadata.
- [ ] **APC-008 — Add plan-consistency and schema-link checks** — `TODO`
  - Fail when source inventories, schemas, adapters, docs, generated indexes, and plan progress disagree.
- [ ] **APC-009 — Create canonical cross-source acceptance fixtures** — `TODO`
  - Check in representative duels, crowds, boss phases, private choices, nested reactions, spatial actions, reconnects, and corrections.

### Phase 2 — Shared source, offer, and participant contracts

- [ ] **APC-010 — Define `RuleSourceRef` and canonical display identity** — `TODO`
- [ ] **APC-011 — Define versioned `EncounterActionOffer`** — `TODO`
  - Include actor, source, interaction role, timing, costs, availability, targeting summary, usage, and bounded presentation.
- [ ] **APC-012 — Define passive and derived-state summaries** — `TODO`
  - Represent effective passive facts without manufacturing invocable actions.
- [ ] **APC-013 — Define contextual affordance summaries** — `TODO`
  - Represent actions available only because of current participants, terrain, objects, shops, inventory, or campaign context.
- [ ] **APC-014 — Define participant presentation references** — `TODO`
  - Safely project names, portraits, side accents, sheet kind, and public status without exposing hidden sheets or control IDs.
- [ ] **APC-015 — Define timing and action-cost presentation** — `TODO`
  - Normalize Standard, Shift, Swift, Free, Full, Extended, Priority, Interrupt, Reaction, AP, frequency, and resource labels.
- [ ] **APC-016 — Define targeting and spatial-requirement summaries** — `TODO`
  - Distinguish participant, side, item, move, cell, area, direction, destination, path, and no-target declarations.
- [ ] **APC-017 — Define usage and resource summaries** — `TODO`
  - Project remaining uses, scene/daily state, AP, action budgets, cooldowns, once flags, and safe reset labels.
- [ ] **APC-018 — Define source-agnostic action grouping and ordering** — `TODO`
  - Provide stable categories and priorities independent of rules-book taxonomy.
- [ ] **APC-019 — Add strict parsers, normalizers, hashes, and fixtures** — `TODO`
  - Reject ambiguous IDs, unsafe copy, oversized fields, and incompatible schema versions.

### Phase 3 — Availability, reasons, and contribution explanations

- [ ] **APC-020 — Define the closed availability-reason catalog** — `TODO`
- [ ] **APC-021 — Separate public reasons from private and diagnostic evidence** — `TODO`
- [ ] **APC-022 — Add action-economy and timing reasons** — `TODO`
- [ ] **APC-023 — Add frequency, usage, cooldown, and once-limit reasons** — `TODO`
- [ ] **APC-024 — Add target, range, relationship, visibility, and geometry reasons** — `TODO`
- [ ] **APC-025 — Add condition, suppression, item, form, capability, and source-loss reasons** — `TODO`
- [ ] **APC-026 — Add ownership, profile-control, side, and permission reasons** — `TODO`
- [ ] **APC-027 — Define ordered contribution explanations** — `TODO`
  - Explain totals, substitutions, caps, prevention, immunity, and effective sources using typed rows rather than prose parsing.
- [ ] **APC-028 — Add redacted contribution projections** — `TODO`
  - Preserve understandable outcomes while hiding private abilities, items, features, edges, or GM-only facts.
- [ ] **APC-029 — Add reason and explanation conformance/property tests** — `TODO`

### Phase 4 — Choices, pending interactions, and exact response semantics

- [ ] **APC-030 — Define the closed choice-kind catalog** — `TODO`
  - Cover participant, side, mode, branch, type, stat, skill, move, ability, capability, feature, edge, item, cell, area, direction, destination, and path choices.
- [ ] **APC-031 — Define versioned `EncounterChoiceOffer` and option identity** — `TODO`
- [ ] **APC-032 — Define safe option presentation and previews** — `TODO`
  - Support participant, reference, item, side, and spatial previews without making them authoritative.
- [ ] **APC-033 — Define selection cardinality, ordering, defaults, and confirmation** — `TODO`
- [ ] **APC-034 — Define decline, pass, cancel, expiry, and forced resolution** — `TODO`
- [ ] **APC-035 — Define pending interaction public summaries** — `TODO`
- [ ] **APC-036 — Define owner-authorised pending views** — `TODO`
- [ ] **APC-037 — Define GM recovery and correction views** — `TODO`
- [ ] **APC-038 — Bind exact response identity to retry/reconnect/replay** — `TODO`
- [ ] **APC-039 — Add nested and competing choice ordering tests** — `TODO`

### Phase 5 — Accepted outcomes, history, VFX, and accessibility presentation

- [ ] **APC-040 — Define `AcceptedEncounterPresentation`** — `TODO`
- [ ] **APC-041 — Define typed change facts** — `TODO`
  - Cover HP, temporary HP, injury, condition, stage, movement, resource, usage, item, effect, zone, form, side, placement, and scene changes.
- [ ] **APC-042 — Define outcome and prevention facts** — `TODO`
  - Cover used, triggered, accepted, declined, hit, miss, critical, immune, prevented, redirected, expired, corrected, and abandoned outcomes.
- [ ] **APC-043 — Define causal grouping for nested actions** — `TODO`
  - Preserve parent/child order without exposing private trace internals.
- [ ] **APC-044 — Define action-splash and headline projection** — `TODO`
- [ ] **APC-045 — Define generic VFX and reduced-motion hints** — `TODO`
  - Keep visual hints downstream and non-mechanical.
- [ ] **APC-046 — Define event-feed and history projection** — `TODO`
  - Replace combat-log prose as the primary machine-readable presentation source.
- [ ] **APC-047 — Define screen-reader announcements and urgency** — `TODO`
- [ ] **APC-048 — Define correction, rollback, and reconciliation presentation** — `TODO`
- [ ] **APC-049 — Add deterministic presentation replay tests** — `TODO`

### Phase 6 — Migrate existing sources and remove bespoke seams

- [ ] **APC-050 — Adapt MoveSpec v2 offers and accepted results** — `TODO`
- [ ] **APC-051 — Adapt AbilitySpec v1 active, passive, trigger, and pending results** — `TODO`
- [ ] **APC-052 — Adapt Maneuver actions and contested checks** — `TODO`
- [ ] **APC-053 — Adapt Orders and trainer-to-Pokémon actions** — `TODO`
- [ ] **APC-054 — Adapt movement, send-out, recall, and switching** — `TODO`
- [ ] **APC-055 — Adapt items, Poké Balls, capture, and inventory actions** — `TODO`
- [ ] **APC-056 — Adapt initiative, scenes, field effects, hazards, and direct table actions** — `TODO`
- [ ] **APC-057 — Adapt pending move/ability responses and recovery** — `TODO`
- [ ] **APC-058 — Publish one versioned client capability bundle** — `TODO`
  - Replace parallel move/ability/source capability payloads with a role-appropriate encounter bundle.
- [ ] **APC-059 — Remove production dependence on raw context-menu metadata** — `TODO`

### Phase 7 — Realtime, security, scale, and release acceptance

- [ ] **APC-060 — Integrate offer/presentation projection with snapshots and patches** — `TODO`
- [ ] **APC-061 — Integrate accepted presentation with durable realtime rows** — `TODO`
- [ ] **APC-062 — Validate replay gaps, reconnect, duplicate delivery, and tab echo handling** — `TODO`
- [ ] **APC-063 — Complete privacy, authorization, and malformed-input testing** — `TODO`
- [ ] **APC-064 — Benchmark catalog-scale offer and explanation projection** — `TODO`
- [ ] **APC-065 — Add contract debug inspectors without player leakage** — `TODO`
- [ ] **APC-066 — Complete API, schema, contributor, and operator documentation** — `TODO`
- [ ] **APC-067 — Run multi-client accessibility and reduced-motion acceptance** — `TODO`
- [ ] **APC-068 — Run all canonical encounter fixtures through the generic contract** — `TODO`
- [ ] **APC-069 — Retire superseded source-specific presentation contracts** — `TODO`
- [ ] **APC-070 — Record final acceptance and unblock capability automation** — `TODO`
  - Require focused suites, typecheck, build, contract checkers, `scripts/quality-gate.sh`, and zero undocumented legacy dependencies.

## Decision log

- **2026-07-26 — Place this initiative between Ability and Capability automation.** Ability automation finishes against its existing plan; the generic seam is then stabilised before additional catalogs multiply client-specific paths.
- **2026-07-26 — Treat source kind as provenance rather than UI taxonomy.** A Feature action and a Move action may share the same action surface while remaining mechanically owned by separate runtimes.
- **2026-07-26 — Preserve non-button mechanics.** Passives, effective capabilities, substitutions, triggered effects, and campaign operations receive explicit roles rather than being forced into invocable menus.
- **2026-07-26 — Make structured accepted facts the presentation source of truth.** Logs and VFX remain projections of accepted mechanics, not alternative mechanics channels.
- **2026-07-26 — Defer the visual redesign, not the UX contracts.** This plan supplies stable data and interaction primitives; `ENCOUNTER_UI_UX_PLAN.md` later replaces the map-first experience.
