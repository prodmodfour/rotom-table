# Feature automation

Feature automation v1 is the server-authoritative runtime for all 444 app-owned Trainer Feature rows.

## Authority

- Runtime identity and source text come only from `data/reference/features.json`.
- `scripts/migrate_feature_reference_v1.py` is a reviewed, hash-guarded one-way repair. Book markdown and parser output are maintenance provenance only.
- `data/feature-automation/ruleset.json`, `inventory.json`, `class-directory.json`, `manifest.json`, `specs.json`, `prerequisites.json`, `grants.json`, `campaign-operations.json`, `cohorts.json`, and `scenario-requirements.json` freeze the executable contract.
- Unknown identities, malformed typed instances, missing choices, source drift, and unresolved build clauses fail closed.

## Runtime

`FeatureInstanceData` retains canonical identity, rank, bounded choices, acquisition provenance, and source-hash-bound GM override evidence. `resolveEffectiveFeatures` merges Features, class anchors, Orders, Training, and provenance-bound grants into one deterministic projection. It suppresses malformed rows and bounds grant cycles.

The native registry owns one hash-bound definition per catalog row. Passive queries, grants, event subscriptions, AP/frequency settlement, encounter declarations, and campaign operations consume that projection. AP Spend, Bind, Drain, temporary grants, usage scopes, exact retry, target authority, and accepted trigger events are never client-authored.

Permanent Move, Ability, Capability, Edge, and Feature grants retain their source instance. Removing or retraining a source therefore removes the virtual grant instead of leaving an unexplained sheet row. Existing Trainer derivations consume strict typed identities rather than interpreting Feature prose. Embedded Commander Orders are frozen in `orders.json`; live code never reparses their source blocks.

Execution compiles an immutable context and optimistic read set into a state plan. Request receipts provide exact retry, while stale revisions reject the whole plan. AP Bind/Drain, frequency ledgers, target-Pokémon grant reconciliation, team relationships, campaign inventory deltas, injected rolls, pending reactions, and bounded adjudications all retain source IDs and audit evidence. Extended Rest, scene cleanup, expiry, source loss, pass, cancellation, and GM recovery have explicit lifecycle operations.

## Breeding provider boundary

BR-061 consumes Feature authority only through `server/domain/breeding/featureProviderHandoff.ts` and `server/useCases/resolveBreedingFeatureProviderHandoff.ts`. The adapter reloads the current Trainer and campaign clock, accepts only effective unsuppressed parameter-complete Feature instances, checks canonical records/runtime definitions and the reviewed breeding modifier inventory, and emits self-hashed server-private typed contributions with matching read-set dependencies. Submitted Feature projections, choices, values, facility claims, dependencies, and hashes have no authority.

`Dilettante` may grant `Breeder` only from its current selected Edge. Its canonical Skill-prerequisite waiver and General Education/Perception substitution are resolved by a synchronous server-owned choice and folded into Breeder evidence; Feature automation still does not run the DC 12 check or own a Project. `Playing God` exposes bounded potential artificial-Egg parameters, while the hatch-special, fossil, and learning contributions remain gated to their breeding tickets. No facility definition exists. The handoff performs no mutation, roll, publication, or client projection, and Feature authority ends before Project, Egg, incubation, hatch, child, lineage, or outcome mechanics.

## Security and privacy

- Clients submit stable intent IDs, selected server-offered values, and authorized targets; they never submit mechanics, reference prose, rolls, AP settlement, or output deltas.
- Actor, roster, side, placement, willingness, range, action economy, trigger-event, condition, and read-revision authority is supplied from server snapshots.
- Unknown names, malformed typed data, unsupported build clauses, cyclic nested grants, invented outputs, duplicate request IDs with changed payloads, and over-budget contexts fail closed.
- Owner/private build details remain on authorized projections. Public encounter summaries contain only source-safe presentation fields.

## Editing and migration

The sheet editor permits only canonical Feature names and renders required bounded choices. Its status badge distinguishes automated, missing-choice, malformed, and unresolved rows. Compatibility names and parenthetical choices are read once and normalized; accepted writes persist typed automation data.

## Validation

Run:

```bash
npm run check:feature-automation
npm run check:feature-automation-complete
```

The strict command additionally requires the archived plan to be `DONE`. `scripts/quality-gate.sh` runs it before typecheck and tests.

## Contributor and operator checklist

1. Change documentary/parser inputs only as provenance, then update the reviewed one-way migration and its expected hashes.
2. Run the migration and seeder twice; the second run must be byte-stable.
3. Review source adjudications, prerequisites, choices, grants, embedded Orders, campaign operations, dependencies, interactions, and exact scenario IDs.
4. Add focused positive, denial, retry, lifecycle, source-loss, and interaction tests. Do not certify a prose-only fallback.
5. Run both check commands, typecheck, focused tests, and the full quality gate.

For recovery, retain the Trainer sheet, Feature runtime receipts/pending state, campaign plan, and all read revisions. Retry the same request ID only with the same payload. A changed payload is a conflict; a stale read set is replanned; unresolved pending work is passed, cancelled, expired, or GM-resolved through its bounded workflow rather than edited in storage.
