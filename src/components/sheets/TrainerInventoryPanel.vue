<script setup lang="ts">
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'
import type { TrainerSheet } from '~/types/trainerSheet'

defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addItem: [key: TrainerInventoryKey]
  removeItem: [key: TrainerInventoryKey, index: number]
}>()

const forwardAddItem = (key: TrainerInventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: TrainerInventoryKey, index: number) => emit('removeItem', key, index)
</script>

<template>
  <div class="trainer-inventory-panel">
    <TrainerEquippedGearPanel :equipment-slots="sheet.equipmentSlots!" />

    <div class="grid-two">
      <TrainerInventoryItemTable
        v-for="section in TRAINER_INVENTORY_SECTIONS"
        :key="section.key"
        :section-key="section.key"
        :title="section.title"
        :items="sheet.inventory![section.key]"
        :name-placeholder="section.namePlaceholder"
        :variant="section.variant"
        @add-item="forwardAddItem"
        @remove-item="forwardRemoveItem"
      />
    </div>
  </div>
</template>

<style scoped>
.trainer-inventory-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}
</style>
