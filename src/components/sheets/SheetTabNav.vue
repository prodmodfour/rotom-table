<script setup lang="ts">
export interface SheetTabOption {
  key: string
  label: string
}

defineProps<{
  tabs: SheetTabOption[]
  activeKey: string
}>()

const emit = defineEmits<{
  'update:activeKey': [key: string]
}>()
</script>

<template>
  <nav class="tab-nav" aria-label="Sheet tabs">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      :class="['tab-btn', { active: activeKey === tab.key }]"
      @click="emit('update:activeKey', tab.key)"
    >{{ tab.label }}</button>
  </nav>
</template>

<style scoped>
.tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.85rem 0;
}

.tab-btn {
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.tab-btn:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.tab-btn.active {
  background: var(--paper-active);
  border-color: var(--rule-active);
  color: var(--ink-bright);
}
</style>
