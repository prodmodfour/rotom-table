<script setup lang="ts">
import { computed } from 'vue'
import InventoryItemTable from '~/components/inventory/InventoryItemTable.vue'
import {
  setTrainerInventoryItemName,
  trainerInventoryItemOptions,
} from '~/utils/sheets/trainerInventoryItems'
import type {
  TrainerInventoryKey,
  TrainerInventoryTableVariant,
} from '~/utils/sheets/trainerInventorySections'
import type { InventoryEntry } from '~/types/trainerSheet'

const props = defineProps<{
  sectionKey: TrainerInventoryKey
  title: string
  items?: InventoryEntry[]
  namePlaceholder: string
  variant: TrainerInventoryTableVariant
  selectedRowIndex?: number | null
}>()

const emit = defineEmits<{
  addItem: [key: TrainerInventoryKey]
  removeItem: [key: TrainerInventoryKey, index: number]
}>()

const itemNameOptions = computed(() => trainerInventoryItemOptions(props.sectionKey))

const setItemName = (item: InventoryEntry, value: string) => {
  setTrainerInventoryItemName(item, value, props.variant)
}

const forwardAddItem = (key: TrainerInventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: TrainerInventoryKey, index: number) => emit('removeItem', key, index)
</script>

<template>
  <InventoryItemTable
    :section-key="sectionKey"
    :title="title"
    :items="items"
    :name-placeholder="namePlaceholder"
    :variant="variant"
    :item-name-options="itemNameOptions"
    :selected-row-index="selectedRowIndex"
    @add-item="forwardAddItem"
    @remove-item="forwardRemoveItem"
    @set-item-name="setItemName"
  >
    <template #rowActions="slotProps">
      <slot name="rowActions" v-bind="slotProps" />
    </template>
  </InventoryItemTable>
</template>
