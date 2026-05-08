<script setup lang="ts">
import MapInitiativeTracker from '~/components/map/InitiativeTracker.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
  collapsed: boolean
  showTracker: boolean
  rows: InitiativeRow[]
  sortedRows: InitiativeRow[]
  activeId: string | null
  round: number
  selectedId: string | null
  canManage: boolean
  hasInitiativeValues: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'set-round', value: Event): void
  (event: 'previous'): void
  (event: 'next'): void
  (event: 'fill-from-speed'): void
  (event: 'clear-active'): void
  (event: 'clear-values'): void
  (event: 'set-active-and-focus', id: string): void
  (event: 'focus', id: string): void
  (event: 'set-initiative-input', id: string, value: Event): void
  (event: 'set-initiative-from-speed', id: string, speed: number): void
}>()
</script>

<template>
  <aside
    class="initiative-sidebar"
    :class="{ 'initiative-sidebar--collapsed': collapsed }"
    :aria-label="collapsed ? 'Collapsed initiative tracker' : 'Initiative tracker'"
  >
    <div class="initiative-toggle-row">
      <button
        type="button"
        class="initiative-toggle"
        :aria-expanded="!collapsed"
        aria-controls="initiative-tracker-content"
        :aria-label="collapsed ? 'Expand initiative tracker' : 'Collapse initiative tracker'"
        :title="collapsed ? 'Expand initiative' : 'Collapse initiative'"
        @click="emit('toggle-collapsed')"
      >
        <span aria-hidden="true">{{ collapsed ? '‹' : '›' }}</span>
        <span class="initiative-toggle__label">{{ collapsed ? 'Expand' : 'Collapse' }}</span>
      </button>
    </div>

    <div
      id="initiative-tracker-content"
      v-show="!collapsed"
      class="initiative-content"
    >
      <MapInitiativeTracker
        v-if="showTracker"
        :rows="rows"
        :sorted-rows="sortedRows"
        :active-id="activeId"
        :round="round"
        :selected-id="selectedId"
        :can-manage="canManage"
        :has-initiative-values="hasInitiativeValues"
        @set-round="emit('set-round', $event)"
        @previous="emit('previous')"
        @next="emit('next')"
        @fill-from-speed="emit('fill-from-speed')"
        @clear-active="emit('clear-active')"
        @clear-values="emit('clear-values')"
        @set-active-and-focus="emit('set-active-and-focus', $event)"
        @focus="emit('focus', $event)"
        @set-initiative-input="(id, value) => emit('set-initiative-input', id, value)"
        @set-initiative-from-speed="(id, speed) => emit('set-initiative-from-speed', id, speed)"
      />
    </div>
  </aside>
</template>

<style scoped>
.initiative-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.85rem;
  border-left: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
  transition: padding 0.2s ease;
}

.initiative-sidebar--collapsed {
  align-items: center;
  padding: 0.65rem 0.45rem;
  overflow: hidden;
}

.initiative-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  min-height: 0;
}

.initiative-toggle-row {
  display: flex;
  justify-content: flex-start;
  padding: 0 0.25rem;
}

.initiative-sidebar--collapsed .initiative-toggle-row {
  justify-content: center;
  padding: 0;
}

.initiative-toggle {
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

.initiative-toggle:hover,
.initiative-toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.initiative-toggle span[aria-hidden='true'] {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 0.8;
}

.initiative-sidebar--collapsed .initiative-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

.initiative-sidebar--collapsed .initiative-toggle__label {
  display: none;
}

@media (max-width: 1100px) {
  .initiative-sidebar {
    max-height: none;
    border-left: 0;
    border-top: 1px solid var(--rule);
  }
}
</style>
