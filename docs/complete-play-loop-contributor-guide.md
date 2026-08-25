# Complete Play Loop contributor guide

## Sources of truth

Runtime PTU identity and mechanics come only from app-owned `data/reference/*.json`. For items, the source is `data/reference/items.json`. Books, PDFs, markdown, parser inputs, websites, wikis, and `ptu-data/data/` are provenance or documentary material, never runtime fallback.

Do not parse canonical effect prose at runtime. If structured data is absent or ambiguous, fail closed. Add or repair app-owned canonical data only through a reviewed, source-hash-bound migration.

## Item completion states

Every canonical row must appear exactly once in `data/complete-play-loop/item-catalog-cohorts.v1.json` under a reviewed provider:

- `native` — structured server mechanics and atomic mutation;
- `guided` — reviewed bounded GM choice, reservation/disposition, receipt, privacy, retry, and correction;
- `passive` — exact equipment/held source, compatibility, lifecycle, and contribution authority.

A blocked row is forbidden at acceptance. `reference-only` or `not-applicable` requires explicit proof that no concrete game mechanic is being hidden; neither is currently assigned. Provider counts include every known provider key, including reviewed zero-only sentinels.

## Adding or changing an item provider

1. Update the canonical structured source or reviewed provider registry.
2. Bind exact canonical record/effect fingerprints. Never key mechanics only by display text when stable identity exists.
3. Implement server-owned eligibility, choices, targeting, cost, reservation, mutation, history, replay, and privacy.
4. Keep clients command-only. A client may project or preview; it may not resolve or persist mechanics.
5. Add exact replay, stale authority, partial failure, restart, cross-tab/reconnect, and role-redaction tests.
6. Update the reviewed cohort policy and regenerate affected artifacts.
7. Run authority, scale, accessibility, failure, and golden gates appropriate to the changed surface.

Core commands:

```bash
python3 scripts/generate_complete_play_loop_item_catalog_cohorts.py
python3 scripts/generate_complete_play_loop_authority_guardrails.py
npm run check:complete-play-loop-item-catalog-closure
npm run check:complete-play-loop-authority-guardrails
```

Do not hand-edit a generated fingerprint to silence drift.

## Canonical-data repair

A repair must include:

- reviewed migration ID and input source fingerprint;
- exact before/after record or field evidence;
- deterministic idempotent migration and `--check` mode;
- regenerated catalog, ItemSpec/provider, cohort, certification, and successor hashes;
- focused semantics and drift tests;
- documentation of the new runtime meaning.

Black Sludge is the reference pattern: a reviewed acquisition-cost repair plus a native Poison-only turn-start Digestion Buff. The migration did not infer mechanics from prose at runtime.

## Transaction and storage rules

Inventory writes belong only to reviewed pure reducers, transaction-planned migrations, transaction repositories/use cases, or projection redaction. P8-094 pins every direct inventory assignment and count. Adding one requires ownership review.

Choice-bearing operations persist the exact bounded choice authority and revalidate it on resume. Consumption and every affected revision commit together. Publish realtime only after commit. Terminal operation IDs replay the same immutable result; divergent reuse fails.

SQLite schema changes must preserve existing rows and indexes through an explicit migration. Update `LATEST_STORAGE_SCHEMA_VERSION`, fresh-install tests, predecessor-to-current migration tests, and documentation. Never bypass an existing CHECK constraint in runtime code.

## Settlement ownership

Every root field of `EncounterSettlementDocument` has one or more declared providers. A new field must be assigned to a current reader/writer/revalidator and included in atomic commit or explicit read-only authority. After any change to `shared/encounterSettlement/document.ts`, recompute its SHA-256 and update every `settlementDocumentModelSha256` pin.

## UI contribution rules

Load the global `ui-design-workflow` pi skill before visible work. Follow `DESIGN.md`, role-safe projections, and current tokens. Preserve semantic tables, CSS-only mobile reflow, approximately 44-pixel controls, cyan focus/selection, red destructive semantics, reduced motion, no horizontal overflow, and established focus restoration.

Generate a target mockup for substantive open visual decisions. Skip it only when the edit is provably non-visual or an exact accepted pattern, and record why.

## Deferred Mechanics Closure extensions

The six ranged profiles, all twelve supplemental weapon Moves, eleven previously incomplete item actions, generic Skill Checks, Trainer Participant Contests, and Battle Contests are current native/guided authorities. Use [Deferred mechanics closure](deferred-mechanics-closure.md) as the cross-surface authority map.

Ranged and weapon actions must continue through equipment grants, the ordinary Encounter presentation, Move planning, action/resource ledgers, map/sheet CAS, accepted history, and exact operation replay. Supplemental weapon Moves stay in `shared/capabilityAutomation/weaponMoves.ts`, outside the frozen Pokémon Move catalog, and fail closed for Contest appeal identity.

Item actions extend the equipment-action or bounded guided-request lifecycle; do not add direct sheet/UI mutation. Generic Skill Checks extend `shared/skillChecks/*` and the schema-v50 repository/use cases. Contest variants extend `ContestDocument` and its distinct public/owner/GM/diagnostic projections. Battle coordination exchanges typed immutable facts and local plans; Encounter and Contest code must not directly rewrite each other's documents.

For every change, preserve complete read sets, server-owned randomness, synchronous transaction planning, post-commit realtime publication, exact retry, role-safe projections, and accepted successor-chain continuity. Run the focused closure gate for the touched cohort before broad validation.

## Required review gates

```bash
npm run check:complete-play-loop-authority-guardrails
npm run check:complete-play-loop-performance
npm run check:complete-play-loop-accessibility-visual
npm run check:complete-play-loop-concurrency-failure
npm run check:complete-play-loop-golden-campaigns
npm run check:deferred-closure-golden-journeys
npm run check:deferred-closure-migrations
npm run check:deferred-closure-backup-restore
npm run check:deferred-closure-accessibility
npm run check:deferred-closure-performance
npm run check:deferred-closure-privacy
npm run check:deferred-closure-docs
```

Use focused one-worker tests while developing. Reserve full test, build, and `scripts/quality-gate.sh` for closure.
