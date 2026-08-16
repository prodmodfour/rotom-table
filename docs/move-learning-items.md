# Authoritative TM/HM Move learning

P8-054 implements all 100 canonical TMs and six canonical HMs as server-owned, one-hour Trainer Extended Actions. The reviewed contract and complete roster live in [`data/complete-play-loop/move-learning-items.v1.json`](../data/complete-play-loop/move-learning-items.v1.json).

## Runtime authority

Runtime code reads only app-owned canonical JSON:

- `data/reference/items.json` identifies each exact TM/HM source.
- `data/reference/rules.json` provides structured, reviewed Move-learning mechanics.
- `data/reference/pokedex.json` authorizes one exact machine kind, number, and Move for each compatible species.
- `data/reference/moves.json` reconstructs the learned Move; clients cannot submit Move fields.
- `data/reference/abilities.json` authorizes the exact Cluster Mind increase from six to eight active Moves.

Documentary text is provenance only and is never parsed at runtime. `data/complete-play-loop/canonical-data-remediation.v1.json` binds the structured rule migration and the reviewed in-place `Façade` → `Facade` identity normalization to exact predecessor/successor hashes while preserving the existing Move mechanics.

## Declaration and completion

From a Trainer's Pokémon Items inventory section:

1. Select **Use** on an enabled TM/HM offer.
2. Select one currently owned Pokémon.
3. Select an authoritative open-slot or replacement option. Opaque option IDs bind the source definition, target revision, species, Move, current active rows, Tutor Points, and relevant limits.
4. Confirm the exact Move change.
5. Start the Move-training Extended Action.
6. After the table completes the reviewed about-one-hour training interval, explicitly complete the activity.

Starting or interrupting training changes no Move, Tutor Point, source quantity, or HM usage state. The durable **Complete Move Training** command is the explicit server-owned end of the reviewed 60-minute Extended Action; it does not advance the shared campaign clock itself. Completion reloads and reauthorizes the source, ownership, current campaign clock, target revision, species compatibility, duplicate status, active-Move maximum, TM/Tutor maximum, Tutor Points, and exact persisted choices before one atomic commit.

A TM consumes exactly one source unit only at accepted completion. An HM remains in inventory and records one private use for its serialized source during the current authoritative campaign day. The latest accepted day is retained; a later campaign day replaces the prior receipt, so no daily reset job is needed.

## Limits and costs

The server evaluates the effective known-Move union of `movelist` and `appliedMoves`.

- A Pokémon normally has at most six active Moves; the exact reviewed Cluster Mind ability permits eight.
- No more than three active Moves may come from TM/Tutor sources, excluding Natural Moves.
- Currently unlocked level-up Moves and canonical Tutor Moves marked `(N)` are Natural. Species Egg Move compatibility alone is reference-only and does not prove a learned Move.
- A previously trained Move becomes Natural when the Pokémon reaches its canonical level-up opportunity.
- Adding a machine Move or replacing a Natural Move costs one Tutor Point.
- Replacing an already counted TM/Tutor slot costs zero additional Tutor Points.
- Already-known Moves, unavailable Tutor Points, stale revisions, incompatible species, malformed duplicate rows, ambiguous authority, and no-op replacements fail closed.

Accepted machine rows are rebuilt from canonical Move data and marked read-only on setup sheets. Immutable private application provenance—not editable `TM/HM` or `Tutor` labels—controls limit accounting.

## Private state and projection

Pokémon store immutable applications in `serverPrivate.itemMoveLearning`. Trainers store HM daily-use receipts in `serverPrivate.itemMachineUsage`. Setup saves preserve both states from the current server document and preserve accepted item-controlled Move rows; clients cannot forge, alter, remove, or reorder those rows.

Owner/player/realtime projections expose only safe sheet and activity presentation. They remove server-private state, digests, source-row identities, operation identities, ownership evidence, and private choices/outcomes. UI rows may expose the owner-safe `itemMoveLearningLocked: true` marker only to disable direct edits.

## Replay and recovery

Accepted completion persists its exact result before publication. A retry with the same command/activity identity returns the persisted result without consuming another TM, duplicating a Move, spending Tutor Points again, or writing another HM receipt. An uncertain client uses the normal item-operation and Extended Action recovery endpoints rather than editing inventory or sheets.

A failed completion applies nothing. Refresh the offer after stale source, sheet, ownership, campaign-clock, compatibility, or limit errors. Persisted choices are reused for retries and are never regenerated after acceptance.
