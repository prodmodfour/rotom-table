<script setup lang="ts">
defineProps<{
  sidebarCollapsed: boolean
  initiativeCollapsed: boolean
}>()
</script>

<template>
  <div
    class="layout-shell"
    :class="{
      'layout-shell--sidebar-collapsed': sidebarCollapsed,
      'layout-shell--initiative-collapsed': initiativeCollapsed,
    }"
  >
    <slot name="left" />
    <slot name="scene" />
    <slot name="right" />
    <slot name="admin" />
  </div>
</template>

<style scoped>
.layout-shell {
  --map-sidebar-width: minmax(310px, 380px);
  --initiative-sidebar-width: minmax(300px, 360px);

  display: grid;
  grid-template-columns: var(--map-sidebar-width) minmax(0, 1fr) var(--initiative-sidebar-width);
  min-height: 100vh;
  gap: 0;
  background: var(--paper);
  transition: grid-template-columns 0.2s ease;
}

.layout-shell--sidebar-collapsed {
  --map-sidebar-width: 56px;
}

.layout-shell--initiative-collapsed {
  --initiative-sidebar-width: 56px;
}

@media (max-width: 1100px) {
  .layout-shell,
  .layout-shell--sidebar-collapsed,
  .layout-shell--initiative-collapsed {
    grid-template-columns: 1fr;
  }
}
</style>
