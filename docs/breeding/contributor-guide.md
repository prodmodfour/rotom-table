# Breeding contributor guide

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

## Privacy

Implement separate public, owner, participating-owner, GM, and diagnostic parsers/projections. Do not serialize private fields and hide them in Vue. Control cannot exceed visible authorized identity. Realtime remains a refresh signal.

Fixture data must set `synthetic: true` and `containsCampaignData: false`. Do not commit campaign databases, exports, auth state, traces with private payloads, or local browser storage.

## Tests

During implementation, prefer focused single-worker Vitest commands:

```bash
npx vitest run path/to/test.ts --maxWorkers=1 --no-file-parallelism
npm run check:breeding-automation
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
