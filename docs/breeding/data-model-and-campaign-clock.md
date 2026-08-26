# Breeding data model and campaign-clock semantics

## Authority model

Breeding uses strict immutable evidence around mutable revisioned aggregates. Runtime facts come from app-owned `data/reference/*.json`, versioned Breeding contracts, current SQLite rows, and current effective provider handoffs. Documentary books, parser inputs, maps, browser state, and legacy sheet fields are not runtime authority.

The principal aggregates are:

- **Breeding Project** — parent selectors/snapshots, owner and Breeder Trainers, immutable campaign options, timeline, check result, status, revision, and accepted Egg link.
- **Pokémon Egg** — dedicated pre-hatch aggregate containing source provenance, frozen offspring blueprint, parent snapshots, incubation, hatch-special state, status, revision, and eventual child link.
- **Pokémon sheet** — created only during accepted hatch completion. It is not the Egg.
- **Campaign clock** — singleton monotonic campaign minute/revision authority used by every lifecycle, expiry, correction, and cooldown rule.
- **Operation** — immutable command identity plus durable read set, authorization receipt, GM overrides, offers, rolls, result, and conflict scopes.

An Egg is never a sheet flag, inventory item, token, map object, encounter object, roster entry, or Pokémon identity before hatch.

## Stable identities and revisions

Typed IDs identify the aggregate family and include a versioned opaque suffix. A client may submit an ID only as a selector. Current role/Profile/Trainer control and expected revision must still be rebuilt server-side.

- Project identity is stable across Project revisions.
- Egg identity is stable across ownership, incubation, readiness, special review, and hatch revisions.
- Parent snapshots retain the selected sheet slug, exact accepted revision, canonical Species/family facts, and contribution provenance even if a live parent later changes.
- A child sheet slug is allocated and owned by Pokémon storage during hatch. Pokémon storage owns its `slug`, `folder`, `revision`, `createdAt`, and `updatedAt`.
- Species acquisition identity is exactly `(trainerSheetSlug, speciesId)` and survives release.

Revision checks prevent lost updates; they do not authorize access. A stale revision requires a fresh projection or a typed recovery path, never an in-place edit.

## Project aggregate

The closed Project statuses are:

1. `draft`;
2. `awaiting-parent-consent`;
3. `initial-time-in-progress`;
4. `check-ready`;
5. `additional-time-in-progress`;
6. `ready-to-produce`;
7. `egg-produced`;
8. `check-failed`;
9. `cancelled`;
10. `expired`;
11. `abandoned`;
12. `conflicted`.

Only the first six are active. A Project stores two exact parent refs, owner/Breeder Trainer identities, frozen ruleset/options, initial and additional campaign-minute counters, check checkpoint/result, dependency definitions, and accepted Egg identity where applicable.

Project consent is separate immutable evidence. Cross-owner setup may create only `awaiting-parent-consent`. The final required current consent advances the ordinary Project; no consent is embedded as a browser boolean.

A parent may participate in at most one active Project. The repository enforces this atomically rather than relying on a prior list query.

## Egg aggregate

The closed Egg statuses are:

1. `incubating`;
2. `ready`;
3. `awaiting-special-adjudication`;
4. `hatching`;
5. `hatched`;
6. `cancelled`;
7. `invalidated-by-gm`.

Source kinds are `breeding`, `fossil`, `gm`, and `feature-artificial`. Each source uses typed provenance and the same Egg/incubation/hatch pipeline.

The frozen offspring blueprint owns accepted Species/family identity, Nature resolution, Basic Ability resolution, Gender resolution, starting Level, inheritance candidates, Baby Template decision/effects, and provider traits. Accepted rolls and offers are referenced by durable evidence. Live parent retraining, evolution, rename, transfer, deletion, or reference changes do not rewrite an accepted Egg.

Incubation stores average/target/accumulated campaign minutes, duration policy evidence, last applied clock revision/minute, readiness minute/kind, pause state, and operation links. Hatch-special stores one persisted d100 and later adjudication/outcome where required. Terminal hatch stores the child link and accepted settlement facts.

Ownership transfer changes only ownership metadata and revision. It preserves source, blueprint, parents, incubation, and hatch state byte-semantically. The two transfer consent roles remain durable evidence after consumption.

## Operation and evidence model

Every mutating workflow reserves one typed operation before mechanics application. Durable phase-one evidence may include:

- exact canonical command and command hash;
- conflict scopes and expected revisions;
- complete read set and current reference versions;
- authorization receipt and any exact GM override documents;
- server-issued offers and selected opaque option identities;
- persisted randomness;
- reviewed adjudications and provider dependencies.

Phase two runs in one caller-owned synchronous transaction. The result is either accepted or rejected and references exact aggregate revisions/scopes. A pending row means phase one survived while phase two did not settle. Recovery must use the same command and current authority. A terminal exact retry returns stored evidence without rerunning mechanics or publication.

Operation IDs are replay keys, not user-generated authorization. Reusing one with different command bytes is an identity collision.

## SQLite persistence map

The current application runtime schema is version 56. The standalone offline import migrator remains intentionally version 28: it creates the reviewed Breeding import boundary, then application migrations 29 through 56 run when the runtime opens that database. Schema 39 adds the bounded guided-item request journal, schema 40 adds the replay-safe unified inventory-action declaration/result journal, schema 41 preserves those rows while admitting split, merge, and discard action kinds, schema 42 adds the atomic encounter-settlement journal, immutable history facts, and authority-linked attention sources, schema 43 adds immutable authority-linked settlement corrections, schema 44 preserves guided-request rows while admitting the bounded campaign-tool adjudication request kind, schema 45 adds the guided-onboarding policy, slot, draft, submission, review, operation, and completion tables, schema 46 adds authoritative Contest documents, operations, preparation operations, and aggregate-only UX metrics, schema 47 adds replay-safe encounter equipment-action operations, schema 48 preserves guided-request rows while admitting durable fishing declarations, schema 49 row-preservingly admits bounded Snag Machine conversion adjudication, and schema 50 adds versioned generic Skill Check documents plus replay-safe operation journals; none creates a second Egg lifecycle. Core tables are grouped by responsibility:

### Aggregates and lifecycle

- `breeding_projects` — revisioned strict Project JSON plus indexed owner/parent/status facts.
- `pokemon_eggs` — revisioned strict Egg JSON plus owner/status/child/source facts.
- `breeding_incubation_segments` — immutable credited/skipped/overflow campaign-time segments.
- `pokemon_breeding_origins` — immutable child lineage/origin record.
- `breeding_inheritance_learning_records` — immutable Level-20-through-100 inheritance checkpoint settlements.
- `trainer_species_acquisitions` — first immutable Trainer/Species acquisition and reward fact.
- `trainer_species_acquisition_source_operations` — terminal external capture/setup/trade/migration source settlements.
- `sheets` — Trainer and post-hatch Pokémon documents; never an Egg table.

### Consent and review

- `breeding_consents` — Project participant consent history.
- `pokemon_egg_transfer_consents` — linked source-gift and recipient-acceptance history.
- `breeding_option_offers` — command-bound server choices and consumption status.
- `breeding_rolls` — persisted server randomness.
- `breeding_checks` — immutable Breeder check results.
- `breeding_gm_adjudications` — reviewed choices/corrections.

### Operation authority

- `breeding_operations` — command, status, result, revision, and timestamps.
- `breeding_operation_scopes` — normalized conflict scopes.
- `breeding_read_sets` — immutable complete current observations.
- `breeding_authorization_receipts` — exact authorization decision/evidence links.
- `breeding_gm_overrides` — strict bounded override documents referenced by receipts.
- `item_breeding_operations` — principal-bound exact command/result/evidence replay for Egg Warmer, Fossil restoration, and Artificial Egg orchestration.
- `inventory_action_operations` — principal-bound pending/accepted declarations, private owning-handoff commands, atomic bidirectional Trainer/group transfer receipts, and replay-safe authoritative results for unified equip, give, and transfer actions.
- Trainer `sheets.serverPrivate.itemBreeding` — private exact Egg Warmer unit/Egg assignment authority; public and owner sheet projections omit it.

### Clock, delivery, and archives

- `campaign_clock` — singleton revision/minute/last-operation authority.
- `realtime_events` and `realtime_event_log_state` — restricted refresh publication and replay cursor.
- `breeding_archives` — canonical archive/request evidence.
- `breeding_archive_import_requests` — immutable import/restore requests.
- `breeding_archive_restore_receipts` — terminal atomic restore evidence.

Repositories strictly parse rows on load and use bounded pagination. Storage helpers do not start nested transactions. Callers own one synchronous transaction for all participants.

## Transaction groups

### Project creation and progress

Project creation settles current setup validation, consent state, adjudications/offers, operation evidence, Project insertion, and restricted refreshes together. Time advancement credits only a currently active exact Project and appends immutable evidence. Check resolution persists its d20 before applying the outcome.

### Egg production

Production revalidates the Project, check/timeline, parents or accepted snapshots, current references, options, offers, provider evidence, and rolls. It consumes offers, inserts one Egg, advances the Project to `egg-produced`, settles the operation, and publishes restricted refreshes atomically.

### Breeding-item orchestration

Egg Warmer assignment updates one Trainer's private exact unit/Egg custody state and its replay receipt together. Campaign-day incubation independently revalidates that unit, current owner, assigned Egg, contribution evidence, and campaign checkpoint; missing custody fails closed to the base rate. Fossil and Artificial Egg workflows adapt the existing source-Egg transaction boundary: only accepted Fossil restoration consumes its exact source, all three tools remain reusable, and every created Egg enters `pokemon_eggs` through the shared lifecycle rather than a parallel offspring path.

### Campaign-clock batch

The dedicated Breeding batch command advances the singleton clock once. Up to 100 due Eggs are handled in canonical order through deterministic child operation IDs. Each child transaction writes the Egg successor, one incubation segment, operation evidence/result, GM override evidence, and refreshes. A fault may leave a durable completed prefix; continuation at the same target minute reuses that prefix and handles only remaining due Eggs.

The campaign-day command is a stricter orchestration boundary: one reviewed day advances exactly 1,440 campaign minutes and atomically settles the clock, campaign-day sheet recovery, live-map timed effects, and every Egg behind the exact successor checkpoint. It may reuse the same deterministic Breeding child evidence, but it cannot accept a partial Egg prefix or report completion while any due Egg remains. Any Egg or aggregate failure rolls the whole campaign-day operation back; an exact retry replays the accepted receipt without writes or publication.

### Ownership transfer

Transfer consumes one current source-gift and one linked current recipient-acceptance, updates the Egg owner/revision, settles one operation, and publishes former/new owner refreshes in one transaction. Neither consent is inferred or reconstructed.

### Hatch completion

Completion atomically inserts the initialized child sheet, exactly one Trainer Box/team link, lineage origin, first Species acquisition and any one Dex Exp reward, Egg terminal successor, inheritance checkpoints due at starting Level, operation result, and restricted refreshes. No accepted partial child may survive rollback.

## Campaign-clock semantics

### Singleton authority

`campaign_clock` contains one nonnegative safe integer `campaignMinute`, one monotonically increasing `revision`, and the operation that last advanced it. Only an accepted `advance-campaign-clock` command changes the minute. The target cannot move backward.

Wall-clock time is never read to award lifecycle progress. Request rate windows, browser timestamps, realtime timestamps, file modification times, and archive times are not campaign time.

### Project timeline

An ordinary Project requires:

- exactly 240 credited campaign minutes before the check becomes ready;
- one persisted d20 check against DC 12;
- on success, exactly 240 additional credited campaign minutes;
- at least 480 total credited campaign minutes before Egg production.

Failure/cancellation/interruption follows the typed lifecycle policy. Corrections create auditable successors and do not edit past credit.

### Egg incubation

At each clock advance, eligible Eggs receive the interval since their exact last applied clock checkpoint. Approved providers transform target-equivalent credit through persisted evidence; they do not change the clock. Paused Eggs record skipped time. Credit stops at the immutable target and readiness is assigned to the exact campaign minute at which the threshold was reached. Any remaining interval is recorded as overflow, not hidden extra progress.

Readiness correction is GM-audited and monotonic. It cannot use wall time or silently rewrite accepted duration evidence.

### Long skips and bounded continuation

The dedicated Breeding batch workflow selects at most 100 incubating Eggs behind the target clock in canonical Egg-ID order. `hasMoreDueEggs: true` means the GM/operator must issue a fresh equal-target command using the new clock revision and exact remaining scopes. Equal-target continuation is valid because the singleton minute is already current while remaining Eggs still have older checkpoints.

Never increase that Breeding batch page ad hoc, process children out of order, or start one nested transaction around its child operations. Prefix recovery is part of the dedicated batch model. The campaign-day command has a different reviewed contract: it discovers all Eggs due at its exact successor checkpoint before mutation and either commits every child inside the global day transaction or commits none.

### Expiry and cooldown

Consent expiry, offer expiry, provider cooldowns, lifecycle recovery, transfer settlement, and any reviewed duration window compare only to current campaign minute. Equality at expiry means expired. Advancing browser or system time cannot expire or satisfy authority.

## Projections and privacy

Storage documents are never sent wholesale to all audiences. Server builders produce distinct public, owner, participating-owner, GM, and diagnostic schemas. Public identity may be HMAC-derived; owner projections expose only controlled facts; participating owners receive only their own parent/consent contribution; GM sees strict mechanics when authorized; diagnostics contain bounded hash/status traces.

Realtime events carry refresh information and authorized targets, not full commands or mechanics. CSS is never the privacy boundary.

## Archive and migration model

Campaign backup includes all restorable authoritative records and complete evidence chains, including transfer consents, GM overrides, external Species-acquisition settlements, clock checkpoint, Projects, Eggs, lineage, learning, offers, rolls, checks, and adjudications. Archives are strict canonical JSON, self-hashed, chunked, and bounded to 64 MiB UTF-8.

Restore requires current GM authority, exact current app-owned references, synchronous validation, and one atomic replacement transaction. A new-campaign target must be empty. Orphan repair is an out-of-place restore of a reviewed known-good backup; diagnostics alone never authorize mutation. Legacy map Egg metadata remains quarantined and legacy lineage cannot manufacture authority.

## Invariants for schema changes

A schema or repository change is incomplete unless it preserves:

- application/offline migration byte parity and historical migration meaning;
- strict row parsing and restart behavior;
- exact retry and operation evidence;
- transaction ownership without async/nested callbacks;
- archive export/import/restore and integrity diagnostics;
- role-projected privacy and restricted realtime delivery;
- current reference/version checks;
- focused rollback, concurrency, migration, and production-like acceptance.

See `docs/breeding/contributor-guide.md` for the change procedure and `docs/breeding/operator-guide.md` for incident handling.
