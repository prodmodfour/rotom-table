<script setup lang="ts">
import { computed, ref } from 'vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'
import type { TrainerSheet } from '~/types/trainerSheet'

const props = defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addItem: [key: TrainerInventoryKey]
  removeItem: [key: TrainerInventoryKey, index: number]
}>()

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
const activeSection = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find((section) => section.key === activeSectionKey.value)
  ?? TRAINER_INVENTORY_SECTIONS[0]
))
const inventorySectionCounts = computed<Partial<Record<TrainerInventoryKey, number>>>(() => {
  const inventory = props.sheet.inventory
  return TRAINER_INVENTORY_SECTIONS.reduce<Partial<Record<TrainerInventoryKey, number>>>((counts, section) => {
    counts[section.key] = inventory?.[section.key]?.length ?? 0
    return counts
  }, {})
})

const forwardAddItem = (key: TrainerInventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: TrainerInventoryKey, index: number) => emit('removeItem', key, index)
</script>

<template>
  <div class="trainer-inventory-panel">
    <TrainerEquippedGearPanel :equipment-slots="sheet.equipmentSlots!" />

    <InventorySectionTabs
      v-model:active-section-key="activeSectionKey"
      :counts="inventorySectionCounts"
    />

    <div class="inventory-section-panel">
      <TrainerInventoryItemTable
        :key="activeSection.key"
        :section-key="activeSection.key"
        :title="activeSection.title"
        :items="sheet.inventory![activeSection.key]"
        :name-placeholder="activeSection.namePlaceholder"
        :variant="activeSection.variant"
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

.inventory-section-panel {
  min-width: 0;
}
</style>
