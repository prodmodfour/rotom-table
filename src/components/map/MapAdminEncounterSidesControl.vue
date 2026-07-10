<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ENCOUNTER_SIDE_LIMITS,
  type EncounterSide,
  type EncounterSideStatus,
} from '#shared/moveAutomation/encounterState'
import type { SheetPlacement } from '~/types/map'
import type {
  MapEncounterSideAssignmentInput,
  MapEncounterSideCreateInput,
  MapEncounterSidePatch,
} from '~/composables/map-editor/useMapEncounterSides'
import { checkedValueFromEvent, textValueFromEvent } from '~/utils/domEvents'

const props = withDefaults(defineProps<{
  sides: readonly EncounterSide[]
  placements: readonly SheetPlacement[]
  selectedPlacementId?: string | null
  error?: string | null
  disabled?: boolean
}>(), {
  selectedPlacementId: null,
  error: null,
  disabled: false,
})

const emit = defineEmits<{
  (event: 'create-side', input: MapEncounterSideCreateInput): void
  (event: 'update-side', id: string, patch: MapEncounterSidePatch): void
  (event: 'set-side-status', id: string, status: EncounterSideStatus): void
  (event: 'assign-placements', input: MapEncounterSideAssignmentInput): void
  (event: 'clear-error'): void
}>()

const ASSIGNMENT_TARGET_UNSET = '__choose-side__'
const ASSIGNMENT_TARGET_UNAFFILIATED = '__unaffiliated__'
const DEFAULT_SIDE_COLOR = '#64748b'

const newSideLabel = ref('')
const newSideColor = ref(DEFAULT_SIDE_COLOR)
const selectedPlacementIds = ref<string[]>([])
const assignmentTarget = ref(ASSIGNMENT_TARGET_UNSET)

const sortedSides = computed(() => [...props.sides].sort((left, right) => {
  if (left.status !== right.status) return left.status === 'active' ? -1 : 1
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
}))
const activeSides = computed(() => sortedSides.value.filter(side => side.status === 'active'))
const sortedPlacements = computed(() => [...props.placements].sort((left, right) => (
  left.sheetKind.localeCompare(right.sheetKind)
  || left.sheetSlug.localeCompare(right.sheetSlug)
  || left.id.localeCompare(right.id)
)))
const placementIdSet = computed(() => new Set(props.placements.map(placement => placement.id)))
const selectedPlacementIdSet = computed(() => new Set(selectedPlacementIds.value))
const selectedPlacementCount = computed(() => selectedPlacementIds.value.length)
const allPlacementsSelected = computed(() => (
  props.placements.length > 0 && selectedPlacementCount.value === props.placements.length
))
const createDisabled = computed(() => (
  props.disabled
  || !newSideLabel.value.trim()
  || props.sides.length >= ENCOUNTER_SIDE_LIMITS.count
))
const assignmentDisabled = computed(() => (
  props.disabled
  || selectedPlacementCount.value === 0
  || assignmentTarget.value === ASSIGNMENT_TARGET_UNSET
))
const sideById = computed(() => new Map(props.sides.map(side => [side.id, side])))
const assignedCountBySideId = computed(() => {
  const counts = new Map<string, number>()
  for (const placement of props.placements) {
    if (!placement.sideId) continue
    counts.set(placement.sideId, (counts.get(placement.sideId) ?? 0) + 1)
  }
  return counts
})

watch(
  () => props.placements.map(placement => placement.id),
  (placementIds) => {
    const nextIds = new Set(placementIds)
    selectedPlacementIds.value = selectedPlacementIds.value.filter(id => nextIds.has(id))
  },
  { immediate: true },
)

watch(
  () => props.selectedPlacementId,
  (placementId) => {
    if (!placementId || !placementIdSet.value.has(placementId)) return
    if (selectedPlacementIds.value.includes(placementId)) return
    selectedPlacementIds.value = [...selectedPlacementIds.value, placementId]
  },
  { immediate: true },
)

watch(activeSides, (sides) => {
  if (
    assignmentTarget.value === ASSIGNMENT_TARGET_UNSET
    || assignmentTarget.value === ASSIGNMENT_TARGET_UNAFFILIATED
    || sides.some(side => side.id === assignmentTarget.value)
  ) return
  assignmentTarget.value = ASSIGNMENT_TARGET_UNSET
})

const emitCreateSide = (): void => {
  if (createDisabled.value) return
  emit('clear-error')
  emit('create-side', { label: newSideLabel.value, color: newSideColor.value })
  newSideLabel.value = ''
}

const emitLabelUpdate = (side: EncounterSide, label: string): void => {
  if (props.disabled || label === side.label) return
  emit('clear-error')
  emit('update-side', side.id, { label })
}

const emitColorUpdate = (side: EncounterSide, color: string): void => {
  if (props.disabled || color === side.color) return
  emit('clear-error')
  emit('update-side', side.id, { color })
}

const emitStatusUpdate = (side: EncounterSide): void => {
  if (props.disabled) return
  emit('clear-error')
  emit('set-side-status', side.id, side.status === 'active' ? 'inactive' : 'active')
}

const updatePlacementSelection = (placementId: string, selected: boolean): void => {
  if (props.disabled || !placementIdSet.value.has(placementId)) return
  const next = new Set(selectedPlacementIds.value)
  if (selected) next.add(placementId)
  else next.delete(placementId)
  selectedPlacementIds.value = [...next]
}

const selectAllPlacements = (): void => {
  if (props.disabled) return
  selectedPlacementIds.value = props.placements.map(placement => placement.id)
}

const clearSelectedPlacements = (): void => {
  if (props.disabled) return
  selectedPlacementIds.value = []
}

const emitPlacementAssignment = (): void => {
  if (assignmentDisabled.value) return
  const sideId = assignmentTarget.value === ASSIGNMENT_TARGET_UNAFFILIATED
    ? null
    : assignmentTarget.value
  if (sideId !== null && !activeSides.value.some(side => side.id === sideId)) return

  emit('clear-error')
  emit('assign-placements', {
    placementIds: [...selectedPlacementIds.value],
    sideId,
  })
  assignmentTarget.value = ASSIGNMENT_TARGET_UNSET
}

const currentSideLabel = (placement: SheetPlacement): string => {
  if (!placement.sideId) return 'Unknown / unaffiliated'
  const side = sideById.value.get(placement.sideId)
  if (!side) return `Missing side: ${placement.sideId}`
  return side.status === 'inactive' ? `${side.label} (archived)` : side.label
}
</script>

<template>
  <section class="encounter-sides-control" aria-labelledby="admin-encounter-sides-heading">
    <div class="encounter-sides-control__heading">
      <div>
        <h3 id="admin-encounter-sides-heading">Encounter sides</h3>
        <p>Create stable sides, rename their display labels, and assign map placements explicitly.</p>
      </div>
      <span class="encounter-sides-control__count">{{ sides.length }}/{{ ENCOUNTER_SIDE_LIMITS.count }}</span>
    </div>

    <p v-if="disabled" class="encounter-sides-control__notice">
      Switch to Prepare Map mode to edit encounter sides and placement assignments.
    </p>
    <p v-if="error" class="encounter-sides-control__notice encounter-sides-control__notice--error" role="alert">
      {{ error }}
    </p>

    <form class="encounter-sides-control__create" @submit.prevent="emitCreateSide">
      <label>
        <span>New side label</span>
        <input
          v-model="newSideLabel"
          type="text"
          data-testid="encounter-side-create-label"
          :maxlength="ENCOUNTER_SIDE_LIMITS.labelChars"
          placeholder="Heroes"
          :disabled="disabled"
        />
      </label>
      <label class="encounter-sides-control__color-field">
        <span>Colour</span>
        <input
          v-model="newSideColor"
          type="color"
          data-testid="encounter-side-create-color"
          :disabled="disabled"
        />
      </label>
      <button
        type="submit"
        data-testid="encounter-side-create"
        :disabled="createDisabled"
      >
        Add side
      </button>
    </form>

    <ol v-if="sortedSides.length" class="encounter-sides-control__side-list">
      <li
        v-for="side in sortedSides"
        :key="side.id"
        class="encounter-sides-control__side"
        :class="{ 'encounter-sides-control__side--inactive': side.status === 'inactive' }"
        :data-side-id="side.id"
      >
        <div class="encounter-sides-control__side-meta">
          <span class="encounter-sides-control__swatch" :style="{ backgroundColor: side.color ?? DEFAULT_SIDE_COLOR }" />
          <code>{{ side.id }}</code>
          <span>{{ assignedCountBySideId.get(side.id) ?? 0 }} assigned</span>
        </div>
        <label>
          <span>Display label</span>
          <input
            type="text"
            data-testid="encounter-side-label"
            :value="side.label"
            :maxlength="ENCOUNTER_SIDE_LIMITS.labelChars"
            :disabled="disabled"
            @change="emitLabelUpdate(side, textValueFromEvent($event))"
          />
        </label>
        <label class="encounter-sides-control__color-field">
          <span>Colour</span>
          <input
            type="color"
            data-testid="encounter-side-color"
            :value="side.color ?? DEFAULT_SIDE_COLOR"
            :disabled="disabled"
            @input="emitColorUpdate(side, textValueFromEvent($event))"
          />
        </label>
        <button
          type="button"
          data-testid="encounter-side-status"
          :disabled="disabled"
          @click="emitStatusUpdate(side)"
        >
          {{ side.status === 'active' ? 'Archive side' : 'Reactivate side' }}
        </button>
      </li>
    </ol>
    <p v-else class="encounter-sides-control__empty">
      No encounter sides yet. Create at least two sides before assigning opposing placements.
    </p>

    <fieldset class="encounter-sides-control__assign" :disabled="disabled">
      <legend>Placement assignments</legend>
      <div class="encounter-sides-control__selection-actions">
        <span>{{ selectedPlacementCount }} selected</span>
        <button
          type="button"
          data-testid="encounter-side-select-all"
          :disabled="disabled || placements.length === 0 || allPlacementsSelected"
          @click="selectAllPlacements"
        >
          Select all
        </button>
        <button
          type="button"
          data-testid="encounter-side-clear-selection"
          :disabled="disabled || selectedPlacementCount === 0"
          @click="clearSelectedPlacements"
        >
          Clear
        </button>
      </div>

      <ul v-if="sortedPlacements.length" class="encounter-sides-control__placement-list">
        <li v-for="placement in sortedPlacements" :key="placement.id">
          <label>
            <input
              type="checkbox"
              data-testid="encounter-side-placement"
              :data-placement-id="placement.id"
              :checked="selectedPlacementIdSet.has(placement.id)"
              :disabled="disabled"
              @change="updatePlacementSelection(placement.id, checkedValueFromEvent($event))"
            />
            <span class="encounter-sides-control__placement-name">
              <strong>{{ placement.sheetSlug }}</strong>
              <small>{{ placement.sheetKind }} · {{ placement.id }}</small>
            </span>
            <span class="encounter-sides-control__placement-side">{{ currentSideLabel(placement) }}</span>
          </label>
        </li>
      </ul>
      <p v-else class="encounter-sides-control__empty">Place tokens on the map before assigning sides.</p>

      <div class="encounter-sides-control__assignment-row">
        <label>
          <span>Assign selected placements to</span>
          <select
            v-model="assignmentTarget"
            data-testid="encounter-side-assignment-target"
            :disabled="disabled || selectedPlacementCount === 0"
          >
            <option :value="ASSIGNMENT_TARGET_UNSET" disabled>Choose an assignment</option>
            <option :value="ASSIGNMENT_TARGET_UNAFFILIATED">Unknown / unaffiliated</option>
            <option v-for="side in activeSides" :key="side.id" :value="side.id">
              {{ side.label }} ({{ side.id }})
            </option>
          </select>
        </label>
        <button
          type="button"
          data-testid="encounter-side-assign"
          :disabled="assignmentDisabled"
          @click="emitPlacementAssignment"
        >
          Apply assignment
        </button>
      </div>
    </fieldset>

    <p class="encounter-sides-control__footnote">
      Side IDs stay stable when labels change. Archiving hides a side from new assignments but preserves existing placement identity.
    </p>
  </section>
</template>

<style scoped>
.encounter-sides-control {
  display: grid;
  gap: 0.8rem;
  margin: 0 0 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-soft);
  padding: 0.8rem;
}

.encounter-sides-control__heading,
.encounter-sides-control__side-meta,
.encounter-sides-control__selection-actions,
.encounter-sides-control__assignment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.encounter-sides-control h3,
.encounter-sides-control p {
  margin: 0;
}

.encounter-sides-control h3,
.encounter-sides-control label > span:first-child,
.encounter-sides-control legend {
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.encounter-sides-control__heading p,
.encounter-sides-control__empty,
.encounter-sides-control__footnote,
.encounter-sides-control__notice {
  margin-top: 0.28rem;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.35;
}

.encounter-sides-control__count,
.encounter-sides-control__placement-side,
.encounter-sides-control__side-meta span {
  color: var(--ink-soft);
  font-size: 0.76rem;
  font-weight: 700;
}

.encounter-sides-control__notice {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.55rem 0.65rem;
}

.encounter-sides-control__notice--error {
  border-color: rgba(255, 31, 45, 0.45);
  color: var(--bad);
}

.encounter-sides-control__create {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 0.65rem;
}

.encounter-sides-control label {
  display: grid;
  gap: 0.35rem;
}

.encounter-sides-control__color-field input {
  min-width: 3.2rem;
  height: 2.45rem;
  padding: 0.2rem !important;
}

.encounter-sides-control input,
.encounter-sides-control select,
.encounter-sides-control button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.encounter-sides-control input:focus,
.encounter-sides-control select:focus,
.encounter-sides-control button:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
  outline: none;
}

.encounter-sides-control button {
  cursor: pointer;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.encounter-sides-control button:hover:not(:disabled) {
  border-color: var(--accent);
  background: rgba(255, 31, 45, 0.08);
}

.encounter-sides-control button:disabled,
.encounter-sides-control input:disabled,
.encounter-sides-control select:disabled,
.encounter-sides-control fieldset:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.encounter-sides-control__side-list,
.encounter-sides-control__placement-list {
  display: grid;
  gap: 0.65rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.encounter-sides-control__side {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem;
}

.encounter-sides-control__side-meta {
  grid-column: 1 / -1;
  justify-content: flex-start;
}

.encounter-sides-control__side-meta span:last-child {
  margin-left: auto;
}

.encounter-sides-control__side--inactive {
  opacity: 0.72;
}

.encounter-sides-control__swatch {
  width: 0.85rem;
  height: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 50%;
}

.encounter-sides-control__assign {
  display: grid;
  gap: 0.7rem;
  margin: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  padding: 0.7rem;
}

.encounter-sides-control__assign legend {
  padding: 0 0.25rem;
}

.encounter-sides-control__selection-actions {
  justify-content: flex-start;
}

.encounter-sides-control__selection-actions span {
  margin-right: auto;
  color: var(--ink-soft);
  font-size: 0.82rem;
  font-weight: 700;
}

.encounter-sides-control__placement-list {
  max-height: 15rem;
  overflow-y: auto;
}

.encounter-sides-control__placement-list label {
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.55rem;
}

.encounter-sides-control__placement-list input {
  width: auto;
}

.encounter-sides-control__placement-name {
  display: grid;
  gap: 0.1rem;
  color: var(--ink);
  font-size: 0.88rem;
  letter-spacing: normal !important;
  text-transform: none !important;
}

.encounter-sides-control__placement-name small {
  color: var(--ink-soft);
  font-size: 0.72rem;
  font-weight: 500;
}

.encounter-sides-control__assignment-row {
  align-items: end;
}

.encounter-sides-control__assignment-row label {
  flex: 1;
}

@media (max-width: 640px) {
  .encounter-sides-control__create,
  .encounter-sides-control__side {
    grid-template-columns: 1fr;
  }

  .encounter-sides-control__side-meta {
    grid-column: auto;
  }

  .encounter-sides-control__assignment-row,
  .encounter-sides-control__heading {
    align-items: stretch;
    flex-direction: column;
  }

  .encounter-sides-control__placement-list label {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .encounter-sides-control__placement-side {
    grid-column: 2;
  }
}
</style>
