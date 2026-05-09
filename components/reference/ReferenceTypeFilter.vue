<script setup lang="ts">
withDefaults(defineProps<{
  types: readonly string[]
  activeType: string
  allOption: string
  ariaLabel?: string
}>(), {
  ariaLabel: 'Filter by type',
})

const emit = defineEmits<{
  'update:activeType': [type: string]
}>()
</script>

<template>
  <div class="type-filter" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="type in types"
      :key="type"
      type="button"
      :class="['type-filter__button', {
        active: activeType === type,
        'type-filter__button--all': type === allOption,
      }]"
      :aria-pressed="activeType === type"
      @click="emit('update:activeType', type)"
    >
      <span v-if="type === allOption">All</span>
      <TypeBadge v-else :type="type" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.type-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.type-filter__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.9rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.type-filter__button.active {
  outline: 2px solid var(--ink-bright);
  outline-offset: 2px;
}

.type-filter__button--all {
  padding: 0.32rem 0.85rem;
  background: var(--paper);
  color: var(--ink);
  border-color: var(--rule-soft);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.type-filter__button--all:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.type-filter__button:not(.type-filter__button--all):hover {
  filter: brightness(1.08);
}
</style>
