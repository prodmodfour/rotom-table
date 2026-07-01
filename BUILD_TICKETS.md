# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one encounter generation/spawn bug-fix ticket.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#010) may also set `AUTOMATION_STATUS: DONE` after all encounter generation/spawn tickets are complete.

---

## 001 — Default missing encounter count on the server

Status: TODO

**Problem**

Raw API calls to encounter generation/spawn can omit `count`, `countMin`, and `countMax`, even though the UI has a default count of 3. The server currently sanitizes missing legacy `count` as `0`, which returns a 400 instead of using the default.

**Files**

- `server/utils/encounterGeneration.ts`
- `tests/server/encounterGeneration.test.ts`

**Implementation**

- Import or otherwise share `DEFAULT_ENCOUNTER_COUNT` from the client/shared encounter generation utility.
- In `readEncounterGenerateRequest`, change the non-range branch so missing `body?.count` falls back to the default before calling `sanitizeEncounterCount`.
- Keep explicit invalid counts rejected. For example, `count: 0` should still fail.

Suggested shape:

```ts
const countRange = hasCountRange
  ? sanitizeEncounterCountRange(body?.countMin, body?.countMax)
  : exactEncounterGenerateCountRange(
      sanitizeEncounterCount(body?.count ?? DEFAULT_ENCOUNTER_COUNT),
    )
```

**Acceptance criteria**

- `readEncounterGenerateRequest({ region: 'r', table: 't' })` returns `countRange: { min: 3, max: 3 }`.
- `readEncounterGenerateRequest({ region: 'r', table: 't', count: 0 })` still rejects with the existing minimum-count error.
- Existing count and count-range tests continue to pass.

**Verification**

```bash
npm test -- tests/server/encounterGeneration.test.ts
```

---

## 002 — Make encounter “count” semantics explicit as encounter slots

Status: TODO

**Problem**

The current roller treats count as the number of encounter slots. `Nothing` rolls are filtered out, so the number of generated Pokémon can be lower than the requested count. This behavior is internally consistent, but the UI label “Count range” makes it easy to read the value as “exact Pokémon count.”

**Files**

- `src/components/encounters/EncounterGenerateSetupFields.vue`
- `src/components/encounters/EncounterGenerateResultHeader.vue`
- `src/components/encounters/EncounterGenerateResultCard.vue` if result text needs more room
- Any existing or new component/composable tests around encounter generation UI

**Implementation**

- Rename the setup field label from `Count range` to `Encounter slots` or `Encounter slot range`.
- Update result copy so it distinguishes requested slots from generated files/Pokémon.
- Keep API behavior unchanged in this ticket: slots can still produce fewer Pokémon when `Nothing` is rolled.
- Add or update a focused test that documents this behavior in UI/composable wording.

**Acceptance criteria**

- The `/generate` page no longer implies an exact Pokémon count.
- Result text shows enough context that a user understands why `3` slots might generate fewer than `3` files.
- No server behavior changes in this ticket.

**Verification**

```bash
npm test
npm run typecheck
```

---

## 003 — Add spawn folder collision regression coverage

Status: TODO

**Problem**

Spawn generation currently creates in-memory sheets using a slug prefix derived before the final SQLite folder is allocated. If the desired folder already exists in SQLite, the final folder auto-increments but generated slugs can still use the old prefix.

**Files**

- `tests/server/spawnGeneratedEncounters.test.ts`

**Implementation**

Add a failing regression test before changing production code:

- Use `createHarness()`.
- Pre-create or otherwise occupy the folder `wild/pond_1` for Pokémon sheets.
- Call `spawnGeneratedEncountersUseCase(spawnBody, dependencies)`.
- Assert the final result uses `data/sheets/wild/pond_1-2`.
- Assert the persisted sheet slug and map placement slug are based on the final folder prefix, e.g. `wild-pond-1-2-...`, not `wild-pond-1-...`.
- Assert the result placement slug matches the persisted sheet and map placement.

**Acceptance criteria**

- The new test fails against the current code for the folder/slug mismatch.
- The test is narrowly scoped to folder collision behavior.
- No production code changes in this ticket.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
```

---

## 004 — Retarget generated spawn slugs to the final allocated folder

Status: TODO

**Problem**

The final spawn folder is chosen in `persistEncounterSpawn`, after in-memory pokegen has already produced sheets using a provisional slug prefix. When `allocateEncounterFolder` changes the folder, persisted sheets and placements should use slugs derived from the final folder.

**Files**

- `server/useCases/spawnGeneratedEncounters.ts`
- `tests/server/spawnGeneratedEncounters.test.ts`

**Implementation**

- Extend the spawn generation plan so it records the provisional `slugPrefix` used for pokegen.
- After final folder allocation inside `persistEncounterSpawn`, compute the final slug prefix from the final `dir`/`relDir`.
- Update `prepareGeneratedSheets` so slug allocation uses the final preferred slug while preserving the original generated source slug for mapping generated records back to prepared sheets.
- Keep the generated sheet document override behavior: persisted sheets must still have the final slug, final folder, revision `0`, and current timestamp.
- Ensure `generatedRecordsForPlacement` still maps each original generated sheet to the correct prepared sheet, including duplicate species/source slug cases.

Suggested helper shape:

```ts
const generatedSourceSlug = (generated: GeneratedSheetRecord): string =>
  String(generated.sheet?.slug || generated.slug || fileSlug(generated.file))

const retargetGeneratedSlugPrefix = (
  sourceSlug: string,
  provisionalPrefix: string,
  finalPrefix: string,
): string => sourceSlug.startsWith(`${provisionalPrefix}-`)
  ? `${finalPrefix}${sourceSlug.slice(provisionalPrefix.length)}`
  : sourceSlug
```

**Acceptance criteria**

- The regression test from Ticket 03 passes.
- Existing slug collision tests still pass.
- Map placements point at persisted sheet slugs, not provisional slugs.
- `result.spawn.placements[*].slug` matches the persisted sheet slug used by the map placement.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
npm run typecheck
```

---

## 005 — Keep spawn result file/placement display consistent after slug retargeting

Status: TODO

**Problem**

Spawn mode does not write generated JSON files, but it still returns `files` and `spawn.placements` to the UI. After Ticket 04, persisted slugs may be retargeted to the final folder while `files[*].name` can still reflect the provisional slug/name. This can confuse users reviewing the spawn result.

**Files**

- `server/useCases/spawnGeneratedEncounters.ts`
- `src/components/encounters/EncounterGenerateResultCard.vue` if display should prefer slug over file name
- `tests/server/spawnGeneratedEncounters.test.ts`

**Implementation**

Choose one clear behavior and test it:

- Preferred: leave `files[*].name` as the generator output label, but show final `placement.slug` in the spawn results UI.
- Alternatively: return a normalized spawn-specific file label when no file is actually written.

Server-side, ensure every successful placement result includes the final `slug`. UI-side, render that slug next to or instead of the provisional file name when `result.spawn` exists.

**Acceptance criteria**

- In a folder-collision spawn, the result UI has a visible final slug/folder identity.
- The result does not imply that a JSON file with the provisional name was written to the final folder.
- Existing non-spawn generation result display remains unchanged.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
npm run typecheck
```

---

## 006 — Add duplicate placement-id retry regression coverage

Status: TODO

**Problem**

Spawn placement currently calls `createPlacementId()` once. If that ID is already present on the map, that Pokémon fails to spawn instead of retrying for a fresh ID.

**Files**

- `tests/server/spawnGeneratedEncounters.test.ts`

**Implementation**

Add a failing test that:

- Creates a map with an existing placement ID, for example `spawn-1`.
- Provides `createPlacementId` that returns `spawn-1` first and `spawn-2` second.
- Runs spawn generation.
- Expects the new Pokémon to spawn with `spawn-2`.
- Expects no duplicate-ID failure.

**Acceptance criteria**

- The test fails against current one-shot ID allocation.
- The test proves the retry behavior needed in Ticket 07.
- No production code changes in this ticket.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
```

---

## 007 — Retry placement-id allocation before failing a spawn

Status: TODO

**Problem**

A duplicate placement ID is recoverable. The spawn logic should retry before marking that generated Pokémon as failed.

**Files**

- `server/useCases/spawnGeneratedEncounters.ts`
- `tests/server/spawnGeneratedEncounters.test.ts`

**Implementation**

- Add a helper near `appendPlacementsForGeneratedSheets` that tries to allocate a non-empty, unused placement ID up to `MAX_SLUG_ALLOCATION_ATTEMPTS`.
- Replace the current one-shot duplicate check with the helper.
- Keep the failure path if all attempts fail.
- Ensure the ID is added to the `placementIds` set exactly once, when accepted.

Suggested helper shape:

```ts
const allocateUniquePlacementId = (
  placementIds: Set<string>,
  createPlacementId: () => string,
): string | null => {
  for (let attempt = 0; attempt < MAX_SLUG_ALLOCATION_ATTEMPTS; attempt += 1) {
    const id = createPlacementId()
    if (id && !placementIds.has(id)) {
      placementIds.add(id)
      return id
    }
  }
  return null
}
```

**Acceptance criteria**

- The regression test from Ticket 06 passes.
- Existing successful spawn tests still pass.
- If the injected ID generator only returns duplicates/empty strings, the spawn fails gracefully with a clear placement error.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
npm run typecheck
```

---

## 008 — Add unresolved-placement occupancy regression coverage

Status: TODO

**Problem**

Spawn position selection builds occupied footprints from resolved placements only. If a map already has a placement whose sheet is missing or whose catalog entry cannot be resolved, that occupied anchor can be ignored and a generated Pokémon can spawn on top of it.

**Files**

- `tests/server/spawnGeneratedEncounters.test.ts`
- Optionally `tests/utils/encounterSpawnPlacement.test.ts` if placement utility tests already exist or are easy to add

**Implementation**

Add a failing server-level test:

- Put an existing unresolved placement at the only first-choice spawn anchor.
- Make randomness deterministic so the current code would pick the occupied anchor when unresolved placements are ignored.
- Ensure at least one alternate anchor exists.
- Run spawn generation.
- Assert the new placement is not placed on the unresolved placement’s anchor.

**Acceptance criteria**

- The test fails against current occupancy building.
- The test proves unresolved existing placements reserve space.
- No production code changes in this ticket.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
```

---

## 009 — Reserve conservative footprint space for unresolved existing placements

Status: TODO

**Problem**

Existing map placements should still reserve their occupied anchor even when their sheet cannot be resolved. Otherwise, spawn can overlap broken/temporarily missing tokens.

**Files**

- `server/useCases/spawnGeneratedEncounters.ts`
- `tests/server/spawnGeneratedEncounters.test.ts`

**Implementation**

- Replace the `placementsToSpawned(map, lookup).map(...)` occupancy construction with a helper that iterates raw `map.placements`.
- For resolved placements, keep using the catalog footprint and clearance.
- For unresolved placements, add a conservative fallback footprint:

```ts
{
  id: placement.id,
  position: placement.position,
  base: 1,
  clearance: 1,
}
```

- Prefer importing/using `placementToSpawned` so the resolved-placement behavior stays aligned with renderer logic.

**Acceptance criteria**

- The regression test from Ticket 08 passes.
- Spawn still respects resolved Pokémon/trainer footprints as before.
- Unresolved placements no longer get silently ignored for collision checks.

**Verification**

```bash
npm test -- tests/server/spawnGeneratedEncounters.test.ts
npm run typecheck
```

---

## 010 — Final encounter/spawn verification pass

Status: TODO

**Problem**

The fixes touch shared rolling helpers, spawn persistence, and result display. A final commit should only contain verification/documentation cleanup discovered while running the full suite.

**Files**

- `README.md` or nearby encounter docs, only if wording needs to match the final behavior
- Test snapshots or fixtures, only if required by the previous tickets

**Implementation**

- Run the full verification commands.
- Update docs/copy only where they now conflict with behavior.
- Do not add unrelated refactors.

**Acceptance criteria**

- Full suite passes.
- The encounter generation docs/copy consistently describe slots vs generated Pokémon.
- Spawn folder collision, slug collision, duplicate placement IDs, and unresolved-placement occupancy are covered by tests.

**Verification**

```bash
npm run typecheck
npm test
npm run build
```
