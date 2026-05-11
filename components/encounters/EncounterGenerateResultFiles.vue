<script setup lang="ts">
import type { EncounterGenerateFile } from '~/utils/encounterGeneration'

const props = defineProps<{
  files: ReadonlyArray<EncounterGenerateFile>
  preview: boolean
  openFiles: ReadonlySet<string>
}>()

const emit = defineEmits<{
  (event: 'toggle-file', name: string): void
}>()

const isOpen = (name: string): boolean => props.openFiles.has(name)
</script>

<template>
  <ul class="result-files">
    <EncounterGenerateResultFileRow
      v-for="file in files"
      :key="file.name"
      :file="file"
      :preview="preview"
      :open="isOpen(file.name)"
      @toggle-file="emit('toggle-file', $event)"
    />
  </ul>
</template>

<style scoped>
.result-files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

</style>
