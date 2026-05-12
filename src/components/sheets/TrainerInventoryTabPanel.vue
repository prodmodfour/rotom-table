<script setup lang="ts">
import type { TrainerSheet } from '~/types/trainerSheet'

type InventoryKey = keyof NonNullable<TrainerSheet['inventory']>

defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addItem: [key: InventoryKey]
  removeItem: [key: InventoryKey, index: number]
}>()

const forwardAddItem = (key: InventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: InventoryKey, index: number) => emit('removeItem', key, index)
</script>

<template>
  <section class="tab-panel">
    <TrainerInventoryPanel
      :sheet="sheet"
      @add-item="forwardAddItem"
      @remove-item="forwardRemoveItem"
    />
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
