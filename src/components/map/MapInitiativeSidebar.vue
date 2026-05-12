<script setup lang="ts">
import MapInitiativeTracker from '~/components/map/InitiativeTracker.vue'
import SidebarCollapseToggle from '~/components/map/SidebarCollapseToggle.vue'
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
    <SidebarCollapseToggle
      :collapsed="collapsed"
      controls-id="initiative-tracker-content"
      expand-aria-label="Expand initiative tracker"
      collapse-aria-label="Collapse initiative tracker"
      expand-title="Expand initiative"
      collapse-title="Collapse initiative"
      collapsed-icon="‹"
      expanded-icon="›"
      row-align="start"
      @toggle="emit('toggle-collapsed')"
    />

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


@media (max-width: 1100px) {
  .initiative-sidebar {
    max-height: none;
    border-left: 0;
    border-top: 1px solid var(--rule);
  }
}
</style>
