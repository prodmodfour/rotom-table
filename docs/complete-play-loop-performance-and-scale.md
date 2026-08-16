# Complete Play Loop performance and scale budgets

P8-095 records enforced alpha budgets in `data/complete-play-loop/performance-scale-budgets.v1.json`.

Run:

```bash
npm run check:complete-play-loop-performance
```

The command uses one Vitest worker with file parallelism disabled. Timing uses `performance.now()` and deliberately generous failure ceilings—at least four times the reviewed development baseline—while structural limits are exact. A timing failure is investigated and profiled; a limit is not raised merely to make CI green.

## Certification profiles

- **Lower-end laptop:** four logical cores, 8 GB RAM, Node 24 or a current Chromium-class browser. Strict projection work remains below its scenario budget and initial bounded surface rendering targets two seconds.
- **Mobile:** 320 CSS pixels, touch input, and reduced concurrent work. Inventory and Action Dock surfaces render at most 80 rows/cards at once and retain 44-pixel controls.
- **Large campaign:** 5,000 stored inventory rows, 512 Trainer/Pokémon owners carrying more than 1,000 active equipment contributions, 1,024 reward lines, 10,000 attention items, and 32 realtime clients.

These are stress fixtures, not recommended campaign sizes. The strict contract maxima remain authoritative and incomplete reads still fail closed.

## Scenarios

### Inventory

A complete projection accepts all 512 bounded offers. A 5,000-row semantic table renders one fixed 80-row page, with Previous/Next controls, a live row-range status, preserved global row indices, and selected-row page restoration. Adding and removing rows retain keyboard focus semantics. No virtualization replaces table semantics.

The strict JSON node allowance is 65,536 so a legal 512-offer projection does not contradict its own array limit. It remains finite and rejects larger payload complexity.

### Equipment

The benchmark resolves two hash-bound providers for each of 512 distinct owners. It exercises equipment-state parsing, current definition fingerprints, predicates, and contribution routing rather than timing a mock loop.

### Action Dock

A strict 512-offer encounter projection remains under 1 MiB. The Action Dock initially mounts 80 cards and adds only one 80-card batch per explicit request. Search and grouping reset the batch.

### Settlement rewards

The strict settlement parser validates 1,024 reward lines and 1,024 linked allocations, including exact identities and local references. The existing document limits remain 1,024 reward lines and 4,096 allocations.

### Campaign attention

The role-safe projection validates the complete 10,000-item maximum, unique identities, deterministic order, lifecycle state, temporal integrity, summary counts, and owner-only audience.

### Realtime

One bounded 1,000-event batch is filtered independently for 32 clients. Delivery remains linear in `events × clients`, with exactly one result per event/client pair and no duplicate amplification.

## Maintaining budgets

When a bounded limit or owner changes:

1. profile the real parser, reducer, projection, or component;
2. preserve complete reads and privacy—never speed up by silently truncating authority;
3. update the reviewed budget contract and focused fixture;
4. refresh SHA-256 evidence through the P8-095 data test;
5. run typecheck and the focused command.

P8-094 authority guardrails remain separate and must also pass after source changes.
