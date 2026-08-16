<script setup lang="ts">
import type { EncounterGenerateResult, EncounterSpawnedPlacement } from '~/utils/encounterGeneration'

defineProps<{
  result: EncounterGenerateResult
  tableKey: string
  count: number
  openFiles: ReadonlySet<string>
}>()

const emit = defineEmits<{
  (event: 'toggle-file', name: string): void
}>()

const positionLabel = (position: { x: number; y: number; z: number } | undefined): string => (
  position ? `(${position.x}, ${position.y}, ${position.z})` : '(unknown)'
)

const placementSlugLabel = (placement: EncounterSpawnedPlacement): string => (
  placement.error ? 'Generated slug' : 'Persisted sheet'
)

const generatorFileLabel = (placement: EncounterSpawnedPlacement): string | null => {
  const file = placement.file.trim()
  if (!file || file === placement.slug || file === `${placement.slug}.json`) return null
  return file
}
</script>

<template>
  <section class="panel-card result-card">
    <EncounterGenerateResultHeader
      :preview="result.preview"
      :failures="result.failures"
      :rel-dir="result.relDir"
      :file-count="result.files.length"
      :table-key="tableKey"
      :count="count"
      :spawn="result.spawn"
    />

    <div v-if="result.routeRepel" class="route-repel-result" role="status">
      <strong>{{ result.routeRepel.itemLabel }} applied</strong>
      <span>
        {{ result.routeRepel.repelledRolls }} of {{ count }} reviewed roll{{ count === 1 ? '' : 's' }} at
        Level {{ result.routeRepel.maximumAffectedWildLevel }} or lower {{ result.routeRepel.repelledRolls === 1 ? 'was' : 'were' }} repelled.
      </span>
      <small>Ward authority remains active through campaign minute {{ result.routeRepel.expiresAtCampaignMinute.toLocaleString() }}.</small>
    </div>

    <EncounterGenerateResultFiles
      :files="result.files"
      :preview="result.preview"
      :open-files="openFiles"
      @toggle-file="emit('toggle-file', $event)"
    />

    <div v-if="result.spawn" class="spawn-results">
      <h3 class="spawn-results__title">Spawn placements</h3>
      <ul class="spawn-results__list">
        <li
          v-for="placement in result.spawn.placements"
          :key="placement.file"
          :class="['spawn-results__item', { 'has-error': placement.error }]"
        >
          <span class="spawn-results__slug">
            {{ placementSlugLabel(placement) }}: {{ placement.slug }}
          </span>
          <span v-if="generatorFileLabel(placement)" class="spawn-results__generator-label">
            generator label: {{ generatorFileLabel(placement) }}
          </span>
          <span v-if="placement.error" class="spawn-results__error">{{ placement.error }}</span>
          <span v-else class="spawn-results__position">→ {{ positionLabel(placement.position) }}</span>
        </li>
      </ul>
    </div>
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

.route-repel-result {
  display: grid;
  gap: 0.2rem;
  margin-block: 0.85rem;
  border-inline-start: 3px solid var(--rt-pending);
  background: var(--paper-inset);
  padding: 0.65rem 0.75rem;
}
.route-repel-result strong { color: var(--rt-pending); }
.route-repel-result span { color: var(--ink-soft); font-size: 0.82rem; line-height: 1.45; }
.route-repel-result small { color: var(--ink-muted); font-size: 0.72rem; }

.spawn-results {
  margin-top: 0.85rem;
}

.spawn-results__title {
  margin: 0 0 0.45rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.spawn-results__list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.spawn-results__item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.45rem 0.65rem;
}

.spawn-results__item.has-error {
  border-color: rgba(255, 31, 45, 0.45);
  background: rgba(255, 31, 45, 0.08);
}

.spawn-results__slug {
  color: var(--ink-bright);
  font-family: var(--font-mono);
  font-size: 0.82rem;
}

.spawn-results__generator-label {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.spawn-results__position {
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.spawn-results__error {
  color: var(--bad);
  font-family: var(--font-mono);
  font-size: 0.82rem;
}

</style>
