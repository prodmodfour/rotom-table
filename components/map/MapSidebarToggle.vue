<script setup lang="ts">
defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle'): void
}>()
</script>

<template>
  <div class="sidebar-toggle-row">
    <button
      type="button"
      class="sidebar-toggle"
      :aria-expanded="!collapsed"
      aria-controls="map-sidebar-content"
      :aria-label="collapsed ? 'Expand map sidebar' : 'Collapse map sidebar'"
      :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      @click="emit('toggle')"
    >
      <span aria-hidden="true">{{ collapsed ? '›' : '‹' }}</span>
      <span class="sidebar-toggle__label">{{ collapsed ? 'Expand' : 'Collapse' }}</span>
    </button>
  </div>
</template>

<style scoped>
.sidebar-toggle-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 0.25rem;
}

:global(.sidebar--collapsed) .sidebar-toggle-row {
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

:global(.sidebar--collapsed) .sidebar-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

:global(.sidebar--collapsed) .sidebar-toggle__label {
  display: none;
}
</style>
