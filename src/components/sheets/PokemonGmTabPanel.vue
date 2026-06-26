<script setup lang="ts">
import { computed } from 'vue'
import { ensurePokemonGmSection } from '~/utils/sheets/pokemonGmFields'
import type { CharacterSheet } from '~/types/characterSheet'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  sheet: CharacterSheet
  statPointsBudget: number | null
  statusMessage: string | null
  errorMessage: string | null
}>()

const emit = defineEmits<{
  (event: 'randomize-added-stats'): void
}>()

const gmNotes = computed({
  get: () => props.sheet.gm?.notes ?? '',
  set: (value: string) => {
    ensurePokemonGmSection(props.sheet).notes = value
  },
})
</script>

<template>
  <section class="pokemon-gm-tab" aria-labelledby="pokemon-gm-tab-title">
    <header class="pokemon-gm-tab__header">
      <div>
        <p class="pokemon-gm-tab__eyebrow">GM-only</p>
        <h2 id="pokemon-gm-tab-title">Pokémon GM Notes</h2>
      </div>
      <p class="pokemon-gm-tab__privacy-note">
        This tab and its notes are hidden from player sheet views.
      </p>
    </header>

    <label class="pokemon-gm-tab__notes">
      <span>Private notes</span>
      <textarea
        v-model="gmNotes"
        rows="8"
        placeholder="Capture secrets, encounter plans, loyalty context, hidden traits…"
      />
    </label>

    <PokemonAddedStatsAdminCard
      title-id="pokemon-gm-tab-randomize-added-stats-title"
      :stat-points-budget="statPointsBudget"
      @randomize-added-stats="emit('randomize-added-stats')"
    />

    <p v-if="errorMessage" class="pokemon-gm-tab__message pokemon-gm-tab__message--error">
      {{ errorMessage }}
    </p>
    <p v-else-if="statusMessage" class="pokemon-gm-tab__message pokemon-gm-tab__message--success">
      {{ statusMessage }}
    </p>
  </section>
</template>

<style scoped>
.pokemon-gm-tab {
  display: grid;
  gap: 0.9rem;
  padding: 0.95rem;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
}

.pokemon-gm-tab__header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.pokemon-gm-tab__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pokemon-gm-tab__header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.25rem;
}

.pokemon-gm-tab__privacy-note {
  max-width: 22rem;
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.45;
  text-align: right;
}

.pokemon-gm-tab__notes {
  display: grid;
  gap: 0.45rem;
  color: var(--ink-bright);
  font-weight: 800;
}

.pokemon-gm-tab__notes textarea {
  min-height: 12rem;
  width: 100%;
  resize: vertical;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  color: var(--ink);
  font: inherit;
  font-weight: 500;
  line-height: 1.45;
  padding: 0.75rem 0.85rem;
}

.pokemon-gm-tab__notes textarea:focus-visible {
  border-color: var(--accent);
  outline: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  outline-offset: 2px;
}

.pokemon-gm-tab__message {
  margin: 0;
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  font-weight: 700;
}

.pokemon-gm-tab__message--error {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}

.pokemon-gm-tab__message--success {
  background: color-mix(in srgb, var(--good) 14%, transparent);
  color: var(--good);
}

@media (max-width: 760px) {
  .pokemon-gm-tab__header {
    display: grid;
  }

  .pokemon-gm-tab__privacy-note {
    max-width: none;
    text-align: left;
  }
}
</style>
