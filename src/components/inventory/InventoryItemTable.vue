<script setup lang="ts">
import { computed, useSlots } from 'vue'
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
}>(), {
  items: () => [],
  itemNameOptions: () => [],
  readOnly: false,
})

const emit = defineEmits<{
  addItem: [key: TrainerInventoryKey]
  removeItem: [key: TrainerInventoryKey, index: number]
  setItemName: [item: InventoryEntry, value: string]
}>()

const slots = useSlots()
const hasRowActionsSlot = computed(() => !!slots.rowActions)
const hasActionsColumn = computed(() => !props.readOnly || hasRowActionsSlot.value)
const hasQuantityColumn = computed(() => props.variant !== 'equipment')
const hasSlotColumn = computed(() => props.variant === 'equipment')
const hasModColumn = computed(() => props.variant === 'pokeBalls')
const emptyColumnCount = computed(() => inventoryTableColumnCount(props.variant) - (hasActionsColumn.value ? 0 : 1))

const setItemName = (item: InventoryEntry, value: string) => {
  emit('setItemName', item, value)
}

const displayValue = (value: number | string | undefined): string => {
  if (value === undefined) return '—'
  if (typeof value === 'string' && value.trim() === '') return '—'
  return String(value)
}
</script>

<template>
  <div class="block inv-block">
    <h2 class="block-title">
      {{ title }}
      <button v-if="!readOnly" type="button" class="row-add" @click="emit('addItem', sectionKey)">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <table class="data-table inv-table">
      <thead>
        <tr>
          <th>Name</th>
          <th v-if="hasQuantityColumn">Qty</th>
          <th v-if="hasSlotColumn">Slot</th>
          <th>Cost</th>
          <th v-if="hasModColumn">Mod</th>
          <th>Description</th>
          <th v-if="hasActionsColumn" aria-label="Row actions"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in items" :key="index">
          <th class="inventory-name-col">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(item.name) }}</span>
            <TrainerInventoryItemNameCell
              v-else
              :model-value="item.name"
              :options="itemNameOptions"
              :placeholder="namePlaceholder"
              @commit="(value) => setItemName(item, value)"
            />
          </th>
          <td v-if="hasQuantityColumn">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(item.qty) }}</span>
            <EditableCell v-else v-model="item.qty" type="number" :min="0" />
          </td>
          <td v-if="hasSlotColumn">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(item.slot) }}</span>
            <EditableCell v-else v-model="item.slot" placeholder="Body" />
          </td>
          <td>
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(item.cost) }}</span>
            <EditableCell v-else v-model="item.cost" placeholder="—" />
          </td>
          <td v-if="hasModColumn">
            <span v-if="readOnly" class="inventory-readonly-value">{{ displayValue(item.mod) }}</span>
            <EditableCell v-else v-model="item.mod" placeholder="x1" />
          </td>
          <td class="effect-col">
            <span v-if="readOnly" class="inventory-readonly-value inventory-readonly-value--description">
              {{ displayValue(item.description) }}
            </span>
            <EditableCell v-else v-model="item.description" type="textarea" placeholder="—" multiline />
          </td>
          <td v-if="hasActionsColumn" class="row-actions">
            <slot name="rowActions" :item="item" :index="index" :section-key="sectionKey" />
            <button v-if="!readOnly" type="button" class="row-remove" title="Remove" @click="emit('removeItem', sectionKey, index)">
              <PhX :size="14" weight="bold" />
            </button>
          </td>
        </tr>
        <tr v-if="!items.length">
          <td :colspan="emptyColumnCount" class="muted">—</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="../sheets/trainerInventoryPanel.css"></style>
