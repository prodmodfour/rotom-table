<script setup lang="ts">
import type { EncounterRegionGroup } from '~/utils/encounterTables'

const searchTerm = defineModel<string>('searchTerm', { required: true })

defineProps<{
  filteredByRegion: EncounterRegionGroup[]
  selectedRegion: string | null
  selectedKey: string | null
  totalCount: number
  filteredCount: number
}>()

const emit = defineEmits<{
  (event: 'select-entry', region: string, key: string): void
}>()

const selectEntry = (region: string, key: string) => {
  emit('select-entry', region, key)
}
</script>

<template>
  <aside class="encounter-sidebar">
    <AppNavigation />

    <section class="sidebar-card">
      <EncounterTablesSidebarHeader
        v-model:search-term="searchTerm"
        :total-count="totalCount"
        :filtered-count="filteredCount"
      />

      <EncounterTablesRegionList
        :groups="filteredByRegion"
        :selected-region="selectedRegion"
        :selected-key="selectedKey"
        @select-entry="selectEntry"
      />
    </section>
  </aside>
</template>

<style scoped>
.encounter-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
}

.sidebar-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  padding: 0.85rem;
}

@media (max-width: 1040px) {
  .encounter-sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
}
</style>
