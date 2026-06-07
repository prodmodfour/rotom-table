<script setup lang="ts">
import type { EncounterTableEntry } from '~/types/encounterTable'
import type { MapSummary } from '~/types/map'

const region = defineModel<string>('region', { required: true })
const tableKey = defineModel<string>('tableKey', { required: true })
const countMin = defineModel<number>('countMin', { required: true })
const countMax = defineModel<number>('countMax', { required: true })
const outRoot = defineModel<string>('outRoot', { required: true })
const preview = defineModel<boolean>('preview', { required: true })
const spawnMapSlug = defineModel<string>('spawnMapSlug', { required: true })

defineProps<{
  regions: string[]
  tablesForRegion: EncounterTableEntry[]
  selectedTable: EncounterTableEntry | null
  spawnMaps: MapSummary[]
  mapsLoading: boolean
  mapsLoadError: string | null
  generating: boolean
  folderGenerating: boolean
  spawning: boolean
  canSpawn: boolean
}>()

const emit = defineEmits<{
  (event: 'roll-preview'): void
  (event: 'generate'): void
  (event: 'spawn'): void
}>()
</script>

<template>
  <section class="panel-card form-card">
    <h2 class="panel-title">Roll setup</h2>

    <EncounterGenerateSetupFields
      v-model:region="region"
      v-model:table-key="tableKey"
      v-model:count-min="countMin"
      v-model:count-max="countMax"
      v-model:out-root="outRoot"
      v-model:preview="preview"
      v-model:spawn-map-slug="spawnMapSlug"
      :regions="regions"
      :tables-for-region="tablesForRegion"
      :spawn-maps="spawnMaps"
      :maps-loading="mapsLoading"
      :maps-load-error="mapsLoadError"
      :generating="generating"
    />

    <EncounterGenerateSelectedTableMeta :selected-table="selectedTable" />

    <EncounterGenerateSetupActions
      v-model:preview="preview"
      :has-selected-table="Boolean(selectedTable)"
      :generating="folderGenerating"
      :busy="generating"
      :spawning="spawning"
      :can-spawn="canSpawn"
      @roll-preview="emit('roll-preview')"
      @generate="emit('generate')"
      @spawn="emit('spawn')"
    />
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.1rem 1.2rem;
}

.panel-title {
  margin: 0 0 0.85rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

</style>
