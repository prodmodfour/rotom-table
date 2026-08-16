<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'

const props = withDefaults(defineProps<{
  activeSectionKey: TrainerInventoryKey
  counts?: Partial<Record<TrainerInventoryKey, number>>
  idPrefix?: string
  panelId?: string
}>(), {
  counts: () => ({}),
  idPrefix: undefined,
  panelId: undefined,
})

const emit = defineEmits<{
  'update:activeSectionKey': [key: TrainerInventoryKey]
}>()

const generatedId = useId().replaceAll(':', '')
const resolvedIdPrefix = computed(() => props.idPrefix?.trim() || `inventory-sections-${generatedId}`)
const resolvedPanelId = computed(() => props.panelId?.trim() || `${resolvedIdPrefix.value}-panel`)
const tabId = (key: TrainerInventoryKey): string => `${resolvedIdPrefix.value}-tab-${key}`
const isActiveSection = (key: TrainerInventoryKey) => props.activeSectionKey === key
const sectionCount = (key: TrainerInventoryKey) => props.counts[key] ?? 0
const tablist = ref<HTMLElement | null>(null)
const selectSection = (key: TrainerInventoryKey) => emit('update:activeSectionKey', key)
const focusSection = async (index: number): Promise<void> => {
  const section = TRAINER_INVENTORY_SECTIONS[index]
  if (!section) return
  selectSection(section.key)
  await nextTick()
  tablist.value?.querySelector<HTMLElement>(`[data-inventory-section-index="${index}"]`)?.focus()
}
const moveSectionFocus = (event: KeyboardEvent, currentIndex: number): void => {
  let nextIndex: number | null = null
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = TRAINER_INVENTORY_SECTIONS.length - 1
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % TRAINER_INVENTORY_SECTIONS.length
  }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + TRAINER_INVENTORY_SECTIONS.length) % TRAINER_INVENTORY_SECTIONS.length
  }
  if (nextIndex === null) return
  event.preventDefault()
  void focusSection(nextIndex)
}
const focusActive = (): void => {
  const index = Math.max(0, TRAINER_INVENTORY_SECTIONS.findIndex(section => isActiveSection(section.key)))
  tablist.value?.querySelector<HTMLElement>(`[data-inventory-section-index="${index}"]`)?.focus()
}

defineExpose({ focusActive })
</script>

<template>
  <nav ref="tablist" class="inventory-subtabs" aria-label="Inventory sections" role="tablist">
    <button
      v-for="(section, index) in TRAINER_INVENTORY_SECTIONS"
      :key="section.key"
      type="button"
      class="inventory-subtab"
      :id="tabId(section.key)"
      :class="{ 'is-active': isActiveSection(section.key) }"
      role="tab"
      :aria-controls="resolvedPanelId"
      :aria-selected="isActiveSection(section.key)"
      :tabindex="isActiveSection(section.key) ? 0 : -1"
      :data-inventory-section-index="index"
      @click="selectSection(section.key)"
      @keydown="moveSectionFocus($event, index)"
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
  min-height: 2.75rem;
  border-radius: 6px;
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

.inventory-subtab:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.inventory-subtab:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.inventory-subtab.is-active {
  border-color: var(--rule-active);
  box-shadow: inset 3px 0 0 var(--rt-focus);
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

@media (prefers-reduced-motion: reduce) {
  .inventory-subtab { transition: none; }
}
</style>
