# Complete Play Loop Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

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

- Plan tickets: **100 DONE / 100 total**
- Current ticket: **none; plan complete and archived**
- Blocking dependency: **none; Plans 1–7 are complete**
- Primary product target: **trusted-table liveplay alpha accepted**
- Canonical item coverage: **348 of 348 rows assigned to reviewed complete states; zero blocked rows**
- Complete-loop acceptance: **all focused gates, golden campaigns, full repository validation, and final product assertions passed**

## Tickets

### Phase 1 — Gameplay baseline, coverage model, and acceptance fixtures

- [x] **P8-001 — Audit the current end-to-end campaign play loop** — `DONE`
  - Trace the ordinary GM and player journey from acquiring an item through encounter use, encounter completion, rewards, advancement, recovery, and the next scene or day.
  - Record every manual edit, duplicate entry, dead end, hidden shortcut, and cross-screen handoff in a versioned structured inventory with owning code paths and future tickets.
- [x] **P8-002 — Inventory every canonical item behavior** — `DONE`
  - Classify every entry in `data/reference/items.json` by mechanical role, usable context, timing, target, cost, consumption, duration, equipment requirements, and current product support.
  - Do not infer runtime mechanics from documentary sources; missing or ambiguous canonical data must be recorded as a data defect.
- [x] **P8-003 — Audit inventory authority and item identity** — `DONE`
  - Map trainer inventory, group inventory, shops, capture, automation resources, breeding resources, imports, exports, and realtime updates to their current authority and transaction boundaries.
  - Identify duplicate name matching, unstable row identity, client-owned mutation, and paths that can lose or double-consume inventory.
- [x] **P8-004 — Audit equipment, held-item, and derived-state representation** — `DONE`
  - Document every current equipment or held-item field, slot convention, derived contribution, granted action, passive provider, and source-loss path.
  - Record unsupported slot rules, stale derived state, equipment represented only as prose, and any mismatch between sheets and encounter-effective state.
- [x] **P8-005 — Audit encounter settlement and campaign continuation** — `DONE`
  - Trace encounter lifecycle completion, XP grants, money and loot, captures, objective outcomes, temporary-effect cleanup, injuries, recovery, level thresholds, move learning, evolution, and campaign-day advancement.
  - Produce a gap matrix separating existing authoritative operations from missing orchestration.
- [x] **P8-006 — Define canonical-data remediation rules for item mechanics** — `DONE`
  - Specify the reviewed, source-hash-bound process for adding missing structured item semantics to app-owned data without silently parsing prose at runtime.
  - Define fail-closed behavior for ambiguous identity, costs, targets, durations, and irreversible outcomes.
- [x] **P8-007 — Define item implementation states and the completion rubric** — `DONE`
  - Use the states `native`, `guided`, `passive`, `reference-only`, `not-applicable`, and `blocked`, with explicit evidence requirements for each.
  - Plan completion permits no `blocked` rows and no unjustified `reference-only` row for an item with concrete supported mechanics.
- [x] **P8-008 — Define measurable complete-loop UX success criteria** — `DONE`
  - Set task criteria for action discovery, number of screens, correction rate, double-consumption prevention, reconnect recovery, settlement completion, outstanding-decision discovery, mobile use, and table-distance readability.
  - Keep metrics aggregate-only and free of campaign identities, item payloads, or private choices.
- [x] **P8-009 — Create canonical item and equipment fixtures** — `DONE`
  - Add deterministic fixtures covering healing, status removal, temporary buffs, equipment grants, held passives, source loss, group inventory, shop purchase, and concurrent clients.
  - Bind fixtures to canonical item data and expected authoritative operation plans.
- [x] **P8-010 — Create canonical settlement and continuation fixtures** — `DONE`
  - Add deterministic fixtures for a simple trainer duel, a capture with team overflow, a loot-heavy encounter, an injury-heavy encounter, and a reconnect during settlement.
  - Each fixture must include expected persistent state, temporary cleanup, reward distribution, outstanding decisions, privacy projections, and retry outcomes.

### Phase 2 — Item contract, registry, and authority boundaries

- [x] **P8-011 — Define the versioned `ItemSpec` contract** — `DONE`
  - Model stable identity, supported contexts, interaction role, timing, action cost, prerequisites, targets, choices, consumption, effects, duration, privacy, presentation, and evidence.
  - Keep presentation and mechanics fields distinct and reject unknown schema versions.
- [x] **P8-012 — Define stable item identity and alias resolution** — `DONE`
  - Resolve inventory rows and shop entries to canonical item IDs through reviewed aliases rather than fuzzy prose matching.
  - Reject ambiguous matches and preserve the original display label for user-facing history.
- [x] **P8-013 — Define item contexts, timing, economy, and frequency** — `DONE`
  - Represent encounter, sheet, campaign, workshop, extended-action, and passive contexts plus Standard, Shift, Swift, Full, Free, Extended, Priority, Interrupt, and Reaction timing where applicable.
  - Ensure action economy and frequency are read from authoritative state and spent only by accepted execution.
- [x] **P8-014 — Define item targeting and choice contracts** — `DONE`
  - Support self, participant, side, inventory row, equipment slot, move, stat, skill, type, destination, and bounded GM-adjudication choices.
  - Every projected option must use stable opaque IDs and be re-authorized on execution or resume.
- [x] **P8-015 — Define the item operation vocabulary** — `DONE`
  - Reuse shared operations for HP, temporary HP, injuries, conditions, stages, resources, usage, inventory, equipment, effects, forms, moves, abilities, capabilities, evolution, and campaign facts.
  - Add new operations only when no existing authoritative vocabulary can express the mechanic without loss.
- [x] **P8-016 — Define inventory source, ownership, and control authority** — `DONE`
  - Separate action actor, inventory owner, source container, target, and controlling profile.
  - Specify GM, player-owner, group-inventory, and delegated-use permissions without trusting client-provided ownership.
- [x] **P8-017 — Define consumption, reservation, refund, and durability policy** — `DONE`
  - Specify whether an item is consumed on declaration, accepted use, hit, completed extended action, or GM adjudication.
  - Define reservation and refund behavior for pending choices, cancellation, stale commands, failed checks, abandoned recovery, reusable tools, charges, and breakage.
- [x] **P8-018 — Define read sets, write sets, and atomicity** — `DONE`
  - List every resource an item may consult or mutate and require revision checks for all consulted mutable state.
  - Inventory, sheet, encounter, equipment, resource, and accepted-history changes from one item use must commit or roll back together.
- [x] **P8-019 — Map item mechanics to the encounter presentation contract** — `DONE`
  - Project item offers, contextual affordances, unavailable reasons, costs, targets, choices, contribution explanations, accepted facts, and private details through the generic presentation model.
  - Item source provenance must not create a parallel item-specific decision UI.
- [x] **P8-020 — Build the strict item registry and quality checks** — `DONE`
  - Load versioned ItemSpecs, canonical fingerprints, implementation state, evidence, and handler references into a deterministic registry.
  - Add checks for duplicate IDs, orphan aliases, missing evidence, unbounded choices, unsupported operations, runtime drift, and coverage regressions.

### Phase 3 — Authoritative item execution runtime

- [x] **P8-021 — Build the authoritative item execution context** — `DONE`
  - Load actor, controller, source inventory, canonical item, targets, encounter state, sheets, equipment, resources, environment, and campaign facts from server authority.
  - Record every consulted mutable resource in the operation read set.
- [x] **P8-022 — Implement item eligibility and legal-target derivation** — `DONE`
  - Derive usable contexts, timing, action availability, prerequisites, inventory quantity, equipment state, relationships, range, visibility, and valid targets on the server.
  - Return concise safe reasons plus optional contribution details for authorized inspectors.
- [x] **P8-023 — Implement authoritative source-inventory resolution** — `DONE`
  - Resolve exact row identity and quantity across trainer, group, and other approved containers without client-side name matching.
  - Support stacked rows, whole-row equipment, moved rows, and stale row revisions without consuming the wrong item.
- [x] **P8-024 — Add the general `useItem` live-play command** — `DONE`
  - Introduce a versioned command envelope that references an authorized projected offer, source inventory row, targets, choices, revisions, and operation ID.
  - Keep specialized capture and shop commands intact until their shared boundaries are proven and migrated deliberately.
- [x] **P8-025 — Implement item pending choices and exact resume** — `DONE`
  - Persist unresolved private or public item choices using the existing resolution-stack and operation-journal conventions.
  - Resume must reuse the original rolls, reservations, costs, and read-set assumptions or fail closed when authority changed.
- [x] **P8-026 — Implement deterministic item planning and reduction** — `DONE`
  - Convert a validated ItemSpec plus choices into a deterministic operation plan before mutating storage.
  - Reducers must be pure, ordered, explainable, and compatible with existing automation transaction machinery.
- [x] **P8-027 — Commit item operations atomically** — `DONE`
  - Apply all inventory, sheet, encounter, equipment, resource, and history changes in one transaction with compare-and-swap protection.
  - Test rollback after every write boundary and prohibit partial accepted presentation.
- [x] **P8-028 — Implement exact replay and idempotent retry** — `DONE`
  - Return the original terminal result for duplicate operation IDs and never reroll, respent actions, or reconsume inventory.
  - Cover client timeout, tab echo, reconnect, server restart, and retry after a terminal rejection.
- [x] **P8-029 — Implement privacy-safe projection, realtime, and history** — `DONE`
  - Publish only role-authorized item offers, choices, costs, outcomes, and state changes while preserving private inventory and target information.
  - All clients must converge from authoritative updates without applying optimistic mechanical mutations twice.
- [x] **P8-030 — Implement item correction, abandonment, and runtime conformance** — `DONE`
  - Give the GM explicit correction and safe abandonment paths that preserve receipts and explain resulting inventory state.
  - Add property, parser, authorization, transaction, replay, privacy, and presentation-conformance tests for the runtime.

### Phase 4 — Common consumables and the first complete vertical slice

- [x] **P8-031 — Implement HP-restoration items** — `DONE`
  - Support fixed, rolled, maximum-relative, injury-adjusted, and capped healing using authoritative effective HP.
  - Reject invalid targets and expose a preview that distinguishes expected healing from overheal.
- [x] **P8-032 — Implement condition-removal items** — `DONE`
  - Support one, several, chosen, and all applicable removable conditions with canonical condition identity.
  - Explain when a target has no removable condition or when a condition is outside the item's scope.
- [x] **P8-033 — Implement revival and consciousness-recovery items** — `DONE`
  - Model fainted or unconscious prerequisites, resulting HP, injury interactions, and any timing restrictions.
  - Do not allow ordinary healing items to bypass revival rules.
- [x] **P8-034 — Implement combat-stage and temporary-stat consumables** — `DONE`
  - Apply bounded stage or effective-stat changes with stacking, caps, replacement, and expiration rules.
  - Record the item as the durable source so cleanup and explanation remain correct.
- [x] **P8-035 — Implement duration, expiry, and encounter cleanup for consumables** — `DONE`
  - Support round, turn, scene, encounter, daily, and explicit-dismissal durations through authoritative clocks or lifecycle events.
  - Reconnect, pause, correction, and settlement must not duplicate or strand effects.
- [x] **P8-036 — Implement food, refreshments, and concrete temporary buffs** — `DONE`
  - Cover canonical food effects that have deterministic mechanical outcomes and route interpretive cases to guided adjudication.
  - Prevent incompatible stacking and make remaining duration visible.
- [x] **P8-037 — Implement tools and item-driven skill checks** — `DONE`
  - Support reusable tools, required skills or Features, AP or action costs, deterministic rolls, target effects, and bounded follow-up choices.
  - Consumption and durability must follow the policy defined by the canonical item.
- [x] **P8-038 — Expose item actions in the encounter Action Dock** — `DONE`
  - Add an Inventory action group with search, recents, keyboard access, touch support, legal targets, costs, and visible unavailable reasons.
  - Only contextually meaningful item actions should compete with the current decision.
- [x] **P8-039 — Expose common item actions on sheets and inventory surfaces** — `DONE`
  - Provide use, inspect, equip where applicable, target selection, previews, progress, success, conflict, and recovery states without duplicating mechanics in the client.
  - Link accepted results to the relevant sheet and encounter history.
- [x] **P8-040 — Certify the restorative consumable vertical slice** — `DONE`
  - Complete buy or receive → inventory → encounter offer → target → action cost → effect → exact consumption → event feed → reconnect → correction across GM and player clients.
  - Pass the canonical fixture with no manual HP, condition, stage, action-economy, or inventory repair.

### Phase 5 — Equipment and held-item state

- [x] **P8-041 — Define explicit equipment and held-item documents** — `DONE`
  - Represent trainer equipment slots, Pokémon held items, source inventory provenance, revision, active state, and item-specific configuration explicitly.
  - Do not treat descriptive inventory rows as effective equipment.
- [x] **P8-042 — Add migrations and normalizers for existing equipment data** — `DONE`
  - Convert supported legacy slot or row conventions without inventing ambiguous assignments.
  - Preserve recoverable source data and surface unresolved migration choices to the GM.
- [x] **P8-043 — Implement slot, compatibility, and exclusivity rules** — `DONE`
  - Validate slot type, species or trainer restrictions, handedness, mutually exclusive items, required capabilities, and other canonical prerequisites.
  - Show the exact safe reason an item cannot be equipped.
- [x] **P8-044 — Implement equip, unequip, swap, give, and take commands** — `DONE`
  - Move items between inventory and equipment or held state atomically while respecting ownership, control, revisions, and whole-item semantics.
  - Swaps must never drop, duplicate, or temporarily activate both incompatible sources.
- [x] **P8-045 — Unify stack and whole-row behavior for equipment** — `DONE`
  - Define quantity behavior for stackable consumables, unique equipment, charged tools, and serialized items.
  - Transfers and equipment commands must preserve stable identity and item-specific state.
- [x] **P8-046 — Project equipment-derived contributions** — `DONE`
  - Apply equipment modifiers to derived stats, movement, defenses, capabilities, skill checks, range, and other supported effective values.
  - Inspectors must show base, each source contribution, caps or overrides, and the final value.
- [x] **P8-047 — Project equipment-granted actions and rule sources** — `DONE`
  - Grant Moves, Abilities, Capabilities, Features, Edges, item actions, or contextual affordances through the existing source-agnostic presentation contract.
  - Removing the source must immediately withdraw its offers unless an accepted effect is independently durable.
- [x] **P8-048 — Implement passive equipment event providers** — `DONE`
  - Subscribe held and equipped items to typed authoritative events with frequency, priority, privacy, choice, and exact-replay behavior.
  - Use the existing provider and receipt architecture rather than polling client state.
- [x] **P8-049 — Implement source loss, suppression, durability, and breakage** — `DONE`
  - Remove, suspend, restore, expend, or break equipment effects deterministically when ownership or state changes.
  - Unsupported narrative damage uses guided adjudication and cannot silently mutate durability.
- [x] **P8-050 — Certify multi-client equipment behavior** — `DONE`
  - Complete purchase or transfer → equip → derived change → granted action or passive → reconnect → swap or remove → source cleanup on trainer and Pokémon fixtures.
  - No client may retain stale offers, values, or private equipment details.

### Phase 6 — Out-of-encounter item workflows

- [x] **P8-051 — Create a shared non-encounter item execution context** — `DONE`
  - Reuse ItemSpecs, authority, planning, transactions, receipts, and presentation without requiring an active encounter.
  - Explicitly model campaign time, extended actions, target ownership, and any GM confirmation.
- [x] **P8-052 — Implement medical and extended-action item use** — `DONE`
  - Support First Aid and other canonical treatment tools, required checks, AP, time, injury limits, conditions, and reusable-kit semantics.
  - Progress and interruption must recover safely without duplicate effects.
- [x] **P8-053 — Implement training aids and permanent-stat consumables** — `DONE`
  - Preview permanent changes, validate legal caps and prior use, consume exactly once, and record provenance.
  - Reject changes that would make a sheet invalid or exceed canonical limits.
- [x] **P8-054 — Implement move-learning and move-modifying items** — `DONE`
  - Validate species, tutor or machine compatibility, known-move limits, replacement choices, and any usage restrictions.
  - Commit the learned move and item consumption together after explicit confirmation.
- [x] **P8-055 — Implement evolution-item workflows** — `DONE`
  - Preview target species, form, retained character identity, stats, moves, abilities, capabilities, equipment compatibility, and unresolved choices before commit.
  - Evolution, inventory consumption, sheet update, and resulting attention items must be atomic and replay-safe.
- [x] **P8-056 — Implement item-driven form changes** — `DONE`
  - Model temporary and persistent forms, legal triggers, resulting effective data, source ownership, and reversal.
  - Do not overwrite unrelated character customization or encounter history.
- [x] **P8-057 — Implement bait, lure, repellent, and exploration items** — `DONE`
  - Integrate deterministic effects with encounter generation, campaign clocks, or bounded GM prompts as appropriate.
  - Clearly separate automated consequences from fictional positioning that requires adjudication.
- [x] **P8-058 — Integrate breeding, egg, fossil, and restoration items** — `DONE`
  - Route supported item modifiers and operations through existing breeding and egg authority, including read sets, exact consumption, provenance, and recovery.
  - Do not duplicate breeding calculations or create a second offspring-construction path.
- [x] **P8-059 — Implement the guided adjudication workflow** — `DONE`
  - Let a user declare a supported guided item, reserve or consume it at the correct phase, expose canonical rule context, collect bounded GM input, and commit the accepted outcome.
  - Record who decided, what was accepted, and how inventory was settled without exposing private notes.
- [x] **P8-060 — Certify out-of-encounter item journeys** — `DONE`
  - Pass medical, training, move-learning, evolution, exploration, breeding-related, guided, cancellation, stale, reconnect, and restart fixtures.
  - No journey may require direct JSON, database, HP, move-list, evolution, or inventory repair.

### Phase 7 — Inventory and commerce continuity

- [x] **P8-061 — Define the unified inventory action contract** — `DONE`
  - Use one action model for use, equip, unequip, give, take, transfer, split, merge, discard, inspect, and guided adjudication across trainer and group inventory.
  - Actions must advertise authority, required revisions, destination rules, and irreversible consequences.
- [x] **P8-062 — Implement source-inventory selection and provenance** — `DONE`
  - Show the exact container and row that will supply an item when several eligible copies exist.
  - Remember only safe local presentation preferences; authoritative selection is revalidated on commit.
- [x] **P8-063 — Implement use, equip, give, and transfer flows from inventory** — `DONE`
  - Connect existing trainer/group transfer operations to the shared action anatomy and add item execution without parallel bespoke dialogs.
  - Authoritative responses replace local state and update every affected client.
- [x] **P8-064 — Implement split, merge, and discard flows** — `DONE`
  - Preserve canonical identity, stable row IDs, serialized state, and equipment rules while manipulating stacks.
  - Destructive actions require clear confirmation and produce receipts suitable for correction.
- [x] **P8-065 — Support group-inventory item use and reservation** — `DONE`
  - Allow authorized use directly from shared inventory when the rules and table policy permit it, with explicit target and ownership semantics.
  - Pending use must reserve quantities without blocking unrelated rows or enabling double spending.
- [x] **P8-066 — Add meaningful shop post-checkout actions** — `DONE`
  - After purchase, offer inspect, equip now, use now when legal, transfer to an eligible trainer, or move to group inventory.
  - Continue to use the accepted checkout result rather than re-querying by item name.
- [x] **P8-067 — Add inventory receipts and history** — `DONE`
  - Record purchases, transfers, item uses, equipment changes, guided outcomes, settlement awards, discards, and GM corrections as structured facts.
  - Expose user-readable history without leaking private inventory or internal operation identifiers by default.
- [x] **P8-068 — Implement inventory conflict and recovery UX** — `DONE`
  - Handle stale revisions, moved rows, reserved items, uncertain commands, offline reconnect, and concurrent tabs through explicit reconciliation.
  - Never resolve uncertainty by replaying a new mechanical command automatically.
- [x] **P8-069 — Complete responsive and accessible inventory interactions** — `DONE`
  - Support keyboard, touch, screen readers, zoom, reflow, reduced motion, clear focus restoration, and 44-pixel targets across dense inventories.
  - Keep quantity, source, target, cost, and destructive consequences understandable without color alone.
- [x] **P8-070 — Certify the buy, transfer, equip, and use loop** — `DONE`
  - Complete shop checkout → destination → equip or use → encounter effect → history → transfer or unequip across desktop and mobile GM/player clients.
  - All inventories and effective state must converge without manual refresh or duplicated mutations.

### Phase 8 — Encounter settlement and rewards

- [x] **P8-071 — Define the versioned encounter settlement document** — `DONE`
  - Represent settlement status, encounter revision, participants, unresolved gates, persistent consequences, reward package, allocations, temporary cleanup, decisions, receipts, and completion state.
  - Keep settlement orchestration separate from mechanics authority and do not duplicate encounter or sheet state.
- [x] **P8-072 — Define settlement eligibility and blocking gates** — `DONE`
  - Prevent final settlement while required reactions, uncertain commands, unresolved private choices, contradictory revisions, or invalid participant state remain.
  - Allow explicit GM adjudication only through a recorded bounded correction path.
- [x] **P8-073 — Build the persistent-versus-temporary consequence snapshot** — `DONE`
  - Summarize HP, injuries, conditions, captures, resource usage, equipment, effects, objectives, phases, clocks, and accepted events at encounter end.
  - Each field must name its authority and settlement behavior: preserve, transform, expire, reset, or require a decision.
- [x] **P8-074 — Define reward packages and allocation rules** — `DONE`
  - Model XP, money, item stacks, serialized equipment, captured Pokémon, narrative rewards, and GM notes with group, side, participant, or profile destinations.
  - Preview all writes and validate destination capacity and permissions before commit.
- [x] **P8-075 — Implement batch XP allocation** — `DONE`
  - Reuse authoritative experience rules to distribute fixed, weighted, or individually adjusted XP with level-threshold previews.
  - All grants must commit with settlement or be explicitly excluded; partial repetitive token edits are not the primary flow.
- [x] **P8-076 — Implement money and item loot allocation** — `DONE`
  - Allocate rewards to trainers or group inventory with stack merging, equipment identity, capacity checks, and revision protection.
  - Unallocated rewards remain visibly pending and cannot disappear when settlement is closed.
- [x] **P8-077 — Settle captures and team or box destinations** — `DONE`
  - Reuse accepted capture records, validate ownership and team limits, handle overflow, and expose required naming or assignment decisions.
  - Do not duplicate captured sheets or lose the original caught-ball and provenance data.
- [x] **P8-078 — Settle objectives, clocks, phases, and encounter outcomes** — `DONE`
  - Record public and private objective results, stakes, clock changes, phase conclusions, and campaign consequences as structured accepted facts.
  - Support GM-authored bounded outcomes without turning freeform notes into hidden mechanics.
- [x] **P8-079 — Expire temporary state and reset encounter-scoped resources** — `DONE`
  - Remove or transform effects, stages, zones, reservations, encounter items, and encounter-frequency usage according to their owning contracts.
  - Cleanup must be deterministic, source-aware, replay-safe, and explainable in the settlement preview.
- [x] **P8-080 — Commit settlement atomically** — `DONE`
  - Apply rewards, captures, inventory, sheet changes, cleanup, encounter lifecycle, history, and attention records in one revision-checked transaction.
  - Test rollback at every write boundary and guarantee exact terminal replay.
- [x] **P8-081 — Implement settlement correction, realtime, privacy, and recovery** — `DONE`
  - Support multi-client convergence, role-specific projections, reconnect, restart, stale drafts, uncertain commits, post-settlement correction, and an immutable audit trail.
  - Private rewards and GM notes must never appear in public summaries.
- [x] **P8-082 — Build and certify the Finish Encounter experience** — `DONE`
  - Provide a guided review of unresolved gates, consequences, rewards, allocations, cleanup, outstanding decisions, confirmation, accepted summary, and continuation actions.
  - Pass all settlement fixtures without visiting individual sheets or inventories to repair state.

### Phase 9 — Advancement, recovery, and campaign continuation

- [x] **P8-083 — Build the campaign attention-item model** — `DONE`
  - Represent a stable reason, affected entity, audience, urgency, source event, required decision, legal next actions, and resolution state.
  - Attention items point to authority; they do not copy mutable character data.
- [x] **P8-084 — Detect level thresholds and unspent advancement** — `DONE`
  - Create attention items for reached levels, unspent stat points, newly legal choices, or invalid advancement state.
  - Do not make irreversible build choices automatically.
- [x] **P8-085 — Detect move-learning, ability, and evolution decisions** — `DONE`
  - Surface pending learned moves, replacement choices, evolution eligibility, form choices, and post-evolution cleanup with direct links to bounded workflows.
  - Suppress decisions already resolved by authoritative item, breeding, or settlement operations.
- [x] **P8-086 — Detect Trainer advancement and feature decisions** — `DONE`
  - Surface Trainer level, class, Feature, Edge, skill-rank, and related choices that the canonical sheet model can validate.
  - Unsupported build-planning rules remain clearly guided rather than being silently auto-selected.
- [x] **P8-087 — Detect injury, treatment, and recovery needs** — `DONE`
  - Summarize sheets needing medical attention, extended rests, additional days, condition follow-up, or resource recovery.
  - Use existing healing and campaign-day authority and explain why an entity is not yet recovered.
- [x] **P8-088 — Detect team overflow, captures, hatches, and ownership work** — `DONE`
  - Surface unassigned captures, over-capacity teams, boxed destinations, newly hatched Pokémon, naming, profile linking, and equipment incompatibility.
  - Resolve each through explicit authoritative workflows with privacy-safe ownership.
- [x] **P8-089 — Project attention items by role and profile** — `DONE`
  - Give players only decisions and summaries they own or may see; give the GM campaign-wide orchestration and correction views.
  - Realtime updates must add, update, and clear attention items without duplicate local bookkeeping.
- [x] **P8-090 — Turn the campaign page into a continuation dashboard** — `DONE`
  - Show active encounter, unfinished settlement, urgent decisions, injuries, recovery, captures, eggs, equipment issues, and recommended next actions using the established design system.
  - Preserve a clear GM-only campaign-day action without making it the only campaign tool.
- [x] **P8-091 — Add campaign-day preflight, postflight, and continuation acceptance** — `DONE`
  - Preview affected sheets and unresolved blockers before advancing a day, then show recovery results and remaining attention afterward.
  - Certify settlement → decisions → treatment → next day → next scene across GM and player clients.

### Phase 10 — Catalog completion, quality gates, and alpha closure

- [x] **P8-092 — Implement the canonical item catalog in reviewed cohorts** — `DONE`
  - Move every `data/reference/items.json` row through the registry using bounded cohorts grouped by shared mechanics and provider requirements.
  - Each cohort requires source fingerprint, executable evidence, UI projection, recovery behavior, and an implementation-state decision.
- [x] **P8-093 — Close native, guided, passive, and reference-only coverage** — `DONE`
  - Require every canonical item to be mechanically complete, guided-complete, passive-complete, or explicitly justified as reference-only or not applicable.
  - No item may remain `blocked`, silently inert, falsely actionable, or dependent on an undocumented manual edit.
- [x] **P8-094 — Add drift, forbidden-gap, and dual-authority checks** — `DONE`
  - Fail validation on unregistered canonical items, orphan handlers, client-owned mechanical mutation, inventory writes outside approved transactions, stale provider identities, or settlement fields with no owner.
  - Bind completion evidence to canonical data and runtime fingerprints.
- [x] **P8-095 — Meet performance and scale budgets** — `DONE`
  - Validate large inventories, many equipment providers, dense Action Dock projections, large reward packages, attention queues, and multi-client realtime without unbounded scans or DOM growth.
  - Record lower-end-laptop, mobile, and large-campaign budgets and enforce them in focused benchmarks.
- [x] **P8-096 — Complete accessibility, responsive, and visual acceptance** — `DONE`
  - Run keyboard, screen-reader, touch, zoom, reflow, contrast, reduced-motion, table-distance, desktop, mobile, and table-display checks for item, equipment, settlement, and continuation flows.
  - Fix critical comprehension or interaction defects rather than documenting them as alpha exceptions.
- [x] **P8-097 — Complete concurrency, reconnect, restart, and failure acceptance** — `DONE`
  - Exercise duplicate commands, stale inventories, moved rows, pending choices, reservations, server restart, tab echo, partial transaction failure, settlement retry, and correction.
  - Prove no item, reward, effect, capture, XP grant, or attention decision is lost or applied twice.
- [x] **P8-098 — Run complete golden campaign journeys** — `DONE`
  - Certify acquire → transfer → equip/use → encounter → capture → finish → reward → advancement → treatment → next day → next scene on all canonical fixtures.
  - Require both GM and player perspectives and prohibit direct storage repair during acceptance.
- [x] **P8-099 — Complete user, GM, contributor, and operator documentation** — `DONE`
  - Document item states, inventory actions, equipment, guided adjudication, settlement, attention items, correction, recovery, canonical-data maintenance, and troubleshooting.
  - Keep documentation focused on using and extending the alpha product, not repository promotion or release ceremony.
- [x] **P8-100 — Record final alpha product acceptance** — `DONE`
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
- **2026-08-13 — Correct item use from immutable accepted before/after evidence.** Pending abandonment releases reservations without mechanics; accepted correction is GM-only, exact-replay, linked by a new correction receipt, and fails closed if any affected revision or accepted after-document changed.
- **2026-08-14 — Resolve HP restoration once from authoritative target vitals.** Fixed, rolled, and full-maximum-relative restoration records requested, effective, overheal, injury-cap, and roll evidence in the immutable operation plan; ordinary restoration rejects Fainted targets, self-use spends a Full Action, and another target's next Standard and Shift are forfeited unless canonical Medic Training applies.
- **2026-08-14 — Bind condition cures to canonical target state.** Listed, Persistent, Volatile, chosen, and all-Status scopes derive exact options and before/removed/after evidence from the authoritative target; no-applicable targets fail before consumption, Other Afflictions remain outside Status scopes, and Repulsive medicines stay non-executable until a bounded GM-owned Loyalty consequence exists.
- **2026-08-14 — Keep revival structurally distinct from ordinary healing.** Revive requires an authoritative Fainted Pokémon, sets a reviewed positive HP result against the injury-adjusted cap, clears only Fainted, retains immutable scene KO history, reconciles cross-capability HP invariants, and fails closed rather than partially reviving an As One pair; Revival Herb remains unavailable with the other Repulsive medicines pending bounded GM Loyalty authority.
- **2026-08-15 — Model all eight X Items through authoritative combat state.** Six direct boosts resolve bounded -6…+6 before/delta/after evidence and reject cap no-ops before consumption; Dire Hit is a replace-by-family +2 critical-range encounter effect; Guard Spec is a refresh-by-family immunity for five target end-turn boundaries and blocks only negative Move-authored Combat Stage or Accuracy changes. Both temporary effects expire on switch or recall, direct stages clear on ordinary switch and encounter end while Baton Pass transfers bounded stage state, and immutable item source evidence survives replay, presentation, and correction.
- **2026-08-15 — Separate every consumable duration boundary and make campaign-day settlement global.** Turn, round, scene, encounter, campaign-time, explicit-dismissal, and switch/recall transitions are server-authored; encounter cleanup remains distinct from scene/reward settlement and consults durable pending Item/Move authority. One campaign day is an exact replay-safe 1,440-minute transaction across the singleton clock, sheets, maps, timed effects, and every due Egg checkpoint, with paused Egg time skipped, accepted receipts immutable, lifecycle successors protected from correction resurrection, and GM/diagnostic duration controls projected without private raw effect identity.
- **2026-08-16 — Store and trade reviewed Snacks through existing sheet and encounter authority.** Candy Bar and Honey store exact canonical 5-HP Digestion Buffs; Leftovers creates sheet-owned 1/16 maximum-HP turn-start healing for the encounter. Storage is suppression-aware for Gluttony capacity, rejects incompatible stacking before consumption, and trades atomically through exact server-resolved item mutations. Retained effects follow the same sheet across recall/re-entry, expire at encounter end, and expose a GM/diagnostic duration label without private identity. Five refreshments reuse restorative authority. Black Sludge remains fail-closed with a source-hash-bound open canonical cost defect; runtime never mines the apparent cost from prose.
- **2026-08-16 — Keep item-driven checks and reusable-tool costs server-owned.** First Aid Kit is the reviewed P8-037 proof: a revision-bound Trainer Medicine Education check rolls rank-value d6s exactly once, drains one durable `featureApState` AP recovered by Extended Rest, restores HP by the raw check result clamped at zero, and cures Burned, Poisoned, Badly Poisoned, and Paralysis without consuming its exact source row. The immutable plan binds actor, skill, rank, dice, AP before/after, and drain identity; reduction re-derives the skill, commit revalidates AP, replay never repeats the roll or drain, and correction restores authoritative before-state while reporting reusable inventory as unchanged. Non-encounter progress/interruption UI remains owned by P8-051 and P8-052.
- **2026-08-16 — Separate item presentation from declaration-only command authority.** Controlled Trainer rows with stable identity and reviewed encounter-native specs project compact Inventory offers with safe source context, quantity, base cost, server-authored target previews, target-specific consequences, and textual disabled reasons. Search includes those safe facts; bounded recency survives map-revision refreshes only in component memory; keyboard, touch, focus restoration, responsive decision rows, and source-private rendering reuse the generic cockpit primitives. Workspace offers never carry read sets or command templates. A fresh declaration reauthorizes the complete offer, attaches private source/revision authority, and the client derives target IDs only from the offer's participant target choices before `/api/items/use`; execution still reauthorizes and commits all mechanics server-side.
- **2026-08-16 — Make Trainer-sheet item use a declared server transaction rather than an autosave effect.** A controlled Trainer inventory projects owner-safe common native actions against that Trainer and explicitly linked team or boxed Pokémon, with source row authority omitted from the list response and attached only by a fresh declaration. Sheet targets use canonical sheet references and a server-only non-spatial eligibility adapter; they never create client or encounter geometry. The sheet editor establishes a clean autosave revision boundary, submits the existing immutable `/api/items/use` command, adopts complete accepted sheet documents, links affected sheets, and retains only the exact private command in session storage while a network result is uncertain. New rows receive stable setup identity and legacy rows expose an explicit Prepare action; use, target previews, progress, conflict, accepted, keyboard, touch, reduced-motion, and exact-retry states require no client-side mechanics or direct HP, condition, or inventory repair. Equipment remains visibly unavailable until explicit equipment authority begins at P8-041, and extended-action/campaign-time workflows remain fail-closed for P8-051–P8-052.
- **2026-08-16 — Certify the first restorative loop as one cross-authority journey.** The `healing-potion-encounter` fixture now has a production-like integration certificate that buys two Potions through player-authorized shop checkout, receives one stable Trainer row, converges GM and player offers, declares one server template, selects only the projected Pokémon target, spends the actor Standard Action, schedules the target’s next-turn Standard/Shift forfeiture, heals 20 HP, consumes exactly one unit, and publishes map and sheet updates atomically. Fresh GM/player workspaces reconstruct the public accepted feed from SQLite authority without source-row or inventory-operation evidence; exact item and checkout retries publish and write nothing twice. GM correction restores the exact pre-use HP, action ledgers, and purchased quantity while preserving the completed purchase, projects a linked role-safe correction receipt, rejects player correction, and exact-replays without another compensation. `tests/integration/restorativeConsumableVerticalSlice.test.ts` is the phase-four certificate; no sheet, HP, action, inventory, or database repair occurs in the journey.
- **2026-08-16 — Make equipment a strict embedded authority rather than a descriptive sheet field.** Trainer and Pokémon sheets may carry a schema-v1 `equipmentState` whose complete ordered slots reference whole canonical instances with exact source-inventory provenance, semantic and instance revisions, hash-bound definitions, operation evidence, explicit activity, and bounded item-specific configuration. A legacy slot or held-item string never contributes directly: migration may bind one exact source into an inactive instance or retain the value as separate unresolved evidence. Setup/autosave writes preserve or reject this server-owned state; trusted revision-checked operation writers may replace it. Player sheet and realtime responses derive a non-persisted `equipmentProjection` that omits inventory rows and revisions, hashes, operation IDs, configuration values, and private issue evidence, and malformed or owner-misbound state fails closed.
- **2026-08-16 — Migrate legacy equipment as a conservative atomic document transition.** A schema-independent migration runs after SQLite migrations on every database open and after JSON sheet imports without changing runtime schema 32 or the standalone importer’s schema-28 boundary. It initializes every sheet, resolves only exact app-owned canonical names or reviewed aliases, gives matching legacy rows deterministic stable identity, prefers the owning or roster-linked Trainer inventory, falls back to group inventory only when no Trainer source exists, and moves exactly one whole row or stack unit while incrementing every changed resource once. Exact assignments become inactive `equipment.definition-pending` instances for P8-043; unknown, missing, duplicate, conflicting, or ambiguous assignments remain mechanically inert GM-visible issues. Legacy effective fields are cleared after their values enter explicit evidence, player projections expose only safe aggregate migration state, malformed or owner-misbound authority rolls back the whole migration, and a newer explicit document cannot be overwritten by stale legacy input from the offline importer.
- **2026-08-16 — Make equipment legality exhaustive, structured, and fail-closed.** All 108 canonical equipment rows now have generated, reviewed, record-hash-bound definitions for owner kinds, complete slot-set options, handedness, configuration, prerequisites, and exclusivity; runtime never parses effect prose. Pokémon may wield Weapon rows only with the resolved Wielder Capability, Wonder Launcher requires current Expert Medicine or Technology Education, species and evolution checks use exact app-owned Pokédex evidence, Focus is exclusive, and absent Mega-form reference authority remains inert rather than guessed. One compatibility evaluator returns stable player-safe reasons before inventory movement, detects occupied slots and stale records/configuration, and preserves whole-item multi-slot identity. Migration-pending instances are reconciled against those definitions in the migration transaction: compatible assignments activate, incompatible or choice-dependent assignments retain exact inactive evidence, and dynamic suppression or breakage reasons remain untouched.
- **2026-08-16 — Move equipment custody through immutable atomic commands.** Equip, unequip, give, take, and one-for-one swap commands bind exact inventory, sheet, equipment, instance, slot, configuration, and selected-profile revisions; shared inventory remains GM-only. One SQLite transaction moves whole-item custody, updates each dirty aggregate exactly once, records immutable before/after evidence under a stable command hash, appends realtime events, and never persists a dual-active swap intermediate. Exact replay returns the stored result without writes or publication, malformed envelopes and operation-ID drift fail closed, player HTTP projections redact provenance and private configuration, and uncertain Trainer-sheet commands remain browser-retained for exact retry. The Workshop exposes current reviewed Trainer equip/return actions with exact unavailable reasons; broader roster custody composition follows the accepted `.pi/artifacts/ui-mockups/equipment-custody-workshop/v002.png` target during multi-client equipment completion.
- **2026-08-16 — Serialize every stateful whole item across custody boundaries.** Stack rows use positive safe-integer quantities and merge only under exact normalized identity plus equal metadata; equipment-section and serialized rows always move as one non-mergeable item. `serializedEquipment` retains one stable whole-item identity, current canonical and definition hashes, configuration, bounded strict-JSON state, and a revision advanced exactly once by every custody transition. Equipment extraction, return, swaps, Trainer/group transfers, move resources, item source use, shops, imports, setup saves, and player projections now share that policy: malformed, duplicate, stale, partial, overflowing, metadata-losing, fuzzy-merge, or forged transitions fail closed, and private identity or state never enters player sheet, group-inventory, HTTP, or realtime documents.
- **2026-08-16 — Derive equipment contributions from current whole-item authority.** A generated reviewed registry binds all 108 equipment definitions to canonical item and compatibility hashes, classifies 63 contributing items into 71 typed operations, and leaves granted actions and passive events explicitly deferred. Runtime contributions require an active, hash-current, dynamically compatible instance and exact configuration, owner, transformation, encounter-suppression, move, critical, effectiveness, or terrain facts. One ordered resolver applies additions, non-reducing caps, after-stage floor multipliers, and conflict-safe default overrides to authoritative Stats, Combat Stages, Accuracy, Evasion, Initiative, direct damage, Damage Reduction, critical range, skills, capabilities, and terrain-specific movement. Derived `equipmentContributionProjection` documents are recomputed for every sheet load, accepted mutation response, and realtime event and never persist as authority; player projections use projection-local item references and omit serialized identity, hashes, provenance, configuration values, and state. The responsive Inspector follows `.pi/artifacts/ui-mockups/equipment-contribution-inspector/v002.png`, exposing Base → named sources → caps or overrides → Final, contextual conditions, conflicts, and inactive-source status. Focused contribution, mechanics, privacy, realtime, component, and custody coverage passed 243 tests with bounded workers; Nuxt typecheck, generated-data checks, design-system checks, focused ESLint (no errors), and whitespace validation passed.
- **2026-08-16 — Project equipment grants only from reviewed current whole-item sources.** A generated P8-047 registry classifies all 108 hash-bound equipment definitions into 45 explicit grants: 12 weapon profiles, 12 weapon Moves, three Capabilities, two Abilities, and 16 item actions or contextual affordances. Active, compatible, hash-current, unsuppressed instances feed the existing Move, Ability, Capability, passive-summary, offer, and affordance contracts; source loss, Magic Room, Klutz, stale definitions, invalid compatibility, or missing custody withdraw the source immediately. Native melee weapon selectors are opaque SHA-256 presentation identities revalidated against exact sheet reads; descriptive held or slot text grants nothing. Six ranged profiles, seven absent supplemental Move definitions, and all deferred item actions remain visible with safe unavailable reasons rather than guessed mechanics. Full Incense/Stall, Thick Club/Pure Power, Dark Vision Goggles, Snow/Jungle Boots, Trainer and Pokémon weapon sources, and the Battlefield Workshop bridge use server-projected source facts without exposing serialized identity, hashes, configuration, provenance, state, or development-ticket evidence. Accepted durable effects remain independent of later source loss. Focused source, mechanics, privacy, source-loss, presentation, initiative, movement, realtime, custody, and client-bridge coverage passed 295 tests across 22 files; Nuxt typecheck, three generated equipment checks, encounter design/presentation checks, focused ESLint, and whitespace validation passed.
- **2026-08-16 — Persist one map-free authority snapshot for every new non-encounter item plan.** Sheet, campaign, workshop, and Extended Action commands reuse the ItemSpec planner, reducer, journal, receipts, replay, correction, and realtime boundaries while reading the singleton campaign clock explicitly. The server records exact actor and target revisions, campaign minute, unambiguous roster/profile/GM target authority, typed Extended Action phase and activity revision, and bounded GM-confirmation evidence; clients cannot assert those facts. Ambiguous ownership, missing clock reads, unowned player targets, undeclared workflows, incomplete Extended Actions, and missing confirmation fail closed. Legacy persisted encounter plans remain readable, while every newly declared sheet operation carries the immutable context and revalidates its clock at commit. Focused item runtime, parser, planning, sheet journey, data-contract, privacy, typecheck, ESLint, and whitespace checks passed.
- **2026-08-16 — Treat medical application and timed treatment as two exact durable lifecycles.** First Aid Kit and Bandages now start as mechanically inert Extended Actions whose immutable activity evidence survives reconnect, whose completion reauthorizes current source, target, ownership, AP, definition, campaign clock, and full item read sets, and whose interruption writes no item mechanics. First Aid Kit rolls and drains AP only at accepted completion while retaining its exact reusable row. Bandages consumes one exact row only at completion, then installs a separate six-hour target treatment: every settled 30-minute boundary heals one-eighth full formula Max HP within natural-healing and Injury caps, full duration attempts one daily-limited Injury removal, and any authoritative HP loss cancels immediately. Status is privacy-safe, text-authoritative, responsive, and automatic. Wonder Launcher natively delivers reviewed X Items at eight metres for one Standard Action and one AP without target action forfeiture; Poultices and Re-Breather remain explicitly fail-closed for P8-059 bounded Loyalty and open-air adjudication. The 49-file/315-test focused suite, generated inventory check, typecheck, ESLint, whitespace check, and four production-build liveplay journeys across desktop and mobile Chromium passed without storage repair.
- **2026-08-17 — Apply permanent advancement only at an exact Extended Action completion boundary.** HP Up, Protein, Iron, Calcium, Zinc, Carbos, Heart Booster, PP Up, Rare Candy, and Stat Suppressants are hash-bound native ItemSpecs backed by one reviewed app-owned structured rule. Starts and interruptions are inert; completion revalidates one owned Pokémon, source, definition, limits, legal sheet state, opaque target-specific Move or Base Stat choice, and exact Stat Suppressant Trainer consent before atomically applying the change, private provenance, one-item consumption, receipts, and realtime updates. Six stat Vitamins, Heart Booster, and PP Up share five lifetime slots; Rare Candy uses exact Experience thresholds and a separate five-use limit. Setup saves cannot forge item-controlled fields, and projections redact operation/hash/ownership evidence. The 49-file/361-test focused certificate, typecheck, ESLint, generated inventory and Breeding successor checks, whitespace check, production build, and four accessible responsive Chromium liveplay journeys passed without storage repair.
- **2026-08-18 — Teach machine Moves only through immutable compatibility and completion authority.** All 100 TMs and six HMs are exact reviewed native ItemSpecs backed by canonical Move, species compatibility, Tutor Point, active-Move, TM/Tutor-limit, and Cluster Mind authorities. One owned Pokémon, one opaque add/replacement choice, and one explicit confirmation are persisted at inert Extended Action start and freshly reauthorized at completion. Accepted completion reconstructs the canonical Move, locks its item-trained row, settles Tutor Points and source inventory atomically, consumes TMs once, and records reusable HMs once per authoritative campaign day. Setup saves cannot rewrite accepted Move rows, retries never regenerate a choice, and projections redact source/hash/usage evidence. Focused and broad regressions, generated Move/inventory/Breeding gates, typecheck, ESLint, whitespace checks, and accessible responsive desktop/mobile production liveplay passed.
- **2026-08-18 — Evolve only through one reviewed irreversible destination and keep every consequence visible.** Twenty-four canonical Evolutionary Items and 62 exact source-hash-bound transitions now use one Standard sheet/campaign action with an owned Pokémon target, opaque destination, and exact confirmation. Acceptance consumes one item while atomically retaining character identity and current Moves, adopting destination species authority, reapplying canonical Base Stats, mapping Abilities by tier/slot, updating Skills and Capabilities, reconciling equipment, resetting Added Stats, and writing immutable private provenance plus owner-safe Stat, Move, Ability, and equipment attention. Setup saves lock species and mapped Abilities, permit partial re-stat work, and append one deterministic resolution receipt only for the exact legal budget and Base Relations. The accepted `.pi/artifacts/ui-mockups/evolution-item-workflow/v002.png` drives the responsive preview and sheet attention UI. A 25-file/215-test focused and regression certificate, migration/evidence/inventory/Breeding checks, typecheck, focused ESLint, whitespace validation, production build, and Axe-checked desktop/mobile Chromium liveplay passed without private evidence or storage repair.
- **2026-08-18 — Treat Mega Evolution as one accepted Scene overlay, never a permanent sheet rewrite.** Fifty reviewed Mega forms across 48 species now require one exact active linked Trainer Ring, one exact configured Pokémon Stone or Rayquaza's reviewed Delta exception, current ownership and turn authority, one Swift Action, one use per Trainer per Scene, and an explicit preview acceptance. Acceptance stores private immutable authority and source evidence while projecting only curated form, Type, Ability, non-HP Stat, duration, and reversal facts; base species, HP, Moves, customization, and history remain unchanged. Effective Move, Ability, initiative, suppression, equipment lock, realtime, reconnect, replay, and Scene-end lifecycle paths consume the same encounter overlay. Ordinary custody and Move-driven item mutations cannot orphan the active Ring or Stone. The accepted `.pi/artifacts/ui-mockups/mega-evolution-decision/v001.png` drives the responsive decision. Migration and generated-data checks, Nuxt typecheck, full ESLint with no errors, an 18-file/175-test focused certificate, whitespace validation, and Axe-clean GM/player desktop and mobile production liveplay with reconnect and exact reversal passed without private evidence or storage repair.
- **2026-08-18 — Keep exploration items on durable campaign and encounter authority.** Bait, reusable Fishing Lures, Honey's reviewed alternate mode, three Repels, and Dowsing Rod now use hash-bound structured mechanics, campaign-minute timing, bounded server randomness, exact custody, role-correct GM prompts, color-preserving Shard rewards, route generation, direct-Repel encounter settlement, replay, correction, and private Trainer state. Client uncertainty retains one exact profile/scope-bound command and blocks competing checks; source loss, stale maps, moved rows, invalid targets, and ambiguous GM input fail closed. The accepted `.pi/artifacts/ui-mockups/exploration-item-activity/v002.png` drives the responsive activity UI. Generated-data checks, migration/storage coverage, typecheck, ESLint, whitespace validation, a 20-file/158-test focused certificate, and Axe-clean desktop/mobile production liveplay passed without client timers, private evidence, or storage repair.
- **2026-08-18 — Adapt breeding tools to the one shared Egg lifecycle.** Egg Warmer, Reanimation Machine, and Chemistry Set now use a generated hash-bound integration contract and exact canonical identity. One private Trainer authority assigns an exact reusable Warmer unit to at most four current owned incubating Eggs; every campaign day revalidates custody and credits the reviewed 2× rate, while source loss fails closed to base rate. GM-only Fossil restoration consumes one explicitly designated source at accepted settlement and preserves its machine; GM-only Artificial Egg creation requires current Playing God authority, one Chemistry Set, and $3,500 while preserving the Set. Both delegate to the existing source-Egg operations, read sets, offers, consent boundaries, persistence, and hatch lifecycle. Schema v38 stores principal-bound exact replay; projections use opaque options, realtime strips private state, and one uncertain Profile-bound browser command blocks competing work. The accepted `.pi/artifacts/ui-mockups/breeding-item-workflows/v003.png` drives the accessible responsive Workshop panel. The 20-file/211-test focused certificate, strict Breeding/data checks, generated contract check, Nuxt typecheck, ESLint, whitespace validation, and desktop/mobile production liveplay passed without a parallel offspring path or storage repair.
- **2026-08-18 — Bound interpretive item consequences to one durable GM decision.** Energy Powder, Energy Root, Heal Powder, Revival Herb, and Poultices now reserve through the existing item journal, expose only no-change or exact one-rank Pokémon Loyalty outcomes, and settle deterministic mechanics, action cost, consumption, and a private receipt only after authenticated GM acceptance. Poultices completion remains inert while queued. Re-Breather uses exact Trainer-head or Pokémon-held custody and a `ready → active → depleted → refilling → ready` campaign-minute lifecycle; `Gilled` exists only during its reviewed 60-minute active window and open-air refill takes five minutes. Schema v39 stores immutable declaration and terminal evidence with CAS settlement, exact replay, cancellation, restart recovery, owner/GM realtime invalidation, and private projections. One session-scoped uncertain command blocks all competing decisions. The accepted `.pi/artifacts/ui-mockups/guided-item-adjudication/v002.png` drives the responsive 40/60 Campaign queue and owner panels. Generated contracts, migration checks, a 28-file/252-test focused certificate, focused ESLint, whitespace validation, production build, and Axe-clean desktop/mobile liveplay passed. Nuxt typecheck reports no P8-059 diagnostics; its unrelated existing exploration/breeding diagnostics remain explicit P8-060 certification debt.
- **2026-08-18 — Certify every out-of-encounter item family against one restart-safe acceptance index.** A generated evidence-only P8-060 contract now hash-binds the reviewed medical, permanent advancement, move-learning, evolution, exploration, Breeding/Egg, and guided sources to their current server, integration, composable, and production-liveplay journeys without granting runtime mechanics. A real file-backed SQLite recovery journey closes and reopens a pending item reservation plus guided request, proves unchanged replay authority, rejects operation-ID drift, cancels mechanically inert work, releases the reservation, and verifies terminal evidence after a second restart without JSON, database, HP, Move, evolution, or inventory repair. A stale UI heuristic that mislabeled PP Up and Stat Suppressants as machine training now uses exact TM/HM identity. The 24-file/98-test evidence certificate, generated drift check, Nuxt typecheck, full ESLint with no errors, whitespace validation, production build, and all 13 desktop plus 12 applicable mobile Chromium journeys passed.
- **2026-08-18 — Route every inventory affordance through one safe action anatomy.** Use, equip, unequip, give, take, transfer, split, merge, discard, inspect, and guided adjudication now share one strict schema-v1 offer and declaration contract across Trainer and group sources. Each server offer exposes only an opaque source, authenticated authority checks, exact source and destination revision requirements, bounded quantity and destination policies, user-readable reversible/correctable/irreversible consequences, confirmation phase, availability, and the existing owning handoff. Exact matching rejects source, quantity, destination, confirmation, revision, shape, and identity drift, while commit authority remains with the existing item, equipment, transfer, stack, or guided journal. Inspect is navigation-only; discard requires an exact destructive confirmation; guided mechanics remain deferred to bounded GM settlement. Safe projections forbid row, serialized-instance, operation, Profile, hash, ownership, private-note, and provenance evidence. The versioned data contract, documentation, 2-file/8-test strict parser certificate, Nuxt typecheck, focused ESLint, and whitespace validation passed.
- **2026-08-18 — Make duplicate item sources explicit without exposing custody authority.** Every Trainer sheet item offer now carries one revision-bound opaque source choice plus exact safe container, section, presentation-row, and quantity labels; duplicate current canonical copies form a compact source radiogroup before target choices. Selecting another row switches to its current server offer, clears target-specific decisions, marks the corresponding table row, and redeclares that exact offer so commit-time authority can map privately to one stable row; stale or unavailable rows are never substituted by name. Trainer-to-group transfers now submit stable `trainerItemId` rather than a presentation index, while both transfer directions show and revalidate exact source rows and both revisions. Local storage retains only container kind and section for presentation ordering, deletes expanded/malformed state, and cannot block an action or alter selection. The accepted `.pi/artifacts/ui-mockups/inventory-source-selection/v002.png` scored 10/10 and drives the matte accessible selector. The 21-file/100-test source/transfer certificate, Nuxt typecheck, focused ESLint, whitespace validation, production build, and Axe-clean desktop/mobile Chromium liveplay passed without raw row, instance, operation, Profile, hash, or provenance display.
- **2026-08-18 — Commit visible inventory moves only through their existing owning journals.** Trainer and group inventories now project one strict safe Use, Equip, Give, Transfer, and Inspect anatomy from exact current sources and destinations. Use opens the established sheet-item decision, Inspect remains navigation-only, equipment custody delegates to the replay-safe equipment journal, and both transfer directions delegate to their existing atomic use cases. A schema-v40 principal-bound adapter journal persists the exact private handoff before mutation, stores transfer acceptance in the same transaction as both inventory revisions, recovers exact restart replay, and rejects operation, declaration, principal, source, destination, quantity, or revision drift. Configurable equipment enumerates only server-issued slot/configuration destinations and locks reviewed definition hashes; clients cannot author configuration JSON. Authoritative response documents replace local sheets and group inventory, realtime invalidates other clients, and one scope-bound uncertain command blocks competing mutations until exact retry. The accepted `.pi/artifacts/ui-mockups/unified-inventory-action-flows/v002.png` scored 10/10 and drives the shared 60/40 responsive decision workspace on both inventory surfaces. The 13-file/45-test action-flow certificate plus 7-file/66-test equipment/transfer regression, Nuxt typecheck, focused ESLint, whitespace validation, production build, and Axe-clean desktop/mobile liveplay passed without parallel mechanics, private custody leakage, duplicate movement, or storage repair.
- **2026-08-18 — Reshape stacks only from immutable current row evidence.** Trainer and GM-controlled group inventories now project reservation-aware Split, whole-stack Merge, and explicitly confirmed Discard through the shared action anatomy. Split retains the source ID and creates one deterministic collision-checked row with exact metadata; Merge requires exact normalized identity plus equal metadata, removes the source, retains the selected destination, and rejects unsafe sums; serialized and equipment-section rows never split or merge and discard only as one whole item. Schema v41 preserves every v40 adapter row while admitting the three stack actions. The principal/scope/declaration-bound journal stores strict private before evidence, commits the inventory revision, receipt, and realtime publication atomically, rolls back on receipt failure, and exact-replays across restart without a second mutation. Group stack management remains GM-only, reservations and unresolved reusable Lures fail closed, and player-safe projections expose only opaque choices and presentation labels. The accepted `.pi/artifacts/ui-mockups/inventory-stack-actions/v002.png` scored 10/10 and drives the two-line row controls plus inline non-colour irreversible confirmation. The 13-file/69-test stack certificate, 33-test migration suite, Nuxt typecheck, focused ESLint, whitespace validation, two production builds, and Axe-clean desktop/mobile liveplay passed without optimistic quantity changes, private identity display, duplicate mutation, or storage repair.
- **2026-08-18 — Delegate shared item mechanics without surrendering group custody.** Group inventory now projects one opaque revision-bound acting-Trainer choice, exact safe source offers, current targets, choices, and reviewed consequences, while declaration privately binds the group row and reuses `UseItemCommandV1`, the item journal, planner, reducer, guided queue, recovery, and realtime paths. Players may act only through a Trainer linked to the selected Profile; GMs may select any current Trainer. Extended Actions remain transfer-first. Pending quantities reserve one exact row without freezing unrelated rows; settlement may rebase only a newer aggregate group revision after the source, canonical definition, actor, targets, reservation, and every non-group read revalidate. Transfer and stack operations share the same reservation totals, and exact replay, restart, cancellation, and abandonment cannot double-spend. The responsive 60/40 shared-inventory workspace passed a 21-file/128-test focused certificate, typecheck, ESLint, whitespace validation, production build, and Axe-clean desktop/mobile liveplay without private identity display or storage repair.
- **2026-08-18 — Continue from the exact accepted shop delivery, never a same-name substitute.** Fresh checkout results now retain a strict bounded opaque continuation for each exact merged stack or whole-item row; idempotent replay returns the same receipt, while historical or over-limit purchases stay accepted without unsafe continuation authority. A new role-authorized endpoint recovers the accepted row privately, rejects foreign, expanded, moved, or repurposed evidence, and reprojects current Inspect, Use, Equip, Give, Trainer/group Transfer, reservations, targets, slots, and Profile delegation through existing inventory authorities. Navigation carries only current opaque handoffs into the established decision workspaces and commits nothing until explicit confirmation. The accepted receipt remains visible through loading, failure, retry, and textual unavailable states; stale async loads cannot resurrect dismissed authority. The selected v002 target and real liveplay implementation scored 9.6/10 with one-column 412px reflow, 44px controls, zero page overflow, no console warnings, and zero scoped Axe violations. A 22-file/151-test focused certificate, strict data contract, documentation, typecheck, focused ESLint, whitespace validation, production build, and desktop/mobile Chromium Use/Equip journeys passed without name lookup, optimistic mutation, private identity display, duplicate delivery, or manual repair.
- **2026-08-15 — Preserve semantic inventory tables while reflowing their presentation.** Trainer and shared inventory retain captions, scoped headers, and row headers, then use CSS-only labelled cards below 760 pixels. Roving section tabs and exact-source radiogroups support Arrow, Home, and End keys; editable cells enter and return with Enter, Space, and Escape; decisions restore their exact trigger or the active section fallback. Persistent text, markers, borders, and consequences supplement colour, inventory controls meet the approximately 44-pixel target, reduced motion is honored, and add/remove changes announce and restore focus. The accepted `.pi/artifacts/ui-mockups/inventory-accessible-reflow/v001.png` scored 10/10. A 17-file/75-test accessibility certificate, Nuxt typecheck, scoped ESLint, whitespace validation, production build, and Axe-clean desktop/mobile production-liveplay journeys at 412 and 320 CSS pixels passed with no console error or horizontal clipping.
- **2026-08-20 — Compose settlement cleanup through the existing encounter lifecycle.** One complete current authority read now binds the exact map, every placement-backed sheet, active reservation operations, provider transformations, GM authorization, and a monotonic timestamp. Every effect, zone, ground item, sheet, resource directory, initiative tracker, active reservation, and pending encounter item appears exactly once in the cleanup preview. Combat Stages, Accuracy, turn resources, history, and turn/round/encounter durations reuse the authoritative encounter-end reducers; Scene and campaign state, HP, injuries, conditions, inventory, equipment, and advancement remain untouched. Zones and ground items use source-specific preserve, expiry, or strict same-identity transforms. Active reservations and pending item decisions stay blocking rather than being silently abandoned. Applicable map and sheet writes are deterministic, revision/hash-bound, and withheld whenever coverage, decisions, authorization, or authority is incomplete. The 6-file/32-test focused certificate, Nuxt typecheck, focused ESLint, and whitespace validation passed.
- **2026-08-20 — Commit settlement as one exact terminal SQLite transaction.** Complete Experience, loot, capture, outcome, and cleanup plans now merge only disjoint writes from one current authority snapshot, revalidate rewards and eligibility, and atomically persist the Encounter Document, map, sheets, shared inventories, terminal settlement, immutable history, and authority-linked attention seeds. Schema 42 stores strict principal-bound operation evidence; every write boundary rolls back fully, and exact replay survives process restart without reauthorization or publication. The P8-080 planner, repository, use-case, migration, contract, documentation, rollback, restart, typecheck, ESLint, and whitespace certificate passed.
- **2026-08-20 — Make settlement convergence durable, role-safe, and explicitly recoverable.** Public, current Profile-owner, shared-main-inventory-owner, and GM projections now rebuild bounded settlement and history views without orchestration identities, hashes, principals, source rows, or unauthorized notes. Commit and correction journal audience-specific realtime in the accepting transaction; SSE rechecks current resource and projection audience so GM state cannot be downgraded by owner variants. Schema 43 stores one hash-bound GM correction link without rewriting accepted evidence, rejects cross-journal operation collisions, detects audit payload drift, and exact-replays across restart. Current loads mark stale drafts, while GM-only uncertain status accepts one retained strict command and never retries automatically. The P8-081 10-file/88-test package, 11-file/54-test propagated contract suite, P8-080 regression package, Nuxt typecheck, scoped ESLint, and whitespace validation passed.
- **2026-08-21 — Detect Pokémon build choices without selecting them.** One reviewed structured advancement rule now binds immutable settlement Level events to exact current Move, Ability, Evolution, form, and post-item-Evolution authority. The detector verifies complete bounded sheet, history, settlement-source, and item-operation reads; revalidates server-owned machine-Move and item-Evolution provenance; suppresses accepted item, breeding, and settlement outcomes; excludes reviewed item transitions; and fails closed on conditional branches, stale revisions, duplicate identities, malformed lifecycle evidence, or missing operation payloads. Stable owner attention exposes only opaque event and action identities plus current sheet authority, never species, options, private plans, operation IDs, or automatic build choices. The source-hash-bound migration, chained canonical evidence, documentation, 38-test focused package, 37-test rules-successor regression, Breeding successor check, Nuxt typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Detect Trainer build work from structured entitlement and instance authority.** A reviewed chained rule now binds paid and free Training Features, odd-Level Features, even-Level Edges, bonus Skill Edges, the four-Class limit, and Levels 5/10/20/30/40 alternatives to exact current Feature and Edge instances. Structured milestone rows alone may select the Attack/Special Attack route and extend the P8-084 Stat budget; current extra canonical instances resolve Feature or two-Edge routes through a bounded assignment, while notes resolve nothing. Missing choices remain guided; malformed identities, subchoices, ranks, counters, future or stale allocations, overflow, and contradictory routes are blocking. The owner attention item exposes only current sheet authority and one bounded route, never build options or private evidence. The reviewed migration, 58-test focused package, 32-test P8-084 regression, 38-test P8-085 regression, 37-test rules-successor suite, generated contracts, Breeding successor check, Nuxt typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Explain current medical and recovery work from its owning authorities.** Complete bounded sheet, campaign-clock, and item-operation reads now detect HP, Injuries, the daily Injury limit, condition follow-up, active treatment, Daily Move and Ability use, multi-day Capability use, Trainer AP, and Feature rest state without mutating or copying private mechanics. Active Bandages or Poultices must rebind to one accepted completion-phase operation, exact target revision, current definition hash, and reviewed payload; forged, missing, stale, future, or overdue evidence becomes blocking repair work. Structured explanations distinguish Extended Rest, treatment, and additional-day needs while owner attention exposes only the current sheet route and revision. The source-hash-bound contract, documentation, 49-test focused package, Nuxt typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Detect roster and ownership work without assigning it.** One complete bounded read now cross-checks exact Trainer team and Box rosters, Pokémon sheets, capture facts and durable settlement sources, hash-bound Profiles, authoritative Eggs and self-hashed lineage, accepted hatch operations, and reviewed equipment compatibility. It surfaces six-member overflow, boxed capture follow-up, hatch and naming review, malformed or duplicate ownership, missing Profile links, and incompatible equipment through explicit non-mutating routes. It never infers owners from names, chooses a destination, links a Profile, transfers custody, or exposes Profile, Egg, operation, lineage, equipment-instance, or source evidence. The source-hash-bound contract, documentation, 40-test focused package, Nuxt typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Replace campaign attention as one role-scoped snapshot.** One transaction reads every bounded detector authority through its owning strict repository, excludes unowned wild/NPC sheets through structured Profile, roster, capture, hatch, and player-sheet reachability, and merges byte-equal provider overlap while rejecting divergent identities. GMs receive all current open work; players receive only owner work controlled by the exact selected Profile and a valid direct or roster-derived sheet authority. A strict content-addressed projection omits Profile identity and local tombstones. Latest-generation whole-snapshot replacement handles add, update, and clear without duplicate bookkeeping; authorized sheet events and a payload-minimal exact-Profile invalidation channel trigger reload, while reconnect always reloads HTTP authority. The 87-test focused package, production authority smoke, Breeding successor check, Nuxt typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Make Campaign the role-safe continuation surface.** One complete transaction joins role/Profile-filtered attention, visible active encounters, unfinished settlements, and bounded Egg summaries into a content-addressed whole-dashboard projection. Resume work and the authoritative recommendation precede grouped decisions; the quiet 2:1 rail keeps GM campaign tools secondary, while players receive only selected-Profile authority. Latest-principal request generations and realtime invalidations replace complete snapshots instead of merging local rows. The accepted v002 target scored 10/10; focused tests, production build, desktop/mobile liveplay, 320-pixel reflow, Axe, typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Advance campaign time only after an exact production dry run.** The GM-only preflight executes the existing atomic next-day use case inside a rolled-back SQLite savepoint, projects current blockers and bounded privacy-safe sheet impact, and issues one content-addressed authority identity. Commit revalidates that identity inside the write transaction before recovery, resources, clock, Eggs, effects, operation evidence, and realtime commit together. The Campaign modal requires explicit confirmation, retains unknown outcomes for exact status recovery, rejects stale/offline/cross-tab authority, and reloads whole postflight attention for GM and player continuation. The 77-test package, production build, six desktop/mobile Campaign journeys, 320-pixel reflow, Axe, typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Assign every canonical item to one bounded reviewed provider cohort.** A generated schema-v1 registry covers all 348 exact app-owned rows once across 19 cohorts of at most 32 members. Each cohort hash-binds its canonical records, reviewed source, provider requirements, implementation-state decision, executable or explicit fail-closed evidence, UI projection, recovery, and any required remediation. The server registry revalidates exact record/effect fingerprints but deliberately grants no mechanics. The P8-092 snapshot records 178 native, 104 passive, six guided, and 60 explicitly blocked P8-093 inputs; no concrete mechanic is disguised as reference-only. Generator drift, 11 focused tests, Nuxt typecheck, ESLint, and whitespace validation passed.
- **2026-08-21 — Close every canonical item implementation state.** The former 60-row remediation set now has reviewed runtime authority: 34 interpretive tools share one bounded private GM adjudication with exact reusable/consumable disposition, cancellation, sheet and encounter settlement, durable receipts, and replay; all 25 Poké Balls select one revision-bound row, use structured modifiers and post-capture mechanics, and bind consumption plus capture in one atomic liveplay receipt; and Black Sludge has a source-hash-bound `$500` repair plus a native Poison-only 1/8-Max-HP Digestion Buff. Storage schema 44 preserves guided requests while admitting only the campaign-tool kind. The regenerated 18-cohort registry records 204 native, 40 guided, 104 passive, and zero blocked rows. All generators, the 101-test closure package, 195 Complete Play Loop data tests, Nuxt typecheck, clean scoped ESLint, production build, and whitespace validation passed.
- **2026-08-21 — Make completion drift and authority ownership executable.** A reviewed generator now fails on missing or duplicate canonical rows, blocked cohorts, stale or orphan providers and handlers, client mechanic callers, server imports in client code, unreviewed inventory assignments, and settlement fields or providers without reciprocal ownership. Every provider, caller, inventory boundary, settlement owner, test, guide, and gate is SHA-256-bound. Poké Ball capture no longer retains a setup-edit resolver or sheet-mutation fallback: only the server resolver may roll and settle it, while unavailable liveplay authority fails closed. The guardrail command is part of `scripts/quality-gate.sh`; its five contract tests, 20 capture/page regressions, Nuxt typecheck, scoped ESLint, Python and shell syntax, generator drift, and whitespace validation passed.
- **2026-08-21 — Enforce complete-loop scale without silent truncation or runaway DOM.** Reviewed lower-end-laptop, 320-pixel mobile, and large-campaign profiles now stress all 512 inventory offers, 5,000 stored rows, 1,024+ equipment contributions across 512 owners, a dense 512-offer Action Dock, 1,024 rewards and allocations, the complete 10,000-item attention bound, and 32 clients filtering 1,000 realtime events each. Inventory keeps semantic tables while paging exactly 80 globally indexed rows; Action Dock keeps its existing 80-card incremental batch. The inventory strict-JSON allowance now admits its declared 512-offer maximum while remaining finite. Twelve budget tests, 23 inventory regressions, Nuxt typecheck, scoped ESLint, authority guardrails, generator drift, and whitespace validation passed.
- **2026-08-21 — Accept the complete loop across keyboard, touch, screen reader, zoom, reflow, and table distance.** One SHA-bound matrix consolidates eight accepted desktop/mobile production-liveplay projects for item/inventory, equipment and encounter item use, Finish Encounter settlement, and Campaign continuation. It rechecks zero scoped Axe violations, 320-pixel no-overflow reflow, effective 200% zoom, approximately 44-pixel controls, focus traps and restoration, roving keyboard contracts, reduced motion, privacy-safe labels, and every declared dark/light contrast pair. Large semantic inventories now expose complete row count and stable global row indices across 80-row pages. The accepted audit scored 9.8/10 with no hard failure or critical usability debt; the 34-test focused gate, design-system checker, Nuxt typecheck, scoped ESLint, production build, upstream authority/performance gates, and whitespace validation passed.
- **2026-08-21 — Prove every failure path remains exact, durable, and recoverable without repair.** Ten SHA-bound scenarios exercise duplicate commands, stale inventories, moved rows, pending choices, reservations, restart, cross-tab echo, reconnect, every partial write boundary, settlement uncertainty, and append-only correction. The matrix traces exactly-once ownership for items, rewards, effects, captures, Experience, attention decisions, and realtime delivery. Unknown outcomes retain one exact command; reconnect checks status but never submits; conflicts require fresh redeclaration; and rollback leaves no terminal evidence or partial revision. The 14-file/92-test gate, scoped ESLint, upstream evidence checks, inherited production build/typecheck, and whitespace validation passed with no manual storage repair.
- **2026-08-21 — Certify three complete golden campaign lineages across every canonical fixture.** Restorative/capture, equipment/loot/advancement, and injury/reconnect campaigns each traverse acquire, transfer, equip/use, encounter, capture, finish, reward, advancement, treatment, reviewed next day, and next scene for both GM and current owner. They partition all 16 item and five settlement fixtures exactly once, re-hash every canonical item record, and compose eight immutable desktop/mobile production-liveplay projects with representative transaction suites. Only one deterministic pre-journey settlement INSERT is permitted where no public draft-authoring route exists; no runtime outcome may be repaired through storage. The 15-file/113-test gate, upstream evidence checks, scoped ESLint, inherited production build/typecheck, and whitespace validation passed.
- **2026-08-21 — Publish role-focused alpha guidance and close documentation drift.** One index now routes players, GMs, contributors, and operators to focused guides for item states, inventory actions, equipment, guided adjudication, settlement, attention, correction, recovery, canonical-data maintenance, and troubleshooting. Guidance makes command/status recovery, no-auto-replay, no direct repair, app-owned canonical data, migration/hash discipline, transaction ownership, liveplay operation, backup, privacy, accessibility, and bounded validation explicit without repository promotion or release ceremony. A SHA-bound ten-topic closure validates all relative links and detailed references; its four tests, scoped ESLint, upstream evidence checks, and whitespace validation passed.
- **2026-08-21 — Accept and archive the trusted-table liveplay alpha.** One SHA-bound final record joins all completion gates, all 100 tickets, all 348 canonical item rows, three golden campaign lineages, 21 canonical fixtures, eight desktop/mobile liveplay projects, and the role-focused guidance at one accepted revision. The repository quality gate passed 1,524 Vitest files with 11,008 tests, two Nuxt files with seven tests, 79 Playwright journeys with one intentional skip, ESLint, typecheck, production build, every generator, and every focused acceptance gate; the final whitespace check also passed. The primary acquire → inventory/equipment/use → encounter → settlement → attention/recovery → next day → next scene loop has zero blocked catalog rows, no direct storage repair, and no critical usability debt. The plan is complete and archived.
