# Campaign injury, treatment, and recovery attention

P8-087 detects current sheets that still need medical attention, an Extended Rest, one or more campaign-day transitions, condition follow-up, or resource recovery. Detection is read-only. It never heals HP, removes an Injury or condition, starts treatment, advances time, or clears a resource.

## Complete current authority

Projection requires one explicitly complete read of:

- at most 10,000 current Pokémon and Trainer sheets with exact non-negative revisions;
- the single strict schema-v1 campaign clock; and
- at most 10,000 durable item-operation records.

Sheet and operation identities must be unique. A malformed clock rejects the projection. A malformed individual sheet, contradictory derived HP, invalid resource ledger, forged treatment marker, missing treatment operation, stale item definition, or overdue unmaterialized treatment becomes blocking repair work rather than being interpreted permissively.

The detector uses the same HP, Injury, daily Injury limit, Extended Rest, and next-day functions as sheet healing and campaign-day advancement. It does not recreate those mechanics from labels or documentary text. Ordinary natural recovery is reported as one Injury per authoritative next-day transition. Five or more Injuries explicitly explains that natural HP recovery is blocked; ten Injuries and malformed state are blocking.

## Medical treatment authority

An active Bandages or accepted Poultices lifecycle is valid only when all of these agree:

- the strict sheet-local treatment state and containing sheet identity;
- the current runtime item definition and definition SHA-256;
- one accepted item-operation result;
- one completion-phase Extended Action snapshot at the exact application campaign minute;
- one exact target authority and pre-write sheet revision; and
- one exact `apply-medical-treatment` operation payload with the reviewed duration, tick, healing, Injury, HP-loss, and daily-limit policy.

The source operation and treatment identities never enter campaign attention output. Terminal treatment rows remain bounded history; only an active row requires its accepted source operation in the complete read. An active row whose next tick is already at or before current campaign time is invalid because authoritative time advancement should have materialized it atomically.

## Recovery reasons

The internal detector returns ordered, structured need and explanation codes. They cover:

- zero or negative HP, HP below the current Injury-adjusted healing cap, remaining Injuries, five-plus Injuries, and the daily Injury-healing cap;
- canonical or legacy condition/status follow-up;
- accepted active treatment and remaining campaign minutes;
- Daily Move and Ability usage;
- Daily and multi-day Capability usage;
- Trainer AP that an Extended Rest can restore; and
- Feature AP, temporary AP, Extended-Rest bindings or drains, and non-campaign Feature usage.

Daily Ability and Capability work records the minimum required day advances. Daily Move usage, HP, conditions, Trainer AP, and recoverable Feature state can be addressed by the existing Extended Rest authority. Edge usage is strictly parsed but is not falsely presented as day-reset work because its period identity, rather than P8-051 mutation, owns availability.

Freeform condition notes are treated only as visible follow-up. Their prose is never parsed into mechanics. Projection ignores owner-safe presentation caches such as medical-treatment projections and reads durable authority instead.

## Attention and privacy

A current sheet produces at most one recovery item:

- `medical-review` for Injuries, fainting, condition follow-up, or active treatment;
- `recovery-review` for HP or resource recovery and for malformed repair authority;
- normal urgency for ordinary work, urgent for fainting or five-plus Injuries, and blocking for malformed state or ten Injuries.

An untreated Injury links to the existing sheet medical workflow with `choose-treatment` / `start-treatment`. Active treatment links to read-only recovery review and cannot offer a duplicate start. Other work links to the sheet recovery workflow. Each action is bound to the exact current sheet revision and must reload authority before offering a mutation.

Attention contains no name, HP value, Injury count, condition, status note, Move, Ability, Capability, Feature, AP amount, treatment identity, operation identity, item source, profile evidence, or private provenance. P8-089 adds role/Profile-safe API and realtime lifecycle projection; P8-090 renders current explanations on the continuation dashboard by reloading authorized sheet authority rather than copying mutable details into the attention item.
