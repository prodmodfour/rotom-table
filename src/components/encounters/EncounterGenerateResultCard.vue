<script setup lang="ts">
import type { EncounterGenerateResult } from '~/utils/encounterGeneration'

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
          <span class="spawn-results__file">{{ placement.file }}</span>
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

.spawn-results__file {
  color: var(--ink-bright);
  font-family: var(--font-mono);
  font-size: 0.82rem;
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
