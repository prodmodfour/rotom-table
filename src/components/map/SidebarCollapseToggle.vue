<script setup lang="ts">
withDefaults(defineProps<{
  collapsed: boolean
  controlsId: string
  expandAriaLabel: string
  collapseAriaLabel: string
  expandTitle: string
  collapseTitle: string
  collapsedIcon: string
  expandedIcon: string
  rowAlign?: 'start' | 'end'
}>(), {
  rowAlign: 'end',
})

const emit = defineEmits<{
  (event: 'toggle'): void
}>()
</script>

<template>
  <div
    class="sidebar-toggle-row"
    :class="[
      `sidebar-toggle-row--${rowAlign}`,
      { 'sidebar-toggle-row--collapsed': collapsed },
    ]"
  >
    <button
      type="button"
      class="sidebar-toggle"
      :aria-expanded="!collapsed"
      :aria-controls="controlsId"
      :aria-label="collapsed ? expandAriaLabel : collapseAriaLabel"
      :title="collapsed ? expandTitle : collapseTitle"
      @click="emit('toggle')"
    >
      <span aria-hidden="true">{{ collapsed ? collapsedIcon : expandedIcon }}</span>
      <span class="sidebar-toggle__label">{{ collapsed ? 'Expand' : 'Collapse' }}</span>
    </button>
  </div>
</template>

<style scoped>
.sidebar-toggle-row {
  display: flex;
  padding: 0 0.25rem;
}

.sidebar-toggle-row--start {
  justify-content: flex-start;
}

.sidebar-toggle-row--end {
  justify-content: flex-end;
}

.sidebar-toggle-row--collapsed {
  justify-content: center;
  padding: 0;
}

.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.sidebar-toggle:hover,
.sidebar-toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.sidebar-toggle span[aria-hidden='true'] {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 0.8;
}

.sidebar-toggle-row--collapsed .sidebar-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

.sidebar-toggle-row--collapsed .sidebar-toggle__label {
  display: none;
}
</style>
