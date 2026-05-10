<script setup lang="ts">
import CollapsiblePanelCard from '~/components/map/CollapsiblePanelCard.vue'
import MapDimensionControls from '~/components/map/MapDimensionControls.vue'
import MapVisibilityToggle from '~/components/map/MapVisibilityToggle.vue'
import type { GridDimensions } from '~/types/map'

type DimensionAxis = keyof GridDimensions

defineProps<{
  collapsed: boolean
  name: string
  dimensions: GridDimensions
  playerVisible?: boolean
  isGm: boolean
  canEditMap: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'update-player-visible', value: boolean): void
  (event: 'update-dimension', axis: DimensionAxis, value: number | string): void
}>()

</script>

<template>
  <CollapsiblePanelCard
    class="map-details-panel"
    :title="name"
    :badge="`${dimensions.x} × ${dimensions.y} × ${dimensions.z}`"
    :collapsed="collapsed"
    controls-id="map-details-section"
    @toggle-collapsed="emit('toggle-collapsed')"
  >
    <MapVisibilityToggle
      v-if="isGm"
      :player-visible="playerVisible"
      @update-player-visible="emit('update-player-visible', $event)"
    />
    <p v-else class="permission-note">
      Player view: this map is visible, but GM-only map settings are locked.
    </p>

    <MapDimensionControls
      :dimensions="dimensions"
      :can-edit-map="canEditMap"
      @update-dimension="(axis, value) => emit('update-dimension', axis, value)"
    />
  </CollapsiblePanelCard>
</template>

<style scoped>
.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}
</style>
