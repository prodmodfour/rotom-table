<script setup lang="ts">
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'

const props = withDefaults(defineProps<{
  activeSectionKey: TrainerInventoryKey
  counts?: Partial<Record<TrainerInventoryKey, number>>
}>(), {
  counts: () => ({}),
})

const emit = defineEmits<{
  'update:activeSectionKey': [key: TrainerInventoryKey]
}>()

const isActiveSection = (key: TrainerInventoryKey) => props.activeSectionKey === key
const sectionCount = (key: TrainerInventoryKey) => props.counts[key] ?? 0
const selectSection = (key: TrainerInventoryKey) => emit('update:activeSectionKey', key)
</script>

<template>
  <nav class="inventory-subtabs" aria-label="Inventory sections">
    <button
      v-for="section in TRAINER_INVENTORY_SECTIONS"
      :key="section.key"
      type="button"
      class="inventory-subtab"
      :class="{ 'is-active': isActiveSection(section.key) }"
      :aria-pressed="isActiveSection(section.key)"
      @click="selectSection(section.key)"
    >
      <span>{{ section.title }}</span>
      <span class="inventory-subtab-count">{{ sectionCount(section.key) }}</span>
    </button>
  </nav>
</template>

<style scoped>
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
</style>
