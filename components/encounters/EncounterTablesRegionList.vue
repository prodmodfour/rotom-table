<script setup lang="ts">
import { formatRegionLabel } from '~/utils/encounterTables'
import type { EncounterRegionGroup } from '~/utils/encounterTables'

defineProps<{
  groups: EncounterRegionGroup[]
  selectedRegion: string | null
  selectedKey: string | null
}>()

const emit = defineEmits<{
  (event: 'select-entry', region: string, key: string): void
}>()
</script>

<template>
  <div v-if="groups.length > 0" class="region-list">
    <section
      v-for="group in groups"
      :key="group.region"
      class="region-group"
    >
      <h2 class="region-title">{{ formatRegionLabel(group.region) }}</h2>
      <button
        v-for="entry in group.tables"
        :key="`${entry.region}/${entry.key}`"
        type="button"
        :class="['table-button', { active: entry.region === selectedRegion && entry.key === selectedKey }]"
        @click="emit('select-entry', entry.region, entry.key)"
      >
        <span class="table-name">{{ entry.table.name }}</span>
        <span class="table-meta">
          Lv {{ entry.table.min_level }}–{{ entry.table.max_level }} ·
          {{ entry.table.entries.length }} entries
        </span>
      </button>
    </section>
  </div>

  <p v-else class="empty-state">
    No tables match that search.
  </p>
</template>

<style scoped>
.region-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: auto;
  min-height: 0;
}

.region-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.region-title {
  margin: 0;
  font-family: var(--font-book);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.table-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.table-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.table-button.active {
  border-color: var(--accent);
  background: var(--paper-active);
  color: var(--accent);
}

.table-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.table-meta {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.empty-state {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
  text-align: center;
  font-style: italic;
}
</style>
