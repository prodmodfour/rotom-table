# Complete Play Loop Implementation Plan

`PLAN_STATUS: TODO`

`CURRENT_TICKET: P8-001`

`BLOCKED_BY: NONE`

`DEPENDS_ON: implementation-plans/done/BREEDING_AND_EGG_LIFECYCLE_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Goal

Complete Rotom Table's primary campaign loop so a trusted table can acquire items, equip and use them, run an encounter, settle its consequences, resolve advancement and recovery work, and continue play without manually repairing sheets, inventories, encounter state, or campaign records.

This plan is product-completion work for the alpha. It deliberately prioritizes the ordinary high-frequency PTU campaign loop over repository presentation, release ceremony, public-service hardening, or a new parallel mode such as Contests.

## Product outcome

The completed product supports this coherent journey:

1. A player buys, receives, finds, or transfers an item.
2. The item enters the correct authoritative trainer or group inventory.
3. Rotom Table identifies whether it is usable, equippable, passive, guided, or reference-only.
4. The user sees legal timing, costs, targets, choices, prerequisites, and expected consequences.
5. Item use or equipment changes commit through server-authoritative, revision-checked, idempotent operations.
6. Encounter clients converge on the accepted result without duplicate consumption or optimistic mechanical drift.
7. The GM finishes the encounter through one settlement workflow.
8. XP, money, items, captures, objectives, injuries, temporary effects, and encounter resources settle coherently.
9. Outstanding level, move, evolution, treatment, team, hatch, or ownership decisions become visible attention items.
10. The campaign continues to the next scene or day with no hidden bookkeeping debt.

## Current baseline

Rotom Table already contains the difficult middle of the loop:

- a server-authoritative encounter engine, Encounter Documents, Builder, Battle Cockpit, tactical lens, Director workflows, realtime convergence, exact retry, correction, and accepted presentation facts;
- broad Move, Ability, Capability, Edge, Feature, Maneuver, Order, capture, and breeding automation;
- trainer sheets, Pokémon sheets, shops, shared group inventory, atomic transfers, capture destinations, XP mutation, healing, and campaign-day recovery;
- a generic encounter presentation contract that already recognizes item sources, costs, targets, choices, accepted changes, privacy audiences, and unavailable reasons;
- app-owned canonical item data in `data/reference/items.json`.

The remaining product gap is connective authority and experience. Ordinary items and equipment do not yet form one complete runtime across inventories, sheets, encounters, and campaign time, and encounter completion does not yet orchestrate rewards, cleanup, advancement, recovery, and continuation as one flow.

## Scope

This plan owns:

- canonical item behavior coverage and reviewed structured semantics;
- one general item execution runtime for encounter and non-encounter contexts;
- consumables, reusable tools, equipment, held items, passive providers, and guided adjudication;
- authoritative inventory selection, reservation, consumption, transfer, equipment, history, correction, and recovery;
- item actions in the Battle Cockpit, sheets, inventories, shops, and campaign surfaces;
- encounter settlement, reward allocation, capture destination, temporary cleanup, and settlement history;
- campaign attention items for advancement, evolution, move learning, treatment, team overflow, captures, hatches, and ownership work;
- complete-loop accessibility, responsive behavior, concurrency, restart, performance, and acceptance.

## Explicit non-goals

- Pokémon Contest implementation.
- Public repository presentation, version tags, release notes, branch cleanup, or launch marketing.
- Public authentication, SaaS multi-tenancy, federation, or public-service hardening.
- Replacing the existing encounter engine, presentation contract, map renderer, sheet authority, shop authority, group inventory, capture runtime, breeding runtime, or campaign-day recovery.
- Pretending narrative tools have deterministic effects when the canonical rules require GM judgment.
- Building a second item-specific UI or automation engine beside the source-agnostic encounter and operation systems.
- Broad crafting, downtime, economy, or campaign-generation systems unless a canonical item requires a bounded integration point.
- Automatically making irreversible character-build choices for a player.

## Completion states for canonical items

Every canonical item row must end in exactly one reviewed state:

- **Native** — Rotom Table validates and resolves the complete mechanical effect authoritatively.
- **Guided** — Rotom Table owns eligibility, timing, costs, inventory, choices, receipts, and commit, while a bounded GM decision supplies the rule's interpretive outcome.
- **Passive** — the item contributes automatically while legally held, equipped, or otherwise active.
- **Reference-only** — the item has no supported mechanical action in Rotom Table and the reason is explicit.
- **Not applicable** — the row is documentary, category-only, or otherwise not an actionable owned item.
- **Blocked** — required canonical data or infrastructure is missing. This is a temporary work state and is forbidden at final acceptance.

A row is not complete merely because its description is visible. Any item that presents an action must have authoritative semantics, and any unsupported action must state why it is unavailable.

## Non-negotiable product rules

1. **Finish the ordinary campaign loop before adding a parallel gameplay mode.**
2. **All mechanical item, equipment, reward, and continuation changes are server-authoritative.**
3. **The browser never decrements inventory or applies durable effects optimistically.**
4. **Canonical item identity comes from app-owned structured data, never runtime prose parsing or web lookup.**
5. **One item action may touch many resources, but it commits as one operation or not at all.**
6. **An item is consumed, reserved, refunded, reused, damaged, or broken only at its canonical phase and never twice.**
7. **Actor, controller, inventory owner, source container, and target are separate authority concepts.**
8. **Equipment and held items are explicit effective state, not descriptive inventory rows.**
9. **Item actions use the generic Action Dock, decision, resolution, history, and recovery language.**
10. **Irreversible changes show a complete preview and require an explicit accepted decision.**
11. **Public, owner-private, responder-private, GM-private, and diagnostic data remain structurally distinct.**
12. **Every unresolved consequence becomes visible work rather than hidden bookkeeping.**
13. **GM corrections are explicit, bounded, receipt-backed, and auditable.**
14. **Keyboard, touch, screen-reader, zoom, reflow, reduced-motion, and table-distance use are completion requirements.**
15. **No ticket may declare completion while its workflow still requires direct JSON, SQLite, or ad hoc sheet repair.**

## Target architecture

```text
data/reference/items.json
  + versioned item behavior registry and evidence
  -> authoritative item execution context
  -> eligibility, legal targets, choices, costs, and unavailable reasons
  -> generic encounter/sheet/campaign presentation
  -> declaration or pending decision
  -> deterministic item operation plan
  -> atomic inventory + sheet + encounter + equipment + resource commit
  -> accepted facts, receipts, realtime convergence, exact replay, and correction
```

Equipment and held items extend the same source-provider model:

```text
authoritative equipped/held state
  -> derived contributions
  -> granted actions and contextual affordances
  -> typed passive event subscriptions
  -> source-loss, suppression, durability, and cleanup
```

Encounter completion extends existing authority rather than replacing it:

```text
encounter terminal state
  -> settlement snapshot
  -> unresolved gates
  -> reward package and allocations
  -> persistent-versus-temporary cleanup plan
  -> one atomic settlement commit
  -> structured summary
  -> campaign attention items
  -> next scene or campaign-day continuation
```

## First playable vertical slice

The first end-to-end slice is:

> A Trainer purchases or receives a restorative, enters an encounter, uses it on a legal target, spends the correct action, heals the correct amount, consumes exactly one item, records the result, reconnects from another client, and cannot double-spend through retry.

This slice must be complete before widening the item catalog.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered unfinished ticket and only one ticket is `IN_PROGRESS` unless the decision log explicitly permits parallel work.
- Update this ledger, `implementation-plans/plan-order.md`, and `AGENTS.md` together whenever plan status, current ticket, blocking state, dependency, or ticket count changes.
- Mark a ticket `DONE` only after focused automated tests, required fixtures, role/privacy checks, recovery behavior, and user-facing acceptance for that ticket pass.
- Use bounded test processes and the repository's validation discipline; reserve full suites and `scripts/quality-gate.sh` for meaningful integration and final closure.
- New item semantics must be traceable to app-owned canonical data and reviewed evidence.
- A guided implementation is complete only when authority, bounded GM input, receipts, privacy, retry, correction, and inventory settlement are implemented.
- `PLAN_STATUS: DONE` is permitted only after P8-100, all 100 tickets, every canonical item row, and all complete-loop acceptance journeys are complete.
- Once done, move this file to `implementation-plans/done/COMPLETE_PLAY_LOOP_PLAN.md` and update all authoritative references in the same change.

## Progress snapshot

- Plan tickets: **0 DONE / 100 total**
- Current ticket: **P8-001**
- Blocking dependency: **none; Plans 1–7 are complete**
- Primary product target: **complete alpha campaign loop**
- Canonical item coverage: **not yet inventoried**
- Complete-loop acceptance: **not yet run**

## Tickets

### Phase 1 — Gameplay baseline, coverage model, and acceptance fixtures

- [ ] **P8-001 — Audit the current end-to-end campaign play loop** — `TODO`
  - Trace the ordinary GM and player journey from acquiring an item through encounter use, encounter completion, rewards, advancement, recovery, and the next scene or day.
  - Record every manual edit, duplicate entry, dead end, hidden shortcut, and cross-screen handoff in a versioned structured inventory with owning code paths and future tickets.
- [ ] **P8-002 — Inventory every canonical item behavior** — `TODO`
  - Classify every entry in `data/reference/items.json` by mechanical role, usable context, timing, target, cost, consumption, duration, equipment requirements, and current product support.
  - Do not infer runtime mechanics from documentary sources; missing or ambiguous canonical data must be recorded as a data defect.
- [ ] **P8-003 — Audit inventory authority and item identity** — `TODO`
  - Map trainer inventory, group inventory, shops, capture, automation resources, breeding resources, imports, exports, and realtime updates to their current authority and transaction boundaries.
  - Identify duplicate name matching, unstable row identity, client-owned mutation, and paths that can lose or double-consume inventory.
- [ ] **P8-004 — Audit equipment, held-item, and derived-state representation** — `TODO`
  - Document every current equipment or held-item field, slot convention, derived contribution, granted action, passive provider, and source-loss path.
  - Record unsupported slot rules, stale derived state, equipment represented only as prose, and any mismatch between sheets and encounter-effective state.
- [ ] **P8-005 — Audit encounter settlement and campaign continuation** — `TODO`
  - Trace encounter lifecycle completion, XP grants, money and loot, captures, objective outcomes, temporary-effect cleanup, injuries, recovery, level thresholds, move learning, evolution, and campaign-day advancement.
  - Produce a gap matrix separating existing authoritative operations from missing orchestration.
- [ ] **P8-006 — Define canonical-data remediation rules for item mechanics** — `TODO`
  - Specify the reviewed, source-hash-bound process for adding missing structured item semantics to app-owned data without silently parsing prose at runtime.
  - Define fail-closed behavior for ambiguous identity, costs, targets, durations, and irreversible outcomes.
- [ ] **P8-007 — Define item implementation states and the completion rubric** — `TODO`
  - Use the states `native`, `guided`, `passive`, `reference-only`, `not-applicable`, and `blocked`, with explicit evidence requirements for each.
  - Plan completion permits no `blocked` rows and no unjustified `reference-only` row for an item with concrete supported mechanics.
- [ ] **P8-008 — Define measurable complete-loop UX success criteria** — `TODO`
  - Set task criteria for action discovery, number of screens, correction rate, double-consumption prevention, reconnect recovery, settlement completion, outstanding-decision discovery, mobile use, and table-distance readability.
  - Keep metrics aggregate-only and free of campaign identities, item payloads, or private choices.
- [ ] **P8-009 — Create canonical item and equipment fixtures** — `TODO`
  - Add deterministic fixtures covering healing, status removal, temporary buffs, equipment grants, held passives, source loss, group inventory, shop purchase, and concurrent clients.
  - Bind fixtures to canonical item data and expected authoritative operation plans.
- [ ] **P8-010 — Create canonical settlement and continuation fixtures** — `TODO`
  - Add deterministic fixtures for a simple trainer duel, a capture with team overflow, a loot-heavy encounter, an injury-heavy encounter, and a reconnect during settlement.
  - Each fixture must include expected persistent state, temporary cleanup, reward distribution, outstanding decisions, privacy projections, and retry outcomes.

### Phase 2 — Item contract, registry, and authority boundaries

- [ ] **P8-011 — Define the versioned `ItemSpec` contract** — `TODO`
  - Model stable identity, supported contexts, interaction role, timing, action cost, prerequisites, targets, choices, consumption, effects, duration, privacy, presentation, and evidence.
  - Keep presentation and mechanics fields distinct and reject unknown schema versions.
- [ ] **P8-012 — Define stable item identity and alias resolution** — `TODO`
  - Resolve inventory rows and shop entries to canonical item IDs through reviewed aliases rather than fuzzy prose matching.
  - Reject ambiguous matches and preserve the original display label for user-facing history.
- [ ] **P8-013 — Define item contexts, timing, economy, and frequency** — `TODO`
  - Represent encounter, sheet, campaign, workshop, extended-action, and passive contexts plus Standard, Shift, Swift, Full, Free, Extended, Priority, Interrupt, and Reaction timing where applicable.
  - Ensure action economy and frequency are read from authoritative state and spent only by accepted execution.
- [ ] **P8-014 — Define item targeting and choice contracts** — `TODO`
  - Support self, participant, side, inventory row, equipment slot, move, stat, skill, type, destination, and bounded GM-adjudication choices.
  - Every projected option must use stable opaque IDs and be re-authorized on execution or resume.
- [ ] **P8-015 — Define the item operation vocabulary** — `TODO`
  - Reuse shared operations for HP, temporary HP, injuries, conditions, stages, resources, usage, inventory, equipment, effects, forms, moves, abilities, capabilities, evolution, and campaign facts.
  - Add new operations only when no existing authoritative vocabulary can express the mechanic without loss.
- [ ] **P8-016 — Define inventory source, ownership, and control authority** — `TODO`
  - Separate action actor, inventory owner, source container, target, and controlling profile.
  - Specify GM, player-owner, group-inventory, and delegated-use permissions without trusting client-provided ownership.
- [ ] **P8-017 — Define consumption, reservation, refund, and durability policy** — `TODO`
  - Specify whether an item is consumed on declaration, accepted use, hit, completed extended action, or GM adjudication.
  - Define reservation and refund behavior for pending choices, cancellation, stale commands, failed checks, abandoned recovery, reusable tools, charges, and breakage.
- [ ] **P8-018 — Define read sets, write sets, and atomicity** — `TODO`
  - List every resource an item may consult or mutate and require revision checks for all consulted mutable state.
  - Inventory, sheet, encounter, equipment, resource, and accepted-history changes from one item use must commit or roll back together.
- [ ] **P8-019 — Map item mechanics to the encounter presentation contract** — `TODO`
  - Project item offers, contextual affordances, unavailable reasons, costs, targets, choices, contribution explanations, accepted facts, and private details through the generic presentation model.
  - Item source provenance must not create a parallel item-specific decision UI.
- [ ] **P8-020 — Build the strict item registry and quality checks** — `TODO`
  - Load versioned ItemSpecs, canonical fingerprints, implementation state, evidence, and handler references into a deterministic registry.
  - Add checks for duplicate IDs, orphan aliases, missing evidence, unbounded choices, unsupported operations, runtime drift, and coverage regressions.

### Phase 3 — Authoritative item execution runtime

- [ ] **P8-021 — Build the authoritative item execution context** — `TODO`
  - Load actor, controller, source inventory, canonical item, targets, encounter state, sheets, equipment, resources, environment, and campaign facts from server authority.
  - Record every consulted mutable resource in the operation read set.
- [ ] **P8-022 — Implement item eligibility and legal-target derivation** — `TODO`
  - Derive usable contexts, timing, action availability, prerequisites, inventory quantity, equipment state, relationships, range, visibility, and valid targets on the server.
  - Return concise safe reasons plus optional contribution details for authorized inspectors.
- [ ] **P8-023 — Implement authoritative source-inventory resolution** — `TODO`
  - Resolve exact row identity and quantity across trainer, group, and other approved containers without client-side name matching.
  - Support stacked rows, whole-row equipment, moved rows, and stale row revisions without consuming the wrong item.
- [ ] **P8-024 — Add the general `useItem` live-play command** — `TODO`
  - Introduce a versioned command envelope that references an authorized projected offer, source inventory row, targets, choices, revisions, and operation ID.
  - Keep specialized capture and shop commands intact until their shared boundaries are proven and migrated deliberately.
- [ ] **P8-025 — Implement item pending choices and exact resume** — `TODO`
  - Persist unresolved private or public item choices using the existing resolution-stack and operation-journal conventions.
  - Resume must reuse the original rolls, reservations, costs, and read-set assumptions or fail closed when authority changed.
- [ ] **P8-026 — Implement deterministic item planning and reduction** — `TODO`
  - Convert a validated ItemSpec plus choices into a deterministic operation plan before mutating storage.
  - Reducers must be pure, ordered, explainable, and compatible with existing automation transaction machinery.
- [ ] **P8-027 — Commit item operations atomically** — `TODO`
  - Apply all inventory, sheet, encounter, equipment, resource, and history changes in one transaction with compare-and-swap protection.
  - Test rollback after every write boundary and prohibit partial accepted presentation.
- [ ] **P8-028 — Implement exact replay and idempotent retry** — `TODO`
  - Return the original terminal result for duplicate operation IDs and never reroll, respent actions, or reconsume inventory.
  - Cover client timeout, tab echo, reconnect, server restart, and retry after a terminal rejection.
- [ ] **P8-029 — Implement privacy-safe projection, realtime, and history** — `TODO`
  - Publish only role-authorized item offers, choices, costs, outcomes, and state changes while preserving private inventory and target information.
  - All clients must converge from authoritative updates without applying optimistic mechanical mutations twice.
- [ ] **P8-030 — Implement item correction, abandonment, and runtime conformance** — `TODO`
  - Give the GM explicit correction and safe abandonment paths that preserve receipts and explain resulting inventory state.
  - Add property, parser, authorization, transaction, replay, privacy, and presentation-conformance tests for the runtime.

### Phase 4 — Common consumables and the first complete vertical slice

- [ ] **P8-031 — Implement HP-restoration items** — `TODO`
  - Support fixed, rolled, maximum-relative, injury-adjusted, and capped healing using authoritative effective HP.
  - Reject invalid targets and expose a preview that distinguishes expected healing from overheal.
- [ ] **P8-032 — Implement condition-removal items** — `TODO`
  - Support one, several, chosen, and all applicable removable conditions with canonical condition identity.
  - Explain when a target has no removable condition or when a condition is outside the item's scope.
- [ ] **P8-033 — Implement revival and consciousness-recovery items** — `TODO`
  - Model fainted or unconscious prerequisites, resulting HP, injury interactions, and any timing restrictions.
  - Do not allow ordinary healing items to bypass revival rules.
- [ ] **P8-034 — Implement combat-stage and temporary-stat consumables** — `TODO`
  - Apply bounded stage or effective-stat changes with stacking, caps, replacement, and expiration rules.
  - Record the item as the durable source so cleanup and explanation remain correct.
- [ ] **P8-035 — Implement duration, expiry, and encounter cleanup for consumables** — `TODO`
  - Support round, turn, scene, encounter, daily, and explicit-dismissal durations through authoritative clocks or lifecycle events.
  - Reconnect, pause, correction, and settlement must not duplicate or strand effects.
- [ ] **P8-036 — Implement food, refreshments, and concrete temporary buffs** — `TODO`
  - Cover canonical food effects that have deterministic mechanical outcomes and route interpretive cases to guided adjudication.
  - Prevent incompatible stacking and make remaining duration visible.
- [ ] **P8-037 — Implement tools and item-driven skill checks** — `TODO`
  - Support reusable tools, required skills or Features, AP or action costs, deterministic rolls, target effects, and bounded follow-up choices.
  - Consumption and durability must follow the policy defined by the canonical item.
- [ ] **P8-038 — Expose item actions in the encounter Action Dock** — `TODO`
  - Add an Inventory action group with search, recents, keyboard access, touch support, legal targets, costs, and visible unavailable reasons.
  - Only contextually meaningful item actions should compete with the current decision.
- [ ] **P8-039 — Expose common item actions on sheets and inventory surfaces** — `TODO`
  - Provide use, inspect, equip where applicable, target selection, previews, progress, success, conflict, and recovery states without duplicating mechanics in the client.
  - Link accepted results to the relevant sheet and encounter history.
- [ ] **P8-040 — Certify the restorative consumable vertical slice** — `TODO`
  - Complete buy or receive → inventory → encounter offer → target → action cost → effect → exact consumption → event feed → reconnect → correction across GM and player clients.
  - Pass the canonical fixture with no manual HP, condition, stage, action-economy, or inventory repair.

### Phase 5 — Equipment and held-item state

- [ ] **P8-041 — Define explicit equipment and held-item documents** — `TODO`
  - Represent trainer equipment slots, Pokémon held items, source inventory provenance, revision, active state, and item-specific configuration explicitly.
  - Do not treat descriptive inventory rows as effective equipment.
- [ ] **P8-042 — Add migrations and normalizers for existing equipment data** — `TODO`
  - Convert supported legacy slot or row conventions without inventing ambiguous assignments.
  - Preserve recoverable source data and surface unresolved migration choices to the GM.
- [ ] **P8-043 — Implement slot, compatibility, and exclusivity rules** — `TODO`
  - Validate slot type, species or trainer restrictions, handedness, mutually exclusive items, required capabilities, and other canonical prerequisites.
  - Show the exact safe reason an item cannot be equipped.
- [ ] **P8-044 — Implement equip, unequip, swap, give, and take commands** — `TODO`
  - Move items between inventory and equipment or held state atomically while respecting ownership, control, revisions, and whole-item semantics.
  - Swaps must never drop, duplicate, or temporarily activate both incompatible sources.
- [ ] **P8-045 — Unify stack and whole-row behavior for equipment** — `TODO`
  - Define quantity behavior for stackable consumables, unique equipment, charged tools, and serialized items.
  - Transfers and equipment commands must preserve stable identity and item-specific state.
- [ ] **P8-046 — Project equipment-derived contributions** — `TODO`
  - Apply equipment modifiers to derived stats, movement, defenses, capabilities, skill checks, range, and other supported effective values.
  - Inspectors must show base, each source contribution, caps or overrides, and the final value.
- [ ] **P8-047 — Project equipment-granted actions and rule sources** — `TODO`
  - Grant Moves, Abilities, Capabilities, Features, Edges, item actions, or contextual affordances through the existing source-agnostic presentation contract.
  - Removing the source must immediately withdraw its offers unless an accepted effect is independently durable.
- [ ] **P8-048 — Implement passive equipment event providers** — `TODO`
  - Subscribe held and equipped items to typed authoritative events with frequency, priority, privacy, choice, and exact-replay behavior.
  - Use the existing provider and receipt architecture rather than polling client state.
- [ ] **P8-049 — Implement source loss, suppression, durability, and breakage** — `TODO`
  - Remove, suspend, restore, expend, or break equipment effects deterministically when ownership or state changes.
  - Unsupported narrative damage uses guided adjudication and cannot silently mutate durability.
- [ ] **P8-050 — Certify multi-client equipment behavior** — `TODO`
  - Complete purchase or transfer → equip → derived change → granted action or passive → reconnect → swap or remove → source cleanup on trainer and Pokémon fixtures.
  - No client may retain stale offers, values, or private equipment details.

### Phase 6 — Out-of-encounter item workflows

- [ ] **P8-051 — Create a shared non-encounter item execution context** — `TODO`
  - Reuse ItemSpecs, authority, planning, transactions, receipts, and presentation without requiring an active encounter.
  - Explicitly model campaign time, extended actions, target ownership, and any GM confirmation.
- [ ] **P8-052 — Implement medical and extended-action item use** — `TODO`
  - Support First Aid and other canonical treatment tools, required checks, AP, time, injury limits, conditions, and reusable-kit semantics.
  - Progress and interruption must recover safely without duplicate effects.
- [ ] **P8-053 — Implement training aids and permanent-stat consumables** — `TODO`
  - Preview permanent changes, validate legal caps and prior use, consume exactly once, and record provenance.
  - Reject changes that would make a sheet invalid or exceed canonical limits.
- [ ] **P8-054 — Implement move-learning and move-modifying items** — `TODO`
  - Validate species, tutor or machine compatibility, known-move limits, replacement choices, and any usage restrictions.
  - Commit the learned move and item consumption together after explicit confirmation.
- [ ] **P8-055 — Implement evolution-item workflows** — `TODO`
  - Preview target species, form, retained character identity, stats, moves, abilities, capabilities, equipment compatibility, and unresolved choices before commit.
  - Evolution, inventory consumption, sheet update, and resulting attention items must be atomic and replay-safe.
- [ ] **P8-056 — Implement item-driven form changes** — `TODO`
  - Model temporary and persistent forms, legal triggers, resulting effective data, source ownership, and reversal.
  - Do not overwrite unrelated character customization or encounter history.
- [ ] **P8-057 — Implement bait, lure, repellent, and exploration items** — `TODO`
  - Integrate deterministic effects with encounter generation, campaign clocks, or bounded GM prompts as appropriate.
  - Clearly separate automated consequences from fictional positioning that requires adjudication.
- [ ] **P8-058 — Integrate breeding, egg, fossil, and restoration items** — `TODO`
  - Route supported item modifiers and operations through existing breeding and egg authority, including read sets, exact consumption, provenance, and recovery.
  - Do not duplicate breeding calculations or create a second offspring-construction path.
- [ ] **P8-059 — Implement the guided adjudication workflow** — `TODO`
  - Let a user declare a supported guided item, reserve or consume it at the correct phase, expose canonical rule context, collect bounded GM input, and commit the accepted outcome.
  - Record who decided, what was accepted, and how inventory was settled without exposing private notes.
- [ ] **P8-060 — Certify out-of-encounter item journeys** — `TODO`
  - Pass medical, training, move-learning, evolution, exploration, breeding-related, guided, cancellation, stale, reconnect, and restart fixtures.
  - No journey may require direct JSON, database, HP, move-list, evolution, or inventory repair.

### Phase 7 — Inventory and commerce continuity

- [ ] **P8-061 — Define the unified inventory action contract** — `TODO`
  - Use one action model for use, equip, unequip, give, take, transfer, split, merge, discard, inspect, and guided adjudication across trainer and group inventory.
  - Actions must advertise authority, required revisions, destination rules, and irreversible consequences.
- [ ] **P8-062 — Implement source-inventory selection and provenance** — `TODO`
  - Show the exact container and row that will supply an item when several eligible copies exist.
  - Remember only safe local presentation preferences; authoritative selection is revalidated on commit.
- [ ] **P8-063 — Implement use, equip, give, and transfer flows from inventory** — `TODO`
  - Connect existing trainer/group transfer operations to the shared action anatomy and add item execution without parallel bespoke dialogs.
  - Authoritative responses replace local state and update every affected client.
- [ ] **P8-064 — Implement split, merge, and discard flows** — `TODO`
  - Preserve canonical identity, stable row IDs, serialized state, and equipment rules while manipulating stacks.
  - Destructive actions require clear confirmation and produce receipts suitable for correction.
- [ ] **P8-065 — Support group-inventory item use and reservation** — `TODO`
  - Allow authorized use directly from shared inventory when the rules and table policy permit it, with explicit target and ownership semantics.
  - Pending use must reserve quantities without blocking unrelated rows or enabling double spending.
- [ ] **P8-066 — Add meaningful shop post-checkout actions** — `TODO`
  - After purchase, offer inspect, equip now, use now when legal, transfer to an eligible trainer, or move to group inventory.
  - Continue to use the accepted checkout result rather than re-querying by item name.
- [ ] **P8-067 — Add inventory receipts and history** — `TODO`
  - Record purchases, transfers, item uses, equipment changes, guided outcomes, settlement awards, discards, and GM corrections as structured facts.
  - Expose user-readable history without leaking private inventory or internal operation identifiers by default.
- [ ] **P8-068 — Implement inventory conflict and recovery UX** — `TODO`
  - Handle stale revisions, moved rows, reserved items, uncertain commands, offline reconnect, and concurrent tabs through explicit reconciliation.
  - Never resolve uncertainty by replaying a new mechanical command automatically.
- [ ] **P8-069 — Complete responsive and accessible inventory interactions** — `TODO`
  - Support keyboard, touch, screen readers, zoom, reflow, reduced motion, clear focus restoration, and 44-pixel targets across dense inventories.
  - Keep quantity, source, target, cost, and destructive consequences understandable without color alone.
- [ ] **P8-070 — Certify the buy, transfer, equip, and use loop** — `TODO`
  - Complete shop checkout → destination → equip or use → encounter effect → history → transfer or unequip across desktop and mobile GM/player clients.
  - All inventories and effective state must converge without manual refresh or duplicated mutations.

### Phase 8 — Encounter settlement and rewards

- [ ] **P8-071 — Define the versioned encounter settlement document** — `TODO`
  - Represent settlement status, encounter revision, participants, unresolved gates, persistent consequences, reward package, allocations, temporary cleanup, decisions, receipts, and completion state.
  - Keep settlement orchestration separate from mechanics authority and do not duplicate encounter or sheet state.
- [ ] **P8-072 — Define settlement eligibility and blocking gates** — `TODO`
  - Prevent final settlement while required reactions, uncertain commands, unresolved private choices, contradictory revisions, or invalid participant state remain.
  - Allow explicit GM adjudication only through a recorded bounded correction path.
- [ ] **P8-073 — Build the persistent-versus-temporary consequence snapshot** — `TODO`
  - Summarize HP, injuries, conditions, captures, resource usage, equipment, effects, objectives, phases, clocks, and accepted events at encounter end.
  - Each field must name its authority and settlement behavior: preserve, transform, expire, reset, or require a decision.
- [ ] **P8-074 — Define reward packages and allocation rules** — `TODO`
  - Model XP, money, item stacks, serialized equipment, captured Pokémon, narrative rewards, and GM notes with group, side, participant, or profile destinations.
  - Preview all writes and validate destination capacity and permissions before commit.
- [ ] **P8-075 — Implement batch XP allocation** — `TODO`
  - Reuse authoritative experience rules to distribute fixed, weighted, or individually adjusted XP with level-threshold previews.
  - All grants must commit with settlement or be explicitly excluded; partial repetitive token edits are not the primary flow.
- [ ] **P8-076 — Implement money and item loot allocation** — `TODO`
  - Allocate rewards to trainers or group inventory with stack merging, equipment identity, capacity checks, and revision protection.
  - Unallocated rewards remain visibly pending and cannot disappear when settlement is closed.
- [ ] **P8-077 — Settle captures and team or box destinations** — `TODO`
  - Reuse accepted capture records, validate ownership and team limits, handle overflow, and expose required naming or assignment decisions.
  - Do not duplicate captured sheets or lose the original caught-ball and provenance data.
- [ ] **P8-078 — Settle objectives, clocks, phases, and encounter outcomes** — `TODO`
  - Record public and private objective results, stakes, clock changes, phase conclusions, and campaign consequences as structured accepted facts.
  - Support GM-authored bounded outcomes without turning freeform notes into hidden mechanics.
- [ ] **P8-079 — Expire temporary state and reset encounter-scoped resources** — `TODO`
  - Remove or transform effects, stages, zones, reservations, encounter items, and encounter-frequency usage according to their owning contracts.
  - Cleanup must be deterministic, source-aware, replay-safe, and explainable in the settlement preview.
- [ ] **P8-080 — Commit settlement atomically** — `TODO`
  - Apply rewards, captures, inventory, sheet changes, cleanup, encounter lifecycle, history, and attention records in one revision-checked transaction.
  - Test rollback at every write boundary and guarantee exact terminal replay.
- [ ] **P8-081 — Implement settlement correction, realtime, privacy, and recovery** — `TODO`
  - Support multi-client convergence, role-specific projections, reconnect, restart, stale drafts, uncertain commits, post-settlement correction, and an immutable audit trail.
  - Private rewards and GM notes must never appear in public summaries.
- [ ] **P8-082 — Build and certify the Finish Encounter experience** — `TODO`
  - Provide a guided review of unresolved gates, consequences, rewards, allocations, cleanup, outstanding decisions, confirmation, accepted summary, and continuation actions.
  - Pass all settlement fixtures without visiting individual sheets or inventories to repair state.

### Phase 9 — Advancement, recovery, and campaign continuation

- [ ] **P8-083 — Build the campaign attention-item model** — `TODO`
  - Represent a stable reason, affected entity, audience, urgency, source event, required decision, legal next actions, and resolution state.
  - Attention items point to authority; they do not copy mutable character data.
- [ ] **P8-084 — Detect level thresholds and unspent advancement** — `TODO`
  - Create attention items for reached levels, unspent stat points, newly legal choices, or invalid advancement state.
  - Do not make irreversible build choices automatically.
- [ ] **P8-085 — Detect move-learning, ability, and evolution decisions** — `TODO`
  - Surface pending learned moves, replacement choices, evolution eligibility, form choices, and post-evolution cleanup with direct links to bounded workflows.
  - Suppress decisions already resolved by authoritative item, breeding, or settlement operations.
- [ ] **P8-086 — Detect Trainer advancement and feature decisions** — `TODO`
  - Surface Trainer level, class, Feature, Edge, skill-rank, and related choices that the canonical sheet model can validate.
  - Unsupported build-planning rules remain clearly guided rather than being silently auto-selected.
- [ ] **P8-087 — Detect injury, treatment, and recovery needs** — `TODO`
  - Summarize sheets needing medical attention, extended rests, additional days, condition follow-up, or resource recovery.
  - Use existing healing and campaign-day authority and explain why an entity is not yet recovered.
- [ ] **P8-088 — Detect team overflow, captures, hatches, and ownership work** — `TODO`
  - Surface unassigned captures, over-capacity teams, boxed destinations, newly hatched Pokémon, naming, profile linking, and equipment incompatibility.
  - Resolve each through explicit authoritative workflows with privacy-safe ownership.
- [ ] **P8-089 — Project attention items by role and profile** — `TODO`
  - Give players only decisions and summaries they own or may see; give the GM campaign-wide orchestration and correction views.
  - Realtime updates must add, update, and clear attention items without duplicate local bookkeeping.
- [ ] **P8-090 — Turn the campaign page into a continuation dashboard** — `TODO`
  - Show active encounter, unfinished settlement, urgent decisions, injuries, recovery, captures, eggs, equipment issues, and recommended next actions using the established design system.
  - Preserve a clear GM-only campaign-day action without making it the only campaign tool.
- [ ] **P8-091 — Add campaign-day preflight, postflight, and continuation acceptance** — `TODO`
  - Preview affected sheets and unresolved blockers before advancing a day, then show recovery results and remaining attention afterward.
  - Certify settlement → decisions → treatment → next day → next scene across GM and player clients.

### Phase 10 — Catalog completion, quality gates, and alpha closure

- [ ] **P8-092 — Implement the canonical item catalog in reviewed cohorts** — `TODO`
  - Move every `data/reference/items.json` row through the registry using bounded cohorts grouped by shared mechanics and provider requirements.
  - Each cohort requires source fingerprint, executable evidence, UI projection, recovery behavior, and an implementation-state decision.
- [ ] **P8-093 — Close native, guided, passive, and reference-only coverage** — `TODO`
  - Require every canonical item to be mechanically complete, guided-complete, passive-complete, or explicitly justified as reference-only or not applicable.
  - No item may remain `blocked`, silently inert, falsely actionable, or dependent on an undocumented manual edit.
- [ ] **P8-094 — Add drift, forbidden-gap, and dual-authority checks** — `TODO`
  - Fail validation on unregistered canonical items, orphan handlers, client-owned mechanical mutation, inventory writes outside approved transactions, stale provider identities, or settlement fields with no owner.
  - Bind completion evidence to canonical data and runtime fingerprints.
- [ ] **P8-095 — Meet performance and scale budgets** — `TODO`
  - Validate large inventories, many equipment providers, dense Action Dock projections, large reward packages, attention queues, and multi-client realtime without unbounded scans or DOM growth.
  - Record lower-end-laptop, mobile, and large-campaign budgets and enforce them in focused benchmarks.
- [ ] **P8-096 — Complete accessibility, responsive, and visual acceptance** — `TODO`
  - Run keyboard, screen-reader, touch, zoom, reflow, contrast, reduced-motion, table-distance, desktop, mobile, and table-display checks for item, equipment, settlement, and continuation flows.
  - Fix critical comprehension or interaction defects rather than documenting them as alpha exceptions.
- [ ] **P8-097 — Complete concurrency, reconnect, restart, and failure acceptance** — `TODO`
  - Exercise duplicate commands, stale inventories, moved rows, pending choices, reservations, server restart, tab echo, partial transaction failure, settlement retry, and correction.
  - Prove no item, reward, effect, capture, XP grant, or attention decision is lost or applied twice.
- [ ] **P8-098 — Run complete golden campaign journeys** — `TODO`
  - Certify acquire → transfer → equip/use → encounter → capture → finish → reward → advancement → treatment → next day → next scene on all canonical fixtures.
  - Require both GM and player perspectives and prohibit direct storage repair during acceptance.
- [ ] **P8-099 — Complete user, GM, contributor, and operator documentation** — `TODO`
  - Document item states, inventory actions, equipment, guided adjudication, settlement, attention items, correction, recovery, canonical-data maintenance, and troubleshooting.
  - Keep documentation focused on using and extending the alpha product, not repository promotion or release ceremony.
- [ ] **P8-100 — Record final alpha product acceptance** — `TODO`
  - Run focused and full validation required by the repository, record complete-loop evidence, confirm every ticket and item row is complete, and verify no critical usability debt remains in the primary campaign loop.
  - Set `PLAN_STATUS: DONE`, clear `CURRENT_TICKET`, archive the plan under `implementation-plans/done/`, and update `plan-order.md` and `AGENTS.md` only after all acceptance gates pass.

## Phase exit gates

### Phase 1 exit

- The current product loop, every canonical item, all inventory authorities, equipment state, settlement handoffs, and continuation gaps are represented in versioned structured inventories.
- Completion states, success criteria, fixtures, and canonical-data remediation rules are testable.
- P8-001 through P8-010 are `DONE`.

### Phase 2 exit

- ItemSpec, identity, targeting, operation, ownership, consumption, atomicity, presentation, and registry contracts are versioned and fail closed.
- Registry checks prevent ambiguous or unsupported runtime semantics.
- P8-011 through P8-020 are `DONE`.

### Phase 3 exit

- A general authoritative item command can plan, pause, resume, commit, replay, correct, recover, publish, and project item use without duplicate consumption or private-data leakage.
- P8-021 through P8-030 are `DONE`.

### Phase 4 exit

- Common restorative, condition, revival, stage, duration, food, and tool items work from the encounter cockpit and sheet/inventory surfaces.
- The first playable vertical slice passes with GM and player clients.
- P8-031 through P8-040 are `DONE`.

### Phase 5 exit

- Trainer equipment and Pokémon held items are explicit authoritative state with correct slots, derived values, granted sources, passives, source loss, and multi-client convergence.
- P8-041 through P8-050 are `DONE`.

### Phase 6 exit

- Medical, training, move-learning, evolution, form, exploration, breeding-related, and guided item workflows work outside encounters through the same authority.
- P8-051 through P8-060 are `DONE`.

### Phase 7 exit

- Inventory and commerce surfaces provide coherent use, equipment, transfer, stack, discard, provenance, receipt, recovery, mobile, and accessible workflows.
- The buy → transfer → equip/use loop passes.
- P8-061 through P8-070 are `DONE`.

### Phase 8 exit

- Finishing an encounter settles all supported rewards, captures, consequences, temporary cleanup, history, privacy, correction, and continuation in one coherent workflow.
- P8-071 through P8-082 are `DONE`.

### Phase 9 exit

- Advancement, evolution, move learning, treatment, recovery, team overflow, captures, hatches, and ownership work appear as role-correct attention items on a useful campaign dashboard.
- Settlement → decisions → next day → next scene passes.
- P8-083 through P8-091 are `DONE`.

### Phase 10 exit

- Every canonical item has a final reviewed state, all drift and dual-authority checks pass, scale and accessibility budgets pass, failure/restart journeys pass, and complete golden campaign journeys require no storage repair.
- P8-092 through P8-100 are `DONE`, the plan is archived, and the primary alpha campaign loop has no critical unresolved usability debt.

## Final definition of done

This plan is complete only when all of the following are true:

1. Every entry in `data/reference/items.json` has one final reviewed implementation state and no row remains `blocked`.
2. Common mechanical items no longer require manual HP, condition, stage, move-list, form, inventory, equipment, action-economy, or resource edits.
3. Item and equipment actions use the same authoritative presentation, decision, exact-replay, correction, and recovery systems as the rest of live play.
4. Item quantity, equipment state, target effects, action costs, resources, and accepted history commit atomically.
5. Retrying, reconnecting, reopening a tab, or restarting the server cannot consume, grant, equip, reward, capture, or settle anything twice.
6. Players can act only through controlled characters and authorized inventories; private choices and rewards remain private.
7. Equipment contributions and granted sources appear and disappear correctly after transfer, source loss, suppression, reconnect, and correction.
8. Narrative or interpretive items have a complete guided workflow rather than a dead action or hidden manual edit.
9. Finishing an encounter produces one coherent settlement workflow for XP, money, items, captures, objectives, injuries, conditions, temporary state, and encounter resources.
10. Outstanding advancement, move, evolution, treatment, team, capture, hatch, and ownership decisions are visible and actionable after settlement.
11. The campaign dashboard leads the table from unfinished encounter work through recovery and into the next scene or day.
12. Desktop, mobile, keyboard, touch, screen-reader, reduced-motion, multi-client, reconnect, restart, stale, and correction acceptance all pass.
13. The complete acquire → equip/use → encounter → settle → advance/recover → continue journey works without direct data repair.
14. No critical usability debt remains in the ordinary campaign loop.

## Decision log

- **2026-08-12 — Treat Rotom Table as an alpha product, not a release candidate.** Product completeness takes precedence over repository presentation, tags, releases, and public-facing cleanup.
- **2026-08-12 — Complete the primary campaign loop before Pokémon Contests.** Contests remain a future parallel mode unless real campaign evidence changes the priority.
- **2026-08-12 — Use items and equipment as the backbone of loop completion.** They connect shops, inventories, sheets, encounters, automation, rewards, advancement, and recovery.
- **2026-08-12 — Reuse the existing authoritative operation and presentation architecture.** Item mechanics do not justify a second automation engine or bespoke live-play UI.
- **2026-08-12 — Permit guided completion for genuinely interpretive rules.** Honest bounded adjudication is preferable to false automation or unexplained manual edits.
- **2026-08-12 — Make encounter settlement a first-class product workflow.** Ending an encounter must settle consequences and expose remaining work rather than merely changing lifecycle state.
- **2026-08-12 — Never automate irreversible character-building choices silently.** Rotom Table detects and guides advancement decisions while leaving the final legal choice explicit.
