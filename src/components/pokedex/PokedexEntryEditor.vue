<script setup lang="ts">
import { textValueFromEvent } from '~/utils/domEvents'

defineProps<{
  draft: string
  errorMessage: string | null
  isSaving: boolean
  species: string
  statusMessage: string | null
}>()

const emit = defineEmits<{
  (event: 'update:draft', value: string): void
  (event: 'cancel'): void
  (event: 'save'): void
}>()
</script>

<template>
  <main class="pokedex-detail">
    <article class="book-page pokedex-entry-editor">
      <header class="pokedex-entry-editor__header">
        <div>
          <p class="pokedex-entry-editor__eyebrow">GM edit mode · Ctrl+E</p>
          <h2>Edit {{ species }}</h2>
        </div>
        <div class="pokedex-entry-editor__actions">
          <button
            type="button"
            class="pokedex-entry-editor__button"
            :disabled="isSaving"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            type="button"
            class="pokedex-entry-editor__button pokedex-entry-editor__button--primary"
            :disabled="isSaving"
            @click="emit('save')"
          >
            {{ isSaving ? 'Saving…' : 'Save entry' }}
          </button>
        </div>
      </header>

      <p class="pokedex-entry-editor__help">
        Edit the persisted <code>data/reference/pokedex.json</code> record as JSON.
        Runtime-only fields such as <code>id</code>, <code>slug</code>, and <code>spriteUrl</code> are omitted.
      </p>

      <textarea
        class="pokedex-entry-editor__textarea"
        spellcheck="false"
        :value="draft"
        @input="emit('update:draft', textValueFromEvent($event))"
      />

      <p v-if="errorMessage" class="pokedex-entry-editor__message pokedex-entry-editor__message--error">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="pokedex-entry-editor__message pokedex-entry-editor__message--success">
        {{ statusMessage }}
      </p>
    </article>
  </main>
</template>

<style src="./pokedexDetail.css"></style>

<style scoped>
.pokedex-entry-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pokedex-entry-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.pokedex-entry-editor__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pokedex-entry-editor__header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
}

.pokedex-entry-editor__actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.pokedex-entry-editor__button {
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 0.45rem 0.85rem;
}

.pokedex-entry-editor__button:hover:not(:disabled),
.pokedex-entry-editor__button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.pokedex-entry-editor__button:disabled {
  cursor: wait;
  opacity: 0.64;
}

.pokedex-entry-editor__button--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.pokedex-entry-editor__button--primary:hover:not(:disabled),
.pokedex-entry-editor__button--primary:focus-visible:not(:disabled) {
  color: var(--accent-contrast);
  filter: brightness(1.08);
}

.pokedex-entry-editor__help {
  margin: 0;
  color: var(--ink-muted);
}

.pokedex-entry-editor__textarea {
  min-height: min(68vh, 920px);
  flex: 1 1 auto;
  resize: vertical;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-inset);
  color: var(--ink-bright);
  font-family: var(--font-mono);
  font-size: 0.86rem;
  line-height: 1.45;
  padding: 1rem;
  tab-size: 2;
}

.pokedex-entry-editor__textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: none;
}

.pokedex-entry-editor__message {
  margin: 0;
  border-radius: 12px;
  padding: 0.75rem 0.9rem;
  font-weight: 700;
}

.pokedex-entry-editor__message--error {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}

.pokedex-entry-editor__message--success {
  background: color-mix(in srgb, var(--good) 14%, transparent);
  color: var(--good);
}

@media (max-width: 760px) {
  .pokedex-entry-editor__header {
    flex-direction: column;
  }

  .pokedex-entry-editor__actions {
    justify-content: flex-start;
  }
}
</style>
