# Breeding contributor guide

## Documentation map

- Architecture and fact ownership: `docs/breeding/architecture-and-ownership.md`
- Accessibility and table-distance acceptance: `docs/breeding/accessibility-responsive-and-table-distance.md`
- Strict data model and campaign clock: `docs/breeding/data-model-and-campaign-clock.md`
- Browser/API contracts: `docs/breeding/api-reference.md`
- Player and GM workflows: `docs/breeding/gm-and-player-guide.md`
- Security and privacy: `docs/breeding/security-and-privacy.md`
- Workshop presentation: `docs/breeding/workshop.md`
- Operations and incidents: `docs/breeding/operator-guide.md`
- QA and release: `docs/breeding/qa-and-release-guide.md`

Update the owning document in the same change as behavior. BR-088's documentation closure test rejects route, vocabulary, timeline, status, cross-link, and release-command drift.

## Start with the ledger

1. Read `implementation-plans/BREEDING_AND_EGG_LIFECYCLE_PLAN.md` and `implementation-plans/plan-order.md`.
2. Work only on `CURRENT_TICKET`; keep exactly one ticket `IN_PROGRESS`.
3. Respect the semantic gates in `data/breeding-automation/semantic-registry.json`.
4. Update the matching row in `scenario-requirements.json` when a ticket changes state.
5. Mark work `DONE` only after focused evidence passes.

Run:

```bash
npm run check:breeding-automation-plan
```

before and after a ticket transition.

## Source rules

Runtime authority is restricted to app-owned `data/reference/*.json` and reviewed generated artifacts. Books, markdown, parser inputs, parser output, PDFs, websites, and wikis cannot supplement identities or mechanics at runtime.

If an app-owned source is absent, malformed, or ambiguous:

1. fail closed with a stable diagnostic;
2. record the conflict and affected identities;
3. create a reviewed, source-hash-bound migration into an app-owned reference or compiled adjudication;
4. update the source manifest, dependent definition hashes, tests, and semantic registry;
5. never add a fallback lookup into documentary data.

Do not use web search to establish PTU identities, inventories, rule text, or mechanics.

## Adding a canonical or compiled definition

- Use stable IDs, never display labels as identity.
- Define a strict versioned schema with exact fields and closed enums.
- Reject unknown fields, unsafe integers, duplicate IDs, unbounded strings, unknown references, and malformed hashes.
- Serialize definitions with stable JSON and persist SHA-256.
- Bind compiled rows to exact source and adjudication hashes.
- Emit diagnostics for every excluded input; never silently repair it.
- Add focused boundary and property tests.

## Semantic manifest closure

`data/breeding-automation/semantic-closure-manifest.json` closes the six runtime dimensions owned by BR-080: compiled breeding specs, Projects, Eggs, operations, projections, and reviewed interactions. It does not replace the semantic registry; it binds each dimension to the exact runtime enums, contract hashes, artifact IDs, implementation paths, and current counts.

Every JSON file below `data/breeding-automation/` must be registered exactly once in `semantic-registry.json`, except that registry's own file. Adding an unregistered file, duplicate path, unknown command/status/audience/source kind, missing runtime path, or unclassified modifier must make `npm run check:breeding-automation` fail. When intentionally extending a closed dimension:

1. add or change the strict runtime contract and parser first;
2. update the owning artifact and all transitive definition hashes;
3. update the closure manifest's exact enum, path, count, and artifact bindings;
4. register the artifact exactly once;
5. rehash semantic-registry-bound fixtures from the dependency leaves upward; and
6. add a focused closure regression before advancing the ledger.

Do not weaken the checker with an ignore pattern or generic `other` value. BR-080 closure proves complete declaration, while BR-082 separately certifies each declared interaction's mechanics.

## Adding a provider

1. Add the canonical provider to `modifier-inventory.json` with exact record and mechanic-field hashes.
2. Consume the owning automation system's effective projection; do not copy its acquisition or suppression rules.
3. Define a stable contribution ID, bounded value schema, checkpoint, and stacking/deduplication policy.
4. Snapshot provider identity and definition hash when required.
5. Reject client-authored effects, free-form facilities, and unknown provider IDs.
6. Add interaction scenarios for present, absent, suppressed, stale, duplicate, and source-drift cases.

## Commands and use cases

Mutating commands require a schema version, stable operation ID, expected aggregate revision, authoritative references, and server-issued option IDs. Parse exact fields before authorization or mechanics.

A use case must:

- detect exact retry before rerunning rolls or spends;
- reject operation-ID reuse with a different command hash;
- load and revision-check every consulted aggregate/provider;
- authorize profile, Trainer, parent, consent, and option scope;
- use injected persisted randomness;
- create a complete state plan before writes;
- commit documents, operation result, audit evidence, and durable events in one SQLite transaction;
- publish only after commit;
- return an audience-safe projection.

Never use `Math.random` in an owning use case. Never create a blank child and patch it later.

For parentless source Eggs, adapt into `PokemonEggDocumentV1` rather than adding another lifecycle. Bind the future Egg ID, exact source custody or typed provenance, actor, campaign checkpoint, current provider/tool/import evidence, options, offers, and any persisted roll before settlement. Consume source resources when applicable and insert the Egg under the caller-owned transaction. GM, mysterious, campaign-gift, and imported creation all use the closed self-hashed GM provenance shape; legacy three-field GM sources are read-only. Source-specific reducers may freeze blueprint traits, but they may not fork incubation, hatch-special, child construction, lineage, acquisition rewards, or completion.

## Species acquisition integrations

Route every new capture, hatch, evolution, trade, migration, or GM-reviewed Species fact through `recordTrainerSpeciesAcquisition.ts`. Never query a roster, `dexExp`, a client Pokédex, or legacy fields to decide whether it is first. Never delete history on release. External sources must create strict self-hashed `BreedingSpeciesAcquisitionSourceEvidenceV1` with a deterministic operation ID, current campaign minute, exact Trainer revision, canonical app-owned Species, and—only for capture/evolution/trade—the exact Pokémon slug and revision. Do not add external events to the breeding command union.

Use `settleCaptureSpeciesAcquisitions.ts` only from the accepted Poké Ball commit, `settleSetupSheetSpeciesAcquisitions.ts` only from the setup-save transaction, and `settleReviewedSpeciesAcquisition.ts` only from server-owned review tooling. A review resolver and the generic current-source verifier must synchronously return current exact authority; Promise-like, stale, enriched, accessor-backed, duplicate-owner, unknown-Species, or hash-drifted values fail closed. Keep migration and GM review off browser routes.

Insert the history/reward and terminal source settlement in the caller's synchronous transaction. The source ledger is unique by operation and logical event, hash-binds the acquisition definition and reward result, and must reference an existing Trainer/Species history row. Exact retries return the persisted terminal record and apply zero. Test new integrations for release/reacquisition, companion capture, duplicate ownership, overflow, operation/event collision, corruption, nested rollback, restart/migration parity, and absence of private evidence in realtime.

## Inheritance learning

Treat frozen origin candidates as immutable authority. Resolve only canonical app-owned Move records at checkpoints 20, 30, …, 100; never infer eligibility from editable `eggMoves`, `inheritedMoves`, parent sheets, or documentary text. Keep inherited Moves in the six-slot natural `movelist`, leaving the separate three applied TM/Tutor slots unchanged. A full natural list requires a server-issued occupied replacement option. Persist one self-hashed lineage record and typed permanent provenance, and leave an illegal candidate eligible after its empty checkpoint.

The learning writer must use the caller-owned transaction. Consume selected offers, advance the child once, insert the contiguous record batch, settle the operation, and append restricted refreshes atomically. Exact retry is silent and remains valid after later child revisions. Add tests for skipped Levels, illegal-to-legal progression, exhausted candidates, open/full/already-known slots, rollback/recovery, stale authority, and accessor-backed rows.

## Privacy

Implement separate public, owner, participating-owner, GM, and diagnostic parsers/projections. Do not serialize private fields and hide them in Vue. Control cannot exceed visible authorized identity. Realtime remains a refresh signal.

Fixture data must set `synthetic: true` and `containsCampaignData: false`. Do not commit campaign databases, exports, auth state, traces with private payloads, or local browser storage.

## Security and abuse boundaries

Keep every Breeding POST on `readBreedingJsonRequestBody`; do not call `readBody` directly or raise the 32 KiB policy limit locally. A new mutation intent must use `enforceBreedingWriteRateLimit` only after strict parsing and authenticated Profile resolution, while reads and previews must remain outside write admission. Rate limiting is availability protection only: never use its wall clock, counters, or key as campaign time, command evidence, authorization, randomness, or exact-retry state. A rejection may expose only the bounded status and `Retry-After`.

When adding a list, identity, narrative, option, Move snapshot, candidate, hash, roll, or consent field, bind it to the matching `security-policy.json` abuse limit and add malformed/over-limit evidence. Preserve repository page defaults of 25 and maximum 100. Project creation must continue through atomic repository insertion so one parent cannot enter two active Projects. Update `security-certification.json`, semantic closure, checker assertions, and transitive authority fixture hashes when any audience, privacy field, route, threat, limit, or audit requirement changes.

## Archive and migration changes

A new durable Breeding authority row is incomplete until campaign backup export, authoritative parsing, stable record identity, cross-link validation, foreign-key-safe atomic restore, strict restart reparse, diagnostics, and release certification all cover it. Never omit an unsupported private row and never recreate it from another record during restore. Authorization receipts require every referenced GM override; external Species acquisitions require their terminal source settlement without adding a fake Breeding command; Egg transfers require their exact durable consent history.

Keep archive dependency and transaction hooks synchronous. Preserve the 64 MiB pre-parse envelope bound, 1,000-record chunks, exact reference snapshots, empty-target rule, replacement checkpoint, and immutable request/receipt replay. Migration output must bind exact source hashes, sizes, privacy classes, tool and reviewer evidence. Legacy fields cannot manufacture lineage, and map metadata cannot become runtime Egg authority.

Orphan diagnostics do not grant mutation authority. Acceptance for a repair must demonstrate preservation of the corrupt source, rejection of unsafe in-place new-campaign replacement, atomic restore of a reviewed known-good backup to a clean target, clean post-restore diagnostics, restart persistence, and a durable receipt. Update `archive-contract.json`, `archive-storage-runtime-contract.json`, `archive-release-certification.json`, semantic closure, the registry, checker assertions, and focused archive tests together.

## Performance budget changes

Keep registry, parent-preview, campaign-clock batch, role-projection, and Workshop limits in `shared/breeding/performanceBudgets.ts`; owning runtimes must consume those values rather than duplicate literals. Cardinality and UTF-8 output envelopes are deterministic admission controls. Monotonic elapsed ceilings are release tests only and must never enter a command, read set, campaign clock, transaction, retry decision, or audience projection.

A budget change requires a measured maximum-cardinality fixture, a reason the existing bound cannot be retained, privacy/output-size review, focused single-worker evidence, and synchronized scenario/checker documentation. Do not hide a regression by warming caches inside the measured interval, excluding serialization or transaction settlement, lowering fixture cardinality, or raising a ceiling without review.

## Production-like acceptance changes

Keep `scripts/breedingProductionAcceptance.ts`, its self-hash test, exact evidence needles, the package release command, and the operator procedure synchronized. Every acceptance input must be synthetic and every client must use ordinary authenticated role/Profile projection paths. Preserve file-backed WAL, process restart, long campaign-time skip, dual participant transfer consent, two-connection hatch contention, production Nitro, and desktop/mobile browser coverage. A narrower mock or in-memory-only replacement does not satisfy the release profile.

## Tests

During implementation, prefer focused single-worker Vitest commands:

```bash
npx vitest run path/to/test.ts --maxWorkers=1 --no-file-parallelism
npm run check:breeding-automation
```

For documentation closure, run:

```bash
npm run check:breeding-documentation
```

Add the earliest applicable evidence:

- parser and contract boundaries;
- pure examples, properties, and fuzz cases;
- repository restart/migration tests;
- authorization and privacy matrices;
- exact retry, stale revision, concurrency, and failure injection;
- Nuxt component and composable tests;
- official desktop and Pixel 7 Playwright acceptance;
- backup/restore and production-like acceptance.

Batch changes before typecheck. Reserve the full suite, build, and `scripts/quality-gate.sh` for integration milestones and closure.

## Completion checklist

- one fact owner and no alternate writer;
- app-owned source and definition hashes recorded;
- strict parser and stable unavailable reasons;
- operation replay and transaction behavior tested;
- role projections tested for omissions, not just CSS;
- scenario requirement marked covered with real evidence paths;
- checker and focused tests pass;
- plan ledger and plan-order index agree.
