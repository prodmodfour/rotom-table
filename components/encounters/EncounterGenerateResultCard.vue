<script setup lang="ts">
import type { EncounterGenerateResult } from '~/utils/encounterGeneration'

const props = defineProps<{
  result: EncounterGenerateResult
  tableKey: string
  count: number
  openFiles: ReadonlySet<string>
}>()

const emit = defineEmits<{
  (event: 'toggle-file', name: string): void
}>()
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
    />

    <EncounterGenerateResultFiles
      :files="result.files"
      :preview="result.preview"
      :open-files="openFiles"
      @toggle-file="emit('toggle-file', $event)"
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

</style>
