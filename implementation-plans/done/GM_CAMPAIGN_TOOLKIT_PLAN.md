# GM Campaign Toolkit Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: NONE`

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
| 1 — Activation adoption, rubric, boundaries, fixtures | P12-001–P12-010 | 10/10 |
| 2 — Encounter-table authority | P12-011–P12-022 | 12/12 |
| 3 — Wild generation and Pokémon packages | P12-023–P12-038 | 16/16 |
| 4 — NPC Trainer generation | P12-039–P12-050 | 12/12 |
| 5 — Session-preparation documents | P12-051–P12-062 | 12/12 |
| 6 — Builder handoff and liveplay launch | P12-063–P12-072 | 10/10 |
| 7 — Recovery, migration, backup, concurrency, performance | P12-073–P12-084 | 12/12 |
| 8 — Workspace, accessibility, privacy, docs, final acceptance | P12-085–P12-096 | 12/12 |
| **Total** | | **96/96** |

## Tickets

### Phase 1 — Activation adoption, rubric, boundaries, and fixtures

- [x] **P12-001 — Adopt and freeze the activation footprint** — `DONE`
  - Verify `data/gm-campaign-toolkit/generation-preparation-footprint.v1.json` (40 rows, SHA-256 above) against the live repository; promote its generator into a checked script with a `--check` mode.
  - Register the footprint surfaces in a drift gate so silent changes to inventoried rows fail validation.
  - Evidence: `scripts/generate_gm_campaign_toolkit_footprint.py`; `npm run check:gm-toolkit-footprint` passes against the 40-row activation hash.
- [x] **P12-002 — Define the generation and preparation completion rubric** — `DONE`
  - Bind every footprint row to one reviewed final state from the completion-state vocabulary with a zero-gap rule.
  - Forbid closing any row by downgrading a concrete mechanic to prose or reference-only presentation.
  - Evidence: `data/gm-campaign-toolkit/completion-rubric.v1.json` and the 40/40 target-state registry in `footprint-finality.v1.json`.
- [x] **P12-003 — Confirm canonical versus campaign-owned data boundaries** — `DONE`
  - Record the canonical runtime sources (the fourteen `data/reference/*.json` files plus app-owned runtime rulesets) and the campaign-owned families (tables, archetype policies, preparation documents).
  - Specify fail-closed behavior for absent or ambiguous canonical identity everywhere the toolkit reads it.
  - Evidence: `data/gm-campaign-toolkit/data-boundaries.v1.json`; the fixture checker enforces all fourteen reference files plus `PTU_NATURE_CHART` and documentary-read prohibition.
- [x] **P12-004 — Define preparation roles, privacy, and trust boundaries** — `DONE`
  - Specify GM-only, owner-visible, and public projections for tables, generation, packages, and preparation documents per decision 7.
  - Specify role-scoped realtime invalidation payloads (document identity and revision only).
  - Evidence: `data/gm-campaign-toolkit/role-projections.v1.json`, including structural audience fields and content-free realtime payload rules.
- [x] **P12-005 — Create deterministic generation fixtures** — `DONE`
  - Seeded RNG journals, fixture tables, and expected generated packages for exact replay assertions.
  - Evidence: `data/gm-campaign-toolkit/fixtures/deterministic-generation.v1.json` registers wild, Repel/Nothing, and 1+6 NPC deterministic fixtures.
- [x] **P12-006 — Create failure, concurrency, and recovery fixtures** — `DONE`
  - Exact retry, changed-input conflict, stale revision, offline interruption, restart, reconnect, correction, cancellation, and concurrent-GM-tab matrices.
  - Evidence: `data/gm-campaign-toolkit/fixtures/failure-recovery.v1.json` contains the complete ten-scenario matrix.
- [x] **P12-007 — Define measurable GM UX success criteria** — `DONE`
  - Preparation task-time targets, error-visibility requirements, and decision-anatomy conformance for the toolkit surfaces.
  - Evidence: `data/gm-campaign-toolkit/ux-success-criteria.v1.json`; target times, error limits, decision anatomy, keyboard, announcement, touch, and zoom requirements are fixed.
- [x] **P12-008 — Fix scale fixtures and performance budgets** — `DONE`
  - Encode decision 8's bounds (200×50 tables, 30-cap/10-budget generation, 1+6 NPC packages, 20/50 preparation documents, 6 clients) as enforceable fixtures.
  - Evidence: `data/gm-campaign-toolkit/performance-scale-budgets.v1.json`; `check_gm_campaign_toolkit.py` asserts the exact activation bounds.
- [x] **P12-009 — Fix bounded generation legality policies as reviewed fixtures** — `DONE`
  - Encode decision 4's move, ability, gender, nature, shiny, held-item, and group-composition policies with canonical bindings and fail-closed cases.
  - Evidence: `data/gm-campaign-toolkit/legality-policies.v1.json` binds every legality family and enumerates fail-closed cases.
- [x] **P12-010 — Register Plan 12 validation commands and drift gates** — `DONE`
  - Add bounded check commands for footprint, rubric, and fixtures to the quality path without widening full-suite requirements.
  - Evidence: package commands `check:gm-toolkit-footprint`, `check:gm-toolkit-fixtures`, `check:gm-campaign-toolkit`, and `check:gm-campaign-toolkit-complete`; the closure command is registered in `scripts/quality-gate.sh`.

### Phase 2 — Encounter-table authority

- [x] **P12-011 — Define the campaign table document schema v1** — `DONE`
  - Versioned document with stable row identity and decision 2's predicate set; strict parse with explanations.
  - Evidence: `shared/gmToolkit/encounterTables.ts` strictly parses stable IDs, canonical habitats/species, explicit Nothing, bounded levels/group policy/time/weather, provenance, lifecycle, and exact keys.
- [x] **P12-012 — Implement the deterministic legacy-normalization transform** — `DONE`
  - Ceiling→weight conversion and entry normalization as a reviewed transform in the shared schema module; malformed rows fail closed with exact reasons.
  - Evidence: the existing weighted/cumulative normalization remains green in `tests/shared/encounterTables.test.ts`, and the source-bound migration emits strict v1 rows deterministically.
- [x] **P12-013 — Add table storage migrations and the campaign table repository** — `DONE`
  - DB-backed documents with revision and idempotency semantics in the existing migration chain; no parallel store.
  - Evidence: migration v51 and `gmEncounterTableRepository.ts` provide SQLite documents, optimistic revisions, exact-operation receipts, and stored-column contradiction checks.
- [x] **P12-014 — Migrate the four legacy tables with provenance** — `DONE`
  - Reviewed migration binding source hashes from the footprint; migrated documents byte-equal to their normalized sources on re-export.
  - Evidence: `scripts/migrate_legacy_encounter_tables.py --check` reproduces `migrated-legacy-tables.v1.json` from all four exact activation hashes with 22 species rows and explicit Nothing rows.
- [x] **P12-015 — Implement table create, edit, copy, and archive operations** — `DONE`
  - Revision-checked idempotent operations with receipts.
  - Evidence: GM table use cases cover create/update/copy/archive/restore with server IDs/timestamps, exact retry, changed-input conflict, stale revision, and non-destructive archive.
- [x] **P12-016 — Implement table import and export** — `DONE`
  - Strict validation, canonical species binding, and fail-closed unknown identities; exports carry schema version and provenance.
  - Evidence: strict v1 envelopes, new campaign identity allocation, pinned source revision, and canonical parsing are covered by the focused table authority test.
- [x] **P12-017 — Implement table projections and realtime** — `DONE`
  - Role-safe projections and role-scoped invalidation per P12-004.
  - Evidence: GM-only APIs and `gmToolkitRealtime.ts` emit identity/revision-only invalidations; library projections omit rows, notes, provenance, hashes, and diagnostics.
- [x] **P12-018 — Modernize the Workshop table library UI** — `DONE`
  - Replace folder/file semantics with repository-backed library, search, and archival surfaces.
  - Evidence: `/encounter-tables` now presents Campaign Toolkit tabs, GM gating, repository search, habitat/level/status filters, selected-state cards, import, and responsive empty/loading/error states without filesystem language.
- [x] **P12-019 — Modernize the table editor UI** — `DONE`
  - Canonical species binding, predicate editing, weight preview, and validation explanations per the design authority.
  - Evidence: `EncounterToolkitTableEditor.vue` and `EncounterToolkitTableDetail.vue` expose bounded row/predicate/group editing, explicit Nothing, distribution preview, local validation, copy/import/export/archive, keyboard focus, and responsive layouts.
- [x] **P12-020 — Implement table drift detection** — `DONE`
  - Deterministic re-validation of table rows against canonical identities; drift becomes visible campaign attention, never silent repair.
  - Evidence: strict loads revalidate canonical identity; copy/import provenance pins source revision and reports current/changed/missing states through a deliberate GM warning with no automatic rewrite.
- [x] **P12-021 — Retire the file-backed table seams** — `DONE`
  - Remove `encounterTableStorage` file CRUD and the file library use case after parity proof; no runtime path reads `encounter_tables/`.
  - Evidence: filesystem handlers/use case/storage/file readers and obsolete tests were removed; server generation resolves migrated SQLite documents and browser helpers no longer use `import.meta.glob`.
- [x] **P12-022 — Table authority acceptance** — `DONE`
  - Fixtures, multi-client convergence, migration proofs, and phase-exit evidence.
  - Evidence: source-bound migration check, 12 focused schema/repository/multi-client/realtime tests, `npm run check:gm-campaign-toolkit`, and Nuxt typecheck pass; two simulated GM repositories converge and stale writes conflict.

### Phase 3 — Wild generation and Pokémon packages

- [x] **P12-023 — Define the journaled generation operation contract** — `DONE`
  - Request, receipt, revision, idempotency, and conflict semantics for wild generation as an ordinary exact operation.
  - Evidence: `shared/gmToolkit/generation.ts`, migration v52, and `gmWildGenerationRepository.ts` define strict preview/commit commands, immutable receipts, revisions, and operation conflicts.
- [x] **P12-024 — Implement server-owned seeded RNG journaling** — `DONE`
  - Every draw journaled and replayable; the browser never rolls.
  - Evidence: `seededRng.ts` uses server-secret-bound SHA-256 seeds, unbiased rejection sampling, and an accepted/rejected draw journal; the bound forest fixture replays byte-exactly.
- [x] **P12-025 — Implement candidate identity legality** — `DONE`
  - Species, level, gender, nature, and shiny selection per the P12-009 policies with canonical bindings and fail-closed identity errors.
  - Evidence: `wildPokemonConstruction.ts` binds species, level, gender, nature, shiny, Experience, and held items to app-owned authorities and fails closed on unknown identities.
- [x] **P12-026 — Implement move selection** — `DONE`
  - Canonical level-up lists at-or-below generated level under the bounded policy; deterministic under the journal.
  - Evidence: The latest-six unique canonical level-up policy is implemented and fixture-bound for Cutiefly, Weedle, Pineco, and Level-40 legality coverage.
- [x] **P12-027 — Implement ability assignment** — `DONE`
  - Canonical `basic`/`advanced`/`high` tiers under the reviewed rules bindings; ambiguity fails closed.
  - Evidence: Basic/advanced/high milestone assignment is journaled, canonical, ambiguity-closed, and covered at Levels 5 and 40.
- [x] **P12-028 — Implement capabilities and skills initialization** — `DONE`
  - Canonical pokedex capabilities and skill dice on the generated sheet.
  - Evidence: Canonical Pokédex capabilities and skill dice initialize ordinary `CharacterSheet` fields; focused tests verify both surfaces.
- [x] **P12-029 — Implement derived stats and resource initialization** — `DONE`
  - Reuse existing sheet derivation for stats, combat state, and encounter resources; no generator-private dialects.
  - Evidence: Existing stat budget, nature delta, sheet normalization, derived stat, and HP helpers initialize migration-current combat/resources without a private dialect.
- [x] **P12-030 — Implement group sizing and composition** — `DONE`
  - Table rows plus party-scale policy within level bounds; journaled draws.
  - Evidence: `wildGenerationEngine.ts` enforces table policy, explicit requested bounds, party-scale Trainer revisions, weighted Nothing, and journaled row/level draws.
- [x] **P12-031 — Preserve the route-Repel exploration authority** — `DONE`
  - The `exploration` input's exact Trainer/clock semantics carry into the new operation with fixtures proving parity.
  - Evidence: `routeRepel.ts` carries exact Trainer revision, campaign-clock revision, reviewed item-definition hash, duration, and level filtering with Repel/Nothing fixtures.
- [x] **P12-032 — Implement inert preview and rolled-echo commit semantics** — `DONE`
  - Previews create no durable rows; commits accept exactly the previewed rolls or conflict.
  - Evidence: Signed backup-safe preview tokens bind command, seed, table revision, candidates, and preview hash; storage assertions prove preview writes zero durable rows.
- [x] **P12-033 — Implement atomic generated-package commit** — `DONE`
  - Ordinary migration-current Pokémon sheets with custody, ownership, and no orphan rows; all-or-nothing.
  - Evidence: One SQLite transaction writes selected ordinary Pokémon sheets, package receipt, operation, and durable realtime rows; injected failures roll back all authority.
- [x] **P12-034 — Implement generation receipts and provenance projections** — `DONE`
  - Reviewable receipts; GM-only diagnostics, journals, and source hashes per rule 8.
  - Evidence: GM preview/receipt projections expose review facts while structural GM-only realtime carries document identity/revision only; source hashes and journals never enter player projections.
- [x] **P12-035 — Implement exact retry and changed-input conflict** — `DONE`
  - Retry returns the original result with zero additional draws or writes; changed inputs conflict deterministically.
  - Evidence: Accepted command hashes return the original receipt on exact retry after expiry with zero draws/writes/events; changed material deterministically conflicts.
- [x] **P12-036 — Re-contract the generation API** — `DONE`
  - `/api/encounters/generate` (or its successor route) fronts the journaled operation; host spawn and file writes removed.
  - Evidence: `/api/encounters/generate` is GM-only native liveplay preview/commit authority with no host process, output root, or filesystem write contract.
- [x] **P12-037 — Rebuild the generation Workshop UI** — `DONE`
  - Preview→review→commit surfaces replacing file-result cards, per the design authority and decision anatomy.
  - Evidence: `/generate` is rebuilt as the storyboard-labelled Campaign Toolkit preview→review→commit workspace with accessible states and no file/path/hash/journal diagnostics.
- [x] **P12-038 — Retire the pokegen seams and pass generation acceptance** — `DONE`
  - Retire `pokegenBatch`, `pokegenRunner`, `scripts/pokegen.sh`, and the `just encounter` recipe after parity; run the Phase 3 fixture and multi-client acceptance.
  - Evidence: Pokegen runner/batch/shell, host spawn route, browser-roll/file-result UI, and `just encounter` are removed; 42 focused tests, typecheck, toolkit drift gate, and encounter design check pass.

### Phase 4 — NPC Trainer generation

- [x] **P12-039 — Define the campaign-owned archetype policy schema** — `DONE`
  - Versioned authored policies referencing only canonical identities; unknown references fail closed.
  - Evidence: `npcArchetypes.ts`, the reviewed Field Researcher seed, migrations v54–v55, and `gmNpcArchetypeRepository.ts` provide strict canonical parsing, prerequisite validation, revision control, and campaign-owned persistence.
- [x] **P12-040 — Define the NPC generation contract** — `DONE`
  - Bounded inputs, journaled draws, guided-choice points, receipts, revision, and idempotency.
  - Evidence: `npcGeneration.ts`, `npcPreviewToken.ts`, `npcGenerationEngine.ts`, and `gmNpcGenerationRepository.ts` bind bounded preview/commit commands, signed replay authority, journals, receipts, and exact operations.
- [x] **P12-041 — Implement Trainer level, stats, and skills generation** — `DONE`
  - Per reviewed canonical rules bindings; deterministic under the journal.
  - Evidence: `npcTrainerConstruction.ts` reuses onboarding stat budgets, milestone allocation, background skill ranks, and ordinary Trainer derivation; exact Level-5 totals are fixture-bound.
- [x] **P12-042 — Implement Features and Edges selection** — `DONE`
  - Prerequisite validation through the existing creation/onboarding authority; no invented classes or mechanics.
  - Evidence: archetype parsing resolves catalog slots and validates Feature/Edge prerequisites through onboarding and edge automation before construction.
- [x] **P12-043 — Implement equipment and money generation** — `DONE`
  - Canonical items with exact custody through existing inventory authority.
  - Evidence: canonical item validation fails closed and constructs ordinary Trainer inventory sections and money; tests reject invented items and verify committed custody.
- [x] **P12-044 — Implement owned-roster generation** — `DONE`
  - Wild-generation engine plus ordinary ownership linking for the Trainer's Pokémon.
  - Evidence: exact-target roster assembly reuses journaled wild construction, honors Nothing rows within 30 bounded attempts, and commits `currentTeam` plus receipt-level owner links.
- [x] **P12-045 — Implement atomic NPC package commit** — `DONE`
  - Trainer plus roster in one commit with no orphan rows; all-or-nothing.
  - Evidence: `manageNpcGeneration.ts` writes one ordinary Trainer, up to six ordinary Pokémon, receipt, operation, and identity-only realtime rows in one shared transaction; injected interruption rolls all back.
- [x] **P12-046 — Implement guided GM review decisions** — `DONE`
  - Narrative identity, tactics, and non-structured choices as explicit guided decisions in the shared decision anatomy.
  - Evidence: strict name/identity/tactics/private-note inputs remain GM-private Trainer provenance and are reviewed explicitly in the inert preview UI.
- [x] **P12-047 — Implement NPC receipts, projections, retry, and conflict** — `DONE`
  - Same exactness guarantees as wild generation; GM-only diagnostics.
  - Evidence: signed preview reconstruction, immutable NPC package lookup, exact command hashing, changed-material conflict, restart-safe retry, GM-only routes, and identity/revision-only realtime are focused-test covered.
- [x] **P12-048 — Build the NPC generation Workshop UI** — `DONE`
  - Policy selection, preview, guided review, and commit surfaces.
  - Evidence: `/npc-trainers` and `useNpcGenerationToolkit.ts` provide the GM-only responsive policy/guidance setup, legal Trainer dossier, owned-roster review, explicit inertness, atomic commit, recovery, and accessible announcements. The resource-capped mockup renderer failed safely twice; implementation followed the recorded brief and normative design authority.
- [x] **P12-049 — Create NPC determinism and legality fixtures** — `DONE`
  - Deterministic packages, prerequisite proofs, custody proofs.
  - Evidence: `npc-one-plus-six` binds seed, preview/journal hashes, exact Trainer totals/skills, and six exact canonical Pokémon; toolkit drift checks and focused tests enforce it.
- [x] **P12-050 — NPC generation acceptance** — `DONE`
  - Multi-client, recovery, and phase-exit evidence.
  - Evidence: 16 focused generation/route/privacy tests plus 22 route/realtime checks pass with exact retry, changed-input/stale-revision failure, rollback, restart, two-GM convergence, source/custody assertions, Nuxt typecheck, toolkit checks, and encounter design check.

### Phase 5 — Session-preparation documents

- [x] **P12-051 — Define the session-preparation document schema v1** — `DONE`
  - Scenes, encounter candidates, linked sheets and maps, GM notes, player-safe summaries, unresolved decisions; versioned and strict.
  - Evidence: `sessionPreparation.ts` strictly bounds 20 scenes/50 links, typed source/map/sheet references, placement intent, safe/private text, handouts, decisions, launch evidence, provenance, and six lifecycle states.
- [x] **P12-052 — Add preparation storage migrations, repository, and operations** — `DONE`
  - Existing migration chain and operation-journal families; revision-checked idempotent mutations.
  - Evidence: storage v56, `gmSessionPreparationRepository.ts`, strict operation commands, stable command hashes, exact retry, and one-revision optimistic replacement extend the campaign SQLite chain.
- [x] **P12-053 — Implement the preparation lifecycle** — `DONE`
  - Draft, review, ready, launched, archived, cancelled; a plan is never live authority.
  - Evidence: explicit transition matrix, readiness assertions, edit locks, terminal history, and launch-evidence constraints prevent preparation state from impersonating live Encounter authority.
- [x] **P12-054 — Implement scene and candidate composition** — `DONE`
  - Ordered scenes binding tables, generated packages, existing sheets, and maps by typed reference.
  - Evidence: strict typed source unions plus shared-transaction existence/revision checks bind active tables, immutable wild/NPC packages, ordinary sheets, and maps; the responsive editor orders and reviews sources without showing raw IDs.
- [x] **P12-055 — Implement notes, handouts, and player-safe summaries** — `DONE`
  - Structural projection separation; client redaction is not authority.
  - Evidence: server projectors make non-launched preparations unprojectable publicly and construct launched/archived views from only explicit safe fields and on-launch text handouts; tests prove private fields structurally absent.
- [x] **P12-056 — Implement unresolved-decision and attention integration** — `DONE`
  - Unresolved preparation decisions surface as campaign attention without leaking GM-private content.
  - Evidence: `sessionPreparationDetector.ts` adds hash-identified GM-only attention with safe generic labels/actions; the additive campaign-attention successor edge is source-bound and tests prove prompts/notes absent.
- [x] **P12-057 — Implement preparation realtime** — `DONE`
  - Role-scoped invalidation per P12-004 through the established per-domain module pattern.
  - Evidence: GM-only mutation/list/detail routes publish only preparation identity and revision after commit, publish nothing on retry/failure, and the workspace handles cross-tab invalidation/conflict.
- [x] **P12-058 — Build the preparation workspace UI** — `DONE`
  - Workshop-context surfaces for composing, reviewing, and readying sessions.
  - Evidence: `/session-prep` provides searchable lifecycle library, safe/private overview and scene fields, maps/candidates, decisions, handouts, exact readiness reasons, keyboard-sized controls, responsive collapse, and accessible announcements. The selected target is `session-preparation-workspace/v003.png` (9/10).
- [x] **P12-059 — Implement preparation reuse** — `DONE`
  - Copy and import of scenes and candidates across sessions with provenance.
  - Evidence: exact copy pins source revision/provenance; scene import pins source revision and deterministically remaps scene/candidate identities, with UI import and focused collision tests.
- [x] **P12-060 — Implement archival and cancellation** — `DONE`
  - History-preserving terminal states with receipts.
  - Evidence: lifecycle-checked archive/cancel operations advance revision, retain complete documents and receipts, and forbid terminal mutation/copy with explicit recovery messages.
- [x] **P12-061 — Create preparation fixtures** — `DONE`
  - Lifecycle, projection, attention, and reuse fixtures.
  - Evidence: `fixtures/session-preparation.v1.json` binds the forest scene, readiness blockers, attention, privacy, copy revision, and imported-identity behavior in the toolkit drift gate.
- [x] **P12-062 — Preparation acceptance** — `DONE`
  - Multi-client, privacy, recovery, and phase-exit evidence.
  - Evidence: 99 focused preparation, route, campaign-attention, successor, realtime, and API tests pass with stale reference/rollback, exact retry, restart, two-GM convergence, structural privacy, lifecycle/reuse, Nuxt typecheck, toolkit checks, and encounter design check.

### Phase 6 — Encounter Builder handoff and liveplay launch

- [x] **P12-063 — Define the typed immutable handoff contract** — `DONE`
  - Preparation and generated packages hand off to the Encounter Builder by typed reference; no copied prose authority.
  - Evidence: Builder schema v2 now has one strict wild/NPC/preparation handoff union and a GM-only server-resolved projection; preparation prose is re-resolved and exact-matched inside launch rather than trusted from the browser.
- [x] **P12-064 — Implement package assembly into the Builder** — `DONE`
  - Participants, placement intent, and scene material enter the existing Builder model.
  - Evidence: `encounterBuilderHandoff.ts` assembles ordinary Trainer/Pokémon refs from direct packages or selected scene candidates, fails table-only sources closed, deduplicates and bounds cast, carries placement intent, pins maps, and presents scene material through the rebuilt source receipt UI.
- [x] **P12-065 — Implement shared-transaction revalidation** — `DONE`
  - Every generated read revalidates inside the launch transaction; stale material conflicts.
  - Evidence: package receipts, preparation lifecycle/revision/scene, selected sources, every ordinary sheet revision, prepared map revision, cast membership, and locked story are resolved again in the shared SQLite launch transaction; focused tests cover stale source families.
- [x] **P12-066 — Implement atomic launch commit** — `DONE`
  - Documents, sheets, map state, operations, and realtime rows commit atomically or not at all.
  - Evidence: the existing queued shared transaction now commits deterministic placements on the ordinary map, active Encounter Document, launch receipt, live interaction mode, linked preparation evidence/operation, and persisted realtime rows together; generated sheets remain ordinary precommitted authority.
- [x] **P12-067 — Publish realtime only after commit** — `DONE`
  - Failure paths leave no partial map, sheet, or document state; proofs in fixtures.
  - Evidence: persisted event publication and identity-only preparation invalidation occur only after transaction return; injection after the linked preparation write proves zero map/document/mode/receipt/preparation/event residue.
- [x] **P12-068 — Preserve liveplay, correction, settlement, and continuation** — `DONE`
  - Launched encounters behave as ordinary encounters end to end.
  - Evidence: the golden focused test reconnects through the ordinary workspace projection, resolves ordinary Director story/objective state, prepares and commits ordinary settlement, resets the map, exposes completed continuation summary, and exact-retries settlement.
- [x] **P12-069 — Link launched state back to preparation** — `DONE`
  - The preparation document records the launch immutably without becoming live authority.
  - Evidence: launch advances the ready preparation exactly once to `launched`, appends source scene/encounter/map/time evidence, and records a source-hash-bound `record-launch` operation in the same transaction; subsequent scenes can use the new revision while launched scenes fail closed.
- [x] **P12-070 — Implement the vertical-slice golden journey** — `DONE`
  - Forest table → seeded generation → review → Builder commit → launch → player reconnect → settlement → continuation.
  - Evidence: `encounterBuilderHandoff.test.ts` and `builder-launch.v1.json` bind the canonical forest source through committed package, Ready scene, player-visible ordinary workspace, Director resolution, settlement, continuation, and exact retries without a parallel engine.
- [x] **P12-071 — Create launch failure and rollback fixtures** — `DONE`
  - Interrupted launches, conflicting revisions, and recovery with zero partial state.
  - Evidence: `builder-launch.v1.json` and the expanded failure matrix bind stale preparation/package-sheet/map/story inputs and interrupted linked writes to 409/complete rollback with zero added authority.
- [x] **P12-072 — Slice acceptance** — `DONE`
  - Exact-retry no-duplication proofs across the whole slice; phase-exit evidence.
  - Evidence: 23 focused contract, route, handoff, launch, rollback, privacy, client, settlement, and retry checks pass; Nuxt typecheck and the 14-document toolkit drift gate pass. `encounter-builder-handoff/v001.png` passes autonomous review at 9/10.

### Phase 7 — Recovery, migration, backup, concurrency, and performance

- [x] **P12-073 — Certify fresh-database paths** — `DONE`
  - All new schema on a fresh campaign database.
  - Evidence: `gmCampaignToolkitStorageMigrations.test.ts` applies all 56 contiguous migrations to an empty SQLite campaign and verifies every v51–v56 authority, seed, secret, and foreign key.
- [x] **P12-074 — Certify upgrade from the version-50 baseline** — `DONE`
  - Every migration this plan adds, from the Plan 11 closure baseline, with data-preservation proofs.
  - Evidence: exact v50 ordinary map/sheet bytes survive [51–56], historical heads v51–v55 apply only successors once, v56 reopening is inert, and future v57 is refused before writes.
- [x] **P12-075 — Run the exact-retry and conflict matrix** — `DONE`
  - Tables, generation, NPC packages, preparation, and launch under P12-006 fixtures.
  - Evidence: the 45-test authority matrix proves same receipts/zero added authority and changed-material 409 behavior across all five domains.
- [x] **P12-076 — Run the stale-revision and concurrent-GM matrix** — `DONE`
  - Two GM tabs and mixed-role concurrency without duplicate or lost authority.
  - Evidence: focused authority, route, and realtime suites admit one command per revision, conflict stale peers, structurally deny non-GM toolkit reads, and retain zero lost updates.
- [x] **P12-077 — Run offline, restart, and reconnect coverage** — `DONE`
  - Interrupted operations resume or conflict exactly; clients converge.
  - Evidence: signed previews and receipts recover after restart, uncertain delivery exact-retries, backup reopening adds no migration, player workspace reconnect sees ordinary launch authority, and six clients converge.
- [x] **P12-078 — Run correction and cancellation coverage** — `DONE`
  - Bounded, receipt-backed corrections; journaled evidence never rewritten.
  - Evidence: ordinary Director/settlement correction operates after launch, preparation cancellation/archive retains history, and corrected sheet revisions conflict without changing generation journals or receipts.
- [x] **P12-079 — Certify backup and restore** — `DONE`
  - Table, preparation, package, and launched states restore exactly.
  - Evidence: SQLite online backup restores table, package, sheets, launched preparation, launch operation, map, Encounter Document, and signing secret exactly with zero integrity/FK errors.
- [x] **P12-080 — Prove preview inertness at the storage layer** — `DONE`
  - No durable rows from uncommitted generation anywhere in the database.
  - Evidence: maximum wild and 1+6 NPC previews add zero sheet, operation, package, preparation, Encounter, launch, or realtime rows and no preview-token column.
- [x] **P12-081 — Enforce performance budgets** — `DONE`
  - P12-008 budgets for library, generation, preparation, and launch at scale fixtures.
  - Evidence: the one-worker scale test passes every latency/payload budget at 200×50 tables, 30 draws/10 commits, NPC 1+6, 20 scenes/50 links, and atomic launch.
- [x] **P12-082 — Prove realtime convergence at scale** — `DONE`
  - Six clients with two GM tabs converge within budget.
  - Evidence: six bounded clients reach one durable event head within 1.5 seconds; role-route tests keep private invalidations content-free and unavailable to players.
- [x] **P12-083 — Run storage integrity audits** — `DONE`
  - No orphan sheets, dangling references, or custody drift across all toolkit families.
  - Evidence: read-only `audit:gm-toolkit-storage` checks SQLite/FKs, operation/package pairing, sheet receipts, NPC custody, typed preparation links, launch evidence/operations, and signing authority; injected orphan damage fails.
- [x] **P12-084 — Phase certification** — `DONE`
  - Machine-readable recovery/performance certification bound to fixture hashes.
  - Evidence: `recovery-performance-certification.v1.json` binds all matrices, scale budget, runtime/evidence hashes, and 12/12 outcomes; four certification checks and the 15-document gate pass.

### Phase 8 — Production workspace, accessibility, privacy, documentation, and final acceptance

- [x] **P12-085 — Integrate preparation into Workshop navigation and continuation** — `DONE`
  - Campaign navigation, attention surfaces, and continuation entry points.
  - Evidence: the GM-only primary navigation and Campaign dashboard now expose one Campaign Toolkit destination; continuation structurally projects the earliest Ready or partially launched preparation with remaining scenes only to GMs and deep-links its exact preparation, while players receive neither the card nor the route link.
- [x] **P12-086 — Pass the design-system review** — `DONE`
  - Tokens, semantic tables/cards, decision anatomy, reduced motion, approximately 44-pixel controls; `npm run check:encounter-design` for encounter-adjacent surfaces.
  - Evidence: the reviewed 9/10 continuation, NPC, preparation, and Builder target-state artifacts govern the matte Workshop surfaces; all toolkit controls, chips, radio focus, summaries, and destructive actions were normalized to the semantic token language and 44-pixel target floor. Four focused accessibility/design checks and `npm run check:encounter-design` pass.
- [x] **P12-087 — Pass keyboard and screen-reader acceptance** — `DONE`
  - Focus restoration, announcement, and full keyboard operability across toolkit surfaces.
  - Evidence: the production-build Playwright journey keyboard-navigates generation, NPC review, preparation readying, and the immutable Builder handoff; verifies focus restoration and live status copy; and reports zero serious/critical Axe findings. The focused source acceptance covers all four toolkit surfaces, object-specific names, visible focus, alerts, and polite announcements (4/4 checks).
- [x] **P12-088 — Pass mobile, zoom, and table-distance acceptance** — `DONE`
  - Touch, reflow, and dense-campaign behavior on supported devices.
  - Evidence: the same production journey passes on Desktop Chrome and Pixel 7 across a six-member roster and three-scene preparation (6/6 projects/tests), with reviewed full-page screenshots and traces. Every tested primary target meets the 44-pixel floor, no horizontal overflow occurs on supported mobile, and the Builder reflows without clipping at 320 CSS pixels and the 160-pixel 200%-zoom equivalent.
- [x] **P12-089 — Pass the privacy audit** — `DONE`
  - GM-private material provably absent from owner/public projections, realtime payloads, and exports.
  - Evidence: the structural audit checks all 18 table/package/handoff/generation/preparation routes for authorization before reads or writes; proves the launched public preparation omits private prose, candidate pools, decisions, maps, provenance, and launch receipts; enforces identity/revision-only GM realtime and GM-only generated-sheet events; and proves no package, preparation, journal, or diagnostics export exists. Twenty-two focused audit/route/realtime checks and both production browser role projections pass.
- [x] **P12-090 — Run golden preparation-to-settlement campaigns** — `DONE`
  - Multi-scene preparation with wild and NPC encounters through settlement and continuation, multi-client.
  - Evidence: the golden server campaign commits a wild package and an NPC Trainer-plus-roster package, binds them to two typed scenes and two maps, launches each through the ordinary Builder transaction, resolves ordinary Director story/objective authority, settles both encounters, advances immutable preparation evidence between scenes, and converges completed continuation/workspace projections for two GM and four player clients. Private root, scene, placement, and handout prose is absent from every client summary; the focused golden run passes.
- [x] **P12-091 — Write GM documentation** — `DONE`
  - Workflows, migration, recovery, backup/restore, and troubleshooting.
  - Evidence: `docs/gm-campaign-toolkit/gm-guide.md` documents private table→generation/NPC→preparation→Builder→ordinary settlement workflows, exact retry/concurrency, contiguous v51–v56 migration, retired seams, SQLite/WAL-safe backup and restored-storage audit, and fail-closed troubleshooting. The docs index, current schema guide, and VPS backup runbook are synchronized; nine focused documentation/link checks pass.
- [x] **P12-092 — Write contributor documentation** — `DONE`
  - Extension rules, canonical/campaign data boundaries, and drift-gate maintenance.
  - Evidence: `docs/gm-campaign-toolkit/contributor-guide.md` maps all fifteen canonical runtime authorities, documentary exclusions, campaign-owned families, existing runtime/storage owners, and strict extension rules for tables, wild/NPC generation, preparations, Builder, privacy/realtime, migrations, and UI. It documents the immutable footprint hash, source-bound legacy migration, fixture/finality commands, review-safe regeneration, focused tests, and a closure checklist; the Toolkit docs index and six focused boundary/link/command checks pass.
- [x] **P12-093 — Prove footprint finality** — `DONE`
  - Every footprint row in a reviewed final state; zero Blocked rows; drift gates green.
  - Evidence: `footprint-finality.v1.json` is accepted against P12-093 with the immutable 40-row activation SHA-256 intact, 40/40 exact row-key matches, 20 Native, 4 Migrated, 5 Preserved, 10 Retired, 1 Documentary, and zero Pending/Blocked rows. The final checker now requires owned proof, existing successor authority, active reachability, physical absence of retired activation sources, exact computed summary, and acceptance metadata; the obsolete file-table campaign path, eleven superseded auto-discovered components, browser-random table helpers, dead composables, and their compatibility tests were removed. `gmCampaignToolkitFootprintFinality` plus campaign-path coverage passes 7 tests, `--check-final` passes, foundation/migration checks pass 15 and 4/4, the golden Builder hash was revalidated, and Nuxt typecheck passes.
- [x] **P12-094 — Pass full repository validation** — `DONE`
  - Full test suite, typecheck, lint, production build, and quality gate under the bounded-worker discipline.
  - Evidence: the bounded full repository gate passes all semantic, canonical, migration, drift, privacy, accessibility, performance, type, Nuxt, Vitest, Playwright, and production-build stages. Lint reports zero errors; the full two-project browser matrix passes 97 tests with one intentional skip.
- [x] **P12-095 — Pass desktop and mobile production liveplay acceptance** — `DONE`
  - Golden journeys in production-build liveplay with traces and no critical usability defects.
  - Evidence: `production-liveplay-acceptance.v1.json` binds six traced one-worker desktop/mobile journeys, six reviewed screenshots, zero failed tests, zero critical usability defects, zero serious/critical Axe findings, no overflow, 44-pixel targets, keyboard/focus acceptance, structural player denial, and immutable Builder handoff.
- [x] **P12-096 — Record final acceptance and archive the plan** — `DONE`
  - Machine-readable final acceptance; archive to `implementation-plans/done/`; synchronize `plan-order.md` and `AGENTS.md`; draft and register the Plan 13 scope without activating it.
  - Evidence: `final-acceptance.v1.json` records 96/96 tickets and 40/40 final footprint rows, this ledger is archived under `implementation-plans/done/`, both authoritative indexes are synchronized, and `drafts/RELEASE_READINESS_PLAN.md` is registered for review with no numbered ledger, activation, or execution obligation.

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
- **2026-08-25 — Owner start recorded.** The owner's instruction to complete this ledger explicitly authorizes Plan 12 execution. The owner start gate is lifted, `BLOCKED_BY` is `NONE`, and work begins at P12-001 in dependency order.
- **2026-08-25 — Natures source resolved.** Nature identities live in the app-owned runtime authority `shared/ruleset/natures.ts` (already consumed by sheet derivation and onboarding); no new canonical migration is required for nature rolls.
- **2026-08-25 — Campaign-state table predicates deferred.** Quest-flag/story-gate predicates are authored constraints, not core mechanics; schema v1 ships without them and records the deferral explicitly (decision 2).
- **2026-08-25 — Phase 1 accepted.** The immutable 40-row activation footprint was live-verified at its recorded SHA-256; zero-gap dispositions, source/trust boundaries, deterministic/recovery/UX/scale/legality fixtures, and bounded quality commands are reviewed and green. Phase 2 opens at P12-011.
- **2026-08-25 — Phase 2 accepted.** Strict table schema v1, exact source-hash migration, SQLite repository and receipts, GM-only projection/realtime, the repository-backed Campaign Toolkit table library/editor, pinned source drift, and full filesystem-table retirement passed focused migration, multi-client, realtime, and typecheck evidence. Phase 3 opens at P12-023.
- **2026-08-25 — Phase 3 accepted.** Server-secret-bound journaled generation now produces canonical, migration-current ordinary Pokémon sheets through inert previews and atomic package commits; route Repel and party scaling are preserved, exact retries are write/draw/event-free, identity-only realtime is GM-scoped, and all pokegen, host-spawn, file-result, browser-roll, and `just encounter` seams are retired. Forty-two focused tests, Nuxt typecheck, toolkit drift checks, and encounter design checks pass. Phase 4 opens at P12-039.
- **2026-08-25 — Phase 4 accepted.** Strict campaign-owned archetypes now reuse onboarding legality and native wild construction to produce deterministic ordinary Trainer-plus-owned-roster packages. Guided GM decisions remain structurally private; inert previews, atomic commits, identity-only realtime, exact retries, changed-material conflicts, interruption rollback, restart recovery, and two-GM convergence pass focused acceptance. The NPC Workshop is responsive and keyboard-addressable; the renderer timeout was subsequently raised to ten minutes and `npc-trainer-generation/v005.png` passed autonomous review at 9/10. Phase 5 opens at P12-051.
- **2026-08-25 — Phase 5 accepted.** Versioned session preparations now compose typed campaign sources across strict draft/review/ready/launch/terminal boundaries without becoming live authority. Structural public projection, GM-only attention/realtime, exact operations, source-revision reuse, restart/two-GM recovery, and the responsive three-region Workshop pass focused acceptance. `session-preparation-workspace/v003.png` passes autonomous review at 9/10 after the renderer timeout was raised to ten minutes. Phase 6 opens at P12-063.
- **2026-08-26 — Phase 6 accepted.** Direct wild/NPC packages and Ready scenes now resolve through one typed immutable Builder handoff. Launch revalidates all source authority in the shared transaction, atomically records map/Encounter/operation/realtime/preparation authority, exact-retries without duplication, and rolls back injected linked-write failures completely. The forest slice reconnects, corrects, settles, and continues through ordinary engines. `encounter-builder-handoff/v001.png` passes autonomous review at 9/10. Phase 7 opens at P12-073.
- **2026-08-26 — Phase 7 accepted.** Fresh and exact v50 upgrades, retry/concurrency/restart/correction matrices, online backup/restore, storage-level preview inertness, reviewed scale budgets, six-client convergence, and read-only integrity auditing are machine-certified with source hashes. Seventy-one focused checks pass in bounded one-worker runs, and the 15-document toolkit drift gate is green. Phase 8 opens at P12-085.
- **2026-08-26 — Keyboard, assistive-technology, and responsive acceptance passed.** Production-build desktop and Pixel 7 journeys now cover keyboard-only preview/review/ready/Builder flow, deterministic focus restoration, polite status, Axe WCAG A/AA checks, 44-pixel targets, dense six-roster/three-scene reflow, and no overflow through the 160-CSS-pixel 200%-zoom equivalent. Reactive preparation cloning, disabled-select names, excluded-candidate contrast, and visually hidden Builder radio overflow were corrected from traced browser evidence. Phase 8 continues at P12-089.
- **2026-08-26 — Footprint finality accepted.** The immutable 40-row activation inventory closes with 20 Native, 4 Migrated, 5 Preserved, 10 Retired, 1 Documentary, and zero Pending or Blocked rows. Retired filesystem, host-process, and browser-authority seams are physically absent or unreachable; P12-094 opens only after finality and drift checks pass.
- **2026-08-26 — Full repository and production liveplay acceptance passed.** Bounded type, lint, Nuxt, Vitest, Playwright, semantic, drift, privacy, accessibility, performance, migration, quality-gate, and production-build validation is green. The complete desktop/mobile browser matrix passes 97 tests with one intentional skip, while the dedicated six-journey Toolkit record retains traces, reviewed screenshots, and zero critical usability defects.
- **2026-08-26 — Plan 12 final acceptance recorded.** All 96 tickets and all eight phases are accepted. `data/gm-campaign-toolkit/final-acceptance.v1.json` binds the delivered authority and closure evidence; this ledger is archived, the authoritative indexes are synchronized, and the registered Plan 13 release-readiness draft remains unnumbered, inactive, and non-obligating.
