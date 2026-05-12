<script setup lang="ts">
import { useEncounterTableBrowser } from '~/composables/encounters/useEncounterTableBrowser'

useHead({
  title: 'Encounter Tables · Rotom Table',
})

const {
  searchTerm,
  filteredByRegion,
  selectedRegion,
  selectedKey,
  selectEntry,
  selectedEntry,
  selectedRows,
  totalCount,
  filteredCount,
} = useEncounterTableBrowser()
</script>

<template>
  <div class="encounter-layout">
    <EncounterTablesSidebar
      v-model:search-term="searchTerm"
      :filtered-by-region="filteredByRegion"
      :selected-region="selectedRegion"
      :selected-key="selectedKey"
      :total-count="totalCount"
      :filtered-count="filteredCount"
      @select-entry="selectEntry"
    />

    <EncounterTableDetailPanel
      :selected-entry="selectedEntry"
      :selected-rows="selectedRows"
    />
  </div>
</template>

<style scoped>
.encounter-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper);
}

@media (max-width: 1040px) {
  .encounter-layout {
    grid-template-columns: 1fr;
  }
}
</style>
