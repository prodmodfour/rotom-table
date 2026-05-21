<script setup lang="ts">
import { computed, ref } from 'vue'
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

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
const activeSection = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find((section) => section.key === activeSectionKey.value)
  ?? TRAINER_INVENTORY_SECTIONS[0]
))

const setActiveSection = (key: TrainerInventoryKey) => {
  activeSectionKey.value = key
}

const forwardAddItem = (key: TrainerInventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: TrainerInventoryKey, index: number) => emit('removeItem', key, index)
</script>

<template>
  <div class="trainer-inventory-panel">
    <TrainerEquippedGearPanel :equipment-slots="sheet.equipmentSlots!" />

    <nav class="inventory-subtabs" aria-label="Inventory sections">
      <button
        v-for="section in TRAINER_INVENTORY_SECTIONS"
        :key="section.key"
        type="button"
        class="inventory-subtab"
        :class="{ 'is-active': activeSectionKey === section.key }"
        :aria-pressed="activeSectionKey === section.key"
        @click="setActiveSection(section.key)"
      >
        <span>{{ section.title }}</span>
        <span class="inventory-subtab-count">{{ sheet.inventory?.[section.key]?.length ?? 0 }}</span>
      </button>
    </nav>

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

.inventory-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.45rem;
}

.inventory-subtab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.4rem 0.7rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.inventory-subtab:hover,
.inventory-subtab:focus-visible {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
  outline: none;
}

.inventory-subtab.is-active {
  border-color: var(--rule-active);
  background: var(--paper-active);
  color: var(--ink-bright);
}

.inventory-subtab-count {
  min-width: 1.35rem;
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-muted);
  padding: 0.08rem 0.35rem;
  font-size: 0.72rem;
  text-align: center;
}

.inventory-subtab.is-active .inventory-subtab-count {
  background: var(--accent-soft);
  color: var(--accent);
}

.inventory-section-panel {
  min-width: 0;
}
</style>
