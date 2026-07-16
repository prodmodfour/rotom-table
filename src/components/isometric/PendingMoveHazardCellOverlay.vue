<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MoveHazardCellSelectionCount } from '#shared/moveAutomation/hazardCellSelection'
import type {
  PendingMoveHazardCellResponseReference,
  PendingMoveResponseReference,
} from '~/composables/map-editor/usePendingMoveResponses'
import type { GridAnchor } from '~/types/map'

interface PendingMoveHazardCellOverlayOption {
  readonly id: string
  readonly cell: GridAnchor
  readonly left: number
  readonly top: number
}

interface PendingMoveHazardCellOverlaySelection {
  readonly reference: PendingMoveResponseReference
  readonly canonicalMoveId: string
  readonly count: MoveHazardCellSelectionCount
  readonly options: readonly PendingMoveHazardCellOverlayOption[]
  readonly disabled: boolean
}

const props = defineProps<{
  selections: readonly PendingMoveHazardCellOverlaySelection[]
}>()

const emit = defineEmits<{
  confirm: [reference: PendingMoveHazardCellResponseReference]
}>()

const selectedByWindow = ref<Record<string, readonly string[]>>({})
const windowKey = (reference: PendingMoveResponseReference): string => (
  `${reference.resolutionId}:${reference.windowId}`
)

watch(
  () => props.selections,
  (selections) => {
    const next: Record<string, readonly string[]> = {}
    for (const selection of selections) {
      const key = windowKey(selection.reference)
      const legal = new Set(selection.options.map(option => option.id))
      next[key] = (selectedByWindow.value[key] ?? []).filter(id => legal.has(id))
    }
    selectedByWindow.value = next
  },
  { deep: true, immediate: true },
)

const selectionBounds = (count: MoveHazardCellSelectionCount) => count.kind === 'exact'
  ? { minimum: count.count, maximum: count.count }
  : { minimum: count.minimum, maximum: count.maximum }

const selectedIds = (selection: PendingMoveHazardCellOverlaySelection): readonly string[] => (
  selectedByWindow.value[windowKey(selection.reference)] ?? []
)

const selectedIdSet = (selection: PendingMoveHazardCellOverlaySelection): ReadonlySet<string> => (
  new Set(selectedIds(selection))
)

const instruction = (selection: PendingMoveHazardCellOverlaySelection): string => {
  const { minimum, maximum } = selectionBounds(selection.count)
  const count = minimum === maximum ? `exactly ${minimum}` : `${minimum} to ${maximum}`
  return `Select ${count} server-approved hazard cells for ${selection.canonicalMoveId}.`
}

const progress = (selection: PendingMoveHazardCellOverlaySelection): string => {
  const { minimum, maximum } = selectionBounds(selection.count)
  const selected = selectedIds(selection).length
  return minimum === maximum
    ? `${selected} / ${maximum} selected`
    : `${selected} selected · ${minimum}–${maximum} allowed`
}

const canConfirm = (selection: PendingMoveHazardCellOverlaySelection): boolean => {
  const { minimum, maximum } = selectionBounds(selection.count)
  const selected = selectedIds(selection).length
  return !selection.disabled && selected >= minimum && selected <= maximum
}

const toggle = (
  selection: PendingMoveHazardCellOverlaySelection,
  optionId: string,
): void => {
  if (selection.disabled || !selection.options.some(option => option.id === optionId)) return
  const key = windowKey(selection.reference)
  const selected = new Set(selectedIds(selection))
  if (selected.has(optionId)) selected.delete(optionId)
  else {
    const { maximum } = selectionBounds(selection.count)
    if (selected.size >= maximum) return
    selected.add(optionId)
  }
  selectedByWindow.value = {
    ...selectedByWindow.value,
    [key]: selection.options.filter(option => selected.has(option.id)).map(option => option.id),
  }
}

const confirm = (selection: PendingMoveHazardCellOverlaySelection): void => {
  if (!canConfirm(selection)) return
  emit('confirm', {
    resolutionId: selection.reference.resolutionId,
    windowId: selection.reference.windowId,
    optionIds: [...selectedIds(selection)],
  })
}

const hasSelections = computed(() => props.selections.length > 0)
const optionLabel = (selection: PendingMoveHazardCellOverlaySelection, option: PendingMoveHazardCellOverlayOption): string => {
  const action = selectedIdSet(selection).has(option.id) ? 'Deselect' : 'Select'
  return `${action} hazard cell (${option.cell.x}, ${option.cell.y}, ${option.cell.z}) for ${selection.canonicalMoveId}`
}
</script>

<template>
  <template v-if="hasSelections">
    <div
      v-for="selection in props.selections"
      :key="windowKey(selection.reference)"
      class="pending-hazard-cell-hud"
      aria-live="polite"
      @pointerdown.stop
      @click.stop
    >
      <strong>Choose hazard cells</strong>
      <span>{{ instruction(selection) }}</span>
      <small>{{ progress(selection) }}</small>
      <button
        type="button"
        :disabled="!canConfirm(selection)"
        @click="confirm(selection)"
      >
        Confirm cells
      </button>
    </div>

    <div
      class="pending-hazard-cell-layer"
      aria-label="Legal hazard cells"
      @contextmenu.prevent
    >
      <template
        v-for="selection in props.selections"
        :key="windowKey(selection.reference)"
      >
        <button
          v-for="option in selection.options"
          :key="`${windowKey(selection.reference)}:${option.id}`"
          type="button"
          class="pending-hazard-cell-button"
          :class="{ 'is-selected': selectedIdSet(selection).has(option.id) }"
          :style="{ left: `${option.left}px`, top: `${option.top}px` }"
          :disabled="selection.disabled"
          :aria-pressed="selectedIdSet(selection).has(option.id)"
          :aria-label="optionLabel(selection, option)"
          :title="optionLabel(selection, option)"
          @pointerdown.stop
          @click.stop="toggle(selection, option.id)"
        >
          <span aria-hidden="true">◇</span>
        </button>
      </template>
    </div>
  </template>
</template>

<style scoped>
.pending-hazard-cell-hud {
  position: absolute;
  z-index: 10;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  display: grid;
  gap: 0.2rem;
  justify-items: center;
  max-width: min(30rem, calc(100% - 2rem));
  padding: 0.6rem 0.85rem;
  border: 1px solid color-mix(in srgb, #dc6d37 72%, var(--rule-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--paper) 95%, transparent);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  color: var(--ink);
  text-align: center;
  transform: translateX(-50%);
  pointer-events: auto;
}

.pending-hazard-cell-hud strong {
  color: #dc6d37;
}

.pending-hazard-cell-hud span,
.pending-hazard-cell-hud small {
  font-size: 0.76rem;
}

.pending-hazard-cell-hud button {
  margin-top: 0.2rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid #dc6d37;
  border-radius: 999px;
  background: var(--paper-accent);
  color: #dc6d37;
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 850;
}

.pending-hazard-cell-layer {
  position: absolute;
  z-index: 9;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.pending-hazard-cell-button {
  position: absolute;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 2px solid #dc6d37;
  border-radius: 8px;
  background: color-mix(in srgb, var(--paper) 80%, transparent);
  box-shadow: 0 0 0 5px color-mix(in srgb, #dc6d37 18%, transparent), 0 5px 14px rgba(0, 0, 0, 0.35);
  color: #dc6d37;
  cursor: crosshair;
  transform: translate(-50%, -50%) rotate(45deg);
  pointer-events: auto;
}

.pending-hazard-cell-button > span {
  transform: rotate(-45deg);
}

.pending-hazard-cell-button.is-selected,
.pending-hazard-cell-button:hover,
.pending-hazard-cell-button:focus-visible {
  background: #dc6d37;
  color: var(--paper);
}

.pending-hazard-cell-button:focus-visible {
  outline: 2px solid var(--ink-bright);
  outline-offset: 5px;
}

.pending-hazard-cell-button:disabled,
.pending-hazard-cell-hud button:disabled {
  cursor: wait;
  opacity: 0.48;
}
</style>
