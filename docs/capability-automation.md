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

- `capabilityContexts: string[]` — context identities such as `city-or-town`, `abundant-plant-life`, `scent-trail`, map-wide `deep-darkness` / `total-darkness`, placement-scoped `deep-darkness:<placementId>` / `total-darkness:<placementId>`, or an exact `suitable-mount:<rider>:<mount>` approval;
- `capabilityWillingTargets: string[]` — exact `<actorPlacementId>:<targetPlacementId>` consent identities;
- `capabilityKeystones: { id, position, synchronizedPlacementIds }[]` — synchronized Odd Keystones;
- `capabilityDevices: { id, position, networkId }[]` — Wired entry and connected exit points.

Accepted bounded world changes, generated Unown summaries, and operation IDs are retained in metadata and the SQLite operation ledger. These are authoritative campaign records, not browser decisions.

### Retired Egg map boundary

Egg Warmer remains a canonical Capability, but its activated effect delegates to `breeding.v1`. The map bundle may project the effective Capability as a source-labelled fact; it never offers `warm-egg`. `map.metadata.capabilityEggs` and `hatchHours` are retired, quarantine-only legacy keys with no production reader or writer. The Breeding Workshop rebuilds one current effective Capability handoff and applies `apply-egg-warmer-capability` to a first-class Egg with campaign-time cooldown, persisted randomness, exact retry, and atomic Egg settlement.

## Physical Power loads

Ordinary lifting, carrying, pushing, and pulling use exact GM-authored `metadata.capabilityObjects` entries with a unique `id`, in-bounds `position`, and positive finite `pounds`. A contextual **lift-load** offer selects 1–16 adjacent objects and spends a Standard Action; **release-load** detaches the exact source-owned load and spends a Shift Action. The server combines authoritative pounds and classifies them against the frozen Power 1–16 chart. Drag Weight is exclusive: a load equal to the printed limit is too heavy.

Physical attachments retain the exact Power instance. Heavy and Staggering penalties are projected into Speed CS, movement, Initiative, Accuracy, and Evasion consumers, including Moves, Abilities, maneuvers, Capability attacks, and Poké Ball throws. Staggering permits only one metre per Shift, prevents Standard Actions, and requires an authoritative Athletics DC 4 check on attachment and at each round start. Drag permits one total metre in the authoritative round. Attached objects follow successful movement. A failed Staggering check, fainting, suppression, source replacement/removal, recall, or placement loss detaches the load without deleting or relocating its object identity.

Raw object attachments, pounds, operation IDs, and round ledgers are removed from player map projection. Authorized action offers expose only the bounded object label and exact weight needed to make the selection.

## Living Weapon attack provenance

Native Moves and each exact Living Weapon source remain separate menu and Encounter Presentation rows, even when their Move names match. A sourced row carries an opaque `attack-source.v1.<sha256>` selector derived from the map, acting placement, and exact link incarnation. The selector is public presentation data, not authority: every declaration and resume revalidates the current source-effective link, weapon sheet, wielder rank, and granted Move and includes the consulted weapon/wielder sheets in the optimistic read set. Disengagement and re-engagement produce a new selector, so stale rows fail closed.

Move intent is deliberately tri-state: an opaque string selects that exact source, `null` selects only a native/source-less row, and an omitted field is legacy compatibility that prefers native and otherwise accepts only one unique sourced row. New pending records persist string or `null`; multi-window rematerialization, reconnect, replay, and post-Move follow-ups preserve it. Raw link IDs, Capability instance IDs, configuration IDs, and source operation IDs are never projected. A fainted actor cannot initiate a Move, but a non-fainted wielder may still attack through a fainted Living Weapon; its `-2` applies only to Accuracy and Damage rolls made through that exact selected source. Native attacks and other linked weapons do not inherit it.

## Runtime state and time

Temporary state lives in `encounterState.capabilityRuntime`:

- modes (invisible, intangible, inflated, shrunken, shadow-melded, illusion, forms, and machine entry);
- mount, rider, Living Weapon, fusion, Letter Press, and Zygarde links;
- encounter usage, Telepathy retry penalties, timed Alluring lure and Fortune roam tasks, and pending adjudications.

Lasting usage and campaign resources live on sheets:

- `capabilityUsage` records daily, weekly, hourly, and cooldown identities;
- `capabilityCampaignState` records Juicer stages and Planter contents.

Campaign-day advancement clears Daily uses and decrements Weekly uses. Fortune first spends its Daily use and persists an exact source-owned roam incarnation; no money is rolled until a separate authorised resolution at least one server-timed hour later. A pending GM adjudication is bound privately to that exact incarnation, so it cannot resolve a later replacement roam. Abandonment or source loss removes the task and its resumable summary without refunding the use. Juicer binds one exact held Berry custody epoch and materializes elapsed time on authoritative offers, execution, persistence, and campaign-day advancement: after 24 elapsed hours the Berry becomes the independent shell item `Shuckle’s Berry Juice` (`shuckles-berry-juice`), and untouched shell juice becomes `Rare Candy` (`rare-candy`) after 14 further elapsed days. Legacy held items are strings, so the server retains a custody fingerprint and start timestamp and resets them on representable held-item changes; converted shell contents no longer depend on the held slot or continued Capability source. Shuckle may consume only the juice stage as its own typed Snack; collection requires an explicitly selected linked Trainer and emits the canonical item identity. Hourly and Invisibility cooldowns use server timestamps. Phasing’s round-end Tick is emitted by the initiative lifecycle reducer.

## GM adjudication

Canonical judgement is represented by a durable request, not a manual fallback:

1. the initial command is re-authorized and written to `capability_adjudications` with its definition hash and expiry;
2. only a GM receives the pending offer;
3. accept/reject uses `/api/maps/capabilities/adjudications/resolve`;
4. acceptance revalidates the source instance, current contextual offer, exact task incarnation when applicable, target/resource state, and definition hash;
5. the retained choice is committed atomically and the exact resolution operation is replay-safe.

Fortune’s due roam resolution uses this path. A retained `returns` result performs the delayed server roll and awards it to one exact linked Trainer; the low-Loyalty-only `runs-away` result removes the participant from play and every linked roster without awarding money.

Explosion and Self-Destruct use the durable Move-response pipeline because their ordinary damage, unavoidable `-50%` full-Max-HP result, and optional Loyalty consequence belong to one Move transaction. Unless the user has effective Volatile Bomb, the Move suspends behind one GM-only choice to lower Loyalty by exactly one rank or keep it. Resume revalidates every retained revision and atomically commits target damage, self-HP, usage, and the chosen bounded Loyalty change. Effective Volatile Bomb omits both the prompt and Loyalty mutation. Raw Loyalty and the Loyalty changed-field scope are removed from player sheet/realtime projections.

## Mechanical integration

Capability providers extend existing systems rather than bypassing them. Source-effective Intangible, Shadow Meld, Shrinkable, and major-Illusion modes are rechecked on the server at every Standard/Full action surface (including Capability actions, Abilities, maneuvers, orders, and Poké Ball throws); Shrinkable permits only its explicit restore action.

- movement and pathfinding: valued speeds, Jump, Teleporter, Burrow upkeep, Wallclimber, Phasing, Naturewalk, mounts/fusion, size modes, Threaded, and Keystone Warp;
- Move automation: Reach, Groundsource immunity, Stealth targeting, Invisibility/Phasing targetability, Blender/Shadow Meld Evasion, Mindlock, Darkvision/Blindsense darkness handling, Soulless, self-KO Loyalty adjudication, forms, move and Ability grants;
- Struggle automation: Firestarter, Fountain, Freezer, Guster, Materializer, Zapper, and Telekinetic variants;
- inventory/campaign operations: Collection Jars, daily/weekly products, Mushroom rolls, Fortune, Juicer, Planter, and Zygarde Cube tutoring; Egg Warmer activates only through the Breeding Workshop campaign aggregate;
- links: shared movement, carried target restrictions, As One shared fainting, Living Weapon No Guard suppression and granted Moves, and Viral Fusion substitutions.

## Operations and recovery

Capability resolutions, rolls, produced resources, definition/source hashes, and command payloads are retained in SQLite. Exact operation retries return the stored public result; changed input under the same operation ID is rejected. Map and all sheet writes use one SQLite transaction and optimistic revisions. Realtime events publish only after commit. Pending adjudications survive restart and reject stale, expired, or definition-drifted resumes. Player HTTP responses and nested realtime patches receive a final recursive privacy projection: raw Capability runtime, source ledgers, Capability-prefixed map metadata, private effects, and hidden sheet usage/campaign state are removed even when an accepted command embeds a whole authoritative map.

Backups and SQLite export include the operation and adjudication tables through normal campaign database backup/export. No production code or campaign data is changed directly by this feature branch; deployment remains GitHub-driven.

## Contributor checklist

1. Change canonical source only intentionally and regenerate metadata.
2. Add or update strict parameters and reviewed semantic clauses—never parse prose during execution.
3. Put passive behavior into the owning query and activated behavior behind a contextual offer.
4. Validate all targets, geometry, inventory, time, and choices again on the server.
5. Keep temporary encounter state separate from sheet/campaign state.
6. Add replay, stale-state, source-loss, prevention, boundary, and interaction tests.
7. Run `npm run check:capability-automation-complete`, `npm run typecheck`, focused tests, and `scripts/quality-gate.sh`.
