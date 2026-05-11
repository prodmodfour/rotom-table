<script setup lang="ts">
import { TRAINER_EQUIPMENT_SLOTS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerEquipmentSlots } from '~/types/trainerSheet'

defineProps<{
  equipmentSlots: TrainerEquipmentSlots
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">Equipped</h2>
    <ul class="kv-list">
      <li v-for="slot in TRAINER_EQUIPMENT_SLOTS" :key="slot.key">
        <span>{{ slot.label }}</span>
        <strong class="equipped-item">
          <ItemSprite :item="equipmentSlots[slot.key]" size="sm" />
          <EditableCell v-model="equipmentSlots[slot.key]" placeholder="—" />
        </strong>
      </li>
    </ul>
  </div>
</template>

<style scoped src="./trainerInventoryPanel.css"></style>
