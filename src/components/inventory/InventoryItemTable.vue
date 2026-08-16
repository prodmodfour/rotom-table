<script setup lang="ts">
import { computed, nextTick, ref, useId, useSlots, watch } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import EditableCell from '~/components/EditableCell.vue'
import TrainerInventoryItemNameCell from '~/components/sheets/TrainerInventoryItemNameCell.vue'
import { inventoryTableColumnCount } from '~/utils/sheets/trainerInventorySections'
import type { InventoryEntry } from '~/types/trainerSheet'
import type {
  TrainerInventoryKey,
  TrainerInventoryTableVariant,
} from '~/utils/sheets/trainerInventorySections'

interface InventoryItemNameOption {
  readonly value: string
  readonly label: string
}

const props = withDefaults(defineProps<{
  sectionKey: TrainerInventoryKey
  title: string
  items?: InventoryEntry[]
  namePlaceholder: string
  variant: TrainerInventoryTableVariant
  itemNameOptions?: readonly InventoryItemNameOption[]
  readOnly?: boolean
  selectedRowIndex?: number | null
}>(), {
  items: () => [],
  itemNameOptions: () => [],
  readOnly: false,
  selectedRowIndex: null,
})

const emit = defineEmits<{
  addItem: [key: TrainerInventoryKey]
  removeItem: [key: TrainerInventoryKey, index: number]
  setItemName: [item: InventoryEntry, value: string]
}>()

const slots = useSlots()
const root = ref<HTMLElement | null>(null)
const rowAnnouncement = ref('')
const titleId = `inventory-section-${useId()}`
const hasRowActionsSlot = computed(() => !!slots.rowActions)
const hasActionsColumn = computed(() => !props.readOnly || hasRowActionsSlot.value)
const hasQuantityColumn = computed(() => props.variant !== 'equipment')
const hasSlotColumn = computed(() => props.variant === 'equipment')
const hasModColumn = computed(() => props.variant === 'pokeBalls')
const emptyColumnCount = computed(() => inventoryTableColumnCount(props.variant) - (hasActionsColumn.value ? 0 : 1))
const ROW_PAGE_SIZE = 80
const pageIndex = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(props.items.length / ROW_PAGE_SIZE)))
const pageStart = computed(() => pageIndex.value * ROW_PAGE_SIZE)
const visibleRows = computed(() => props.items
  .slice(pageStart.value, pageStart.value + ROW_PAGE_SIZE)
  .map((item, visibleIndex) => ({ item, index: pageStart.value + visibleIndex })))
const pageStatus = computed(() => {
  if (!props.items.length) return 'No rows'
  return `Rows ${pageStart.value + 1}–${pageStart.value + visibleRows.value.length} of ${props.items.length}`
})
const goToPage = (nextPage: number): void => {
  pageIndex.value = Math.max(0, Math.min(pageCount.value - 1, nextPage))
}
watch(() => props.sectionKey, () => { pageIndex.value = 0 })
watch(() => props.items.length, () => goToPage(pageIndex.value))
watch(() => props.selectedRowIndex, (selected) => {
  if (selected !== null && selected !== undefined && selected >= 0 && selected < props.items.length) {
    goToPage(Math.floor(selected / ROW_PAGE_SIZE))
  }
})

const setItemName = (item: InventoryEntry, value: string) => {
  emit('setItemName', item, value)
}

const rowLabel = (item: InventoryEntry, index: number): string => item.name?.trim() || `row ${index + 1}`
const focusRowName = (index: number): boolean => {
  const row = root.value?.querySelector<HTMLElement>(`[data-inventory-row="${index}"]`)
  const control = row?.querySelector<HTMLElement>('.inventory-name-cell__display, .editable-cell[role="button"], button, a, input')
  control?.focus()
  return Boolean(control)
}
const addRow = async (): Promise<void> => {
  const nextIndex = props.items.length
  goToPage(Math.floor(nextIndex / ROW_PAGE_SIZE))
  emit('addItem', props.sectionKey)
  rowAnnouncement.value = `Added a blank row to ${props.title}.`
  await nextTick()
  if (!focusRowName(Math.min(nextIndex, Math.max(0, props.items.length - 1)))) root.value?.querySelector<HTMLElement>('.row-add')?.focus()
}
const removeRow = async (item: InventoryEntry, index: number): Promise<void> => {
  if (item.serializedEquipment) return
  const removedLabel = rowLabel(item, index)
  emit('removeItem', props.sectionKey, index)
  rowAnnouncement.value = `Removed ${removedLabel} from ${props.title}.`
  await nextTick()
  if (!props.items.length || !focusRowName(Math.min(index, props.items.length - 1))) root.value?.querySelector<HTMLElement>('.row-add')?.focus()
}

const displayValue = (value: number | string | undefined): string => {
  if (value === undefined) return '—'
  if (typeof value === 'string' && value.trim() === '') return '—'
  return String(value)
}
</script>

<template>
  <div ref="root" class="block inv-block">
    <header class="block-title">
      <h2 :id="titleId">{{ title }}</h2>
      <button v-if="!readOnly" type="button" class="row-add" @click="addRow">
        <PhPlus :size="14" weight="bold" aria-hidden="true" /> Add row
      </button>
    </header>
    <table class="data-table inv-table" :aria-labelledby="titleId" :aria-rowcount="items.length + 1">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th v-if="hasQuantityColumn" scope="col">Qty</th>
          <th v-if="hasSlotColumn" scope="col">Slot</th>
          <th scope="col">Cost</th>
          <th v-if="hasModColumn" scope="col">Mod</th>
          <th scope="col">Description</th>
          <th v-if="hasActionsColumn" scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in visibleRows"
          :key="row.index"
          :class="{ 'is-source-selected': selectedRowIndex === row.index }"
          :aria-current="selectedRowIndex === row.index ? 'true' : undefined"
          :aria-rowindex="row.index + 2"
          :data-inventory-row="row.index"
        >
          <th scope="row" class="inventory-name-col" data-label="Name">
            <span v-if="selectedRowIndex === row.index" class="inventory-selected-source-label">
              <span aria-hidden="true"></span>
              Selected source
            </span>
            <span v-if="readOnly || row.item.serializedEquipment" class="inventory-readonly-value">
              {{ displayValue(row.item.name) }}
              <small v-if="row.item.serializedEquipment" class="inventory-whole-item-label">Whole item</small>
            </span>
            <TrainerInventoryItemNameCell
              v-else
              :model-value="row.item.name"
              :options="itemNameOptions"
              :placeholder="namePlaceholder"
              @commit="(value) => setItemName(row.item, value)"
            />
          </th>
          <td v-if="hasQuantityColumn" data-label="Qty">
            <span v-if="readOnly || row.item.serializedEquipment" class="inventory-readonly-value">
              {{ row.item.serializedEquipment ? '1' : displayValue(row.item.qty) }}
            </span>
            <EditableCell
              v-else
              v-model="row.item.qty"
              type="number"
              :min="0"
              :accessible-label="`quantity for ${rowLabel(row.item, row.index)}`"
            />
          </td>
          <td v-if="hasSlotColumn" data-label="Slot">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(row.item.slot) }}</span>
            <EditableCell
              v-else
              v-model="row.item.slot"
              placeholder="Body"
              :accessible-label="`equipment slot for ${rowLabel(row.item, row.index)}`"
            />
          </td>
          <td data-label="Cost">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(row.item.cost) }}</span>
            <EditableCell
              v-else
              v-model="row.item.cost"
              placeholder="—"
              :accessible-label="`cost for ${rowLabel(row.item, row.index)}`"
            />
          </td>
          <td v-if="hasModColumn" data-label="Mod">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(row.item.mod) }}</span>
            <EditableCell
              v-else
              v-model="row.item.mod"
              placeholder="x1"
              :accessible-label="`modifier for ${rowLabel(row.item, row.index)}`"
            />
          </td>
          <td class="effect-col" data-label="Description">
            <span v-if="readOnly" class="inventory-readonly-value inventory-readonly-value--description">
              {{ displayValue(row.item.description) }}
            </span>
            <EditableCell
              v-else
              v-model="row.item.description"
              type="textarea"
              placeholder="—"
              multiline
              :accessible-label="`description for ${rowLabel(row.item, row.index)}`"
            />
          </td>
          <td v-if="hasActionsColumn" class="row-actions" data-label="Actions">
            <slot name="rowActions" :item="row.item" :index="row.index" :section-key="sectionKey" />
            <button
              v-if="!readOnly"
              type="button"
              class="row-remove"
              :disabled="Boolean(row.item.serializedEquipment)"
              :title="row.item.serializedEquipment ? 'Move this whole item through an authoritative equipment or transfer action.' : 'Remove'"
              :aria-label="row.item.serializedEquipment ? `Move ${row.item.name || 'this item'} through an authoritative action` : `Remove ${row.item.name || 'this row'}`"
              @click="removeRow(row.item, row.index)"
            >
              <PhX :size="14" weight="bold" aria-hidden="true" />
            </button>
          </td>
        </tr>
        <tr v-if="!items.length" class="inv-table__empty-row">
          <td :colspan="emptyColumnCount" class="muted">—</td>
        </tr>
      </tbody>
    </table>
    <nav v-if="pageCount > 1" class="inventory-table-pagination" :aria-label="`${title} rows`">
      <button type="button" :disabled="pageIndex === 0" @click="goToPage(pageIndex - 1)">Previous</button>
      <span aria-live="polite">{{ pageStatus }}</span>
      <button type="button" :disabled="pageIndex >= pageCount - 1" @click="goToPage(pageIndex + 1)">Next</button>
    </nav>
    <p class="inventory-row-announcement" aria-live="polite">{{ rowAnnouncement }}</p>
  </div>
</template>

<style scoped src="../sheets/trainerInventoryPanel.css"></style>

<style scoped>
.inventory-table-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.75rem 0 0;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.inventory-table-pagination button {
  min-height: 44px;
  padding: 0 var(--space-4);
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-soft);
  font: inherit;
  cursor: pointer;
}

.inventory-table-pagination button:hover:not(:disabled) {
  border-color: var(--rt-focus);
}

.inventory-table-pagination button:focus-visible {
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.inventory-table-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@media (max-width: 42rem) {
  .inventory-table-pagination {
    justify-content: space-between;
    gap: 0.5rem;
  }

  .inventory-table-pagination button {
    flex: 0 0 auto;
    padding-inline: 0.75rem;
  }
}
</style>
