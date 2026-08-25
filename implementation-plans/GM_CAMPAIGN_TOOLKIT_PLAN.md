# GM Campaign Toolkit Implementation Plan

`PLAN_STATUS: NOT_STARTED`

`CURRENT_TICKET: P12-001`

`BLOCKED_BY: OWNER_START_GATE`

`DEPENDS_ON: implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Owner start gate

This ledger was converted from the reviewed scope draft and registered in the authoritative plan table on 2026-08-25 **by explicit owner instruction that registration does not authorize implementation**. The owner start gate is a recorded blocker for the purposes of the autonomous-continuation rule in `AGENTS.md`:

- No ticket, migration, code change, or fixture in this plan may begin while `BLOCKED_BY: OWNER_START_GATE` is present.
- The gate is lifted only by the owner: replace `BLOCKED_BY: OWNER_START_GATE` with `BLOCKED_BY: NONE`, add a decision-log entry recording the start, and synchronize `implementation-plans/plan-order.md` and `AGENTS.md`.
- Until then, agents must treat this plan as registered but held, and must not count it as unfinished work that compels continuation.

## Goal

Turn Rotom Table's legacy JSON encounter-table and generation utilities into ordinary liveplay GM campaign authority, then close the remaining core Running the Game preparation gaps: wild encounter generation, NPC Trainer generation, and session preparation that flows directly into the existing Encounter Builder, live Encounter, settlement, and campaign-continuation authorities.

The toolkit prepares playable campaign work; it may not create a parallel rules engine, hidden generator-only sheets, or browser-authored mechanical outcomes.

## Product outcome

A GM can complete one coherent preparation-to-play journey:

1. Open a campaign preparation workspace and review current campaign authority, unresolved attention, recent locations, and reusable encounter material.
2. Select a reviewed encounter table or author a campaign-owned table with explicit environment, level, scale, and encounter constraints.
3. Ask the server to generate a deterministic, replayable wild encounter from app-owned reference identities and campaign-owned table rows.
4. Review exact generated Pokémon, legal moves and capabilities, group composition, placement intent, provenance, and any bounded GM choices before committing.
5. Generate an NPC Trainer package with a legal Trainer sheet, owned Pokémon roster, role-safe notes, and explicit reviewed generation policy.
6. Assemble generated and existing participants into the existing Encounter Builder rather than a generator-only staging model.
7. Save a session-preparation document containing scenes, encounters, handouts/notes, and unresolved decisions without leaking GM-private material to players.
8. Launch the prepared encounter through the ordinary map, Encounter Document, liveplay command, realtime, recovery, and settlement paths.
9. Retry, reconnect, restart, back up, restore, and correct generation or launch operations without duplicate sheets, maps, participants, rewards, or history.
10. Continue from settlement into current campaign attention and future preparation, with accepted facts—not copied names or prose—driving every handoff.

## Current baseline (activation-verified 2026-08-25)

Verified against the repository during draft conversion; the machine-readable inventory is `data/gm-campaign-toolkit/generation-preparation-footprint.v1.json` (SHA-256 `161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862`, 40 rows).

- Four legacy campaign tables exist under `encounter_tables/` (22 rows total). All rows are modern weighted objects (zero legacy cumulative-ceiling tuples), all species resolve against canonical `data/reference/pokedex.json`, and zero rows need repair or quarantine.
- Tables are file-backed under `campaignPath('encounter_tables')` through `server/utils/encounterTableStorage.ts` and `server/useCases/encounterTableLibrary.ts` — campaign-adjacent files, not campaign-database documents.
- `/api/encounters/generate` mirrors the `just encounter` recipe and spawns host-local `scripts/pokegen.sh`, which wraps `ptu-data/cli.py` — the documentary parser tree — writing `CharacterSheet` JSON files to an `outRoot`. Its own contract labels it a local-development/private-host tool. This violates both the liveplay-only rule and the documentary-data rule and must be retired.
- `server/utils/encounterGeneration.ts` carries in-production behaviors that must survive modernization: the `exploration` route-Repel authority and preview/rolled-echo exact-commit semantics. Incumbent bounds: count 1–30, default 3.
- The Workshop UI comprises `src/pages/encounter-tables.vue` plus 9 `EncounterGenerate*` and 10 `EncounterTable*` components; generation result surfaces are file-oriented.
- The campaign SQLite database is at storage schema version 50 with a contiguous versioned migration chain.
- Natures are app-owned runtime authority in `shared/ruleset/natures.ts` (canonical PTU nature chart already used by sheet derivation and onboarding).
- No NPC Trainer generation contract and no session-preparation document exist anywhere.
- Mature authorities to extend, not replace: Encounter Builder (`server/useCases/launchEncounterBuilder.ts`, `server/api/encounter-documents/`), Encounter Documents, map authority, sheets, liveplay commands, settlement, campaign attention, backup/restore, per-domain realtime modules, and exact-operation repositories.

## Scope

This plan owns:

- classification and reviewed final states for every footprint row: legacy tables, table storage seams, generation seams, pokegen tooling, generation UI, and the two absent surfaces;
- a strict versioned campaign encounter-table authority: schema, migration, repository, CRUD/import/export/archive, provenance, projections, and drift detection;
- server-authoritative journaled wild encounter generation producing ordinary migration-current Pokémon sheets through atomic package commits;
- NPC Trainer generation from campaign-owned archetype policies validated against canonical identities, committing atomic Trainer-plus-roster packages;
- a versioned, role-projected session-preparation document with lifecycle, repositories, operations, and realtime;
- typed immutable handoffs into the existing Encounter Builder and atomic liveplay launch;
- recovery, concurrency, correction, migration, backup/restore, and performance certification for all new authority;
- the production GM preparation workspace in the Workshop context with full accessibility acceptance;
- golden preparation-to-settlement campaigns, documentation, drift gates, and final acceptance.

## Explicit non-goals

- Supplement or setting-specific encounter packs as canonical bundled mechanics; campaign-authored content remains campaign data.
- Narrative generation, prose-written adventures, autonomous GM decisions, tactics engines, or AI-authored canonical facts.
- Public matchmaking, public authentication, multi-tenancy, federation, or public-service hardening.
- Replacing ordinary sheets, Encounter Documents, maps, liveplay commands, settlement, campaign attention, or realtime authority.
- A second Move, item, weapon, Skill Check, Contest, dice, persistence, or operation engine.
- Release versioning, release notes/tags, fan-content notice review, and release-boundary upgrade guarantees owned by prospective Plan 13.
- Runtime parsing of books, markdown, PDFs, websites, wikis, or parser output.

## Completion states for generation and preparation rows

Every footprint row must end in exactly one reviewed state:

- **Native** — the surface is served by new liveplay authority (built or rebuilt under this plan).
- **Migrated** — legacy data or semantics were carried into new authority through a reviewed deterministic transform with provenance.
- **Preserved** — an existing seam or behavior was retained intact inside the new authority (for example route-Repel, preview/rolled-echo).
- **Retired** — the row was removed after parity proof; no runtime path reaches it.
- **Documentary** — the row remains provenance material and is provably unreachable at runtime.
- **Blocked** — required canonical data or infrastructure is missing. Temporary work state; forbidden at final acceptance.

A row is not complete merely because new code exists beside it. Retirement requires proof that no runtime path, script, or recipe reaches the legacy behavior.

## Non-negotiable product rules

1. All mechanical identities and facts come from the app-owned canonical `data/reference/*.json` authorities (plus app-owned runtime rulesets such as `shared/ruleset/natures.ts`); table rows and preparation documents may select or constrain them but never override them.
2. Campaign-authored encounter tables and archetype policies are explicit user data, not canonical PTU reference sources.
3. The server owns generation randomness, legality, revisions, idempotency, and commits.
4. Preview is inert. No sheet, map, resource, operation, or realtime row exists until an accepted commit.
5. Exact retry returns the original result with no additional random draw or write; changed material conflicts.
6. Generated participants are ordinary migration-current sheets with ordinary ownership and lifecycle semantics.
7. Preparation and live Encounter authority remain separate documents joined by typed immutable handoffs.
8. GM-private plans, candidate pools, random journals, source hashes, and diagnostics never enter owner/public projections.
9. Launch commits all selected documents, sheets, map state, operations, and realtime rows atomically or not at all.
10. Every generated row and handler is registered, source-bound, drift-checked, and ends in a reviewed final state.
11. Local hosting remains deprecated; every workflow must function in production-build liveplay.
12. No scope row may be closed by silently downgrading a concrete core mechanic to prose or reference-only presentation.

## Activation decision record

The ten activation questions from the scope draft, resolved against repository evidence on 2026-08-25. The footprint artifact binds the observed sources.

1. **Legacy table dispositions.** All four tables (`spire-city/streets`, `thickerby_vale/{cave,forest,riverbank}`; 22 rows) are reviewed reusable campaign data: zero unknown species against canonical pokedex, zero legacy tuple rows, zero repair/quarantine/retirement rows. They migrate as campaign-owned table documents with provenance. The footprint's `legacyTableValidation` block is the proof.
2. **Schema v1 predicates.** Stable row identity; explicit weighted selection including a Nothing weight; species bound to canonical pokedex identity; per-row and per-table level bounds; environment tags aligned to the canonical `habitat` vocabulary; optional bounded time-of-day and weather predicates; a party-scale group-size policy; bounded GM-authored notes. Ceiling→weight conversion for any imported legacy tuple rows is a reviewed deterministic transform (P12-012). Campaign-state predicates (quest flags, story gates) are deferred to a later schema revision and recorded as such — they are authored constraints, not core mechanics, so deferral does not violate rule 12.
3. **File-oriented artifacts and preserved behaviors.** Compatibility artifacts: `pokegenBatch`/`pokegenRunner` CharacterSheet file outputs, `scripts/pokegen.sh`, the `just encounter` recipe, `generateEncounters` orchestration, and the host-spawn contract of `/api/encounters/generate`. Their no-loss migration is journaled server generation → inert preview → atomic commit into ordinary sheets and the Encounter Builder, with no filesystem outputs; the writers retire after parity (P12-036, P12-038). Preserved behaviors: the route-Repel `exploration` authority (P12-031) and preview/rolled-echo exact-commit semantics (P12-032).
4. **Wild legality policies.** Level: journaled uniform roll within row bounds. Experience: `pokemonExperienceChart.json`. Moves: canonical level-up lists at-or-below generated level under a bounded selection policy fixed in P12-026 fixtures. Abilities: canonical `basic`/`advanced`/`high` tiers under the reviewed rules bindings fixed in P12-027; absent or ambiguous canonical text fails closed. Gender: canonical `male_pct`/`female_pct`/`genderless`. Nature: journaled roll over the app-owned `PTU_NATURE_CHART`. Shiny: default 0% preserved from the incumbent generator, adjustable only by explicit bounded GM policy. Held items: only via explicit table or GM policy rows referencing canonical items. Group composition: table rows plus party-scale policy within table level bounds.
5. **NPC archetype inputs.** Structured enough for native generation: level, stat distribution, skills, Features/Edges validated through the existing creation/onboarding prerequisite authority, equipment and money from canonical items, and owned rosters through the wild-generation engine with ordinary ownership. No canonical NPC archetype table exists in reference data, so archetype policies are campaign-owned authored data referencing canonical identities and failing closed on unknowns. Guided GM review owns narrative identity, tactics, and any choice not determined by structured policy.
6. **Session preparation persistence.** A new versioned `sessionPreparation` document persisted through new storage migrations in the existing contiguous SQLite chain (continuing from version 50), owned by the existing campaign document repository and operation-journal families; the launch handoff commits through the existing Encounter Document initialize/launch use cases inside one shared transaction. No parallel storage authority.
7. **Projections and realtime.** GM-only: full preparation documents, candidate pools, random journals, receipts, source hashes, diagnostics. Owner-visible: committed sheets they own after launch, with ordinary ownership semantics. Public/player: player-safe summaries and ordinary launched-encounter projections only. Realtime uses the established per-domain module pattern with role-scoped invalidation payloads carrying document identity and revision only; launched encounters reuse existing Encounter Document events.
8. **Scale fixtures.** 200 campaign tables of up to 50 rows; generation requests up to the incumbent bound of 30 with budgets proven at 10 committed Pokémon per encounter; NPC packages of 1 Trainer plus 6 Pokémon; preparation documents with 20 scenes and 50 linked documents; 6 concurrent clients including 2 GM tabs. Budgets are fixed as fixtures in P12-008 and enforced in P12-081/P12-082.
9. **Database certification.** Fresh-install and upgrade-from-v50 (the Plan 11 closure baseline) through every migration this plan adds, plus the existing migration-chain contiguity guarantees for older versions. Full historical-matrix certification at the release boundary belongs to Plan 13.
10. **Ticket count and slice.** 96 tickets across 8 phases. The first playable vertical slice is gated at the Phase 6 exit (P12-070/P12-072) before NPC-wide and multi-scene acceptance completes in Phases 7–8; Phase 4 may not begin until the slice's generation path (Phases 2–3) is accepted.

## Target architecture

```text
app-owned canonical reference data + shared/ruleset natures
  -> campaign-owned encounter-table documents (schema v1, DB-backed, provenance)
  -> journaled server generation operation
       (seeded RNG journal, legality policies, Repel, preview/rolled-echo)
  -> inert preview -> atomic package commit
       (ordinary Pokémon / Trainer sheets, custody, receipts)
  -> session-preparation document (scenes, candidates, notes, projections)
  -> typed immutable handoff -> existing Encounter Builder
  -> shared-transaction revalidation -> atomic launch
       (Encounter Document + map + operations + realtime)
  -> ordinary liveplay -> settlement -> campaign attention and continuation
```

## First playable vertical slice

> The GM opens one reviewed forest encounter table, requests a seeded encounter for the current party, reviews a legal migration-current wild Pokémon group, commits it into the existing Encounter Builder, launches the ordinary live Encounter, reconnects a player client, finishes settlement, and sees the accepted result in campaign continuation. Exact retry creates no additional sheet, map, operation, random draw, reward, or realtime row.

The slice must be complete at the Phase 6 exit before widening to NPC Trainers and multi-scene session preparation acceptance.

## Plan update protocol

- Work tickets strictly in order within a phase; do not open a later phase before the earlier phase's exit gate passes.
- Update each ticket's status marker and `CURRENT_TICKET` as work proceeds; record evidence on the ticket when it completes.
- Keep `implementation-plans/plan-order.md` and `AGENTS.md` synchronized whenever ticket counts, current execution, dependencies, or plan status change.
- Follow the workspace validation discipline: focused tests during implementation, bounded workers, full suites only at integration milestones and closure.
- Record every material decision in the decision log.

## Progress snapshot

| Phase | Tickets | Done |
| --- | --- | ---: |
| 1 — Activation adoption, rubric, boundaries, fixtures | P12-001–P12-010 | 0/10 |
| 2 — Encounter-table authority | P12-011–P12-022 | 0/12 |
| 3 — Wild generation and Pokémon packages | P12-023–P12-038 | 0/16 |
| 4 — NPC Trainer generation | P12-039–P12-050 | 0/12 |
| 5 — Session-preparation documents | P12-051–P12-062 | 0/12 |
| 6 — Builder handoff and liveplay launch | P12-063–P12-072 | 0/10 |
| 7 — Recovery, migration, backup, concurrency, performance | P12-073–P12-084 | 0/12 |
| 8 — Workspace, accessibility, privacy, docs, final acceptance | P12-085–P12-096 | 0/12 |
| **Total** | | **0/96** |

## Tickets

### Phase 1 — Activation adoption, rubric, boundaries, and fixtures

- [ ] **P12-001 — Adopt and freeze the activation footprint** — `NOT_STARTED`
  - Verify `data/gm-campaign-toolkit/generation-preparation-footprint.v1.json` (40 rows, SHA-256 above) against the live repository; promote its generator into a checked script with a `--check` mode.
  - Register the footprint surfaces in a drift gate so silent changes to inventoried rows fail validation.
- [ ] **P12-002 — Define the generation and preparation completion rubric** — `NOT_STARTED`
  - Bind every footprint row to one reviewed final state from the completion-state vocabulary with a zero-gap rule.
  - Forbid closing any row by downgrading a concrete mechanic to prose or reference-only presentation.
- [ ] **P12-003 — Confirm canonical versus campaign-owned data boundaries** — `NOT_STARTED`
  - Record the canonical runtime sources (the fourteen `data/reference/*.json` files plus app-owned runtime rulesets) and the campaign-owned families (tables, archetype policies, preparation documents).
  - Specify fail-closed behavior for absent or ambiguous canonical identity everywhere the toolkit reads it.
- [ ] **P12-004 — Define preparation roles, privacy, and trust boundaries** — `NOT_STARTED`
  - Specify GM-only, owner-visible, and public projections for tables, generation, packages, and preparation documents per decision 7.
  - Specify role-scoped realtime invalidation payloads (document identity and revision only).
- [ ] **P12-005 — Create deterministic generation fixtures** — `NOT_STARTED`
  - Seeded RNG journals, fixture tables, and expected generated packages for exact replay assertions.
- [ ] **P12-006 — Create failure, concurrency, and recovery fixtures** — `NOT_STARTED`
  - Exact retry, changed-input conflict, stale revision, offline interruption, restart, reconnect, correction, cancellation, and concurrent-GM-tab matrices.
- [ ] **P12-007 — Define measurable GM UX success criteria** — `NOT_STARTED`
  - Preparation task-time targets, error-visibility requirements, and decision-anatomy conformance for the toolkit surfaces.
- [ ] **P12-008 — Fix scale fixtures and performance budgets** — `NOT_STARTED`
  - Encode decision 8's bounds (200×50 tables, 30-cap/10-budget generation, 1+6 NPC packages, 20/50 preparation documents, 6 clients) as enforceable fixtures.
- [ ] **P12-009 — Fix bounded generation legality policies as reviewed fixtures** — `NOT_STARTED`
  - Encode decision 4's move, ability, gender, nature, shiny, held-item, and group-composition policies with canonical bindings and fail-closed cases.
- [ ] **P12-010 — Register Plan 12 validation commands and drift gates** — `NOT_STARTED`
  - Add bounded check commands for footprint, rubric, and fixtures to the quality path without widening full-suite requirements.

### Phase 2 — Encounter-table authority

- [ ] **P12-011 — Define the campaign table document schema v1** — `NOT_STARTED`
  - Versioned document with stable row identity and decision 2's predicate set; strict parse with explanations.
- [ ] **P12-012 — Implement the deterministic legacy-normalization transform** — `NOT_STARTED`
  - Ceiling→weight conversion and entry normalization as a reviewed transform in the shared schema module; malformed rows fail closed with exact reasons.
- [ ] **P12-013 — Add table storage migrations and the campaign table repository** — `NOT_STARTED`
  - DB-backed documents with revision and idempotency semantics in the existing migration chain; no parallel store.
- [ ] **P12-014 — Migrate the four legacy tables with provenance** — `NOT_STARTED`
  - Reviewed migration binding source hashes from the footprint; migrated documents byte-equal to their normalized sources on re-export.
- [ ] **P12-015 — Implement table create, edit, copy, and archive operations** — `NOT_STARTED`
  - Revision-checked idempotent operations with receipts.
- [ ] **P12-016 — Implement table import and export** — `NOT_STARTED`
  - Strict validation, canonical species binding, and fail-closed unknown identities; exports carry schema version and provenance.
- [ ] **P12-017 — Implement table projections and realtime** — `NOT_STARTED`
  - Role-safe projections and role-scoped invalidation per P12-004.
- [ ] **P12-018 — Modernize the Workshop table library UI** — `NOT_STARTED`
  - Replace folder/file semantics with repository-backed library, search, and archival surfaces.
- [ ] **P12-019 — Modernize the table editor UI** — `NOT_STARTED`
  - Canonical species binding, predicate editing, weight preview, and validation explanations per the design authority.
- [ ] **P12-020 — Implement table drift detection** — `NOT_STARTED`
  - Deterministic re-validation of table rows against canonical identities; drift becomes visible campaign attention, never silent repair.
- [ ] **P12-021 — Retire the file-backed table seams** — `NOT_STARTED`
  - Remove `encounterTableStorage` file CRUD and the file library use case after parity proof; no runtime path reads `encounter_tables/`.
- [ ] **P12-022 — Table authority acceptance** — `NOT_STARTED`
  - Fixtures, multi-client convergence, migration proofs, and phase-exit evidence.

### Phase 3 — Wild generation and Pokémon packages

- [ ] **P12-023 — Define the journaled generation operation contract** — `NOT_STARTED`
  - Request, receipt, revision, idempotency, and conflict semantics for wild generation as an ordinary exact operation.
- [ ] **P12-024 — Implement server-owned seeded RNG journaling** — `NOT_STARTED`
  - Every draw journaled and replayable; the browser never rolls.
- [ ] **P12-025 — Implement candidate identity legality** — `NOT_STARTED`
  - Species, level, gender, nature, and shiny selection per the P12-009 policies with canonical bindings and fail-closed identity errors.
- [ ] **P12-026 — Implement move selection** — `NOT_STARTED`
  - Canonical level-up lists at-or-below generated level under the bounded policy; deterministic under the journal.
- [ ] **P12-027 — Implement ability assignment** — `NOT_STARTED`
  - Canonical `basic`/`advanced`/`high` tiers under the reviewed rules bindings; ambiguity fails closed.
- [ ] **P12-028 — Implement capabilities and skills initialization** — `NOT_STARTED`
  - Canonical pokedex capabilities and skill dice on the generated sheet.
- [ ] **P12-029 — Implement derived stats and resource initialization** — `NOT_STARTED`
  - Reuse existing sheet derivation for stats, combat state, and encounter resources; no generator-private dialects.
- [ ] **P12-030 — Implement group sizing and composition** — `NOT_STARTED`
  - Table rows plus party-scale policy within level bounds; journaled draws.
- [ ] **P12-031 — Preserve the route-Repel exploration authority** — `NOT_STARTED`
  - The `exploration` input's exact Trainer/clock semantics carry into the new operation with fixtures proving parity.
- [ ] **P12-032 — Implement inert preview and rolled-echo commit semantics** — `NOT_STARTED`
  - Previews create no durable rows; commits accept exactly the previewed rolls or conflict.
- [ ] **P12-033 — Implement atomic generated-package commit** — `NOT_STARTED`
  - Ordinary migration-current Pokémon sheets with custody, ownership, and no orphan rows; all-or-nothing.
- [ ] **P12-034 — Implement generation receipts and provenance projections** — `NOT_STARTED`
  - Reviewable receipts; GM-only diagnostics, journals, and source hashes per rule 8.
- [ ] **P12-035 — Implement exact retry and changed-input conflict** — `NOT_STARTED`
  - Retry returns the original result with zero additional draws or writes; changed inputs conflict deterministically.
- [ ] **P12-036 — Re-contract the generation API** — `NOT_STARTED`
  - `/api/encounters/generate` (or its successor route) fronts the journaled operation; host spawn and file writes removed.
- [ ] **P12-037 — Rebuild the generation Workshop UI** — `NOT_STARTED`
  - Preview→review→commit surfaces replacing file-result cards, per the design authority and decision anatomy.
- [ ] **P12-038 — Retire the pokegen seams and pass generation acceptance** — `NOT_STARTED`
  - Retire `pokegenBatch`, `pokegenRunner`, `scripts/pokegen.sh`, and the `just encounter` recipe after parity; run the Phase 3 fixture and multi-client acceptance.

### Phase 4 — NPC Trainer generation

- [ ] **P12-039 — Define the campaign-owned archetype policy schema** — `NOT_STARTED`
  - Versioned authored policies referencing only canonical identities; unknown references fail closed.
- [ ] **P12-040 — Define the NPC generation contract** — `NOT_STARTED`
  - Bounded inputs, journaled draws, guided-choice points, receipts, revision, and idempotency.
- [ ] **P12-041 — Implement Trainer level, stats, and skills generation** — `NOT_STARTED`
  - Per reviewed canonical rules bindings; deterministic under the journal.
- [ ] **P12-042 — Implement Features and Edges selection** — `NOT_STARTED`
  - Prerequisite validation through the existing creation/onboarding authority; no invented classes or mechanics.
- [ ] **P12-043 — Implement equipment and money generation** — `NOT_STARTED`
  - Canonical items with exact custody through existing inventory authority.
- [ ] **P12-044 — Implement owned-roster generation** — `NOT_STARTED`
  - Wild-generation engine plus ordinary ownership linking for the Trainer's Pokémon.
- [ ] **P12-045 — Implement atomic NPC package commit** — `NOT_STARTED`
  - Trainer plus roster in one commit with no orphan rows; all-or-nothing.
- [ ] **P12-046 — Implement guided GM review decisions** — `NOT_STARTED`
  - Narrative identity, tactics, and non-structured choices as explicit guided decisions in the shared decision anatomy.
- [ ] **P12-047 — Implement NPC receipts, projections, retry, and conflict** — `NOT_STARTED`
  - Same exactness guarantees as wild generation; GM-only diagnostics.
- [ ] **P12-048 — Build the NPC generation Workshop UI** — `NOT_STARTED`
  - Policy selection, preview, guided review, and commit surfaces.
- [ ] **P12-049 — Create NPC determinism and legality fixtures** — `NOT_STARTED`
  - Deterministic packages, prerequisite proofs, custody proofs.
- [ ] **P12-050 — NPC generation acceptance** — `NOT_STARTED`
  - Multi-client, recovery, and phase-exit evidence.

### Phase 5 — Session-preparation documents

- [ ] **P12-051 — Define the session-preparation document schema v1** — `NOT_STARTED`
  - Scenes, encounter candidates, linked sheets and maps, GM notes, player-safe summaries, unresolved decisions; versioned and strict.
- [ ] **P12-052 — Add preparation storage migrations, repository, and operations** — `NOT_STARTED`
  - Existing migration chain and operation-journal families; revision-checked idempotent mutations.
- [ ] **P12-053 — Implement the preparation lifecycle** — `NOT_STARTED`
  - Draft, review, ready, launched, archived, cancelled; a plan is never live authority.
- [ ] **P12-054 — Implement scene and candidate composition** — `NOT_STARTED`
  - Ordered scenes binding tables, generated packages, existing sheets, and maps by typed reference.
- [ ] **P12-055 — Implement notes, handouts, and player-safe summaries** — `NOT_STARTED`
  - Structural projection separation; client redaction is not authority.
- [ ] **P12-056 — Implement unresolved-decision and attention integration** — `NOT_STARTED`
  - Unresolved preparation decisions surface as campaign attention without leaking GM-private content.
- [ ] **P12-057 — Implement preparation realtime** — `NOT_STARTED`
  - Role-scoped invalidation per P12-004 through the established per-domain module pattern.
- [ ] **P12-058 — Build the preparation workspace UI** — `NOT_STARTED`
  - Workshop-context surfaces for composing, reviewing, and readying sessions.
- [ ] **P12-059 — Implement preparation reuse** — `NOT_STARTED`
  - Copy and import of scenes and candidates across sessions with provenance.
- [ ] **P12-060 — Implement archival and cancellation** — `NOT_STARTED`
  - History-preserving terminal states with receipts.
- [ ] **P12-061 — Create preparation fixtures** — `NOT_STARTED`
  - Lifecycle, projection, attention, and reuse fixtures.
- [ ] **P12-062 — Preparation acceptance** — `NOT_STARTED`
  - Multi-client, privacy, recovery, and phase-exit evidence.

### Phase 6 — Encounter Builder handoff and liveplay launch

- [ ] **P12-063 — Define the typed immutable handoff contract** — `NOT_STARTED`
  - Preparation and generated packages hand off to the Encounter Builder by typed reference; no copied prose authority.
- [ ] **P12-064 — Implement package assembly into the Builder** — `NOT_STARTED`
  - Participants, placement intent, and scene material enter the existing Builder model.
- [ ] **P12-065 — Implement shared-transaction revalidation** — `NOT_STARTED`
  - Every generated read revalidates inside the launch transaction; stale material conflicts.
- [ ] **P12-066 — Implement atomic launch commit** — `NOT_STARTED`
  - Documents, sheets, map state, operations, and realtime rows commit atomically or not at all.
- [ ] **P12-067 — Publish realtime only after commit** — `NOT_STARTED`
  - Failure paths leave no partial map, sheet, or document state; proofs in fixtures.
- [ ] **P12-068 — Preserve liveplay, correction, settlement, and continuation** — `NOT_STARTED`
  - Launched encounters behave as ordinary encounters end to end.
- [ ] **P12-069 — Link launched state back to preparation** — `NOT_STARTED`
  - The preparation document records the launch immutably without becoming live authority.
- [ ] **P12-070 — Implement the vertical-slice golden journey** — `NOT_STARTED`
  - Forest table → seeded generation → review → Builder commit → launch → player reconnect → settlement → continuation.
- [ ] **P12-071 — Create launch failure and rollback fixtures** — `NOT_STARTED`
  - Interrupted launches, conflicting revisions, and recovery with zero partial state.
- [ ] **P12-072 — Slice acceptance** — `NOT_STARTED`
  - Exact-retry no-duplication proofs across the whole slice; phase-exit evidence.

### Phase 7 — Recovery, migration, backup, concurrency, and performance

- [ ] **P12-073 — Certify fresh-database paths** — `NOT_STARTED`
  - All new schema on a fresh campaign database.
- [ ] **P12-074 — Certify upgrade from the version-50 baseline** — `NOT_STARTED`
  - Every migration this plan adds, from the Plan 11 closure baseline, with data-preservation proofs.
- [ ] **P12-075 — Run the exact-retry and conflict matrix** — `NOT_STARTED`
  - Tables, generation, NPC packages, preparation, and launch under P12-006 fixtures.
- [ ] **P12-076 — Run the stale-revision and concurrent-GM matrix** — `NOT_STARTED`
  - Two GM tabs and mixed-role concurrency without duplicate or lost authority.
- [ ] **P12-077 — Run offline, restart, and reconnect coverage** — `NOT_STARTED`
  - Interrupted operations resume or conflict exactly; clients converge.
- [ ] **P12-078 — Run correction and cancellation coverage** — `NOT_STARTED`
  - Bounded, receipt-backed corrections; journaled evidence never rewritten.
- [ ] **P12-079 — Certify backup and restore** — `NOT_STARTED`
  - Table, preparation, package, and launched states restore exactly.
- [ ] **P12-080 — Prove preview inertness at the storage layer** — `NOT_STARTED`
  - No durable rows from uncommitted generation anywhere in the database.
- [ ] **P12-081 — Enforce performance budgets** — `NOT_STARTED`
  - P12-008 budgets for library, generation, preparation, and launch at scale fixtures.
- [ ] **P12-082 — Prove realtime convergence at scale** — `NOT_STARTED`
  - Six clients with two GM tabs converge within budget.
- [ ] **P12-083 — Run storage integrity audits** — `NOT_STARTED`
  - No orphan sheets, dangling references, or custody drift across all toolkit families.
- [ ] **P12-084 — Phase certification** — `NOT_STARTED`
  - Machine-readable recovery/performance certification bound to fixture hashes.

### Phase 8 — Production workspace, accessibility, privacy, documentation, and final acceptance

- [ ] **P12-085 — Integrate preparation into Workshop navigation and continuation** — `NOT_STARTED`
  - Campaign navigation, attention surfaces, and continuation entry points.
- [ ] **P12-086 — Pass the design-system review** — `NOT_STARTED`
  - Tokens, semantic tables/cards, decision anatomy, reduced motion, approximately 44-pixel controls; `npm run check:encounter-design` for encounter-adjacent surfaces.
- [ ] **P12-087 — Pass keyboard and screen-reader acceptance** — `NOT_STARTED`
  - Focus restoration, announcement, and full keyboard operability across toolkit surfaces.
- [ ] **P12-088 — Pass mobile, zoom, and table-distance acceptance** — `NOT_STARTED`
  - Touch, reflow, and dense-campaign behavior on supported devices.
- [ ] **P12-089 — Pass the privacy audit** — `NOT_STARTED`
  - GM-private material provably absent from owner/public projections, realtime payloads, and exports.
- [ ] **P12-090 — Run golden preparation-to-settlement campaigns** — `NOT_STARTED`
  - Multi-scene preparation with wild and NPC encounters through settlement and continuation, multi-client.
- [ ] **P12-091 — Write GM documentation** — `NOT_STARTED`
  - Workflows, migration, recovery, backup/restore, and troubleshooting.
- [ ] **P12-092 — Write contributor documentation** — `NOT_STARTED`
  - Extension rules, canonical/campaign data boundaries, and drift-gate maintenance.
- [ ] **P12-093 — Prove footprint finality** — `NOT_STARTED`
  - Every footprint row in a reviewed final state; zero Blocked rows; drift gates green.
- [ ] **P12-094 — Pass full repository validation** — `NOT_STARTED`
  - Full test suite, typecheck, lint, production build, and quality gate under the bounded-worker discipline.
- [ ] **P12-095 — Pass desktop and mobile production liveplay acceptance** — `NOT_STARTED`
  - Golden journeys in production-build liveplay with traces and no critical usability defects.
- [ ] **P12-096 — Record final acceptance and archive the plan** — `NOT_STARTED`
  - Machine-readable final acceptance; archive to `implementation-plans/done/`; synchronize `plan-order.md` and `AGENTS.md`; draft and register the Plan 13 scope without activating it.

## Phase exit gates

### Phase 1 exit
- Footprint adopted and drift-gated; rubric, boundaries, roles, UX criteria, scale budgets, legality policies, and all fixture families exist as reviewed artifacts; P12-001–P12-010 `DONE`.

### Phase 2 exit
- Campaign table documents are the only table authority; the four legacy tables are migrated with provenance; file seams are retired; multi-client table acceptance passes; P12-011–P12-022 `DONE`.

### Phase 3 exit
- Journaled generation commits ordinary Pokémon sheets with preview inertness, exact retry, Repel parity, and no pokegen/file path anywhere; P12-023–P12-038 `DONE`.

### Phase 4 exit
- Atomic NPC Trainer packages with guided review and custody proofs; P12-039–P12-050 `DONE`.

### Phase 5 exit
- Preparation documents with lifecycle, projections, attention, and realtime; P12-051–P12-062 `DONE`.

### Phase 6 exit
- The first playable vertical slice passes end to end with atomic launch and exact-retry proofs; P12-063–P12-072 `DONE`.

### Phase 7 exit
- Fresh and upgraded databases, the full recovery matrix, backup/restore, preview inertness, and performance budgets certified; P12-073–P12-084 `DONE`.

### Phase 8 exit
- Workspace, accessibility, privacy, golden campaigns, documentation, footprint finality, full validation, and liveplay acceptance pass; P12-085–P12-096 `DONE`.

## Final definition of done

- All 96 tickets are `DONE` and every footprint row is in a reviewed final state with zero `Blocked` rows.
- The legacy generation path (file tables, pokegen, host spawn, `just encounter`) is retired with parity evidence, and preserved behaviors (Repel, preview/rolled-echo) have exact-parity fixtures.
- The vertical slice and golden preparation-to-settlement campaigns pass in production-build liveplay on desktop and mobile with traces.
- Full repository validation passes; final acceptance is recorded machine-readably; the plan is archived and both authoritative ledgers are synchronized; the Plan 13 scope draft is registered without activation.

## Decision log

- **2026-08-25 — Draft converted to numbered ledger.** The registered scope draft was reviewed against repository evidence, amended (seam behaviors, pokegen host-spawn, legality-list completeness, ceiling-transform, design gate), and converted. The activation footprint (`data/gm-campaign-toolkit/generation-preparation-footprint.v1.json`, SHA-256 `161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862`) and the ten-question decision record above are the activation evidence. Ticket count fixed at 96.
- **2026-08-25 — Owner start gate recorded.** By explicit owner instruction, registration does not authorize implementation. `BLOCKED_BY: OWNER_START_GATE` stands until the owner records an explicit start; the autonomous-continuation rule must not treat this plan as compelling work while the gate stands.
- **2026-08-25 — Natures source resolved.** Nature identities live in the app-owned runtime authority `shared/ruleset/natures.ts` (already consumed by sheet derivation and onboarding); no new canonical migration is required for nature rolls.
- **2026-08-25 — Campaign-state table predicates deferred.** Quest-flag/story-gate predicates are authored constraints, not core mechanics; schema v1 ships without them and records the deferral explicitly (decision 2).
