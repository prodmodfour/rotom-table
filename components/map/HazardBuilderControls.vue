<script setup lang="ts">
import BuilderBulkActionRow from '~/components/map/BuilderBulkActionRow.vue'
import BuilderBulkButton from '~/components/map/BuilderBulkButton.vue'
import BuilderHintText from '~/components/map/BuilderHintText.vue'
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import HazardPaletteGrid from '~/components/map/HazardPaletteGrid.vue'
import type { BuildTool } from '~/shared/mapEditor'
import type { MapHazardKind } from '~/types/map'
import type { MapHazardDefinition } from '~/utils/mapHazards'

defineProps<{
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  activeHazardDef: MapHazardDefinition
  hazardPalette: MapHazardDefinition[]
  hazardCount: number
}>()

const emit = defineEmits<{
  (event: 'set-hazard-tool', tool: BuildTool): void
  (event: 'select-hazard-kind', kind: MapHazardKind): void
  (event: 'clear-all-hazards'): void
}>()
</script>

<template>
  <BuildToolToggle
    aria-label="Hazard tool"
    :active-tool="hazardTool"
    pencil-label="Place"
    eraser-label="Erase"
    @set-tool="emit('set-hazard-tool', $event)"
  />

  <HazardPaletteGrid
    :active-kind="hazardKind"
    :hazards="hazardPalette"
    @select-hazard-kind="emit('select-hazard-kind', $event)"
  />

  <BuilderHintText>
    Left click to {{ hazardTool === 'pencil' ? `place ${activeHazardDef.label}` : 'erase hazards' }}.
    Right click erases all hazards on a square. Toxic Spikes stacks to 2 layers.
  </BuilderHintText>

  <BuilderBulkActionRow>
    <BuilderBulkButton variant="danger" :disabled="!hazardCount" @click="emit('clear-all-hazards')">
      Clear hazards
    </BuilderBulkButton>
  </BuilderBulkActionRow>
</template>

