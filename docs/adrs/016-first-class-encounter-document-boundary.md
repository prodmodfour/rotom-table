# ADR 016: First-class encounter document boundary

- Status: Accepted
- Date: 2026-08-04

## Context

The map-backed Encounter Workspace proved that battlefield, sheet, initiative, automation, and accepted-history authorities can be projected into a Battle Cockpit without a new aggregate. It also proved that several GM authoring concepts have no truthful owner in those aggregates:

- an encounter identity distinct from a reusable battlefield;
- lifecycle and recipe identity;
- initial reveal orchestration and presentation roles;
- reserves and reinforcement waves;
- objectives, clocks, phases, stakes, and GM notes; and
- encounter-level presentation defaults.

Storing those facts in map metadata would make a reusable battlefield equal to one encounter, mix private story state into map projection, and create unbounded untyped metadata. Storing them in sheets or automation state would give presentation/story data mechanical authority it does not own. Keeping them only in the browser would lose restart/reconnect authority and violate privacy.

At the same time, a broad “Encounter aggregate” that copied participants, HP, conditions, initiative, geometry, sides, pending choices, or action history would create contradictory authorities.

## Decision

Introduce a strict schema-v1 `EncounterDocument` with its own stable `encounterId` and revision. It links to exactly one authoritative `linkedMapSlug` but does not copy battlefield or mechanics state.

The document owns only:

1. encounter name, lifecycle, recipe, and presentation defaults;
2. the set of map participant IDs currently hidden by encounter reveal orchestration;
3. presentation-only cast roles;
4. reserve and wave plans, including references to authoritative sheets, sides, and deployed map placements;
5. structured objectives, clocks, phases, public/GM stakes, and GM notes; and
6. creation/update metadata and its own monotonic revision.

Existing owners remain authoritative:

| State | Authoritative owner |
| --- | --- |
| cells, terrain, hazards, lights, token positions and facing | battlefield map |
| side definitions and placed participant side membership | battlefield map |
| scene and initiative | battlefield map and existing revision-bound commands |
| Pokémon/Trainer identity, HP, injuries, conditions, resources and inventory | sheets and mechanics state |
| action offers, legality, costs, targets and accepted effects | source automation use cases |
| pending interactions and private options | pending-interaction authority |
| accepted mechanics history, correction and replay | existing encounter mechanics/history state |
| live presence, camera, selection and tactical rendering | realtime/presentation layers; never the document |

A document reference is validated against an authoritative, revision-aligned map snapshot before projection. Missing hidden/cast/wave/deployed participant references fail closed. A non-GM projection removes hidden participants and all GM-only story rows before serialization. CSS is not a privacy boundary.

`/play/:encounterId` resolves a document identity first and then loads its linked map. During migration, a map slug with no document remains a compatibility encounter. `/play` lists document-backed encounters by document identity and lists only unclaimed maps as compatibility rows, preventing duplicate discovery.

Document commands use compare-and-swap revision checks and replay-safe operation receipts. Cross-owner transitions such as deployment must update document, sheet/map references, and durable events transactionally or not at all. Encounter Builder launch follows the same rule.

## Consequences

- Multiple historical or draft encounters may reference a reusable battlefield without changing map identity.
- Story state survives reconnect and restart and can be projected structurally by audience.
- The document stays small, bounded, exportable, and reviewable.
- The Battle Cockpit can display first-class names, lifecycle, recipes, objectives, clocks, phases, waves, and notes without inventing map metadata.
- Commands that touch map or sheet authority require explicit cross-repository validation and atomic persistence.
- The document cannot authorize mechanics, legal targets, movement, damage, initiative changes, sheet mutation, or private choice options.
- Map-only compatibility remains temporary and explicit rather than silently migrated.

## Rejected alternatives

### Make the map the encounter

Rejected because battlefields are reusable, map metadata is not a bounded story schema, and private encounter notes would become coupled to map visibility.

### Build a comprehensive encounter aggregate

Rejected because copying placements, sides, HP, initiative, actions, or accepted history creates dual authority and difficult reconciliation.

### Keep authoring state in local storage

Rejected because local state is neither server-authoritative nor shareable/recoverable and cannot enforce viewer privacy.

### Infer authoring state from prose or automation sources

Rejected because runtime authority belongs to reviewed app data and accepted commands; prose cannot safely define mutable campaign state.
