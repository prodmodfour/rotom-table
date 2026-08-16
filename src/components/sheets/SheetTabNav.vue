<script setup lang="ts">
import { nextTick, ref } from 'vue'

export interface SheetTabOption {
  key: string
  label: string
}

const props = defineProps<{
  tabs: SheetTabOption[]
  activeKey: string
}>()

const emit = defineEmits<{
  'update:activeKey': [key: string]
}>()

const nav = ref<HTMLElement | null>(null)
const focusTab = async (index: number): Promise<void> => {
  const tab = props.tabs[index]
  if (!tab) return
  emit('update:activeKey', tab.key)
  await nextTick()
  nav.value?.querySelector<HTMLElement>(`[data-sheet-tab-index="${index}"]`)?.focus()
}
const moveTabFocus = (event: KeyboardEvent, currentIndex: number): void => {
  if (props.tabs.length === 0) return
  let nextIndex: number | null = null
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = props.tabs.length - 1
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % props.tabs.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + props.tabs.length) % props.tabs.length
  if (nextIndex === null) return
  event.preventDefault()
  void focusTab(nextIndex)
}
</script>

<template>
  <nav ref="nav" class="tab-nav" aria-label="Sheet tabs">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.key"
      type="button"
      :class="['tab-btn', { active: activeKey === tab.key }]"
      :aria-pressed="activeKey === tab.key"
      :tabindex="activeKey === tab.key ? 0 : -1"
      :data-sheet-tab-index="index"
      @click="emit('update:activeKey', tab.key)"
      @keydown="moveTabFocus($event, index)"
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
  min-height: 2.75rem;
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

.tab-btn:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.tab-btn.active {
  background: var(--paper-active);
  border-color: var(--rule-active);
  color: var(--ink-bright);
}

@media (prefers-reduced-motion: reduce) {
  .tab-btn { transition: none; }
}
</style>
