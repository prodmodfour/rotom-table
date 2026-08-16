# Out-of-encounter item certification

P8-060 closes the campaign/sheet item phase with one generated acceptance index:

- `data/complete-play-loop/out-of-encounter-item-certification.v1.json`
- `scripts/generate_complete_play_loop_out_of_encounter_certification.py`
- `tests/data/completePlayLoopOutOfEncounterCertification.test.ts`
- `tests/integration/outOfEncounterItemRecovery.test.ts`

The index is **evidence only**. It grants no mechanics, identity, inventory authority, or compatibility. Runtime behavior continues to come from reviewed app-owned contracts and the owning item, equipment, exploration, breeding, and guided use cases.

## Certified journeys

The index binds current source contracts and executable evidence for:

1. First Aid Kit and timed medical Extended Actions;
2. permanent advancement and training consumables;
3. TM/HM move learning;
4. Evolutionary Items;
5. campaign-clock and map exploration items;
6. Egg Warmer, Reanimation Machine, and Chemistry Set adapters over the shared Egg lifecycle;
7. bounded guided medicine, Poultices, and Re-Breather adjudication;
8. cancellation, stale authority, reconnect, uncertain exact retry, process restart, and reservation release.

Every row requires atomic settlement, role/privacy enforcement, exact replay or a dedicated recovery proof, and `manualRepairRequired: false`. Source and test SHA-256 bindings make drift explicit.

## Restart boundary

`tests/integration/outOfEncounterItemRecovery.test.ts` uses a real file-backed SQLite campaign. It persists a pending out-of-encounter item reservation and guided request, closes the database, reopens it, verifies exact authority and source reservation, rejects a changed command under the same operation ID, cancels without mechanics, releases the reservation, closes again, and verifies immutable terminal evidence after a second restart. No JSON or SQLite repair is performed.

## Required checks

```bash
npm run check:complete-play-loop-out-of-encounter-certification
npx vitest run tests/data/completePlayLoopOutOfEncounterCertification.test.ts \
  tests/integration/outOfEncounterItemRecovery.test.ts \
  --maxWorkers=1 --no-file-parallelism
npm run typecheck
```

Run the evidence tests listed in the generated index when any owning workflow changes. Production Chromium journeys remain the liveplay UI boundary; server and integration evidence remains the mutation/recovery boundary.
