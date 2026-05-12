<script setup lang="ts">
export interface ReferenceFilterChip {
  key: string
  label: string
  count: number
}

withDefaults(defineProps<{
  chips: readonly ReferenceFilterChip[]
  activeKey?: string | null
  ariaLabel?: string
}>(), {
  activeKey: null,
  ariaLabel: 'Filter options',
})

const emit = defineEmits<{
  select: [key: string]
}>()
</script>

<template>
  <div class="filter-chip-row" role="list" :aria-label="ariaLabel">
    <button
      v-for="chip in chips"
      :key="chip.key"
      type="button"
      class="filter-chip"
      :class="{ active: activeKey === chip.key }"
      :aria-pressed="activeKey === chip.key"
      @click="emit('select', chip.key)"
    >
      {{ chip.label }} <span class="filter-chip__count">{{ chip.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.filter-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.4rem;
  margin: 0.45rem 0 0.7rem;
}

.filter-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.18rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink-soft);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.filter-chip:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.filter-chip.active {
  background: var(--paper-active);
  border-color: var(--rule-active);
  color: var(--ink-bright);
}

.filter-chip__count {
  opacity: 0.6;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}
</style>
