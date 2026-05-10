<script setup lang="ts">
import SidebarCollapseToggle from '~/components/map/SidebarCollapseToggle.vue'

defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle'): void
}>()
</script>

<template>
  <SidebarCollapseToggle
    :collapsed="collapsed"
    controls-id="map-sidebar-content"
    expand-aria-label="Expand map sidebar"
    collapse-aria-label="Collapse map sidebar"
    expand-title="Expand sidebar"
    collapse-title="Collapse sidebar"
    collapsed-icon="›"
    expanded-icon="‹"
    row-align="end"
    @toggle="emit('toggle')"
  />
</template>
