# GM Campaign Toolkit contributor guide

This guide governs extensions to campaign encounter tables, wild generation, NPC Trainer packages, session preparation, and immutable Encounter Builder handoffs. The Toolkit is liveplay-only and extends existing campaign SQLite, ordinary sheets, maps, Encounter Documents, settlement, continuation, and realtime authority. It must not become a parallel mechanics or persistence system.

## Source and trust boundaries

### Canonical runtime authority

Only these app-owned sources may define PTU identities and mechanics for Toolkit runtime:

- `data/reference/moves.json`
- `data/reference/abilities.json`
- `data/reference/edges.json`
- `data/reference/poke-edges.json`
- `data/reference/capabilities.json`
- `data/reference/features.json`
- `data/reference/conditions.json`
- `data/reference/items.json`
- `data/reference/maneuvers.json`
- `data/reference/pokedex.json`
- `data/reference/stat-rankings.json`
- `data/reference/pokemonExperienceChart.json`
- `data/reference/rules.json`
- `data/reference/contests.json`
- `shared/ruleset/natures.ts#PTU_NATURE_CHART`

`data/gm-campaign-toolkit/data-boundaries.v1.json` is the machine-readable boundary. Runtime must fail closed with a bounded explanation when a canonical identity is absent or ambiguous.

Do not read or parse `ptu-data/`, `books/`, `pokesheet.pdf`, `encounter_tables/`, markdown, PDFs, websites, wikis, or parser output at runtime. They are documentary or migration provenance only. Do not use external research to fill a runtime identity or mechanic.

A canonical-data repair requires a separate reviewed, deterministic, source-hash-bound migration into an app-owned `data/reference/*.json` authority. Never add an alias, guessed identity, fallback list, or prose parser inside a Toolkit handler.

### Campaign-owned authority

These are user or campaign policy data, not canonical PTU facts:

- encounter-table documents;
- NPC archetype policies;
- session-preparation documents;
- generation operations, journals, package receipts, and launch links.

Campaign data may select and constrain canonical identities. It may not override a canonical Species, Move, Ability, item, stat rule, Experience value, Nature, prerequisite, or derived mechanic.

The reviewed Field Researcher policy and four migrated encounter tables are deterministic campaign seeds. Their presence does not turn them into canonical reference catalogs.

## Architecture map

| Concern | Contract | Runtime owner | Persistence/evidence |
| --- | --- | --- | --- |
| Campaign tables | `shared/gmToolkit/encounterTables.ts` | `server/useCases/gmEncounterTableLibrary.ts` | `gmEncounterTableRepository.ts`, schema v51 |
| Wild generation | `shared/gmToolkit/generation.ts` | `manageWildGeneration.ts`, `wildGenerationEngine.ts` | `gmWildGenerationRepository.ts`, schema v52–v53 |
| NPC policies/packages | `npcArchetypes.ts`, `npcGeneration.ts` | `manageNpcGeneration.ts`, `npcTrainerConstruction.ts` | NPC repositories, schema v54–v55 |
| Session preparation | `sessionPreparation.ts`, `sessionPreparationOperations.ts` | `manageSessionPreparation.ts` | `gmSessionPreparationRepository.ts`, schema v56 |
| Builder handoff | `shared/encounterDocuments/builder.ts` | `loadEncounterBuilderHandoff.ts`, `launchEncounterBuilder.ts` | existing launch, map, Encounter Document, preparation operation repositories |
| Realtime | `shared/gmToolkit/realtime.ts` | `server/utils/gmToolkitRealtime.ts` | GM-only identity/revision invalidation; ordinary launched domains retain their owners |

Keep shared parsers strict, versioned, exact-key, bounded, and side-effect free. Use cases own authorization-independent business orchestration. API handlers authorize before reading bodies or opening campaign authority. Repositories serialize documents and exact operations into the existing database. Browser composables submit intent and present projections only.

## Non-negotiable operation rules

Every mutation or generation extension must preserve all of these invariants:

1. The server owns mechanical validation, randomness, revision checks, identity allocation, and persistence.
2. Every random draw—including rejected bounded sampling—is produced through the reviewed seeded RNG and journaled in order.
3. Preview is inert and creates zero durable rows or realtime events.
4. Commit reconstructs and validates the signed preview; it never trusts browser candidates or mechanics.
5. Accepted packages create ordinary migration-current sheets through existing repositories.
6. One transaction commits every affected document, sheet, custody link, operation result, and durable realtime row, or none.
7. Realtime publication occurs only after the transaction returns.
8. Exact operation retry returns the original immutable result with zero new draws, writes, revisions, or events.
9. Reusing an operation identity with changed material is a deterministic conflict.
10. Stale sources fail closed. Runtime never silently upgrades, substitutes, or rewrites a pinned reference.
11. All bounds remain enforced at contracts and storage boundaries.
12. Private evidence never enters public/owner projections, exports, user-facing diagnostics, or realtime content.

Do not use `Math.random`, browser-generated mechanics, local/session storage as operation authority, filesystem output, child processes, or a second database.

## Extending encounter tables

`EncounterTableDocumentV1` is strict schema v1 with at most 50 rows. It requires stable row identities, canonical Species, explicit weighted Nothing, canonical habitat tags, bounded Levels, bounded predicates, and one bounded group-size policy.

When changing table behavior:

1. Change the shared contract first. If existing persisted bytes cannot retain their meaning, mint a new schema version and an explicit storage migration rather than loosening v1.
2. Keep exact-key validation and bounded issue paths. Unknown fields are not forward-compatible mechanics.
3. Resolve Species and habitat only from `data/reference/pokedex.json`.
4. Update the library/detail projection separately from the full GM document. Library rows must remain bounded and omit table rows, notes, provenance hashes, and diagnostics.
5. Add optimistic-revision and exact-operation tests for create, edit, copy, archive/restore, import, and export as affected.
6. Prove import validates the complete envelope before persistence.
7. Preserve source revision on copy/import provenance and make drift visible without automatic repair.
8. Update scale coverage for 200 tables × 50 rows when payload or algorithm shape changes.

The four historical files are transformed only by `scripts/migrate_legacy_encounter_tables.py`, whose output is source-hash exact. Do not read those files from a route or use case. Do not regenerate the migration artifact merely because source bytes changed; first review why an immutable activation source drifted.

## Extending wild generation

All generation draws flow through `server/domain/gmToolkit/seededRng.ts`. A new policy that can alter an outcome must have:

- a strict command field with an explicit bound;
- one app-owned canonical binding;
- an ordered journal draw or a deterministic no-draw rule;
- inclusion in the preview command hash, signed token, preview hash, and exact-commit reconstruction;
- a fail-closed case for missing/ambiguous canonical authority;
- deterministic fixture evidence and exact-replay tests;
- preview-inertness and rollback assertions;
- a reviewable GM projection that hides seed, token, journal, source hash, and internal IDs.

Generated Pokémon construction must continue through `wildPokemonConstruction.ts` and existing sheet derivation/normalization helpers. Do not create a generator-only sheet dialect or persist a candidate as a partial sheet.

Current hard limits are 30 requested/journaled slots and 10 committed Pokémon. Changing a bound is a product and scale-fixture decision, not a local constant edit.

Route Repel remains existing exploration authority. Revalidate its Trainer revision, campaign-clock revision, item-definition evidence, duration, and level filtering. Never reduce it to a client checkbox or copied level threshold.

## Extending NPC generation

NPC archetypes are structured campaign-owned policies that reference canonical Features, Edges, items, and roster sources. Unknown identities and failed prerequisites reject the policy.

A policy or generator change must:

1. update the strict archetype or generation contract;
2. validate Features and Edges through existing onboarding/creation prerequisite authority;
3. validate equipment only against canonical items and existing inventory sections;
4. construct Trainer stats, Skills, resources, and sheet shape with existing rules helpers;
5. assemble owned Pokémon through native wild generation, not a second roster generator;
6. preserve guided name, identity, tactics, and notes as explicit GM-private decisions rather than mechanical facts;
7. commit one Trainer and at most six Pokémon plus exact roster custody in one transaction;
8. add deterministic 1+6, rollback, retry, stale-policy, and privacy evidence.

A bounded attempt may honor Nothing rows while filling an exact roster target. If the target cannot be filled within the journal bound, reject without partial sheets. Never silently drop Nothing or draw outside the journal.

Changes to `data/gm-campaign-toolkit/default-npc-archetypes.v1.json` require policy review, canonical/prerequisite validation, migration/seed behavior review, deterministic fixture updates, and a drift-gate update. A campaign policy is not added to `data/reference/` merely to make validation convenient.

## Extending session preparation

`SessionPreparationDocumentV1` is a private planning document with strict typed references and six lifecycle states. It is never live map or Encounter authority.

When adding a field or reference kind:

1. update the strict document parser, limits, operation command parser, repository serialization, and fixtures;
2. assign one owner for create/edit/transition/copy/import/archive/launch behavior;
3. define whether it is GM-only or explicitly player-safe;
4. update `projectSessionPreparationForPublic` by constructing a new allowed shape—never spread the private document and delete fields;
5. update library projection only when the bounded list task requires it;
6. validate every typed reference and revision before save/review/ready and again inside launch;
7. include copied/imported identity remapping and immutable source provenance;
8. add lifecycle, readiness, stale-reference, exact-retry, rollback, public-privacy, and scale tests.

Current bounds are 20 scenes, 50 linked documents, 20 candidates per scene, 50 handouts, and 50 decisions. Readiness requires at least one scene, no open decision, and no candidate left as an unreviewed option.

Launch evidence is appended only by the Builder launch transaction. No preparation mutation route may place map tokens, initialize an Encounter Document, start initiative, or publish public encounter authority.

## Extending Builder handoffs

`EncounterBuilderHandoffV2` is the sole Toolkit-to-Builder reference contract. A handoff carries document identity, expected revision, and optional scene identity; the server resolves display and mechanics.

For a new source family:

- extend the discriminated union and strict parser rather than adding untyped query data;
- load only through a GM-only server resolver;
- resolve ordinary sheet references and bounded placement intent;
- fail closed when source material cannot become ordinary Builder cast;
- pin every package, preparation, sheet, and map revision;
- re-resolve all source authority inside the existing shared launch transaction;
- exact-match any story-locked browser echo against server-resolved source;
- append source launch evidence atomically without making the source document live authority;
- use existing map, Encounter Document, launch operation, interaction-mode, realtime, and settlement owners.

Do not copy package mechanics or private preparation documents into the browser request. Do not create a Toolkit launch endpoint, staging map, generated Encounter type, or settlement adapter.

## Authorization, projections, and realtime

Every Toolkit table, policy, generation, package, preparation, and handoff route is GM-only. Call `requireGm(event)` before body parsing, repository creation, or use-case work. Keep request bodies bounded.

Server projections are allowlists:

- **GM** — full documents and review projections as required by the task;
- **owner/player** — ordinary owned sheets only after ordinary ownership/launch rules allow them;
- **public** — launched player-safe preparation and ordinary Encounter projections only.

Never implement privacy with `delete`, CSS, client filtering, or a shared broad response type. Add a negative test containing unmistakable private sentinel values and prove their field names and values are structurally absent.

Toolkit invalidation payloads contain exactly `documentId` and `revision`; channel/domain/type are event envelope metadata. They are GM-only. Generated-sheet library events contain only sheet kind, slug, and revision and remain GM-only. Mechanical recovery always reloads HTTP authority.

Do not add package, preparation, random-journal, source-hash, token, or diagnostics export routes.

## Persistence and migrations

Plan 12 owns contiguous schema versions 51–56 in `server/storage/migrations.ts`. A future migration must:

- append one version after the current head; never reorder or edit accepted historical meaning;
- preserve fresh-install and every supported predecessor path;
- validate JSON and byte bounds with storage CHECK constraints;
- retain operation/document foreign-key and index invariants;
- run in the existing migration transaction;
- reject a future database version before writes;
- add fresh, predecessor-upgrade, reopen, backup/restore, and foreign-key tests;
- update schema documentation and storage audit coverage.

Use repositories on the existing `RotomDatabase`. Do not open a sidecar SQLite database, JSON store, browser database, or filesystem directory for Toolkit authority.

`gm_toolkit_secrets` is server-only backup-safe signing authority. Never return, log, export, hard-code, or regenerate its value during normal startup. New signed authority should use an explicit key/version and backup/restore tests.

## UI contribution rules

Toolkit UI is the GM Workshop context. Before visible changes, load the global `ui-design-workflow` skill and follow `DESIGN.md`; for Builder/Encounter-adjacent work also follow the Encounter design system and run `npm run check:encounter-design`.

Preserve:

- one **Campaign Toolkit** shell and labels **Tables**, **Wild encounter**, **NPC Trainers**, and **Session prep**;
- exact copy such as **Preview only — nothing has been saved**, **Commit package**, and **Ready for Builder**;
- cyan selection/focus, amber pending/review, mint valid/accepted, and red only for consequential actions;
- raw ID, hash, token, journal, path, and diagnostics suppression;
- native semantics, visible keyboard focus, polite completion announcements, and focus restoration after asynchronous context changes;
- approximately 44-pixel controls, reduced-motion behavior, responsive one-column reflow, and no horizontal scrolling at 200% zoom.

A browser may hold transient form intent and the one current operation identity needed for exact retry. It must not roll mechanics, persist previews, cache private documents as authority, or synthesize accepted results.

## Drift-gate maintenance

### Immutable activation footprint

`data/gm-campaign-toolkit/generation-preparation-footprint.v1.json` has exactly 40 activation rows and immutable SHA-256:

```text
161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862
```

Run:

```bash
npm run check:gm-toolkit-footprint
```

Do not run the footprint generator with `--write` merely to silence a failure. First determine whether an inventoried source was intentionally migrated/retired or whether unrelated drift violated accepted closure. Minting a replacement activation artifact requires explicit review and the script's deliberate updated-activation path; it is not routine maintenance.

`data/gm-campaign-toolkit/footprint-finality.v1.json` must contain the same 40 keys exactly once. Every row has one final state (`Native`, `Migrated`, `Preserved`, `Retired`, or `Documentary`), existing authority paths, and runtime-reachability proof where required. `Pending` and `Blocked` are forbidden at final acceptance.

### Migrated table evidence

Run:

```bash
npm run check:gm-toolkit-legacy-tables
```

The migration checker recomputes all four documents from exact activation source bytes. An unexpected hash change is a review failure, not a reason to edit the expected hash or output JSON.

### Fixtures and final acceptance

Run bounded foundation checks with:

```bash
npm run check:gm-campaign-toolkit
```

This verifies boundaries, role policy, legality, deterministic fixtures, failure/recovery scenarios, scale budgets, session/Builder fixtures, recovery certification hashes, footprint, and legacy migration.

At final closure run:

```bash
npm run check:gm-campaign-toolkit-complete
```

The final command additionally requires all 40 rows final, the 96-ticket accepted artifact, retired seams absent, and the `justfile` unable to reach legacy generation. Never hand-edit a certification hash. Recompute only after the owned implementation and evidence have been deliberately reviewed and rerun.

When a hashed authority or test changes semantically, rerun its owning focused tests, update the certification/artifact with the new reviewed hash, and rerun every downstream checker. When a change is non-semantic but still hash-bound, the same review requirement applies—the hash is evidence of exact bytes, not a lint cache.

## Testing requirements

Develop with focused, one-worker runs. A changed domain normally needs:

- shared strict-parser and canonical fail-closed tests;
- repository migration/revision/exact-operation tests;
- deterministic replay and changed-input conflict tests for random authority;
- preview storage-inertness and injected transaction rollback;
- restart, backup/restore, and concurrent-GM tests;
- role-route, projection, export, and realtime privacy tests;
- Builder stale-source, atomic launch, ordinary settlement, and continuation tests when handoff behavior changes;
- component accessibility/source acceptance and production-build Playwright for visible flows;
- scale-budget evidence when payload, loop, query, or bounds change.

Useful focused commands:

```bash
npx vitest run tests/server/gmEncounterTableAuthority.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run tests/server/gmWildGeneration.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run tests/server/gmNpcGeneration.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run tests/server/gmSessionPreparation.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run tests/server/encounterBuilderHandoff.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run tests/server/gmCampaignToolkitPrivacyAudit.test.ts --maxWorkers=1 --no-file-parallelism
npm run check:gm-campaign-toolkit
```

Reserve full test, lint, typecheck, production build, and `scripts/quality-gate.sh` for integration/closure windows. Stop duplicate TypeScript/Vitest/Vite/Nuxt processes after memory pressure; do not compensate by weakening coverage or running unbounded parallel workers.

## Review checklist

Before accepting a Toolkit contribution, verify:

- [ ] Runtime mechanics use only app-owned canonical authorities.
- [ ] Campaign policy selects but does not redefine canonical facts.
- [ ] Contracts are strict, versioned, exact-key, and bounded.
- [ ] Mechanical randomness is server-owned, seeded, journaled, and replayed exactly.
- [ ] Preview creates no durable authority.
- [ ] Commit/launch revalidates inside one existing shared transaction.
- [ ] Generated participants are ordinary sheets with ordinary custody.
- [ ] Exact retry adds zero authority and changed material conflicts.
- [ ] Public/owner projections are separate allowlisted structures.
- [ ] Realtime is post-commit, role-scoped, and content-free.
- [ ] No new package/preparation/journal/diagnostics export exists.
- [ ] No file, process, browser, or second-database mechanics path exists.
- [ ] Migration, backup/restore, privacy, accessibility, and scale evidence covers the change.
- [ ] Footprint/finality/certification changes were reviewed rather than regenerated to silence drift.

## Related documentation

- [GM Campaign Toolkit guide](gm-guide.md)
- [Toolkit data boundaries](../../data/gm-campaign-toolkit/data-boundaries.v1.json)
- [Toolkit completion rubric](../../data/gm-campaign-toolkit/completion-rubric.v1.json)
- [Encounter Builder](../encounter-workspace/encounter-builder.md)
- [Complete Play Loop contributor guide](../complete-play-loop-contributor-guide.md)
- [Private VPS backup runbook](../private-vps-backups.md)
