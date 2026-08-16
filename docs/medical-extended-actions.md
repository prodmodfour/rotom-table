# Medical item Extended Actions

P8-052 makes First Aid Kit and Bandages treatment durable, replay-safe workflows on the Trainer sheet. They use the shared P8-051 non-encounter item context and deterministic item planner rather than creating a second item engine.

## Authoritative workflow

1. **Start treatment** from an enabled, server-projected First Aid Kit offer and one enabled target.
2. The server re-loads the controlled Trainer, exact reusable inventory row, linked target, target ownership, current campaign clock, reviewed definition hash, and complete read set.
3. Start stores an `in-progress` activity at revision `0`. It does **not** roll, drain AP, change HP or conditions, consume inventory, or revise a sheet.
4. **Complete treatment** reprojects the current offer and revalidates the exact source, current target authority and eligibility, Trainer AP, campaign clock, and reviewed definition.
5. The existing item planner rolls the current effective Medicine Education rank in d6s exactly once, drains 1 AP until Extended Rest, restores HP up to the Injury-adjusted effective maximum, and removes applicable Burned, Poisoned, Badly Poisoned, or Paralysis state. The reusable First Aid Kit remains in inventory.
6. Item evidence, both sheet writes, the activity terminal receipt, and realtime rows commit in one SQLite transaction. Any stale read or write failure rolls all of them back and leaves the activity safely in progress.
7. **Interrupt safely** writes only the terminal activity receipt and activity invalidation. It never creates an item operation or applies mechanics.

No minimum elapsed *application* duration is invented: canonical reviewed authority establishes Extended Action timing but no numeric duration for completing that action. The activity records its authoritative start and terminal campaign minutes.

## Bandages lifecycle

Bandages use the same start/complete/interrupt activity boundary. Completion consumes exactly one selected source and installs a separate target-owned treatment; it does not immediately heal HP or remove an Injury.

- The treatment lasts 360 authoritative campaign minutes.
- Each due 30-minute boundary restores 1/8 of full formula Max HP, with a minimum of 1 and the Injury-adjusted cap. Natural healing is blocked while the target has 5 or more Injuries.
- At the full six-hour boundary it attempts to remove one Injury through the shared three-per-day Injury limit.
- Any authoritative HP loss cancels the active treatment in the same sheet transaction. Later clock settlement cannot revive it.
- A target may have only one active treatment. The sheet-local lifecycle projection is bounded; immutable item-operation receipts remain the origin audit.
- Campaign-day advancement materializes all due Bandages boundaries before next-day recovery and commits treatment, HP, Injury, clock, receipt, and realtime changes atomically.
- Players receive only opaque status, timing, tick totals, HP restored, and terminal copy. Definition hashes and source operation evidence stay private.

Poultices share the deterministic Bandages effect, but canonical authority also assigns possible repeated-use Loyalty consequences to GM judgment. Native execution therefore remains fail-closed until P8-059 supplies a bounded guided Loyalty-attention receipt; Rotom Table does not silently omit or invent that consequence.

## Wonder Launcher delivery and Re-Breather boundary

An active, compatible, unsuppressed Wonder Launcher projects one concrete native delivery offer for each reviewed X-Item in the wielder's authoritative Trainer inventory. A fresh declaration binds the current whole-item source through an opaque delivery digest; the serialized equipment identity never enters the offer, player sheet, realtime projection, or command transport. Acceptance revalidates that exact grant, actor and target revisions, map, 8-meter range, available AP, and X-Item source. It atomically spends one Standard Action, drains 1 AP until Extended Rest, consumes the X-Item, and applies its existing native effect. The target does not receive the ordinary next-turn Standard/Shift forfeiture. Source loss or suppression before settlement fails closed; accepted X-Item effects remain durable. Unreviewed Researcher-combined item identities remain unavailable rather than being inferred.

Re-Breather activation is explicitly assigned to P8-059 rather than falsely completed by P8-052. Canonical authority requires both a one-hour air supply and automatic five-minute refill **while in open air**. Current encounter and campaign state does not establish that environmental fact. P8-059 must collect bounded GM confirmation for open-air refill before executable reservoir state can settle; runtime does not assume every five-minute boundary is open air.

## Recovery and concurrency

- Start, complete, and interrupt use separate `item-activity-operation:v1:*` identities.
- One active activity is allowed per Trainer and per exact source instance.
- Exact retries compare the full stored command and return stored evidence. Completion never rerolls or drains AP twice.
- Reusing an operation or activity identity for different input fails closed.
- Only the lowest current activity revision may settle.
- Source loss, ownership loss, target ineligibility, AP loss, canonical hash drift, and stale item read sets leave work in progress so it can be retried after repair or interrupted safely.
- The browser retains only the exact uncertain lifecycle command in session storage. On reconnect it first reloads durable activity evidence, then offers exact retry only when the result remains unknown.

## Projection and privacy

The owner/GM projection may include the opaque activity ID, revision, status, display labels, campaign minutes, current target HP summary and conditions, completion labels, and safe terminal message. It never includes source row IDs, serialized equipment IDs, hashes, profile IDs, raw ownership evidence, raw commands, private notes, or a roll before completion.

Realtime activity events use the controlled Trainer sheet channel and `sheet-access`. Their data contains only schema version, opaque activity ID, status, and revision; clients reload the authorised projection.

## UI states

The Trainer Inventory workspace provides:

- target selection with an explicit “start stores activity only” boundary;
- a selected First Aid Kit or Bandages row labelled **Resume** while application work is active;
- a durable amber **Treatment in progress** card with actor, target, campaign minute, textual progress, completion costs, and the exact no-effects-yet notice;
- distinct **Interrupt safely** and **Complete treatment** controls;
- disabled completion with server-authored current reasons;
- terminal completed/interrupted states and an exact-retry recovery state;
- a target-sheet Bandages status card with authoritative interval, settled minutes, boundaries, cumulative HP, Injury rule, and HP-loss warning;
- 44px controls, keyboard focus, non-colour clock/timeline cues, reduced motion, and one-column narrow reflow.

Accepted targets are `.pi/artifacts/ui-mockups/medical-extended-action/v001.png` for application work and `.pi/artifacts/ui-mockups/bandages-treatment-status/v003.png` for post-acceptance treatment status, each with its brief and selected review.

## Evidence

- Contract: `data/complete-play-loop/medical-extended-actions.v1.json`
- Shared parsers: `shared/itemAutomation/extendedActions.ts` and `shared/itemAutomation/medicalTreatments.ts`
- Storage migration: SQLite v35 and `server/storage/itemExtendedActionRepository.ts`
- Use case: `server/useCases/manageItemExtendedAction.ts`
- Projection: `server/domain/itemAutomation/extendedActionProjection.ts`
- Timed treatment lifecycle: `server/domain/itemAutomation/medicalTreatments.ts`
- Campaign-time settlement: `server/useCases/advanceCampaignDay.ts`
- Wonder Launcher delivery binding: `server/domain/itemAutomation/equipmentDelivery.ts`
- API: `GET/POST /api/items/extended-actions`
- Client: `src/composables/sheets/useTrainerItemExtendedActions.ts`
- UI: `src/components/sheets/TrainerItemExtendedActionCard.vue` and `src/components/sheets/MedicalTreatmentStatusCard.vue`
