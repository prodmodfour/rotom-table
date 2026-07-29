# Capability automation

Rotom Table treats the 83 entries in `data/reference/capabilities.json` as a closed, versioned rules catalog. Capability mechanics are server-authoritative in live play; reference prose is never interpreted in the browser or at runtime.

## Sources and generated metadata

- Canonical runtime source: `data/reference/capabilities.json`
- Frozen ruleset, inventory, reviewed adjudications, manifest, Power chart, and scenario requirements: `data/capability-automation/`
- Deterministic generator: `python3 scripts/seed_capability_automation_manifest.py`
- Drift/completion check: `npm run check:capability-automation-complete`

The similarly named parser output under `ptu-data/data/` is documentary. `Sky` and `Levitate` intentionally retain the app-owned Groundsource immunity text. Every runtime definition binds the canonical effect SHA-256, reviewed semantic clauses, native handler identity, and a deterministic definition hash.

## Effective Capability projection

`server/domain/capabilityAutomation/effectiveCapabilities.ts` is the authority for a placed participant. It combines, in deterministic precedence order:

1. species or Trainer formula baselines;
2. sheet overrides and typed parameters;
3. reviewed Move grants and numeric bonuses;
4. static Feature and Edge grants;
5. effective Ability grants;
6. form, mount, and fusion substitutions;
7. encounter grants and suppressions.

Unknown legacy labels remain visible as maintenance facts but cannot enter mechanics. Accepted parameter forms include numeric movement/Power values, `Jump L/H`, `Mountable X`, `Naturewalk (...)`, Planter categories, and reviewed aliases. Sources remain attached to each projected instance.

## Presentation and commands

Capabilities do **not** create a universal action menu. `buildCapabilityClientCapabilityBundle` emits:

- passive facts for controlled participants;
- source-owned offers only when their authoritative context exists;
- unavailable reason codes for costs, level gates, and usage;
- GM-only pending-adjudication summaries.

Those values adapt into the generic Encounter Presentation contract. A consequential offer posts a strict `ExecuteCapabilityActionCommand` to `/api/maps/capabilities/execute`. Coordinates, targets, options, items, recipients, and bounded descriptions are choices only; the server reconstructs the current instance, offer, rule definition, geometry, resources, and result.

## Map-owned context resources

World facts that cannot be inferred from token geometry must be authored by the GM as bounded map metadata. Supported keys are:

- `capabilityContexts: string[]` — context identities such as `city-or-town`, `abundant-plant-life`, `scent-trail`, or an exact `suitable-mount:<rider>:<mount>` approval;
- `capabilityWillingTargets: string[]` — exact `<actorPlacementId>:<targetPlacementId>` consent identities;
- `capabilityEggs: { id, hatchHours }[]` — Egg Warmer resources;
- `capabilityKeystones: { id, position, synchronizedPlacementIds }[]` — synchronized Odd Keystones;
- `capabilityDevices: { id, position, networkId }[]` — Wired entry and connected exit points.

Accepted bounded world changes, generated Unown summaries, and operation IDs are retained in metadata and the SQLite operation ledger. These are authoritative campaign records, not browser decisions.

## Runtime state and time

Temporary state lives in `encounterState.capabilityRuntime`:

- modes (invisible, intangible, inflated, shrunken, shadow-melded, illusion, forms, and machine entry);
- mount, rider, Living Weapon, fusion, Letter Press, and Zygarde links;
- encounter usage, Telepathy retry penalties, and pending adjudications.

Lasting usage and campaign resources live on sheets:

- `capabilityUsage` records daily, weekly, hourly, and cooldown identities;
- `capabilityCampaignState` records Juicer stages and Planter contents.

Campaign-day advancement clears Daily uses and decrements Weekly uses. Juicer binds one exact held Berry custody epoch and materializes elapsed time on authoritative offers, execution, persistence, and campaign-day advancement: after 24 elapsed hours the Berry becomes the independent shell item `Shuckle’s Berry Juice` (`shuckles-berry-juice`), and untouched shell juice becomes `Rare Candy` (`rare-candy`) after 14 further elapsed days. Legacy held items are strings, so the server retains a custody fingerprint and start timestamp and resets them on representable held-item changes; converted shell contents no longer depend on the held slot or continued Capability source. Shuckle may consume only the juice stage as its own typed Snack; collection requires an explicitly selected linked Trainer and emits the canonical item identity. Hourly and Invisibility cooldowns use server timestamps. Phasing’s round-end Tick is emitted by the initiative lifecycle reducer.

## GM adjudication

Canonical judgement is represented by a durable request, not a manual fallback:

1. the initial command is re-authorized and written to `capability_adjudications` with its definition hash and expiry;
2. only a GM receives the pending offer;
3. accept/reject uses `/api/maps/capabilities/adjudications/resolve`;
4. acceptance revalidates the source instance, current contextual offer, target/resource state, and definition hash;
5. the retained choice is committed atomically and the exact resolution operation is replay-safe.

Low-Loyalty Fortune uses this same path conditionally. A retained `returns` result awards the server roll; `runs-away` removes the participant from play without awarding money.

## Mechanical integration

Capability providers extend existing systems rather than bypassing them:

- movement and pathfinding: valued speeds, Jump, Teleporter, Burrow upkeep, Wallclimber, Phasing, Naturewalk, mounts/fusion, size modes, Threaded, and Keystone Warp;
- Move automation: Reach, Groundsource immunity, Stealth targeting, Invisibility/Phasing targetability, Blender/Shadow Meld Evasion, Mindlock, Blindsense, Soulless, forms, move and Ability grants;
- Struggle automation: Firestarter, Fountain, Freezer, Guster, Materializer, Zapper, and Telekinetic variants;
- inventory/campaign operations: Collection Jars, daily/weekly products, Mushroom rolls, Fortune, Egg Warmer, Juicer, Planter, and Zygarde Cube tutoring;
- links: shared movement, carried target restrictions, As One shared fainting, Living Weapon No Guard suppression and granted Moves, and Viral Fusion substitutions.

## Operations and recovery

Capability resolutions, rolls, produced resources, definition/source hashes, and command payloads are retained in SQLite. Exact operation retries return the stored public result; changed input under the same operation ID is rejected. Map and all sheet writes use one SQLite transaction and optimistic revisions. Realtime events publish only after commit. Pending adjudications survive restart and reject stale, expired, or definition-drifted resumes.

Backups and SQLite export include the operation and adjudication tables through normal campaign database backup/export. No production code or campaign data is changed directly by this feature branch; deployment remains GitHub-driven.

## Contributor checklist

1. Change canonical source only intentionally and regenerate metadata.
2. Add or update strict parameters and reviewed semantic clauses—never parse prose during execution.
3. Put passive behavior into the owning query and activated behavior behind a contextual offer.
4. Validate all targets, geometry, inventory, time, and choices again on the server.
5. Keep temporary encounter state separate from sheet/campaign state.
6. Add replay, stale-state, source-loss, prevention, boundary, and interaction tests.
7. Run `npm run check:capability-automation-complete`, `npm run typecheck`, focused tests, and `scripts/quality-gate.sh`.
