# Pokémon Contests Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: NONE`

`DEPENDS_ON: implementation-plans/done/CHARACTER_CREATION_AND_CAMPAIGN_ONBOARDING_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Goal

Make Rotom Table capable of running a complete, rules-valid Pokémon Contest for a trusted table: preparing Pokémon contest stats, enrolling contestants, playing the introduction and performance stages with server-authoritative dice, scoring, voltage, and contest effects, and settling ribbons, experience, and prizes into the ordinary campaign records.

This plan delivers the parallel gameplay mode that Plans 8 and 9 explicitly deferred. It is the last major core-rulebook play subsystem without a runtime, and it must arrive as an ordinary extension of existing sheet, item, dice, realtime, and settlement authority rather than a second engine.

## Product outcome

The completed product supports this coherent journey:

1. A player raises contest stats through combat-stat correlation and poffin consumption on the ordinary Pokémon sheet.
2. The GM creates a contest with a variant, contest type, contestant count, prize, and ribbon in a Workshop flow.
3. Player-owned and GM-controlled Pokémon enroll from ordinary sheets with validated eligibility.
4. Each trainer plays the introduction stage: a skill choice, journaled server rolls, bonus rolls, generated contest dice, and letter assignment.
5. The performance stage runs authoritative rounds with canonical positions, turn order, adjacency, and the center of attention.
6. Each contestant declares appeals from their real move list with contest type matching, dice spends, voltage, and native contest effects.
7. Every roll, score, fumble, and voltage change commits through server-authoritative, revision-checked, idempotent operations that all clients converge on.
8. Coordinator and Style Expert Features, contest Edges, Abilities, and items intervene at their canonical timing through the shared decision anatomy.
9. The GM finishes the contest through one settlement workflow that awards placements, experience, ribbons, and prizes atomically.
10. Ribbons, level-ups, prize decisions, and unresolved consequences become durable records and visible campaign attention items.
11. Contests survive stale clients, reconnects, corrections, server restarts, and exact retry without duplicate scoring or lost results.
12. Desktop, mobile, keyboard, touch, screen-reader, spectator, privacy, performance, and multi-client acceptance pass.

## Current baseline

Rotom Table already contains the systems this plan should extend rather than replace:

- server-authoritative documents, revision-checked idempotent operations, journaled dice evidence, realtime convergence, exact retry, and bounded GM correction patterns from the encounter, breeding, and onboarding runtimes;
- the generic offer/decision/accepted-result presentation contract, Action Dock language, provenance inspectors, and accepted-result choreography;
- ordinary Trainer and Pokémon sheet authority with skills, stats, moves, Features, Edges, Abilities, resources, progression, teams, and profile links;
- item, equipment, shop, group-inventory, money, and consumption authority with exact custody semantics;
- encounter settlement, reward allocation, campaign attention items, campaign-day continuation, and durable history;
- canonical app-owned reference data for moves, abilities, features, edges, items, and rules.

The gap is that contests have no structured authority at all: `contestStats` is a freeform sheet string, `data/reference/moves.json` carries no contest types or effects, no canonical contest rules file exists, and the 34 contest-referencing Features, 2 Edges, 3 Abilities, and 4 items are reference-only prose. The five contest-stat identities exist only inside breeding coloration.

## Scope

This plan owns:

- canonical contest reference data: contest stats, correlations, allied/opposed relationships, scoring tables, voltage bounds, position and turn charts, contest effects, variants, and contest experience rules;
- canonical per-move contest type and contest effect identity for the runtime move catalog;
- structured contest-stat, poffin, and preparation authority on ordinary sheets;
- the versioned Contest Document, lifecycle, validation, dice journaling, projections, and realtime events;
- Standard, Supercontest, Festival, and Rotation contests with the introduction and performance stages native;
- native contest-effect resolution, voltage, fumbles, adjacency, and center-of-attention scoring;
- Coordinator, Style Expert, and crossover Feature integration plus contest Edges, Abilities, and items;
- the Live Contest experience: stage view, scoreboard, decision surfaces, history, GM oversight, and spectators;
- contest settlement: placements, experience, ribbons, prizes, cleanup, attention items, and campaign history;
- contest accessibility, responsive behavior, privacy, concurrency, restart, performance, and complete acceptance.

## Explicit non-goals

- Trainer Participant and Battle Contest variants; contracts must leave room for them, but blending trainer appeals or full combat into contests is deferred.
- Gym badges, leagues, tournament brackets, or Grand Festival event management beyond ribbon records and informational qualification counts.
- Judge personalities, audience simulation, or narrative-generation subsystems; voltage is the only audience mechanic.
- Public spectator accounts, streaming, or public-service hardening.
- A second dice, realtime, automation, or settlement engine beside the existing shared authority.
- Parsing documentary books, PDFs, websites, wikis, or free-form contest prose at runtime.
- Automatically optimizing appeals, picking moves, or making irreversible decisions for a player.
- Contest-only character formats, parallel sheet authority, or contest state that outlives settlement as hidden bookkeeping.
- Replacing the encounter engine, item runtime, progression, or campaign continuation systems.
- Cosmetic dress-up or fashion subsystems beyond the canonical contest items.

## Completion states for canonical contest rows

Every canonical contest rule row and every contest-referencing row (per-move contest identities, Features, Edges, Abilities, items) must end in exactly one reviewed state:

- **Native** — Rotom Table validates and resolves the complete mechanical effect authoritatively.
- **Guided** — Rotom Table owns eligibility, timing, costs, choices, receipts, and commit, while a bounded GM decision supplies the rule's interpretive outcome.
- **Passive** — the row contributes automatically while legally held, equipped, known, or otherwise active.
- **Reference-only** — the row has no supported mechanical action in contests and the reason is explicit.
- **Not applicable** — the row is documentary, category-only, or otherwise not actionable in contests.
- **Blocked** — required canonical data or infrastructure is missing. This is a temporary work state and is forbidden at final acceptance.

A row is not complete merely because its description is visible. Any option that presents a contest action must have authoritative semantics, and any unsupported action must state why it is unavailable.

## Non-negotiable product rules

1. **Contests are a parallel mode of play, not a parallel authority system; ordinary sheets, items, experience, and campaign records remain the only durable authority.**
2. **Canonical contest facts come only from reviewed app-owned structured data; missing canonical identity fails closed.**
3. **Every introduction, appeal, bonus, tie-break, and supercontest die is server-rolled, journaled, and replayable; the browser never rolls or scores.**
4. **Appeal, fumble, voltage, and dice-pool changes appear only after authoritative acceptance, never optimistically.**
5. **Contest dice pools, poffin allowances, rerolls, and once-per-contest resources decrement exactly once at their canonical phase.**
6. **Appeals never consume battle move frequencies or mutate durable combat state.**
7. **Positions, turn order, adjacency, and the center of attention derive only from the canonical charts.**
8. **Actor, controller, sheet owner, GM, and spectator are separate authority concepts with structural role projections.**
9. **Contest interventions use the shared offer, decision, resolution, history, and recovery anatomy—no contest-only mutation dialects.**
10. **Rules that canonically require GM judgment—significance multipliers, prize contents, grooming latitude—are explicit guided decisions, never silent defaults.**
11. **Settlement commits placements, experience, ribbons, prizes, and cleanup as one operation or not at all; exact retry never duplicates rewards.**
12. **GM corrections are explicit, bounded, receipt-backed, and auditable, and never rewrite journaled dice evidence.**
13. **Every unresolved consequence becomes visible campaign work rather than hidden bookkeeping.**
14. **Keyboard, touch, screen reader, zoom, reflow, reduced motion, and table-distance use are completion requirements.**

## Target architecture

```text
app-owned canonical contest data
  (data/reference/contests.json + per-move contest identity
   + existing move/feature/edge/ability/item references)
  -> reviewed contest catalog: stats, effects, charts, variants
  -> structured contest-stat and poffin authority on ordinary sheets
  -> versioned ContestDocument (variant, type, contestants, ledgers)
  -> introduction stage: skills, bonus rolls, letters
  -> performance rounds: positions, appeals, voltage, fumbles, effects
  -> server-rolled journaled dice + revision-checked idempotent operations
  -> role-projected realtime scoreboard, history, and provenance
  -> settlement: placements, experience, ribbons, prizes, cleanup
  -> campaign continuation, attention items, durable contest history
```

Preparation and contest authority remain intentionally separate:

```text
durable preparation
  = ordinary sheet authority (contest dice sources, poffins, items)

a running contest
  = one ContestDocument with per-contest ledgers and journals

settlement
  = one atomic transition into ordinary campaign authority

after settlement
  = ribbons, experience, prizes, history, attention items only
```

## First playable vertical slice

The first end-to-end slice is:

> The GM creates a three-contestant Standard Cute Contest with one player-owned Pokémon and two GM-controlled contestants. Both trainers play the introduction stage, three performance rounds resolve with authoritative positions, appeals, voltage, and scoring, and settlement awards experience and a ribbon that appear on the winning sheets and the campaign dashboard.

This slice must be complete before widening to four- and five-contestant charts, Supercontests, Festivals, Rotation Contests, and the full Feature, Edge, Ability, and item integration cohort.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered unfinished ticket; only one ticket is `IN_PROGRESS` unless the decision log explicitly permits bounded parallel work.
- Update this ledger, `implementation-plans/plan-order.md`, and `AGENTS.md` together whenever plan status, current ticket, dependency, blocker, or ticket count changes.
- Mark a ticket `DONE` only after focused automated tests, required fixtures, role/privacy checks, recovery behavior, and user-facing acceptance pass.
- Follow the repository's bounded-worker validation discipline and reserve the full suite, production build, and `scripts/quality-gate.sh` for meaningful integration and final closure.
- New contest semantics must be traceable to app-owned canonical data, stable identity, evidence, and source fingerprints; documentary chapters and errata are provenance for reviewed migrations only.
- A contest surface is incomplete if the user can select an option that the server cannot authoritatively validate, roll, and commit.
- `PLAN_STATUS: DONE` is permitted only after P10-100, all 100 tickets, all canonical contest rows, and all golden contest journeys are complete.

## Progress snapshot

- Plan tickets: **100 DONE / 100 total**
- Current ticket: **NONE**
- Blocking dependency: **none; Plans 1–9 are complete and archived**
- Primary product target: **accepted and archived**
- Canonical contest coverage: **761 defined Move identities, 16 explicit unavailable identities, 44 finalized integration rows, 34 rule rows, and zero blocked rows**
- Variant acceptance: **18 deterministic scenarios cover all five Standard types at three/four/five contestants plus Supercontest, Festival, and Rotation**
- Known data gaps at drafting: **resolved through the reviewed `pokemon-contests:v1` migration; legacy `contestStats` remains compatibility description only**
- First playable vertical slice: **complete in authoritative runtime and desktop/mobile liveplay**
- Final validation: **repository quality gate passed, including the reviewed migration and fixtures, 81 focused Contest tests, lint with zero errors, typecheck, 1,554 Vitest files / 11,197 tests, seven Nuxt tests, 85 Playwright journeys across desktop/mobile with one intentional project skip, and the production build**
- Final acceptance record: **`data/contests/alpha-acceptance.v1.json`**

## Tickets

### Phase 1 — Canonical contest authority, gameplay baseline, and acceptance fixtures

- [x] **P10-001 — Audit the current contest footprint and debt** — `DONE`
  - Trace every existing contest touchpoint: the freeform `contestStats` sheet field and its lookup and serialization paths, breeding coloration contest-stat identities, contest-referencing reference rows, and any surface that displays contest prose today.
  - Record every fabricated, prose-only, or reference-only behavior in a versioned inventory with owning code paths and the future ticket that retires or upgrades it.
- [x] **P10-002 — Inventory canonical contest rules and classify implementable decisions** — `DONE`
  - Classify every core contest rule from the app's provenance sources: contest stats and combat-stat correlation, poffin allowances, introduction skills and bonus rolls, appeal and center-of-attention scoring, voltage, position and turn charts, adjacency, type matching, the contest-effect list, variants, and contest experience.
  - Record each rule's intended native, guided, passive, reference-only, or not-applicable state, and file explicit data defects where structured authority is absent or ambiguous rather than interpreting prose at runtime.
- [x] **P10-003 — Create canonical `data/reference/contests.json` through a reviewed migration** — `DONE`
  - Add one source-hash-bound, schema-versioned canonical file for contest stats, combat-stat correlations and caps, allied/opposed relationships, introduction skill mappings, appeal and center-of-attention scoring tables, voltage bounds, three-, four-, and five-contestant position and turn-order charts, contest-effect definitions, variant definitions, and the contest experience rule.
  - Bind the migration to exact documentary source fingerprints including errata, review it as app-owned authority, and add the file to the `AGENTS.md` canonical reference list in the same change.
- [x] **P10-004 — Create canonical per-move contest identity through a reviewed migration** — `DONE`
  - Bind every runtime move to a reviewed contest type and contest effect where the provenance sources define them, including errata corrections, without mutating unrelated move fields.
  - Represent moves without canonical contest data as an explicit no-contest-identity state that fails closed at runtime; forbid guessed types, web lookups, and silent GM defaults.
- [x] **P10-005 — Inventory contest-referencing Features, Edges, Abilities, and items** — `DONE`
  - Classify all 34 contest-referencing Features (the Coordinator tree, the Style Expert ranks and stat branches, and crossovers such as Stat Ace, Contest Trends, Playing God, Beguiling Dance, Passing Waltz, Voice Lessons, and Marksman Orders), the Grace and Groomer Edges, the Beautiful, Fashion Designer, and Ugly Abilities, and the Poffin Mixer, Fancy Clothes, Contest Accessory, and Contest Fashion items.
  - Assign each row a target completion state and owning ticket, and record poffin acquisition, grooming, and held-item bonus-roll authority gaps—including the missing standalone poffin item identity—as explicit data or design defects.
- [x] **P10-006 — Define contest roles, privacy, and trust boundaries** — `DONE`
  - Model GM, competing player, non-competing spectator, and diagnostic access for setup, private planning, dice pools, corrections, and settlement within the existing trusted-table profile system.
  - Keep the scoreboard, letters, voltage, and accepted appeals table-visible while GM notes, undeclared prizes, and diagnostics stay structurally private.
- [x] **P10-007 — Define the contest completion rubric** — `DONE`
  - Define native, guided, passive, reference-only, not-applicable, and blocked states for every canonical contest rule row and every contest-referencing reference row.
  - Final acceptance permits no blocked rows, no prose-inferred runtime semantics, and no visible contest action without authoritative semantics or an explicit safe unavailable reason.
- [x] **P10-008 — Define measurable contest UX success criteria** — `DONE`
  - Set aggregate-only targets for time to contest start, appeal decision time, round duration, scoreboard comprehension at table distance, recovery from illegal choices, settlement completion, and spectator clarity.
  - Exclude campaign identities, character names, private notes, and roll payloads from any metric.
- [x] **P10-009 — Create canonical contest acceptance fixtures** — `DONE`
  - Add deterministic seeded fixtures for three-, four-, and five-contestant Standard Contests of each contest type, a Supercontest, a Festival, and a Rotation Contest, including the documented three-contestant Cute Contest walkthrough as a golden replay fixture.
  - Bind each fixture to canonical source fingerprints, expected letters, positions, per-round scores, voltage, fumbles, final placements, and settlement packages.
- [x] **P10-010 — Create contest failure, concurrency, and recovery fixtures** — `DONE`
  - Add deterministic fixtures for stale revisions, duplicate declarations, disconnected contestants, GM restart mid-round, illegal move repeats, dice-pool overspend, interrupted settlement, and server restart between rounds.
  - Each fixture must define public, player, and GM projections, retry behavior, rollback expectations, and the absence of partial scoring or duplicated rewards.

### Phase 2 — Contest document, contracts, and validation architecture

- [x] **P10-011 — Define the versioned `ContestDocument` contract** — `DONE`
  - Model hall presentation, variant, contest type, policy, contestants and controllers, stage, round, letters, positions, appeal, fumble, and voltage ledgers, dice-pool usage, pending effect state, history, and settlement references.
  - Reject unknown schema versions and separate immutable contest identity from editable display metadata.
- [x] **P10-012 — Define contest lifecycle, revision, and idempotency semantics** — `DONE`
  - Support setup, introduction, performance, settling, completed, and cancelled states with explicit legal transitions and no orphan intermediate authority.
  - Every mutation must be revision-checked, every declaration and settlement must carry a stable operation ID, and exact retry must return the original terminal result.
- [x] **P10-013 — Define stable contest identity for options and choices** — `DONE`
  - Assign bounded stable IDs to contest stats, effects, variants, introduction skills, letters, positions, declared appeals, interventions, and settlement entries.
  - Preserve user-facing labels separately from canonical identity and reject ambiguous aliases and stale option references.
- [x] **P10-014 — Implement authoritative journaled contest dice** — `DONE`
  - Roll every introduction, appeal, bonus, supercontest-type, and tie-break die on the server with journaled ordered results and replayable evidence bound to the accepting operation, following the existing dice-journal patterns.
  - Forbid client-supplied roll results and guarantee that duplicate delivery or retry never re-rolls an accepted result.
- [x] **P10-015 — Define the contest validation and explanation contract** — `DONE`
  - Represent illegal move repetition, adjacency violations, dice overspend, wrong-turn declarations, exhausted resources, and stage-mismatched actions through stable codes with safe user-readable reasons.
  - Validation must name the affected contestant, decision, and legal alternatives without exposing internal hashes or private data.
- [x] **P10-016 — Define derived contest projections** — `DONE`
  - Produce deterministic public scoreboard, per-contestant owner, GM oversight, and diagnostic projections covering appeal, fumble, voltage, dice pools, positions, and pending decisions.
  - Every derived number must identify its canonical contributors so the contest surface never becomes a second opaque rules engine.
- [x] **P10-017 — Define contest read sets, write sets, and atomicity** — `DONE`
  - List the document, sheet, reference, item, policy, and journal resources consulted or written by each operation, including cross-resource settlement writes.
  - Each declaration, intervention, correction, and settlement commits completely or leaves every authoritative resource unchanged.
- [x] **P10-018 — Define contest realtime events and role projections** — `DONE`
  - Add privacy-safe setup, introduction, declaration, accepted-appeal, voltage, round, correction, and settlement events with client IDs, ordering, and durable replay.
  - Project owner-private planning and GM-private notes structurally rather than filtering in the client.
- [x] **P10-019 — Build strict contest contract and drift quality gates** — `DONE`
  - Add checks for effect-coverage regressions against the canonical effect list, per-move contest identity coverage, orphan option IDs, invalid transitions, chart mismatches, and stale source fingerprints.
  - The quality gate must fail when canonical contest coverage regresses or when client and server validators disagree.
- [x] **P10-020 — Certify contest contracts against fixtures** — `DONE`
  - Replay the Phase 1 fixtures through contract validation, projection derivation, and event schemas without any engine implementation shortcuts.
  - Verify role projections, idempotency semantics, and validation codes match fixture expectations exactly.

### Phase 3 — Contest-stat and preparation authority on sheets

- [x] **P10-021 — Implement structured contest-stat authority on Pokémon sheets** — `DONE`
  - Replace the freeform `contestStats` string as authority with typed per-stat state covering combat-derived dice, poffin-granted dice, and provenance, preserving the legacy text as non-authoritative description.
  - Keep contest-stat identity aligned with the existing breeding coloration stat IDs rather than creating a second identity space.
- [x] **P10-022 — Derive combat-stat contest contributions** — `DONE`
  - Compute contest dice from the canonical combat-stat correlations with the canonical cap, excluding combat stages, and recompute on every authoritative sheet change.
  - Expose contribution explanations naming each contributing stat, poffin, and cap.
- [x] **P10-023 — Implement poffin allowance and consumption authority** — `DONE`
  - Enforce the level-based poffin allowance and lifetime cap, allocate each consumed poffin to one contest stat, and commit consumption through the existing idempotent item runtime.
  - Over-allowance consumption must fail closed with a safe reason and never silently waste an item.
- [x] **P10-024 — Implement canonical contest item inventory and acquisition** — `DONE`
  - Make poffins and the canonical contest items acquirable, storable, transferable, and equippable through existing shop, inventory, and equipment authority, adding any missing canonical item identities such as standalone poffins through reviewed source-hash-bound migrations first.
  - Classify Poffin Mixer and grooming workflows as guided where canonical bounds require GM adjudication.
- [x] **P10-025 — Implement Trainer introduction-stage inputs** — `DONE`
  - Model the five canonical introduction skills and their contest-stat mappings from existing trainer skill authority, plus the Grace and Groomer Edge effects on available rolls.
  - Represent held-item and grooming bonus-roll eligibility explicitly, with guided adjudication where the canonical rules leave GM latitude.
- [x] **P10-026 — Build the sheet contest preparation surface** — `DONE`
  - Present contest dice, sources, poffin allowance and history, and per-stat totals in Field Guide language on Pokémon sheets, with introduction-skill previews on trainer sheets.
  - Follow the UI design workflow with reviewed fixtures for empty, partial, capped, and stale states.
- [x] **P10-027 — Migrate existing sheets safely** — `DONE`
  - Migrate all persisted sheets to structured contest-stat state without fabricating authority from legacy freeform text; carry the old string forward as description only.
  - Cover fresh databases, upgrades, restored backups, and sheets edited concurrently during rollout.
- [x] **P10-028 — Surface per-move contest identity in reference and sheets** — `DONE`
  - Show canonical contest type and effect in move reference pages, sheet move lists, and lookup surfaces, with explicit no-canonical-data presentation where identity is absent.
  - Keep contest identity display consistent with existing move reference anatomy rather than adding a parallel move UI.
- [x] **P10-029 — Align onboarding, breeding, and progression touchpoints** — `DONE`
  - Ensure guided onboarding previews, breeding coloration, level-ups, evolutions, and stat changes read and recompute structured contest state through one shared derivation.
  - Prevent divergent contest-stat math between sheets, onboarding previews, and contest documents.
- [x] **P10-030 — Certify contest preparation authority** — `DONE`
  - Test derivation, poffin consumption, caps, migration, projections, realtime sheet events, concurrency, and restart against fixtures with GM and player roles.
  - Verify that no surface still treats the legacy freeform string as mechanical authority.

### Phase 4 — Contest setup and the introduction stage

- [x] **P10-031 — Build the Contest Workshop creation flow** — `DONE`
  - Let the GM create a contest with hall presentation, variant, contest type where applicable, contestant count, prize declaration, and ribbon flag in Workshop language with explicit save and validation state.
  - Reject unsupported variants and out-of-bounds contestant counts with safe reasons.
- [x] **P10-032 — Implement contestant enrollment and eligibility** — `DONE`
  - Enroll player-owned and GM-controlled Pokémon from ordinary sheets with controller assignment, duplicate prevention, and readiness validation.
  - Support Rotation Contest team composition with the canonical per-team dice-cap derivation.
- [x] **P10-033 — Implement contest policy and GM settings** — `DONE`
  - Expose the experience significance multiplier, prize contents, and bounded optional settings as explicit reviewed policy on the document rather than hidden defaults.
  - Record policy provenance in the document and forbid silent mid-contest policy edits.
- [x] **P10-034 — Implement the introduction-stage skill decision** — `DONE`
  - Offer each trainer the five canonical skill choices with dice previews from authoritative skill ranks and the standard-contest matching-bonus explanation.
  - Commit each choice through revision-checked declarations with exact retry.
- [x] **P10-035 — Implement introduction rolls and contest-dice generation** — `DONE`
  - Roll journaled server dice per skill rank, convert qualifying results into contest-stat dice, apply the matching-skill bonus appeal, and record per-contestant introduction totals.
  - Apply Grace, Groomer, held-item, and grooming bonus rolls natively where canonical and through guided adjudication where GM latitude exists.
- [x] **P10-036 — Implement letter assignment and tie resolution** — `DONE`
  - Assign letters from introduction totals with the canonical matching-skill adjustment and journaled authoritative tie-breaks.
  - Publish letters, initial appeal, and dice pools to all projections before the performance stage opens.
- [x] **P10-037 — Implement Supercontest and Festival initialization** — `DONE`
  - Roll the journaled per-round type die for Supercontests with the canonical mapping and re-roll rule, and initialize Festival elimination structure with appeal-carryover semantics.
  - Keep variant-specific state inside the document contract rather than variant-specific forks of the engine.
- [x] **P10-038 — Publish setup and introduction realtime projections** — `DONE`
  - Deliver role-projected setup, enrollment, introduction-roll, and letter events to the GM, competing players, and spectators with durable replay.
  - Late-joining clients must converge on exact current stage state without private leakage.
- [x] **P10-039 — Implement setup resilience and pre-start changes** — `DONE`
  - Support cancelling a contest, replacing or withdrawing contestants before the start, and restarting the introduction under explicit GM control with visible history.
  - A started performance stage must never silently lose accepted introduction results.
- [x] **P10-040 — Certify the setup and introduction slice** — `DONE`
  - Run three-, four-, and five-contestant setups across variants with GM and player clients, covering validation, retry, restart, tie-breaks, and privacy.
  - Verify fixture-expected letters, dice pools, and bonus appeal exactly.

### Phase 5 — Performance-stage engine

- [x] **P10-041 — Implement rounds, positions, and turn order from canonical charts** — `DONE`
  - Drive per-round positions, turn order, and the center-of-attention slot exclusively from the canonical three-, four-, and five-contestant charts bound in `contests.json`.
  - Reject out-of-turn declarations and expose whose decision currently blocks play.
- [x] **P10-042 — Implement adjacency authority** — `DONE`
  - Derive adjacency from current round positions for every effect and rule that targets adjacent competitors.
  - Guarantee chart-consistent adjacency across rounds and expose it to projections for explanation.
- [x] **P10-043 — Implement the appeal declaration contract** — `DONE`
  - Offer each contestant their real sheet moves with contest identity, enforce the no-repeat rule with the canonical Reliable exception, and accept contest-dice spends up to the canonical per-appeal cap from remaining pools.
  - Appeals must never consume battle frequencies, AP, or durable combat resources.
- [x] **P10-044 — Implement contest-type matching and dice assembly** — `DONE`
  - Apply matching, allied, and opposing modifiers from the canonical allied/opposed relationships, including the fumble-on-zero-dice rule, plus voltage bonus dice from start-of-turn voltage.
  - Show the exact assembled dice formula with contributors before declaration commit.
- [x] **P10-045 — Implement appeal resolution and scoring** — `DONE`
  - Resolve journaled appeal rolls with the normal and center-of-attention scoring tables, fumble accrual, and authoritative ledger updates in one accepted operation.
  - Publish accepted results with per-die evidence for the history inspector and permit no client-side scoring.
- [x] **P10-046 — Implement the voltage engine** — `DONE`
  - Track per-contestant voltage within canonical bounds, apply effect-driven gains and losses at their exact phases, and expose start-of-turn bonus derivation.
  - Voltage changes commit only through accepted operations and never drift optimistically.
- [x] **P10-047 — Implement direct dice-and-voltage contest effects natively** — `DONE`
  - Implement the canonical effects whose semantics are immediate dice counts and voltage changes: Big Show, Excitement, Steady Performance, Special Attention, Attention Grabber, Unsettling, Incentives, Inversed Appeal, Reflective Appeal, Catching Up, Good Show, Exhausting Act, and Double Time.
  - Bind each implementation to its canonical effect identity with per-effect fixtures.
- [x] **P10-048 — Implement conditional and cross-round contest effects natively** — `DONE`
  - Implement Desperation, Gamble, Get Ready, Reliable, Sabotage, Safe Option, Saving Grace, Seen Nothing Yet, and Tease, including scoring-rule overrides, next-round doubling, round-scoped protections, and adjacent fumble infliction.
  - Persist pending cross-round state in the document so restart and replay preserve exact semantics.
- [x] **P10-049 — Implement round advancement, tally, and variant completion** — `DONE`
  - Advance rounds, close the performance stage after the canonical round count, compute final scores as appeal minus fumble, and resolve placements.
  - Run Festival elimination loops with appeal carryover and Supercontest per-round type changes without forking the engine.
- [x] **P10-050 — Certify the performance engine with golden replays** — `DONE`
  - Replay the documented three-contestant Cute Contest fixture and the seeded four- and five-contestant, Supercontest, Festival, and Rotation fixtures to exact expected scores.
  - Verify no-repeat enforcement, adjacency, dice-pool depletion, and effect edge cases against per-effect fixtures.

### Phase 6 — Features, Edges, Abilities, and item integration

- [x] **P10-051 — Implement the Coordinator class tree natively** — `DONE`
  - Implement Coordinator, Decisive Director, Adaptable Performance, Flexible Preparations, Innovation, Nuanced Performance, Reliable Performance, Look and Learn, and Juggling Show with canonical timing, frequencies, and targets inside contest flow.
  - Bind each Feature to existing feature-automation identity and resource authority rather than contest-only feature state.
- [x] **P10-052 — Implement the Style Expert tree natively** — `DONE`
  - Implement Style Expert, Style Flourish, Style Entrainment, and the five stat branches—Beautiful Ballet, Fabulous Max, Enticing Beauty; Cool Conduct, Rule of Cool, Action Hero Stunt; Cute Cuddle, Gleeful Steps, Let’s Be Friends!; Smart Scheme, Calculated Assault, Learn From Your Mistakes; Tough Tumble, Macho Charge, Endurance—with canonical contest semantics.
  - Where a branch Feature already has implemented combat semantics, integrate contest semantics without duplicating the row's identity.
- [x] **P10-053 — Implement crossover contest Features** — `DONE`
  - Resolve the Stat Ace, Contest Trends, Playing God, Beguiling Dance, Passing Waltz, Voice Lessons, and Marksman Orders contest interactions natively or as bounded guided decisions per the rubric.
  - Record any row that canonical data cannot support natively with an explicit reviewed reason.
- [x] **P10-054 — Implement the Grace and Groomer Edges natively** — `DONE`
  - Apply Grace's introduction-stage flexibility and Groomer's grooming benefits at their canonical phases through existing edge-automation identity.
  - Cover interaction with bonus rolls, matching-skill bonuses, and letter assignment in fixtures.
- [x] **P10-055 — Implement contest Abilities** — `DONE`
  - Implement Beautiful, Fashion Designer, and Ugly with canonical contest-phase semantics as native or passive rows per the rubric.
  - Suppress or withdraw contributions exactly when their providers become inactive.
- [x] **P10-056 — Complete contest item behavior** — `DONE`
  - Implement Fancy Clothes, Contest Accessory, Contest Fashion, and Poffin Mixer flows natively or guided per the rubric, including introduction bonus-roll items.
  - Route all consumption, equipping, and custody through existing item and equipment authority.
- [x] **P10-057 — Implement intervention timing windows** — `DONE`
  - Define legal windows for Feature, Edge, Ability, and item interventions across introduction, declarations, resolution, and settlement, including the Rotation Contest any-time Feature rule.
  - Reject out-of-window interventions with safe reasons and journal accepted ones with provenance.
- [x] **P10-058 — Bind contest resources to existing sheet authority** — `DONE`
  - Charge Feature frequencies, once-per-contest limits, and rerolls against ordinary sheet resource authority with per-contest scopes that reset at settlement.
  - Exact retry and reconnect must never double-charge or double-apply an intervention.
- [x] **P10-059 — Close completion states for all contest-referencing rows** — `DONE`
  - Drive all 34 Features, 2 Edges, 3 Abilities, and 4 items plus per-move contest identities to final rubric states with evidence.
  - No referencing row may remain blocked, prose-inferred, or silently absent from contest flow.
- [x] **P10-060 — Certify the integration cohort** — `DONE`
  - Run cohort fixtures where Coordinator, Style Expert, crossover Features, Edges, Abilities, and items interact within one contest, including conflicting interventions.
  - Verify identity, timing, resource, and privacy behavior matches canonical expectations.

### Phase 7 — Live Contest experience

- [x] **P10-061 — Define the Live Contest visual grammar** — `DONE`
  - Extend the DESIGN.md live context to contests: portrait-led contestants, one visually primary decision, semantic scoring colors, restrained spectacle choreography, and provenance access.
  - Produce and review target-state mockups through the UI design workflow before implementation.
- [x] **P10-062 — Build the contest stage view** — `DONE`
  - Present per-round positions, letters, adjacency, and the center of attention with portrait-led identity and clear round context.
  - Keep the stage view comprehension-first at table distance without requiring the tactical lens.
- [x] **P10-063 — Build the authoritative scoreboard** — `DONE`
  - Present appeal, fumble, voltage, and remaining dice pools with accepted-result choreography and no optimistic movement.
  - Support spectator scanning while the active decision stays visually primary.
- [x] **P10-064 — Build the appeal decision surface** — `DONE`
  - Offer the contestant's moves with contest type, effect, assembled dice preview, no-repeat state, and dice-spend controls in the shared decision anatomy.
  - Show expected unavailable options with safe reasons instead of hiding them.
- [x] **P10-065 — Build the introduction-stage experience** — `DONE`
  - Guide skill choice, bonus rolls, and letter reveal with explanations of generated dice and bonus appeal.
  - Keep roll reveals authoritative, replay-consistent, and reduced-motion safe.
- [x] **P10-066 — Build contest history and provenance inspectors** — `DONE`
  - Provide an event feed and per-appeal inspector showing the declared move, modifiers, spent dice, per-die results, scoring table, and effect consequences.
  - Deep rules explanation follows the shared provenance patterns without exposing private data.
- [x] **P10-067 — Build GM oversight and correction controls** — `DONE`
  - Give the GM pause, bounded correction, contestant replacement, and cancellation controls with receipts and visible history.
  - Corrections use canonical validators and never rewrite journaled dice evidence.
- [x] **P10-068 — Implement contest responsive layouts** — `DONE`
  - Support desktop, laptop, tablet, and phone layouts for the stage, scoreboard, decisions, and history without clipped controls or horizontal page traps.
  - Define breakpoint-specific arrangements that preserve the primary decision.
- [x] **P10-069 — Implement spectator and multi-client presentation** — `DONE`
  - Give non-competing players a clear spectator projection with public facts only, converging across clients in accepted order.
  - Contestant clients must show their own pending decision without blocking other participants' views.
- [x] **P10-070 — Certify the Live Contest experience in liveplay** — `DONE`
  - Run a full contest through GM, two player, and one spectator clients in liveplay with reviewed visual fixtures.
  - Verify decision hierarchy, choreography, and history comprehension against the UX success criteria.

### Phase 8 — Settlement, ribbons, and campaign continuation

- [x] **P10-071 — Build the contest settlement document and preview** — `DONE`
  - Assemble placements, final scores, experience allocation, ribbon award, prizes, and cleanup into one settlement preview with every write listed before commit.
  - Reuse encounter-settlement presentation language rather than a contest-only settlement dialect.
- [x] **P10-072 — Implement contest experience allocation natively** — `DONE`
  - Compute experience from the canonical beaten-contestant rule with its explicit round-up exception, apply the explicit GM significance multiplier, and honor Festival whole-event and Rotation split rules.
  - Route experience through existing progression authority so level-up consequences become ordinary attention items.
- [x] **P10-073 — Implement the ribbon ledger** — `DONE`
  - Record ribbons as durable, provenance-backed records on winning Pokémon and their trainers with hall, contest type, variant, date, and contest reference.
  - Present ribbons on sheets and campaign surfaces and count qualification totals informationally.
- [x] **P10-074 — Implement prize and reward settlement** — `DONE`
  - Award declared money, items, and other prizes through existing inventory and money authority inside the settlement transaction.
  - Undeclared or judgment-dependent prizes settle through bounded guided GM decisions with receipts.
- [x] **P10-075 — Implement contest cleanup** — `DONE`
  - Reset per-contest dice usage, once-per-contest resources, voltage, and pending effect state at settlement without touching durable preparation authority.
  - Guarantee no contest-scoped state leaks into sheets, encounters, or later contests.
- [x] **P10-076 — Publish settlement attention items** — `DONE`
  - Surface level-ups, move learning, evolution, prize decisions, and unresolved guided outcomes as ordinary campaign attention work.
  - Attention items must link to their owning workflows rather than duplicating them.
- [x] **P10-077 — Integrate contests into campaign surfaces** — `DONE`
  - Show scheduled, active, and completed contests with placements and ribbons on the campaign dashboard and player portals with role-appropriate detail.
  - Keep contest history durable, exportable, and restorable with campaign backups.
- [x] **P10-078 — Implement settlement atomicity, retry, and rollback** — `DONE`
  - Commit experience, ribbons, prizes, cleanup, history, and completion in one idempotent transaction with exact replay on retry.
  - Any failure leaves sheets, inventories, and campaign records unchanged with a safe retriable state.
- [x] **P10-079 — Publish settlement realtime completion events** — `DONE`
  - Deliver durable role-projected completion, ribbon, reward, and attention events ordered after commit and safe under duplicate delivery.
  - Late or reconnecting clients must converge on settled state without incorrectly replaying dice or scores.
- [x] **P10-080 — Certify settlement and continuation journeys** — `DONE`
  - Run contests through settlement into campaign continuation, verifying experience, ribbons, prizes, cleanup, attention, and dashboard state across roles.
  - Include Festival, Rotation split, retry, rollback, and restart cases from fixtures.

### Phase 9 — Accessibility, responsiveness, resilience, and performance

- [x] **P10-081 — Complete keyboard-only and switch-access operation** — `DONE`
  - Provide predictable focus order for enrollment, skill choice, appeal declaration, dice spends, interventions, corrections, and settlement using native controls.
  - No contest decision may require pointer precision, drag-and-drop, hover, or an unlabelled shortcut.
- [x] **P10-082 — Complete screen-reader structure and announcements** — `DONE`
  - Expose stage, round, turn, scoreboard, and accepted results through landmarks and live regions with bounded aggregate roll announcements.
  - Blocking decisions and settlement must be unmistakable without announcing every die of a large appeal individually.
- [x] **P10-083 — Complete touch targets, help, and validation recovery** — `DONE`
  - Meet target sizes, avoid hover-only explanations, separate destructive controls, and provide concise inline help for contest concepts such as voltage, letters, and the center of attention.
  - Error summaries must focus the blocking decision and every issue link must land on an operable control.
- [x] **P10-084 — Complete reduced-motion, zoom, and reflow acceptance** — `DONE`
  - Preserve comprehension of scoring choreography under reduced motion, 200% zoom, and narrow reflow without losing accepted-result clarity.
  - Retain reviewed visual fixtures for motion-reduced and zoomed scoreboard states.
- [x] **P10-085 — Certify multi-tab and multi-device concurrency** — `DONE`
  - Handle a contestant on two devices, GM corrections during declarations, spectators joining mid-round, and simultaneous contests in one campaign.
  - Stale clients must reconcile without duplicate declarations or divergent scoreboards.
- [x] **P10-086 — Certify restart, reconnect, and uncertain-outcome recovery** — `DONE`
  - Recover the document, dice journals, pending declarations, cross-round effect state, and settlement across server restart and realtime gaps.
  - Distinguish offline, stale, retryable, and uncertain states and block duplicate speculative declarations.
- [x] **P10-087 — Complete authorization, privacy, and abuse testing** — `DONE`
  - Test controller boundaries, spectator probing, forged option IDs, out-of-turn declarations, payload bounds, and settlement authority within the trusted-table model.
  - No participant may read private planning or mutate another contestant's state.
- [x] **P10-088 — Enforce contest performance budgets** — `DONE`
  - Set budgets for document loads, declaration round-trips, projection recomputation, event fan-out, and history rendering at maximum contestants and effect complexity.
  - Use deterministic benchmark fixtures and bounded rendering for long histories.
- [x] **P10-089 — Run responsive and cross-device acceptance** — `DONE`
  - Validate official desktop and mobile projects across setup, introduction, performance, and settlement with keyboard, touch, and screen-reader passes.
  - No critical usability defect may be deferred to the final phase.
- [x] **P10-090 — Run the combined resilience acceptance** — `DONE`
  - Execute concurrency, restart, privacy, performance, and accessibility fixtures together against one long-running campaign database.
  - Record evidence and close every discovered defect or track it as explicit blocking work.

### Phase 10 — Coverage closure, golden journeys, documentation, and final acceptance

- [x] **P10-091 — Certify complete canonical contest coverage** — `DONE`
  - Prove every canonical contest rule row and referencing row reached a final rubric state with structured authority, evidence, and tests.
  - Zero blocked rows, prose-inferred semantics, guessed contest identities, or silent absences may remain.
- [x] **P10-092 — Certify the variant and scale matrix** — `DONE`
  - Run Standard Contests of all five contest types at three, four, and five contestants plus Supercontest, Festival, and Rotation through complete journeys.
  - Verify chart correctness, elimination flow, dice caps, and experience rules per variant.
- [x] **P10-093 — Run GM, player, and spectator multi-client acceptance** — `DONE`
  - Exercise enrollment, introduction, declarations, interventions, corrections, and settlement across four concurrent roles with realtime ordering checks.
  - Confirm unauthorized clients receive no private planning, notes, or diagnostic data.
- [x] **P10-094 — Run fresh-database, upgrade, backup, and restore acceptance** — `DONE`
  - Create and settle contests on fresh databases, upgrade historical schemas, and back up and restore mid-contest and settled states.
  - Verify journals, ledgers, ribbons, and provenance survive restore exactly.
- [x] **P10-095 — Run golden deterministic replay acceptance** — `DONE`
  - Replay the documented walkthrough fixture and all seeded golden contests to exact scores, placements, and settlements on the final integrated build.
  - Any divergence is a blocking defect, not a tolerance.
- [x] **P10-096 — Run failure, correction, rollback, and exact-retry acceptance** — `DONE`
  - Inject failures at declaration, resolution, effect application, round advance, and each settlement write.
  - Prove no partial score, duplicate reward, lost ribbon, or ambiguous outcome remains.
- [x] **P10-097 — Run golden campaign journeys through contests** — `DONE`
  - Certify journeys from poffin preparation and enrollment through ribbon, experience, and next-day continuation for newly onboarded and veteran characters on desktop and mobile.
  - Continue each fixture into ordinary campaign surfaces to confirm clean handoff to existing authority.
- [x] **P10-098 — Make contests a first-class campaign activity** — `DONE`
  - Integrate contest creation and discovery into the campaign dashboard, navigation, and player portals as ordinary campaign work rather than a hidden tool.
  - Keep encounter-first tables unaffected when no contest exists.
- [x] **P10-099 — Complete user, GM, contributor, and operator documentation** — `DONE`
  - Document preparation, setup, variants, play, interventions, settlement, ribbons, troubleshooting, canonical-data maintenance, privacy, and recovery.
  - Focus on running and extending the alpha product rather than release ceremony.
- [x] **P10-100 — Record final Pokémon Contest alpha acceptance** — `DONE`
  - Run all focused and full repository validation, record golden-journey evidence, confirm all 100 tickets and canonical contest rows are complete, and verify no critical contest debt remains.
  - Set `PLAN_STATUS: DONE`, clear `CURRENT_TICKET`, archive the plan, synchronize `plan-order.md` and `AGENTS.md`, and draft and register the next prospective plan from the plan-order 1.0 release definition only after every gate passes.

## Phase exit gates

### Phase 1 exit

- The contest footprint, canonical rules, referencing rows, roles, completion rubric, success criteria, and deterministic fixtures are recorded, and `contests.json` plus per-move contest identity exist as reviewed app-owned authority.
- P10-001 through P10-010 are `DONE`.

### Phase 2 exit

- Document, lifecycle, identity, dice, validation, projection, atomicity, realtime, and drift contracts are versioned, executable, and certified against fixtures.
- P10-011 through P10-020 are `DONE`.

### Phase 3 exit

- Contest stats, poffins, contest items, and introduction inputs are structured sheet authority with safe migration, and no surface treats the legacy freeform string as mechanical truth.
- P10-021 through P10-030 are `DONE`.

### Phase 4 exit

- GMs can create contests and enroll contestants, and complete introduction stages produce journaled rolls, contest dice, bonus appeal, and letters across all variants.
- P10-031 through P10-040 are `DONE`.

### Phase 5 exit

- The performance stage runs authoritative rounds, positions, adjacency, appeals, voltage, and all canonical contest effects, and the golden walkthrough replays to exact scores.
- P10-041 through P10-050 are `DONE`.

### Phase 6 exit

- All contest-referencing Features, Edges, Abilities, and items reach final completion states inside contest flow through existing automation and resource authority.
- P10-051 through P10-060 are `DONE`.

### Phase 7 exit

- The Live Contest stage, scoreboard, decision, history, GM oversight, and spectator surfaces pass reviewed visual fixtures and liveplay certification.
- P10-061 through P10-070 are `DONE`.

### Phase 8 exit

- Settlement atomically awards placements, experience, ribbons, and prizes, cleans up contest-scoped state, and hands off to campaign attention, history, and continuation.
- P10-071 through P10-080 are `DONE`.

### Phase 9 exit

- Keyboard, screen-reader, touch, reduced-motion, zoom, concurrency, restart, privacy, and performance acceptance pass with evidence.
- P10-081 through P10-090 are `DONE`.

### Phase 10 exit

- Canonical coverage, variant matrix, multi-client, migration, backup/restore, deterministic replay, rollback, golden journeys, discoverability, and documentation pass.
- P10-091 through P10-100 are `DONE`, the plan is archived, and no critical contest debt remains.

## Final definition of done

This plan is complete only when all of the following are true:

1. Canonical contest rules and per-move contest identities exist as reviewed, source-hash-bound, app-owned structured data listed in `AGENTS.md`.
2. Contest stats, poffin allowances, and preparation state are structured sheet authority with contribution explanations and safe migration from legacy freeform text.
3. Standard, Supercontest, Festival, and Rotation Contests run natively for three, four, and five contestants with canonical positions, turn order, adjacency, and the center of attention.
4. Introduction stages resolve skills, bonus rolls, generated dice, bonus appeal, letters, and ties through journaled server dice.
5. Appeals enforce move legality, the no-repeat rule, dice-spend caps, type matching, and voltage, and never consume battle frequencies or combat state.
6. All canonical contest effects resolve natively with exact scoring, fumble, voltage, and cross-round semantics.
7. All 34 contest-referencing Features, both Edges, all three Abilities, and all four items reach final completion states with evidence.
8. Every roll, score, and ledger change is server-authoritative, revision-checked, idempotent, journaled, and convergent across clients.
9. Settlement commits placements, experience with its canonical round-up exception, ribbons, prizes, and cleanup atomically with exact retry.
10. Ribbons and contest history are durable, provenance-backed campaign records visible on sheets and campaign surfaces.
11. Unresolved consequences surface as ordinary campaign attention items linked to their owning workflows.
12. GM corrections are bounded, receipted, and auditable without rewriting dice evidence.
13. Public, owner, GM, and diagnostic projections remain structurally distinct for planning, notes, and diagnostics.
14. The golden documented walkthrough and all seeded fixtures replay deterministically to exact results.
15. Desktop, mobile, keyboard, touch, screen-reader, zoom, reflow, reduced-motion, concurrency, restart, and performance acceptance pass.
16. Fresh-database, upgrade, backup, restore, rollback, and exact-retry acceptance pass.
17. Contests are discoverable first-class campaign activity with complete user, GM, contributor, and operator documentation.
18. No critical usability, authority, privacy, data-loss, or manual-repair debt remains in the preparation-to-ribbon journey.

## Decision log

- **2026-08-20 — Make Pokémon Contests Plan 10.** Plans 8 and 9 both deferred Contests by name as the next parallel gameplay plan; onboarding and the primary play loop are complete, and Contests are the last major core-rulebook play subsystem without a runtime.
- **2026-08-20 — Reuse shared authority instead of building a contest engine fork.** Documents, journaled dice, idempotent operations, the presentation contract, item custody, settlement language, and campaign attention are extended, never duplicated.
- **2026-08-20 — Native variant scope is Standard, Supercontest, Festival, and Rotation.** Trainer Participant and Battle Contest variants are explicitly deferred; contracts must not preclude them, but blending trainer appeals or full combat into contests is a later decision.
- **2026-08-20 — Appeals never touch combat resources.** Canonical contest play ignores battle frequencies, so contest declarations must be structurally incapable of consuming encounter or sheet combat state.
- **2026-08-20 — Per-move contest identity requires reviewed canonical data.** Moves without source-backed contest types or effects fail closed as visible no-contest-identity rows; guessing, prose parsing, and web lookup are forbidden.
- **2026-08-20 — Replace the freeform `contestStats` string with structured authority.** Legacy text is preserved as description only and never converted into mechanics by inference.
- **2026-08-20 — Accept and archive Plan 10.** All 100 tickets, 777 Move rows, 44 integration rows, 34 rule rows, 18 deterministic variant scenarios, desktop/mobile liveplay, and the repository quality gate passed with zero blocked Contest rows or critical Contest debt; `data/contests/alpha-acceptance.v1.json` records the closure. The requested next-plan scope is registered for review at `implementation-plans/drafts/DEFERRED_MECHANICS_CLOSURE_PLAN.md` without activating an authoritative Plan 11 ledger.
- **2026-08-20 — GM-judgment rules become explicit guided decisions.** Experience significance multipliers, prize contents, and grooming latitude are visible reviewed settings or guided adjudications, never silent defaults presented as canon.
