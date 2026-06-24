<script setup lang="ts">
import SheetBrowser from '~/components/SheetBrowser.vue'
import MapMenuModalShell from '~/components/map/MapMenuModalShell.vue'
import type { MapTokenSheetSelection } from '~/composables/map-editor/useTokenControls'

const props = withDefaults(defineProps<{
  busy?: boolean
}>(), {
  busy: false,
})

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'select', selection: MapTokenSheetSelection): void
}>()

const selectSheet = (selection: MapTokenSheetSelection) => {
  if (props.busy) return
  emit('select', selection)
}
</script>

<template>
  <MapMenuModalShell
    title="Sheets"
    title-id="sheets-menu-title"
    description-id="sheets-menu-description"
    :shortcut-keys="['Ctrl', 'S']"
    @close="emit('close')"
  >
    <p v-if="busy" class="sheets-menu__busy" role="status">
      Spawning token…
    </p>
    <SheetBrowser :show-heading="false" :disabled="busy" @select="selectSheet" />
  </MapMenuModalShell>
</template>

<style scoped>
.sheets-menu__busy {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.85rem;
}
</style>
