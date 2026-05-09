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

const isOpen = (name: string): boolean => props.openFiles.has(name)
</script>

<template>
  <section class="panel-card result-card">
    <header class="result-heading">
      <h2 class="panel-title">
        {{ result.preview ? 'Preview generated' : 'Generated folder' }}
        <span v-if="result.failures > 0" class="panel-subtle warn">
          {{ result.failures }} failure(s)
        </span>
      </h2>
      <div class="result-pills">
        <span v-if="!result.preview" class="badge">{{ result.relDir }}</span>
        <span class="badge">{{ result.files.length }} file(s)</span>
      </div>
    </header>

    <p v-if="!result.preview" class="result-hint">
      Files written to
      <code>{{ result.relDir }}/</code>.
      The folder name auto-increments (<code>{{ tableKey }}_{{ count }}</code>,
      <code>{{ tableKey }}_{{ count }}-2</code>…) so repeat runs don't clobber.
    </p>

    <ul class="result-files">
      <li
        v-for="file in result.files"
        :key="file.name"
        :class="['result-file', { 'has-error': file.error }]"
      >
        <button
          v-if="result.preview && file.content"
          type="button"
          class="result-file__head"
          @click="emit('toggle-file', file.name)"
        >
          <span class="result-file__caret" :class="{ open: isOpen(file.name) }" aria-hidden="true">▸</span>
          <span class="result-file__name">{{ file.name }}</span>
        </button>
        <div v-else class="result-file__head">
          <span class="result-file__caret" aria-hidden="true">·</span>
          <span class="result-file__name">{{ file.name }}</span>
        </div>

        <p v-if="file.error" class="result-file__error">{{ file.error }}</p>
        <pre
          v-if="result.preview && file.content && isOpen(file.name)"
          class="result-file__body"
        >{{ file.content }}</pre>
      </li>
    </ul>
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

.panel-title {
  margin: 0 0 0.85rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.panel-subtle.warn {
  color: var(--warn);
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--accent);
}

.result-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.4rem;
}

.result-heading .panel-title {
  margin: 0;
}

.result-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}

.result-hint {
  margin: 0 0 0.85rem;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.result-files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.result-file {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  overflow: hidden;
}

.result-file.has-error {
  border-color: rgba(251, 73, 52, 0.45);
  background: rgba(251, 73, 52, 0.08);
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
