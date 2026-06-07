<script setup lang="ts">
import type { EncounterTableEntry } from '~/types/encounterTable'
import type { MapSummary } from '~/types/map'
import { MAX_ENCOUNTER_COUNT, MIN_ENCOUNTER_COUNT } from '~/utils/encounterGeneration'
import { formatRegionLabel } from '~/utils/encounterTables'

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
  spawnMaps: MapSummary[]
  mapsLoading: boolean
  mapsLoadError: string | null
  generating: boolean
}>()

const mapOptionLabel = (map: MapSummary): string => map.folder ? `${map.folder} / ${map.name}` : map.name
</script>

<template>
  <div class="form-grid">
    <label class="field">
      <span class="field-label">Region</span>
      <select v-model="region" :disabled="generating">
        <option v-for="r in regions" :key="r" :value="r">
          {{ formatRegionLabel(r) }}
        </option>
      </select>
    </label>

    <label class="field">
      <span class="field-label">Table</span>
      <select v-model="tableKey" :disabled="generating || tablesForRegion.length === 0">
        <option
          v-for="entry in tablesForRegion"
          :key="entry.key"
          :value="entry.key"
        >
          {{ entry.table.name }}
        </option>
      </select>
    </label>

    <fieldset class="field fieldset">
      <legend class="field-label">Count range</legend>
      <div class="range-row">
        <label class="subfield">
          <span class="subfield-label">Min</span>
          <input
            v-model.number="countMin"
            type="number"
            :min="MIN_ENCOUNTER_COUNT"
            :max="MAX_ENCOUNTER_COUNT"
            :disabled="generating"
          />
        </label>
        <label class="subfield">
          <span class="subfield-label">Max</span>
          <input
            v-model.number="countMax"
            type="number"
            :min="MIN_ENCOUNTER_COUNT"
            :max="MAX_ENCOUNTER_COUNT"
            :disabled="generating"
          />
        </label>
      </div>
    </fieldset>

    <label class="field">
      <span class="field-label">Output root</span>
      <input
        v-model.trim="outRoot"
        type="text"
        :disabled="generating || preview"
        placeholder="data/sheets/wild"
      />
    </label>

    <label class="field">
      <span class="field-label">Spawn map</span>
      <select
        v-model="spawnMapSlug"
        :disabled="generating || mapsLoading || spawnMaps.length === 0"
      >
        <option value="">
          {{ mapsLoading ? 'Loading maps…' : 'Select map…' }}
        </option>
        <option
          v-for="map in spawnMaps"
          :key="map.slug"
          :value="map.slug"
        >
          {{ mapOptionLabel(map) }}
        </option>
      </select>
      <span v-if="mapsLoadError" class="field-hint error">Maps unavailable: {{ mapsLoadError }}</span>
      <span v-else-if="!mapsLoading && spawnMaps.length === 0" class="field-hint">Create a map before using Spawn.</span>
    </label>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.7rem;
  margin-bottom: 0.85rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.fieldset {
  border: 0;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.field-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.field-hint {
  color: var(--ink-muted);
  font-size: 0.72rem;
  line-height: 1.35;
}

.field-hint.error {
  color: var(--bad);
}

.range-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.subfield {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.subfield-label {
  color: var(--ink-muted);
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

select,
input[type='text'],
input[type='number'] {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
  font: inherit;
}

select:focus,
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

select:disabled,
input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
