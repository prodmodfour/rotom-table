# Edge automation

Rotom Table treats Trainer Edges and Poké Edges as separate, server-authoritative rule families.

## Runtime authority

Only these app-owned catalogs define runtime identities and source text:

- `data/reference/edges.json` — 61 Trainer Edges
- `data/reference/poke-edges.json` — 20 Poké Edges

Books, parser output, websites, and other documentary files are maintenance provenance only. Runtime source drift fails closed through `data/edge-automation/ruleset.json` and `scripts/check_edge_automation.ts`.

## Data flow

1. `shared/edgeAutomation/catalog.ts` resolves an identity within an explicit family.
2. `shared/edgeAutomation/instances.ts` validates typed instance IDs, ranks, choices, acquisition provenance, and GM overrides. Unknown or malformed legacy rows remain diagnostic-only.
3. `server/domain/edgeAutomation/effectiveEdges.ts` resolves ownership, grants, repetition, suppression, and source loss deterministically.
4. `server/domain/edgeAutomation/registry.ts` binds every canonical row to a hash-stable native declaration. Runtime code does not interpret effect prose.
5. Passive owning queries use the effective projection or `passiveProviders.ts`; Move, Ability, Capability, Trainer skill/training, and Pokémon derivation integrations consume the same typed instances.
6. `acquisition.ts` plans add/retrain/remove operations with prerequisite evidence, exact instance identity, GM-only overrides, repeat limits, Tutor Point settlement, and dependency checks.
7. Campaign operations are planned from server snapshots by `campaignOperations.ts`; callers commit money, inventory, usage, and sheet writes atomically through existing revision transactions.
8. Generic encounter presentation projects effective facts and declared actions without exposing executable rules to clients.

## Permanent grants

Move, Ability, and Capability grants are projections with source instance IDs and definition hashes. They are not copied into unexplained sheet prose. Removal, retraining, suppression, and source loss therefore remove the projection automatically. Legacy rows accepted by compatibility readers should be persisted back as typed `automation` data.

## Prerequisites and overrides

Prerequisites are strict ASTs in `data/edge-automation/prerequisites.json`. Eligibility is evidence, not runtime effect authority. A GM-authored exceptional build must include a bounded override with the current prerequisite hash, author identity, timestamp, and reason. Players cannot create overrides. Changing a prerequisite hash invalidates stale overrides.

## Poké Edge lifecycle

Poké Edges spend one Tutor Point per instance. Acquisition validates species, Level, choices, natural Ability eligibility, Move AC, Connection keywords, repeat limits, and final-evolution choices. `pokemonLifecycle.ts` blocks evolution under Underdog’s Strength and performs Realized Potential or Skill Improvement refunds in the same planned evolution transaction.

## Breeder boundary

`Breeder` is the only closed delegation. Edge automation owns its identity, prerequisites, effective permission, contribution evidence, and request contract `edge.breeder.request.v1`. The downstream capability is `breeding.v1`, owned by `BREEDING_AND_EGG_LIFECYCLE_PLAN.md`. Until that capability exists, the planner returns `downstream-capability-unavailable`; Edge automation never creates Eggs, offspring, lineage, inheritance, or incubation state.

## Contributor workflow

1. Change canonical JSON only through a reviewed migration; never supplement it from external/documentary data.
2. Run `python3 scripts/seed_edge_automation_manifest.py` when governed artifacts intentionally change.
3. Add or update strict mechanics and focused scenarios without parsing effect prose at runtime.
4. Run `npm run check:edge-automation`, focused Edge tests, typecheck, and the repository quality gate at closure.
5. Do not mark a row complete if any mechanical branch remains a manual note, client-authored mutation, or undocumented delegation.
