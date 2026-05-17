<script setup lang="ts">
import type { EncounterGenerateFile } from '~/utils/encounterGeneration'

defineProps<{
  file: EncounterGenerateFile
  preview: boolean
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-file', name: string): void
}>()
</script>

<template>
  <li :class="['result-file', { 'has-error': file.error }]">
    <button
      v-if="preview && file.content"
      type="button"
      class="result-file__head"
      @click="emit('toggle-file', file.name)"
    >
      <span class="result-file__caret" :class="{ open }" aria-hidden="true">▸</span>
      <span class="result-file__name">{{ file.name }}</span>
    </button>
    <div v-else class="result-file__head">
      <span class="result-file__caret" aria-hidden="true">·</span>
      <span class="result-file__name">{{ file.name }}</span>
    </div>

    <p v-if="file.error" class="result-file__error">{{ file.error }}</p>
    <pre
      v-if="preview && file.content && open"
      class="result-file__body"
    >{{ file.content }}</pre>
  </li>
</template>

<style scoped>
.result-file {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  overflow: hidden;
}

.result-file.has-error {
  border-color: rgba(255, 31, 45, 0.45);
  background: rgba(255, 31, 45, 0.08);
}

.result-file__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--ink);
  cursor: default;
  text-align: left;
}

button.result-file__head {
  cursor: pointer;
  transition: background 0.15s ease;
}

button.result-file__head:hover {
  background: var(--paper-hover);
}

.result-file__caret {
  color: var(--accent);
  transition: transform 0.15s ease;
  font-size: 0.85rem;
}

.result-file__caret.open {
  transform: rotate(90deg);
}

.result-file__name {
  font-family: var(--font-mono);
  font-size: 0.88rem;
  color: var(--ink-bright);
}

.has-error .result-file__name {
  color: var(--bad);
}

.result-file__error {
  margin: 0;
  padding: 0 0.75rem 0.55rem 1.85rem;
  color: var(--bad);
  font-family: var(--font-mono);
  font-size: 0.82rem;
  white-space: pre-wrap;
}

.result-file__body {
  margin: 0;
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--rule);
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre-wrap;
}
</style>
