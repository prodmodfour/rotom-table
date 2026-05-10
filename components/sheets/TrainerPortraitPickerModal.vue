<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import { textValueFromEvent } from '~/utils/domEvents'
import type { PokemonCatalogEntry } from '~/types/pokemon'

defineProps<{
  query: string
  options: PokemonCatalogEntry[]
  selectedUrl?: string
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  close: []
  select: [spriteUrl: string]
}>()

const updateQuery = (event: Event) => {
  emit('update:query', textValueFromEvent(event))
}
</script>

<template>
  <div class="portrait-picker-backdrop" @click.self="emit('close')">
    <div class="portrait-picker" role="dialog" aria-label="Pick a trainer sprite">
      <header class="portrait-picker__header">
        <h2>Pick a trainer sprite</h2>
        <button
          type="button"
          class="portrait-picker__close"
          title="Close"
          @click="emit('close')"
        >
          <PhX :size="16" weight="bold" />
        </button>
      </header>
      <div class="portrait-picker__search">
        <input
          :value="query"
          type="search"
          placeholder="Search by name or slug…"
          class="portrait-picker__input"
          autofocus
          @input="updateQuery"
        />
        <span class="portrait-picker__count">
          {{ options.length }} sprite{{ options.length === 1 ? '' : 's' }}
        </span>
      </div>
      <div class="portrait-picker__grid">
        <button
          v-for="option in options"
          :key="option.slug"
          type="button"
          class="portrait-option"
          :class="{ 'portrait-option--active': selectedUrl === option.spriteUrl }"
          :title="option.species"
          @click="emit('select', option.spriteUrl ?? '')"
        >
          <img
            :src="option.spriteUrl"
            :alt="option.species"
            class="portrait-option__img"
            loading="lazy"
          />
          <span class="portrait-option__label">{{ option.species }}</span>
        </button>
        <p v-if="!options.length" class="muted portrait-picker__empty">
          No sprites match "{{ query }}".
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.portrait-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 1000;
}

.portrait-picker {
  width: min(900px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.portrait-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.portrait-picker__header h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
}

.portrait-picker__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
}

.portrait-picker__close:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.portrait-picker__search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
}

.portrait-picker__input {
  flex: 1 1 auto;
  font: inherit;
  color: inherit;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  padding: 0.4rem 0.6rem;
}

.portrait-picker__input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.portrait-picker__count {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
}

.portrait-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  overflow: auto;
}

.portrait-picker__empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 1.5rem 0;
}

.portrait-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
  font: inherit;
  color: inherit;
}

.portrait-option:hover {
  border-color: var(--accent);
  background: var(--paper-hover);
}

.portrait-option--active {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.25);
}

.portrait-option__img {
  width: 80px;
  height: 80px;
  object-fit: contain;
  image-rendering: pixelated;
}

.portrait-option__label {
  font-size: 0.72rem;
  color: var(--ink-soft);
  text-align: center;
  line-height: 1.2;
  text-transform: capitalize;
  word-break: break-word;
}

.muted {
  color: var(--ink-muted);
  font-size: 0.85rem;
}
</style>
