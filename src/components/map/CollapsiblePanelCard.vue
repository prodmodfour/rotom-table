<script setup lang="ts">
import CollapsiblePanelHeading from '~/components/map/CollapsiblePanelHeading.vue'

defineProps<{
  title: string
  badge: string
  collapsed: boolean
  controlsId: string
  wideGap?: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
}>()
</script>

<template>
  <section class="panel-card" :class="{ 'panel-card--wide-gap': wideGap }">
    <CollapsiblePanelHeading
      :title="title"
      :badge="badge"
      :collapsed="collapsed"
      :controls-id="controlsId"
      @toggle-collapsed="emit('toggle-collapsed')"
    />

    <div :id="controlsId" v-show="!collapsed" class="collapsible-section-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-card--wide-gap {
  gap: 0.85rem;
}

.collapsible-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
