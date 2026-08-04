<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterChoiceOffer } from '#shared/encounterPresentation/contracts'
import { encounterCompactSpatialPreviews } from '#shared/encounterWorkspace/spatiality'

const props = defineProps<{
  choice: EncounterChoiceOffer
  selectedOptionIds: readonly string[]
  disabled?: boolean
}>()
const emit = defineEmits<{ select: [optionId: string] }>()
const previews = computed(() => encounterCompactSpatialPreviews(props.choice))
const allCells = (preview: (typeof previews.value)[number]) => [
  ...preview.cells,
  ...preview.path,
  ...(preview.destination ? [preview.destination] : []),
]
const bounds = (preview: (typeof previews.value)[number]) => {
  const cells = allCells(preview)
  const xs = cells.map(cell => cell.x)
  const zs = cells.map(cell => cell.z)
  const minX = Math.min(...xs, 0)
  const minZ = Math.min(...zs, 0)
  const maxX = Math.max(...xs, minX + 1)
  const maxZ = Math.max(...zs, minZ + 1)
  return { minX, minZ, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxZ - minZ + 1) }
}
const point = (preview: (typeof previews.value)[number], cell: { x: number, z: number }) => {
  const box = bounds(preview)
  return {
    x: 8 + ((cell.x - box.minX + 0.5) / box.width) * 84,
    y: 8 + ((cell.z - box.minZ + 0.5) / box.height) * 84,
  }
}
const pathPoints = (preview: (typeof previews.value)[number]): string => preview.path
  .map(cell => point(preview, cell))
  .map(value => `${value.x},${value.y}`)
  .join(' ')
const previewSummary = (preview: (typeof previews.value)[number]): string => [
  preview.cells.length ? `${preview.cells.length} cells` : null,
  preview.path.length ? `${preview.path.length} step path` : null,
  preview.destination ? `destination ${preview.destination.x}, ${preview.destination.y}, ${preview.destination.z}` : null,
  preview.direction ? `direction ${preview.direction}` : null,
].filter(Boolean).join(', ') || 'Spatial preview'
</script>

<template>
  <div class="encounter-compact-spatial-preview" :aria-label="`${choice.kind} choices`">
    <button
      v-for="preview in previews"
      :key="preview.optionId"
      type="button"
      :disabled="disabled"
      :aria-pressed="selectedOptionIds.includes(preview.optionId)"
      :aria-label="`${preview.label}, ${previewSummary(preview)}`"
      @click="emit('select', preview.optionId)"
    >
      <svg viewBox="0 0 100 100" role="img" :aria-label="previewSummary(preview)">
        <path d="M8 8H92V92H8Z" class="encounter-compact-spatial-preview__grid" />
        <polyline v-if="preview.path.length" :points="pathPoints(preview)" class="encounter-compact-spatial-preview__path" />
        <circle
          v-for="cell in preview.cells"
          :key="`cell:${cell.x}:${cell.y}:${cell.z}`"
          :cx="point(preview, cell).x"
          :cy="point(preview, cell).y"
          r="5"
          class="encounter-compact-spatial-preview__cell"
        />
        <rect
          v-if="preview.destination"
          :x="point(preview, preview.destination).x - 6"
          :y="point(preview, preview.destination).y - 6"
          width="12"
          height="12"
          class="encounter-compact-spatial-preview__destination"
        />
        <text v-if="preview.direction" x="50" y="55" text-anchor="middle">{{ preview.direction }}</text>
      </svg>
      <strong>{{ preview.label }}</strong>
      <small>{{ previewSummary(preview) }}</small>
    </button>
  </div>
</template>

<style scoped>
.encounter-compact-spatial-preview { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.5rem; margin-top: 0.65rem; }
.encounter-compact-spatial-preview > button { min-height: var(--rt-touch-minimum); display: grid; gap: 0.25rem; padding: 0.5rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-compact-spatial-preview > button[aria-pressed='true'] { border-color: var(--rt-focus); box-shadow: inset 0 0 0 1px var(--rt-focus); }
.encounter-compact-spatial-preview svg { width: 100%; max-height: 8rem; background: var(--rt-bg-canvas); }
.encounter-compact-spatial-preview__grid { fill: none; stroke: var(--rt-rule); stroke-width: 1; }
.encounter-compact-spatial-preview__path { fill: none; stroke: var(--rt-info); stroke-linecap: round; stroke-linejoin: round; stroke-width: 4; }
.encounter-compact-spatial-preview__cell { fill: color-mix(in srgb, var(--rt-info) 55%, transparent); stroke: var(--rt-text-strong); }
.encounter-compact-spatial-preview__destination { fill: var(--rt-success); stroke: var(--rt-text-strong); }
.encounter-compact-spatial-preview text { fill: var(--rt-text-strong); font: 800 0.75rem var(--rt-font-numeric); }
.encounter-compact-spatial-preview strong,
.encounter-compact-spatial-preview small { display: block; }
.encounter-compact-spatial-preview small { color: var(--rt-text-muted); }
</style>
