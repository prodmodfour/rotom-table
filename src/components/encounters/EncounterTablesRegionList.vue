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
      <EncounterTablesRegionListItem
        v-for="entry in group.tables"
        :key="`${entry.region}/${entry.key}`"
        :entry="entry"
        :selected="entry.region === selectedRegion && entry.key === selectedKey"
        @select-entry="emit('select-entry', entry.region, entry.key)"
      />
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

.empty-state {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
  text-align: center;
  font-style: italic;
}
</style>
