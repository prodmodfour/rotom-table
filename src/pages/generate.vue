<script setup lang="ts">
import { computed } from 'vue'
import { useEncounterGenerationPage } from '~/composables/encounters/useEncounterGenerationPage'
import { useEncounterTableLibraryData } from '~/composables/encounters/useEncounterTableLibraryData'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import { getClientId } from '~/utils/clientId'

useHead({
  title: 'Generate · Rotom Table',
})

const route = useRoute()
const router = useRouter()
const encounterTableData = useEncounterTableLibraryData()
const mapLibraryData = useMapLibraryData({ clientId: getClientId() })
const mapsLoading = mapLibraryData.loading
const mapsLoadError = mapLibraryData.loadError
const spawnMaps = computed(() => Array.from(mapLibraryData.maps.values()))

const {
  region,
  regions,
  tableKey,
  countMin,
  countMax,
  outRoot,
  preview,
  spawnMapSlug,
  tablesForRegion,
  selectedTable,
  rolledPreview,
  rollPreview,
  generating,
  spawning,
  busy,
  canSpawn,
  error,
  result,
  generate,
  spawn,
  openFiles,
  toggleFile,
} = useEncounterGenerationPage({
  query: route.query,
  entries: encounterTableData.items,
  maps: spawnMaps,
  replaceQuery: async (query) => {
    await router.replace({ query })
  },
})
</script>

<template>
  <div class="generate-layout">
    <header class="generate-header">
      <AppNavigation />
    </header>

    <main class="generate-main">
      <EncounterGenerateSetupCard
        v-model:region="region"
        v-model:table-key="tableKey"
        v-model:count-min="countMin"
        v-model:count-max="countMax"
        v-model:out-root="outRoot"
        v-model:preview="preview"
        v-model:spawn-map-slug="spawnMapSlug"
        :regions="regions"
        :tables-for-region="tablesForRegion"
        :selected-table="selectedTable"
        :spawn-maps="spawnMaps"
        :maps-loading="mapsLoading"
        :maps-load-error="mapsLoadError"
        :generating="busy"
        :folder-generating="generating"
        :spawning="spawning"
        :can-spawn="canSpawn"
        @roll-preview="rollPreview"
        @generate="generate"
        @spawn="spawn"
      />

      <EncounterRolledPreviewCard
        v-if="rolledPreview.length"
        :encounters="rolledPreview"
      />

      <EncounterGenerateErrorCard v-if="error" :message="error" />

      <EncounterGenerateResultCard
        v-if="result"
        :result="result"
        :table-key="tableKey"
        :count="result.count ?? result.rolled.length"
        :open-files="openFiles"
        @toggle-file="toggleFile"
      />
    </main>
  </div>
</template>

<style scoped>
.generate-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.generate-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.generate-main {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

</style>
