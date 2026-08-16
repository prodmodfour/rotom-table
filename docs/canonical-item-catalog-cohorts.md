# Canonical item catalog cohorts

P8-092 assigns every exact row in `data/reference/items.json` to one bounded reviewed implementation cohort. The registry is `data/complete-play-loop/item-catalog-cohorts.v1.json`; its reviewed policy is `scripts/reviewed-data/item-catalog-cohort-policy.v1.json`.

## Purpose and authority boundary

The cohort registry is catalog coverage evidence, not a second ItemSpec registry and never mechanical authority. It may answer which reviewed provider owns a canonical row, which completion state was reviewed, and which evidence or remediation applies. It cannot make an item usable, infer an effect, authorize custody, resolve a target, choose a destination, consume inventory, or mutate a sheet/map/Egg.

Runtime actions still require their owning exact provider:

- machine Move ItemSpecs and Extended Actions;
- item-Evolution transitions;
- permanent-advancement ItemSpecs;
- exploration operations;
- Breeding/Egg item operations;
- bounded guided adjudication;
- equipment definitions, contributions, grants, and provider lifecycle;
- core ItemSpecs and item-operation journals; or
- the specialized capture operation.

`server/domain/itemAutomation/catalogCohortRegistry.ts` intentionally exposes read-only coverage decisions. It rechecks every member's exact canonical record and effect fingerprint and rejects duplicate, missing, or drifted identities. Callers must still resolve the owning provider independently. Runtime prose parsing is forbidden.

## Reviewed grouping

A cohort contains at most 32 rows. After P8-093 closure, the 348-row catalog forms 18 cohorts:

- four machine-Move cohorts for 106 TMs/HMs;
- one 24-row Evolution cohort;
- one 10-row permanent-advancement cohort;
- one seven-row exploration cohort;
- one three-row Breeding cohort;
- one six-row guided-adjudication cohort;
- four equipment cohorts for 104 remaining exact definitions;
- one 29-row core ItemSpec cohort, including the reviewed Black Sludge repair;
- one 25-row native capture cohort; and
- three guided interpretive-tool cohorts containing 34 field, camp, crafting, care, and combat items.

Precedence is explicit because some exact rows participate in more than one supporting registry. For example, an Evolutionary Keepsake can have equipment compatibility and an Evolution provider; the Evolution provider owns its catalog decision while equipment remains a supporting authority. A row appears in exactly one cohort.

Every cohort records:

- ordered exact members and each canonical record/effect SHA-256;
- one aggregate source fingerprint;
- one implementation-state decision;
- provider requirements;
- source evidence;
- executable or explicit fail-closed evidence;
- UI projection evidence;
- recovery evidence; and
- nonempty remediation requirements for any blocked decision (there are none after P8-093).

All evidence paths are app-relative and hash-pinned. The generator fails on a missing path, unknown item, duplicate membership, incomplete catalog, invalid reviewed state, oversized cohort, or a blocked/remediation mismatch.

## P8-093 closure

The reviewed snapshot now records 204 `native`, 104 `passive`, 40 `guided`, and zero `blocked` rows. A `native`, `passive`, or `guided` decision means the cohort has the evidence required by `data/complete-play-loop/completion-rubric.v1.json`; it does not weaken per-operation authorization or freshness checks.

P8-093 closes the former 60-row remediation set:

- all 25 Poké Balls use reviewed structured mechanics and one exact revision-bound inventory row; the accepted liveplay command binds consumption and capture outcome in one atomic replay-safe receipt;
- all 34 interpretive tools use reviewed bounded GM adjudication with no freeform mechanics, explicit reusable or consumable source disposition, private durable receipts, cancellation, and live UI handoffs; and
- Black Sludge has a source-hash-bound `$500` canonical acquisition-cost migration and a native Poison-only 1/8-Max-HP turn-start Digestion Buff ItemSpec.

No canonical row remains blocked or is silently relabeled as reference-only. Runtime mechanics still come only from each owning provider, never from the cohort classification.

## Generation and validation

Regenerate after reviewing source changes:

```bash
python3 scripts/generate_complete_play_loop_item_catalog_cohorts.py
```

Drift check:

```bash
python3 scripts/generate_complete_play_loop_item_catalog_cohorts.py --check
```

`shared/itemAutomation/catalogCohorts.ts` strictly rejects unknown fields, unsafe repository paths, malformed hashes, oversized cohorts, duplicate identities, non-contiguous ordering, divergent counts, and incomplete blocked evidence. Focused tests verify parser failure behavior, complete exact catalog coverage, current evidence hashes, read-only registry lookup, and zero blocked rows at P8-093 closure.
