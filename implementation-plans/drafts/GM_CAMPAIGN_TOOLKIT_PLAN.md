# GM Campaign Toolkit — Draft Scope

`DRAFT_STATUS: REGISTERED_FOR_REVIEW`

`PROSPECTIVE_ORDER: 12`

`EXECUTION_AUTHORITY: NONE`

`ACTIVATION_REQUIRES: reviewed numbered ledger and registration in implementation-plans/plan-order.md authoritative plan table`

`DEPENDS_ON: implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Registration boundary

This file records the prospective Plan 12 scope requested by P11-092 and the `plan-order.md` 1.0 release definition. It is **not an active implementation ledger**, has no numbered tickets, and creates no autonomous execution obligation. Work begins only after repository evidence review resolves the activation questions below, this draft is converted into a numbered ledger, and that ledger is registered in the authoritative plan table.

## Goal

Turn Rotom Table's legacy JSON encounter-table and generation utilities into ordinary liveplay GM campaign authority, then close the remaining core Running the Game preparation gaps: wild encounter generation, NPC Trainer generation, and session preparation that flows directly into the existing Encounter Builder, live Encounter, settlement, and campaign-continuation authorities.

The toolkit must prepare playable campaign work; it may not create a parallel rules engine, hidden generator-only sheets, or browser-authored mechanical outcomes.

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

## Repository baseline to verify at activation

- `encounter_tables/` contains legacy region/table JSON owned as campaign/tooling material rather than canonical PTU runtime reference data.
- `shared/encounterTables.ts`, `server/useCases/encounterTableLibrary.ts`, `server/utils/encounterGeneration.ts`, and `/api/encounters/generate` already provide table-library and generation seams that must be audited before reuse.
- `src/pages/encounter-tables.vue` and its `EncounterGenerate*` components expose a Workshop flow, but generated output and file-oriented handling must be reconciled with liveplay-only authority.
- The current Encounter Builder, Encounter Documents, map authority, sheets, liveplay commands, settlement, campaign attention, backup/restore, and exact-operation repositories are mature authorities to extend, not replace.
- No reviewed native NPC Trainer generation contract or durable session-preparation document is currently registered.
- Plan 11 closes the Move, weapon, item, Skill Check, and Contest catalogs that generated participants may consume.

These are draft observations, not final debt counts. Activation must replace them with a machine-readable footprint and exact current-source hashes.

## Scope commitments

### 1. Generation footprint and authority policy

- Inventory every encounter-table, encounter-generation, NPC-template, Encounter Builder, session-preparation, and generated-file path.
- Classify legacy rows as reusable campaign content, migration inputs, documentary examples, or obsolete tooling.
- Define final states and a zero-gap rubric for all in-scope generator and preparation rows.
- Bind every generator input to app-owned reference data or explicit campaign-owned authored data; no PDF, book markdown, parser output, website, or wiki becomes runtime authority.

### 2. Encounter-table authority

- Define a strict versioned table schema with stable row identity, weighted selection, environmental predicates, level/scale bounds, and bounded GM-authored notes.
- Migrate reviewed legacy JSON without silently reinterpreting malformed or ambiguous rows.
- Support campaign-owned create, edit, copy, import, export, archive, and provenance workflows with revision checks and role-safe projections.
- Detect table and generated-output drift deterministically.

### 3. Server-authoritative wild encounter generation

- Move all randomness, candidate legality, level selection, group sizing, move selection, and generated identity to a journaled server operation.
- Use only canonical app-owned Pokédex, Move, Ability, Capability, item, rules, and progression JSON for mechanical facts.
- Fail closed when a table references an absent or ambiguous canonical identity.
- Expose a reviewable generation receipt and exact retry; changed inputs conflict.

### 4. Generated Pokémon and roster legality

- Produce migration-current ordinary Pokémon sheets, never generator-private sheet dialects.
- Reuse current derived-stat, move, capability, equipment, lifecycle, and ownership authorities.
- Prove level, experience, move access, ability choice, combat state, and encounter-resource initialization are legal and deterministic.
- Keep optional flavor and GM notes structurally separate from public/owner mechanical projections.

### 5. NPC Trainer generation

- Define reviewed Trainer archetype/policy inputs and a bounded generation contract for level, stats, skills, Features/Edges, equipment, money, Pokémon ownership, and encounter role.
- Generate ordinary Trainer and Pokémon sheets in one atomic package with exact custody and no orphan rows.
- Require explicit GM review for narrative identity, tactics, and any choice not determined by structured policy.
- Do not invent canonical classes, Features, Edges, items, or mechanics from prose.

### 6. Session-preparation documents

- Add a versioned, role-projected preparation document for planned scenes, encounter candidates, linked sheets/maps, GM notes, player-safe summaries, and unresolved decisions.
- Preserve stable handoffs into existing Encounter Builder and campaign-attention routes.
- Support drafts, review, ready, launched, archived, and cancelled lifecycle states without treating a plan as live authority.
- Keep player/public projections structurally distinct; client redaction is not authority.

### 7. Encounter Builder and liveplay handoff

- Commit selected generated packages through the current Encounter Builder, Encounter Document, map, placement, initiative, scene, operation, and realtime repositories.
- Revalidate every generated read inside the shared transaction before launch.
- Publish realtime only after commit and leave no partial map/sheet/document state on failure.
- Preserve current liveplay commands, correction paths, finish/settlement authority, and campaign continuation.

### 8. Recovery, migration, backup, and concurrency

- Certify fresh database and historical upgrade paths without introducing a parallel storage authority.
- Cover exact retry, changed-input conflict, stale revision, offline interruption, restart, reconnect, correction, cancellation, and concurrent GM tabs.
- Back up and restore table, preparation, generated package, and launched encounter states exactly.
- Ensure generated-but-uncommitted previews never create durable sheets or consume campaign authority.

### 9. Production GM workspace

- Integrate preparation into the established Workshop context and campaign navigation.
- Reuse current design tokens, semantic tables/cards, decision anatomy, focus restoration, responsive behavior, reduced motion, and approximately 44-pixel controls.
- Keep the Encounter cockpit encounter-first; preparation does not become a second live Encounter UI.
- Validate desktop/mobile, keyboard/touch, screen reader, zoom/reflow, table-distance use, and dense campaign performance.

### 10. Acceptance and documentation

- Add deterministic table/generation fixtures, multi-client production journeys, performance budgets, privacy audits, drift gates, and golden preparation-to-settlement campaigns.
- Document GM workflows, contributor extension rules, canonical/campaign data boundaries, migration, recovery, backup/restore, and troubleshooting.
- Run full repository validation and record a machine-readable final acceptance before archival.

## Non-goals

- Supplement or setting-specific encounter packs as canonical bundled mechanics; campaign-authored content remains campaign data.
- Narrative generation, prose-written adventures, autonomous GM decisions, tactics engines, or AI-authored canonical facts.
- Public matchmaking, public authentication, multi-tenancy, federation, or public-service hardening.
- Replacing ordinary sheets, Encounter Documents, maps, liveplay commands, settlement, campaign attention, or realtime authority.
- A second Move, item, weapon, Skill Check, Contest, dice, persistence, or operation engine.
- Release versioning, release notes/tags, fan-content notice review, and release-boundary upgrade guarantees owned by prospective Plan 13.
- Runtime parsing of books, markdown, PDFs, websites, wikis, or parser output.

## Non-negotiable rules

1. All mechanical identities and facts come from the app-owned canonical `data/reference/*.json` authorities; table rows and preparation documents may select or constrain them but never override them.
2. Campaign-authored encounter tables are explicit user data, not canonical PTU reference sources.
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

## Proposed phase shape for ledger review

The activation review should convert this scope into bounded tickets in dependency order:

1. footprint, completion rubric, authority/data boundaries, and deterministic fixtures;
2. strict encounter-table schema and reviewed legacy migration;
3. journaled wild-encounter generation and ordinary Pokémon-sheet packages;
4. NPC Trainer policy and atomic Trainer/roster packages;
5. session-preparation document, projections, repositories, and realtime;
6. Encounter Builder handoff and liveplay launch;
7. recovery, concurrency, correction, migration, backup/restore, and performance;
8. production GM workspace, accessibility, privacy, golden campaigns, documentation, and final acceptance.

Ticket count is intentionally unset until the footprint and activation questions are reviewed.

## Activation questions

1. Which legacy `encounter_tables/` rows are reviewed reusable campaign data, and which require repair, quarantine, or retirement?
2. What exact structured predicates—location, terrain, time, weather, rarity, level, party scale, and campaign state—belong in the first native table schema?
3. Which current generation outputs are file-oriented compatibility artifacts, and what is their no-loss migration into ordinary sheet/Encounter Builder commits?
4. What bounded policies define legal wild Pokémon moves, abilities, capabilities, held items, and group composition at each level?
5. Which Trainer archetype inputs are canonically structured enough for native generation, and which choices must remain guided GM review?
6. Does session preparation require a new persisted schema version, and which existing repository/operation families own its atomic launch handoff?
7. Which preparation details are GM-only, owner-visible, or public, and what exact realtime invalidation payloads are safe for each role?
8. What scale fixtures represent the largest supported campaign, table library, generated roster, concurrent clients, and preparation document?
9. Which historical campaign database versions must be certified at activation, given Plan 13 owns release-boundary guarantees?
10. What final ticket count and first playable vertical slice follow from the machine-readable footprint?

## Proposed first playable vertical slice

> The GM opens one reviewed forest encounter table, requests a seeded encounter for the current party, reviews a legal migration-current wild Pokémon group, commits it into the existing Encounter Builder, launches the ordinary live Encounter, reconnects a player client, finishes settlement, and sees the accepted result in campaign continuation. Exact retry creates no additional sheet, map, operation, random draw, reward, or realtime row.

The activation ledger must make this slice complete before widening to NPC Trainers and multi-scene session preparation.

## Review and activation checklist

- [ ] Build and review a machine-readable generation/preparation footprint.
- [ ] Resolve all ten activation questions in a decision record.
- [ ] Confirm canonical versus campaign-owned data boundaries against repository instructions.
- [ ] Choose a numbered ticket count and dependency order.
- [ ] Register the numbered ledger in the authoritative plan table.
- [ ] Mark this draft `CONVERTED` only after registration.

Until every item is complete, this draft remains prospective and inactive.
