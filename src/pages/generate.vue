<script setup lang="ts">
import { useEncounterGenerationPage } from '~/composables/encounters/useEncounterGenerationPage'
import { useEncounterTableLibraryData } from '~/composables/encounters/useEncounterTableLibraryData'

useHead({
  title: 'Generate · Rotom Table',
})

const route = useRoute()
const router = useRouter()
const encounterTableData = useEncounterTableLibraryData()

const {
  region,
  regions,
  tableKey,
  countMin,
  countMax,
  outRoot,
  preview,
  tablesForRegion,
  selectedTable,
  rolledPreview,
  rollPreview,
  generating,
  error,
  result,
  generate,
  openFiles,
  toggleFile,
} = useEncounterGenerationPage({
  query: route.query,
  entries: encounterTableData.items,
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
        :regions="regions"
        :tables-for-region="tablesForRegion"
        :selected-table="selectedTable"
        :generating="generating"
        @roll-preview="rollPreview"
        @generate="generate"
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
