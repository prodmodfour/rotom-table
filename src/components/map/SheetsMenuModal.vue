<script setup lang="ts">
import SheetBrowser from '~/components/SheetBrowser.vue'
import MapMenuModalShell from '~/components/map/MapMenuModalShell.vue'
import type { MapTokenSheetSelection } from '~/composables/map-editor/useTokenControls'

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'select', selection: MapTokenSheetSelection): void
}>()
</script>

<template>
  <MapMenuModalShell
    title="Sheets"
    title-id="sheets-menu-title"
    description-id="sheets-menu-description"
    :shortcut-keys="['Ctrl', 'S']"
    @close="emit('close')"
  >
    <SheetBrowser :show-heading="false" @select="emit('select', $event)" />
  </MapMenuModalShell>
</template>
