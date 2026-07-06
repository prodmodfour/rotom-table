# BUILD_TICKETS.md

AUTOMATION_STATUS: TODO

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one ticket from the supplied planning file; build ticket numbers follow that document's suggested order when present.

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (`018`) may also set `AUTOMATION_STATUS: DONE` after all 18 refreshed tickets are complete.

---

# Initiative modal fix plan

This document breaks the Ctrl+I initiative modal fix into ordered, commit-sized tickets. Implement them in order. Each ticket should leave the app compiling and tests passing before moving on.

## Goal

Make the Ctrl+I initiative modal a complete GM control surface for initiative:

- Auto-calculate every combatant from the existing derived initiative logic.
- Let GMs manually reorder combatants from the modal.
- Ensure the reordered list is the real order used by Start, Next, Previous, and live play.
- Keep score-derived initiative as the default behavior when no manual order is present.
- Preserve keyboard accessibility and GM permission checks.

## Important implementation rule

Do not implement drag reorder as a visual-only list shuffle. The persisted map initiative state must know about the manual order, and both client and server initiative advancement must read the same final order.

Use this mental model:

- Placement `initiative` stores each combatant's raw/base initiative override.
- Existing derived logic turns raw/base initiative into final initiative score by applying combat stages, items, training, Paralysis, Flinch, Quick Feet, etc.
- New `manualOrderIds` stores the GM's explicit order when they drag or keyboard-move rows.
- If `manualOrderIds` is absent or empty, order remains fully calculated.
- Auto-calc all should update placement initiative values and clear `manualOrderIds` so the list returns to calculated order.

---

## 001 - Clarify the existing auto-calc all control

Status: DONE

**Commit message:** `Clarify initiative auto-calc control`

### Why

The code already has most of the auto-fill behavior, but the modal button label `Use All Init` does not clearly communicate that it recalculates all combatants using the derived initiative path.

### Files

- `src/components/map/InitiativeControls.vue`
- Any component tests that snapshot or assert the button label

### Changes

1. Rename the `Use All Init` button text to `Auto-calc all`.
2. Update the button title to explain exactly what is recalculated:

   ```vue
   title="Recalculate every combatant from derived initiative: Speed after Combat Stages, item/training bonuses, then condition effects for final order"
   ```

3. Keep the emitted event as `fill-from-speed` for now. Renaming the event can be a later cleanup; this ticket should be tiny.
4. Consider moving this button visually before `Clear turn` and `Reset` if it is currently buried. Do not redesign the whole control panel in this ticket.

### Acceptance checks

- The Ctrl+I modal shows `Auto-calc all`.
- Clicking it still triggers the existing all-combatant initiative fill behavior.
- No behavior changes except wording/title/placement.

### Suggested test command

```bash
npm run test -- tests/composables/map-editor/useInitiativeTracker.test.ts
```

---

## 002 - Add persisted manual order to map initiative state

Status: DONE

**Commit message:** `Add manual initiative order state`

### Why

Manual reorder needs a real storage location. The current `InitiativeTrackerState` only stores `activeId` and `round`, so dragged order would otherwise disappear or remain visual-only.

### Files

- `src/types/map.ts`
- Any tests that construct `InitiativeTrackerState` and use exact object equality

### Changes

1. Extend `InitiativeTrackerState`:

   ```ts
   export interface InitiativeTrackerState {
     /** Placement id whose turn is currently active. */
     activeId?: string | null
     /** 1-based combat round counter. */
     round?: number
     /** Optional GM-authored turn order. Missing/null means derive order from initiative scores. */
     manualOrderIds?: string[]
   }
   ```

2. Do not migrate existing maps. Missing `manualOrderIds` should mean calculated order.
3. Do not add UI yet.

### Acceptance checks

- TypeScript accepts `map.initiative.manualOrderIds`.
- Existing map fixtures without `manualOrderIds` still typecheck.
- No runtime behavior changes yet.

### Suggested test command

```bash
npm run typecheck
```

---

## 003 - Add shared manual-order merge helpers

Status: DONE

**Commit message:** `Add initiative manual order helpers`

### Why

Client and server must merge manual order with calculated order in exactly the same way. Put this in shared initiative ordering code so every pathway uses identical logic.

### Files

- `shared/initiativeOrder.ts`
- `tests/shared/initiativeOrder.test.ts` or create it if it does not exist

### Changes

1. Add a helper that starts from calculated order and overlays `manualOrderIds`:

   ```ts
   export const orderInitiativeEntries = <TEntry extends InitiativeOrderEntry>(
     entries: readonly TEntry[],
     manualOrderIds?: readonly string[] | null,
   ): TEntry[] => {
     const calculated = sortInitiativeOrderEntries(entries)
     if (!manualOrderIds?.length) return calculated

     const byId = new Map(calculated.map((entry) => [entry.id, entry]))
     const used = new Set<string>()
     const ordered: TEntry[] = []

     for (const id of manualOrderIds) {
       const entry = byId.get(id)
       if (!entry || used.has(id)) continue
       ordered.push(entry)
       used.add(id)
     }

     for (const entry of calculated) {
       if (!used.has(entry.id)) ordered.push(entry)
     }

     return ordered
   }
   ```

2. Update `initiativeOrderIds` to accept the optional manual list:

   ```ts
   export const initiativeOrderIds = (
     entries: readonly InitiativeOrderEntry[],
     manualOrderIds?: readonly string[] | null,
   ): string[] => orderInitiativeEntries(entries, manualOrderIds).map((entry) => entry.id)
   ```

3. Keep `sortInitiativeOrderEntries` unchanged because other callers may want pure calculated order.

### Tests to add

- No manual list returns existing calculated order.
- Manual list `['c', 'a']` puts `c`, then `a`, then all remaining calculated entries.
- Unknown ids are ignored.
- Duplicate ids in manual order are ignored after the first occurrence.
- New combatants missing from manual order are appended in calculated order.

### Acceptance checks

- Existing initiative ordering tests still pass.
- New helper is deterministic.
- No app behavior changes until callers adopt the helper.

### Suggested test command

```bash
npm run test -- tests/shared/initiativeOrder.test.ts
```

---

## 004 - Thread manual order through server-side order entry utilities

Status: DONE

**Commit message:** `Support manual order in initiative order entries`

### Why

The server uses `initiativeOrderIdsForPlacements` to decide authoritative Next/Previous order. That helper needs to accept persisted manual order before live-play or session commands can work correctly.

### Files

- `src/utils/initiativeOrderEntries.ts`
- Tests that cover `initiativeOrderIdsForPlacements`, if present

### Changes

1. Update the function signature:

   ```ts
   export const initiativeOrderIdsForPlacements = (
     placements: readonly SheetPlacement[],
     readSheet: InitiativeSheetReader,
     manualOrderIds?: readonly string[] | null,
   ): string[] => initiativeOrderIds(
     initiativeOrderEntriesForPlacements(placements, readSheet),
     manualOrderIds,
   )
   ```

2. Keep all existing callers compiling by making the parameter optional.
3. Add focused tests if this utility already has tests. Otherwise this can be covered when command handlers are updated later.

### Acceptance checks

- Existing callers do not need immediate changes.
- Passing manual ids produces manual order plus calculated append behavior.

### Suggested test command

```bash
npm run typecheck
```

---

## 005 - Make the client tracker read and mutate manual order locally

Status: DONE

**Commit message:** `Use manual initiative order in tracker`

### Why

Before wiring drag UI, the composable needs a real API for setting, moving, and clearing manual order. This ticket can be tested without any visual changes.

### Files

- `src/composables/map-editor/useInitiativeTracker.ts`
- `tests/composables/map-editor/useInitiativeTracker.test.ts`

### Changes

1. Import `orderInitiativeEntries` or use the helper from Ticket 3.
2. Change `sortedInitiativeRows` so it overlays `map.value?.initiative?.manualOrderIds` on top of calculated order.
3. Add a computed flag:

   ```ts
   const manualInitiativeOrderActive = computed(() => Boolean(map.value?.initiative?.manualOrderIds?.length))
   ```

4. Add `setManualInitiativeOrder(ids: readonly string[] | null)`:

   - Return if no map or no manage permission.
   - Validate against current `validInitiativeIds`.
   - Remove duplicates.
   - Ignore unknown ids in local/setup mode.
   - Ensure `ensureInitiativeState()` preserves existing `activeId` and `round`.
   - If `ids` is null or the sanitized list is empty, delete `manualOrderIds`.
   - Otherwise store `manualOrderIds = [...sanitizedIds]`.

5. Add `moveInitiativeRow(id: string, direction: -1 | 1)`:

   - Build ids from `sortedInitiativeRows.value`.
   - Move the id one slot if possible.
   - Call `setManualInitiativeOrder(nextIds)`.

6. Add `reorderInitiativeRows(ids: readonly string[])`:

   - Delegate to `setManualInitiativeOrder(ids)`.

7. Return these from `useInitiativeTracker`:

   ```ts
   manualInitiativeOrderActive,
   setManualInitiativeOrder,
   moveInitiativeRow,
   reorderInitiativeRows,
   ```

### Tests to add

1. Manual order changes `sortedInitiativeRows`:

   - Create three tokens with calculated order `a, b, c`.
   - Call `setManualInitiativeOrder(['c', 'a', 'b'])`.
   - Assert sorted ids are `c, a, b`.

2. `nextInitiative()` follows manual order:

   - Set manual order to `c, a, b`.
   - Set active to `c`, call next, expect `a`.

3. `previousInitiative()` follows manual order:

   - Set active to `c`, call previous, expect `b` and round handling still works.

4. Invalid ids are ignored locally:

   - Set `['missing', 'b']`; expect stored order `['b']` and sorted begins with `b`.

### Acceptance checks

- Setup/edit mode can reorder initiative without UI.
- Next/Previous use the manual order.
- No drag UI exists yet.

### Suggested test command

```bash
npm run test -- tests/composables/map-editor/useInitiativeTracker.test.ts
```

---

## 006 - Auto-calc all clears manual order

Status: DONE

**Commit message:** `Reset manual initiative order on auto-calc`

### Why

`Auto-calc all` should mean “return to calculated initiative order.” If a manual order remains after auto-calc, the user will think recalculation is broken because the visible order may not change.

### Files

- `src/composables/map-editor/useInitiativeTracker.ts`
- `tests/composables/map-editor/useInitiativeTracker.test.ts`

### Changes

1. In `fillInitiativeFromSpeed`, after successfully setting all placement initiative values locally, clear manual order:

   ```ts
   const state = ensureInitiativeState()
   if (state) delete state.manualOrderIds
   ```

2. In live-play mode this eventually needs a batch/combined command, but do not solve live-play batching in this ticket. For now, update local behavior and test it. A later ticket will extend the payload and live-play command path.

3. Be careful not to clear `activeId` or `round`.

### Tests to add

- Seed `map.initiative.manualOrderIds`.
- Call `fillInitiativeFromSpeed()` in local/setup mode.
- Assert placement initiatives were filled.
- Assert `manualOrderIds` is absent.
- Assert `activeId` and `round` are preserved.

### Acceptance checks

- Auto-calc all returns local/setup order to calculated score order.
- Existing Speed/condition tests still pass.

### Suggested test command

```bash
npm run test -- tests/composables/map-editor/useInitiativeTracker.test.ts
```

---

## 007 - Expose manual reorder events through the modal component chain

Status: DONE

**Commit message:** `Wire initiative reorder events through modal`

### Why

Before adding buttons or drag behavior, wire the data path from the modal down to the list and back up to the map page.

### Files

- `src/components/map/InitiativeMenuModal.vue`
- `src/components/map/InitiativeTracker.vue`
- `src/components/map/InitiativeList.vue`
- `src/pages/maps/[slug].vue`

### Changes

1. Add props where needed:

   ```ts
   manualOrderActive: boolean
   ```

2. Add emits where needed:

   ```ts
   (event: 'move-row', id: string, direction: -1 | 1): void
   (event: 'reorder', ids: string[]): void
   (event: 'clear-manual-order'): void
   ```

3. In `src/pages/maps/[slug].vue`, destructure the new tracker returns:

   ```ts
   manualInitiativeOrderActive,
   moveInitiativeRow,
   reorderInitiativeRows,
   setManualInitiativeOrder,
   ```

4. Wire events:

   ```vue
   :manual-order-active="manualInitiativeOrderActive"
   @move-row="moveInitiativeRow"
   @reorder="reorderInitiativeRows"
   @clear-manual-order="setManualInitiativeOrder(null)"
   ```

5. Do not add visual controls yet. This ticket should be wiring-only.

### Acceptance checks

- Typecheck passes.
- The modal prop/event chain compiles.
- No visible UI changes except any required prop plumbing.

### Suggested test command

```bash
npm run typecheck
```

---

## 008 - Add keyboard-accessible row move controls

Status: DONE

**Commit message:** `Add initiative row move controls`

### Why

Drag and drop is not enough. The modal needs an accessible fallback, and arrow move buttons are simpler to implement and test before pointer dragging.

### Files

- `src/components/map/InitiativeRowItem.vue`
- `src/components/map/InitiativeList.vue`
- Possibly `tests/components/...` if component tests exist for initiative rows

### Changes

1. Add a `rowCount` prop to `InitiativeRowItem.vue` so the row knows whether up/down should be disabled:

   ```ts
   rowCount: number
   ```

2. Add emits:

   ```ts
   (event: 'move-row', id: string, direction: -1 | 1): void
   ```

3. Add two small buttons, ideally near the turn sprite or score editor:

   ```vue
   <button
     type="button"
     class="initiative-row__move"
     :disabled="!canManage || index === 0"
     :aria-label="`Move ${entry.name} earlier in initiative`"
     @click="emit('move-row', entry.id, -1)"
   >
     ↑
   </button>

   <button
     type="button"
     class="initiative-row__move"
     :disabled="!canManage || index >= rowCount - 1"
     :aria-label="`Move ${entry.name} later in initiative`"
     @click="emit('move-row', entry.id, 1)"
   >
     ↓
   </button>
   ```

4. Update the row grid CSS. A simple safe layout is:

   ```css
   grid-template-columns: 42px minmax(0, 1fr) 78px auto;
   ```

   Put the move controls in the `auto` column.

5. In `InitiativeList.vue`, pass `:row-count="rows.length"` and re-emit `move-row` upward.

### Acceptance checks

- GM can move a row up/down in the Ctrl+I modal.
- First row’s up button is disabled.
- Last row’s down button is disabled.
- Non-GM/read-only users see disabled move controls.
- Next/Previous follows the changed order because Ticket 5 already made the composable authoritative.

### Suggested test command

```bash
npm run typecheck
npm run test -- tests/composables/map-editor/useInitiativeTracker.test.ts
```

---

## 009 - Add a reset manual order control

Status: DONE

**Commit message:** `Add reset calculated initiative order control`

### Why

Once manual ordering exists, GMs need an obvious way back to calculated order without pressing Auto-calc all.

### Files

- `src/components/map/InitiativeControls.vue`
- `src/components/map/InitiativeTracker.vue`
- `src/components/map/InitiativeMenuModal.vue`

### Changes

1. Add `manualOrderActive` to `InitiativeControls.vue` props.
2. Add emit:

   ```ts
   (event: 'clear-manual-order'): void
   ```

3. Render a button only when manual order is active:

   ```vue
   <button
     v-if="manualOrderActive"
     type="button"
     class="initiative-tool"
     :disabled="!canManage"
     title="Return to calculated initiative order"
     @click="emit('clear-manual-order')"
   >
     Reset order
   </button>
   ```

4. Pass the prop/event through `InitiativeTracker.vue` and `InitiativeMenuModal.vue`.
5. Keep this button separate from `Reset`, because `Reset` currently clears initiative values and active turn. The new button should only clear `manualOrderIds`.

### Acceptance checks

- The reset order button only appears after a manual reorder.
- Clicking it returns the list to calculated order.
- It does not clear initiative values, active turn, or round.

### Suggested test command

```bash
npm run typecheck
```

---

## 010 - Add pointer drag reorder inside the initiative list

Status: DONE

**Commit message:** `Add drag reorder to initiative list`

### Why

This delivers the requested click-and-drag behavior after the authoritative data path and accessible fallback already exist.

### Files

- `src/components/map/InitiativeList.vue`
- `src/components/map/InitiativeRowItem.vue`
- Optional component tests for drag event helpers

### Changes

1. Add a dedicated drag handle in `InitiativeRowItem.vue`. Do not make the entire row draggable because the row already contains focus buttons, turn buttons, and number inputs.

   ```vue
   <button
     type="button"
     class="initiative-row__drag-handle"
     draggable="true"
     :disabled="!canManage"
     :aria-label="`Drag ${entry.name} to reorder initiative`"
     @dragstart="emit('drag-start', entry.id, $event)"
     @dragend="emit('drag-end')"
   >
     ⋮⋮
   </button>
   ```

2. Add emits in `InitiativeRowItem.vue`:

   ```ts
   (event: 'drag-start', id: string, value: DragEvent): void
   (event: 'drag-end'): void
   (event: 'drop-row', id: string, value: DragEvent): void
   ```

3. In `InitiativeList.vue`, track `draggedId` in a local `ref<string | null>`.
4. Add helper:

   ```ts
   const moveIdBefore = (
     ids: readonly string[],
     draggedId: string,
     targetId: string,
   ): string[] => {
     if (draggedId === targetId) return [...ids]
     const next = ids.filter((id) => id !== draggedId)
     const targetIndex = next.indexOf(targetId)
     if (targetIndex < 0) return [...ids]
     next.splice(targetIndex, 0, draggedId)
     return next
   }
   ```

5. On row dragover/drop:

   - Prevent default only if `canManage` and `draggedId` is set.
   - On drop, build `rows.map(row => row.id)`, move dragged id before target id, emit `reorder` with the full id list.
   - Clear `draggedId` on dragend/drop.

6. Consider a drop-after behavior for dropping below the last row. A simple first implementation can move before the target row only because the down arrow controls already cover exact repositioning. A later polish can add top/bottom drop zones.

### Acceptance checks

- Drag handle can reorder rows in the Ctrl+I modal.
- Dragging does not interfere with clicking the row body, turn sprite, or initiative input.
- Non-GM/read-only users cannot drag reorder.
- After dragging, Next/Previous follows the dragged order.

### Suggested test command

```bash
npm run typecheck
```

---

## 011 - Extend live-play and session payload types for manual order

Status: DONE

**Commit message:** `Add manual order to initiative command payloads`

### Why

Live play cannot persist manual order until command payloads accept it. This ticket only changes shared types and validators, not server application behavior.

### Files

- `shared/livePlayCommands.ts`
- `shared/sessionInitiativeCommands.ts`
- `tests/shared/livePlayCommands.test.ts`
- `tests/shared/sessionInitiativeCommands.test.ts`

### Changes

1. Extend live-play `SetInitiativePayload`:

   ```ts
   export interface SetInitiativePayload {
     readonly tokenId?: string
     readonly initiative?: number | null
     readonly activeId?: string | null
     readonly round?: number
     readonly manualOrderIds?: readonly string[] | null
   }
   ```

2. Extend session `SetInitiativeCommandPayload` the same way.
3. Update clone helpers so `manualOrderIds` is preserved.
4. Update validation rules:

   - `manualOrderIds` may be omitted.
   - `manualOrderIds: null` is valid and means clear manual order.
   - `manualOrderIds: []` should be invalid or normalized away. Prefer invalid in shared command validation to catch UI mistakes.
   - Non-null manual order must be an array of non-empty strings.
   - Duplicate ids should be invalid in command validation.
   - Unknown ids cannot be checked in shared validation because validators do not have map state. Server use cases will check them later.

5. Update the rule that says setInitiative must set at least one field. Include `manualOrderIds` as a valid field.

### Tests to add

- Valid setInitiative with `manualOrderIds: ['a', 'b']`.
- Valid setInitiative with `manualOrderIds: null`.
- Invalid duplicate ids.
- Invalid empty array.
- Invalid non-string id.
- Invalid `tokenId` without `initiative` still remains invalid.

### Acceptance checks

- Shared validation accepts and rejects the new field correctly.
- No server behavior changes yet.

### Suggested test command

```bash
npm run test -- tests/shared/livePlayCommands.test.ts tests/shared/sessionInitiativeCommands.test.ts
```

---

## 012 - Apply manual order in live-play initiative commands

Status: DONE

**Commit message:** `Persist manual order in live initiative commands`

### Why

The live-play authoritative path must store `manualOrderIds` and use it for Next/Previous, otherwise the modal may look right locally but the server will reject advancement as stale or use calculated order.

### Files

- `server/useCases/applyLivePlayInitiativeCommand.ts`
- `tests/server/livePlayInitiativeCommands.test.ts`

### Changes

1. Extend `InitiativeLaneState` in this file to include:

   ```ts
   readonly manualOrderIds?: readonly string[]
   ```

2. Update `initiativeLaneState(map)` to copy valid manual order from `map.initiative?.manualOrderIds`.
3. Update lane equality to compare `manualOrderIds` as well as active, round, and entries.
4. Update changed patch payloads so manual order changes are included in `current`.
5. In `applySetInitiativePayload`:

   - Start from the entire existing initiative object, not only active/round.
   - Preserve `manualOrderIds` when only a token initiative, active id, or round changes.
   - If payload has `manualOrderIds: null`, delete it.
   - If payload has a non-null array, validate against current placements:
     - every id must exist exactly once;
     - no duplicates;
     - recommended: array must include every placement id exactly once so server order is explicit and stale client state is caught.
   - Store a cloned array.

6. Update `initiativeOrder(...)` helper in this file:

   ```ts
   const initiativeOrder = (
     placements: readonly SheetPlacement[],
     readSheet: InitiativeSheetReader,
     manualOrderIds?: readonly string[] | null,
   ): readonly string[] => initiativeOrderIdsForPlacements(placements, readSheet, manualOrderIds)
   ```

7. In `assertAdvancePrecondition` / `applyAdvanceInitiativePayload`, pass `context.map.initiative?.manualOrderIds` when building authoritative order.

### Tests to add

- `setInitiative` with manual order persists `map.initiative.manualOrderIds`.
- `nextInitiative` advances according to manual order, not calculated score order.
- `previousInitiative` advances according to manual order.
- Unknown manual order id is rejected.
- Partial manual order is rejected if you choose the “must include every placement” rule.
- Clearing with `manualOrderIds: null` removes manual order and returns advancement to calculated order.

### Acceptance checks

- Live-play server uses the same final order as the client modal.
- Patches include enough initiative state for clients to adopt manual order.

### Suggested test command

```bash
npm run test -- tests/server/livePlayInitiativeCommands.test.ts
```

---

## 013 - Apply manual order in legacy/session initiative commands

Status: DONE

**Commit message:** `Persist manual order in session initiative commands`

### Why

There are two initiative command paths in the repo. The older/session path should not diverge from live play.

### Files

- `server/useCases/applyInitiativeCommand.ts`
- `tests/server/applyInitiativeCommand.test.ts`
- Any WebSocket/session initiative tests that assert payload shape

### Changes

Mirror Ticket 12 in `applyInitiativeCommand.ts`:

1. Add `manualOrderIds` to `InitiativeLaneState`.
2. Include `manualOrderIds` in `currentInitiativeState`.
3. Compare it in `initiativeLaneStatesEqual`.
4. Preserve it in `applySetInitiativePayload` unless explicitly changed.
5. Apply `manualOrderIds: null` as a clear.
6. Validate ids against map placements.
7. Pass persisted manual order into `initiativeOrderIdsForPlacements` for Next/Previous.

### Tests to add

- Manual order persists through setInitiative.
- Next/Previous use manual order.
- Clearing manual order returns to calculated order.
- Stale order precondition still rejects when visible order mismatches server order.

### Acceptance checks

- Session command behavior matches live-play command behavior.
- No hidden path still uses calculated-only order after a manual reorder.

### Suggested test command

```bash
npm run test -- tests/server/applyInitiativeCommand.test.ts
```

---

## 014 - Update live-play patch adoption for manual order

Status: DONE

**Commit message:** `Adopt manual order in initiative patches`

### Why

Server acceptance is not enough. Clients that receive realtime initiative patches must update `map.initiative.manualOrderIds`; otherwise another client will not see the dragged order.

### Files

- `src/utils/livePlayPatches.ts`
- `tests/utils/livePlayPatches.test.ts`

### Changes

1. In `applyInitiativePatch`, it currently reconstructs:

   ```ts
   map.initiative = { activeId, round }
   ```

   Change it to include manual order when present in `current`:

   ```ts
   const manualOrderIds = Array.isArray(current.manualOrderIds)
     ? current.manualOrderIds.filter(nonEmptyString)
     : undefined

   map.initiative = {
     activeId,
     round,
     ...(manualOrderIds?.length ? { manualOrderIds } : {}),
   }
   ```

2. If the server sends no manual order, make sure the local map clears stale manual order.
3. Keep existing entry initiative adoption behavior unchanged.
4. If you choose to represent clear as `manualOrderIds: undefined` in patch current state, document that in the test. If you choose `manualOrderIds: []`, normalize it to absent.

### Tests to add

- Initiative patch with manual order stores it locally.
- Initiative patch without manual order clears a previously local manual order.
- Existing active/round/entries patch behavior still works.

### Acceptance checks

- A second client sees the GM’s dragged order after the realtime patch applies.

### Suggested test command

```bash
npm run test -- tests/utils/livePlayPatches.test.ts
```

---

## 015 - Wire manual order commands from the client tracker in live play

Status: DONE

**Commit message:** `Dispatch manual initiative order changes`

### Why

The tracker added local manual order APIs earlier. Now those APIs need to call `dispatchSetInitiative` with `manualOrderIds` when in live-play mode.

### Files

- `src/composables/map-editor/useInitiativeTracker.ts`
- `src/pages/maps/[slug].vue`
- `src/composables/map-editor/useLivePlayCommands.ts` if stricter typing or helper methods need updates
- `tests/composables/map-editor/useInitiativeTracker.test.ts`
- `tests/composables/map-editor/useLivePlayCommands.test.ts` if command body assertions exist

### Changes

1. Update `setManualInitiativeOrder` from Ticket 5 so live play dispatches:

   ```ts
   if (dispatchLiveSetInitiative({ manualOrderIds: nextIds?.length ? nextIds : null })) return
   ```

2. In live-play mode, prefer sending the complete visible order, not a partial list. Build from `sortedInitiativeRows.value.map(row => row.id)` after applying the move/drop.
3. Confirm `useLivePlayCommands.setInitiative(payload)` sends map initiative scope and no token scope. It probably already does for generic setInitiative; update tests if they assert exact payload keys.
4. For `fillInitiativeFromSpeed` in live-play mode, send `manualOrderIds: null` along with the auto-calc behavior if possible.

   Current behavior sends one `setInitiative` command per placement. You have two options:

   - Simple option: after the loop of initiative updates, send one final `setInitiative({ manualOrderIds: null })`. This is easiest but creates several commands.
   - Better option: add a later batch command for all initiative values plus manual order clear. Do not invent that in this ticket unless you want a larger refactor.

   Use the simple option first. It is commit-sized.

### Tests to add

- With live-play dispatch enabled, `setManualInitiativeOrder(['c', 'a', 'b'])` calls dispatch with `{ manualOrderIds: ['c', 'a', 'b'] }`.
- Clearing manual order calls dispatch with `{ manualOrderIds: null }`.
- Auto-calc all in live-play mode eventually dispatches a manual-order clear.

### Acceptance checks

- Drag or keyboard reorder sends a live-play setInitiative command.
- Setup/edit mode still mutates local map directly.

### Suggested test command

```bash
npm run test -- tests/composables/map-editor/useInitiativeTracker.test.ts tests/composables/map-editor/useLivePlayCommands.test.ts
```

---

## 016 - Polish modal layout for initiative as a primary control surface

Status: TODO

**Commit message:** `Polish initiative modal controls`

### Why

After behavior works, make the Ctrl+I modal easier to run from during encounters.

### Files

- `src/components/map/InitiativeControls.vue`
- `src/components/map/InitiativeRowItem.vue`
- `src/components/map/InitiativeList.vue`
- `src/components/map/InitiativeMenuModal.vue`

### Changes

1. Make `Auto-calc all` prominent.
2. Keep `Previous`, `Start/Next turn`, and round controls visible without scrolling on common laptop sizes.
3. Add a small manual-order notice when active:

   ```txt
   Manual order active. Use Reset order to return to calculated initiative.
   ```

4. Make row metadata more explicit when a row has a manual override:

   - Existing row already shows `Final Init` when initiative differs from speed. Keep that behavior.
   - Do not add too much text; the modal is compact.

5. Ensure pointer cursor and focus-visible states exist for drag handle and move buttons.
6. Avoid using color alone to indicate manual order.

### Acceptance checks

- The modal feels usable as the only initiative panel.
- Auto-calc all and Reset order are easy to find.
- Reorder controls are not visually confused with setting active turn.
- Keyboard focus order is sane: turn button, row body/focus, score input, move controls/drag handle.

### Suggested test command

```bash
npm run typecheck
```

---

## 017 - Add end-to-end-ish regression coverage for the full flow

Status: TODO

**Commit message:** `Test initiative modal manual order flow`

### Why

The feature spans UI, composable state, live-play command payloads, server application, and patch adoption. Add a small set of regression tests that cover the real failure modes.

### Files

Use whichever existing suites are closest:

- `tests/composables/map-editor/useInitiativeTracker.test.ts`
- `tests/server/livePlayInitiativeCommands.test.ts`
- `tests/utils/livePlayPatches.test.ts`
- Optional component test for `InitiativeList.vue` / `InitiativeRowItem.vue`

### Required regression cases

1. **Local modal order flow**

   - Calculated order starts as `a, b, c`.
   - Move `c` up or set manual order to `c, a, b`.
   - Assert sorted rows are `c, a, b`.
   - Call `nextInitiative` and assert it follows `c, a, b`.

2. **Auto-calc resets manual order**

   - Manual order exists.
   - Auto-calc all is triggered.
   - Initiative values are recalculated.
   - `manualOrderIds` is cleared.

3. **Live-play authoritative order**

   - Server map has calculated order `a, b, c` but manual order `c, a, b`.
   - `nextInitiative` advances from `c` to `a`.

4. **Patch adoption**

   - Apply an initiative patch with manual order.
   - Local map stores manual order.
   - Apply a later patch without manual order.
   - Local map clears manual order.

### Acceptance checks

- The exact bug class cannot come back unnoticed: visual reorder but Next/Previous still calculated.
- The auto-calc behavior cannot silently leave stale manual order in place.

### Suggested test command

```bash
npm run test -- tests/composables/map-editor/useInitiativeTracker.test.ts tests/server/livePlayInitiativeCommands.test.ts tests/utils/livePlayPatches.test.ts
```

---

## 018 - Final typecheck, full test run, and cleanup

Status: TODO

**Commit message:** `Validate initiative modal fix`

### Why

This feature touches shared types, server code, client patch adoption, and UI. The final commit should be cleanup only: no new behavior unless a test failure forces it.

### Files

- Any files touched by previous tickets
- This document, if you want to mark tickets completed

### Checklist

1. Search for calculated-order-only calls:

   ```bash
   rg "initiativeOrderIdsForPlacements|initiativeOrderIds\(|manualOrderIds|SET_INITIATIVE|setInitiative" shared src server tests
   ```

2. Confirm every authoritative Next/Previous path passes manual order.
3. Confirm every patch/adoption path preserves or clears manual order intentionally.
4. Confirm every setInitiative validation path handles `manualOrderIds`.
5. Confirm auto-calc all clears manual order in setup/edit and live play.
6. Confirm non-GM controls are disabled.
7. Run:

   ```bash
   npm run typecheck
   npm run test
   ```

8. Manually smoke test:

   - Open map as GM.
   - Spawn at least three combatants.
   - Open Ctrl+I.
   - Auto-calc all.
   - Drag last combatant to top.
   - Press Start/Next and confirm order follows the dragged list.
   - Press Reset order and confirm calculated order returns.
   - Repeat in live-play mode with a second client if available.

### Acceptance checks

- Full typecheck passes.
- Full test suite passes.
- Manual smoke test passes in setup/edit.
- Manual smoke test passes in live play or there is a documented follow-up if live-play environment is unavailable.
