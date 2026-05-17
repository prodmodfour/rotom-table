<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  filterTrainerPokemonBrowserEntries,
  TRAINER_TEAM_LIMIT,
  type TrainerPokemonBrowserEntry,
} from '~/utils/trainerPokemonLinks'

const props = withDefaults(defineProps<{
  entries: readonly TrainerPokemonBrowserEntry[]
  teamCount: number
  teamLimit?: number
}>(), {
  teamLimit: TRAINER_TEAM_LIMIT,
})

const emit = defineEmits<{
  addToTeam: [slug: string]
  addToBox: [slug: string]
}>()

const query = ref('')
const collapsed = ref(false)

const filteredEntries = computed(() => filterTrainerPokemonBrowserEntries(props.entries, query.value))
const teamIsFull = computed(() => props.teamCount >= props.teamLimit)
const emptyMessage = computed(() => (
  query.value
    ? 'No Pokémon sheets match that search.'
    : 'No available Pokémon sheets to link.'
))

const teamButtonLabel = (entry: TrainerPokemonBrowserEntry): string => {
  if (entry.linkedAs === 'team') return 'On Team'
  if (entry.linkedAs === 'box') return 'Move to Team'
  return 'Add Team'
}

const boxButtonLabel = (entry: TrainerPokemonBrowserEntry): string => {
  if (entry.linkedAs === 'box') return 'In Box'
  if (entry.linkedAs === 'team') return 'Move to Box'
  return 'Add Box'
}

const canAddToTeam = (entry: TrainerPokemonBrowserEntry): boolean => (
  entry.linkedAs !== 'team' && !teamIsFull.value
)
</script>

<template>
  <section class="pokemon-browser">
    <header class="pokemon-browser__header">
      <button
        type="button"
        class="pokemon-browser__toggle"
        :aria-expanded="!collapsed"
        aria-controls="trainer-pokemon-browser-body"
        @click="collapsed = !collapsed"
      >
        <span class="pokemon-browser__chevron" aria-hidden="true">{{ collapsed ? '›' : '⌄' }}</span>
        <span>Link Pokémon</span>
      </button>
      <span class="pokemon-browser__badge">{{ filteredEntries.length }} shown</span>
    </header>

    <div id="trainer-pokemon-browser-body" v-show="!collapsed" class="pokemon-browser__body">
      <p class="pokemon-browser__help">
        Browse available Pokémon sheets and add them to this trainer's team or box. Example sheets are hidden; player trainers only see player Pokémon.
      </p>

      <label class="pokemon-browser__search">
        <span class="sr-only">Search Pokémon sheets</span>
        <input v-model.trim="query" type="search" placeholder="Search by name, species, level, or folder…" />
      </label>

      <div v-if="filteredEntries.length" class="pokemon-browser__grid">
        <article
          v-for="entry in filteredEntries"
          :key="entry.slug"
          class="pokemon-browser__card"
          :class="entry.linkedAs ? `is-linked-${entry.linkedAs}` : undefined"
        >
          <span class="pokemon-browser__sprite">
            <img v-if="entry.spriteUrl" :src="entry.spriteUrl" :alt="entry.displayName" />
            <span v-else aria-hidden="true">?</span>
          </span>

          <span class="pokemon-browser__copy">
            <span class="pokemon-browser__name">{{ entry.displayName }}</span>
            <span class="pokemon-browser__meta">{{ entry.species }} · Lv {{ entry.level }}</span>
            <span v-if="entry.folder" class="pokemon-browser__folder">{{ entry.folder }}</span>
          </span>

          <span v-if="entry.linkedAs" class="pokemon-browser__linked-badge">
            {{ entry.linkedAs === 'team' ? 'Team' : 'Box' }}
          </span>

          <span class="pokemon-browser__actions">
            <button
              type="button"
              class="pokemon-browser__action"
              :disabled="!canAddToTeam(entry)"
              :title="teamIsFull && entry.linkedAs !== 'team' ? 'Team is full' : teamButtonLabel(entry)"
              @click="emit('addToTeam', entry.slug)"
            >{{ teamButtonLabel(entry) }}</button>
            <button
              type="button"
              class="pokemon-browser__action"
              :disabled="entry.linkedAs === 'box'"
              @click="emit('addToBox', entry.slug)"
            >{{ boxButtonLabel(entry) }}</button>
          </span>
        </article>
      </div>

      <p v-else class="pokemon-browser__empty">{{ emptyMessage }}</p>
    </div>
  </section>
</template>

<style scoped>
.pokemon-browser {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
  padding: 0.85rem;
}

.pokemon-browser__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.pokemon-browser__toggle {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: left;
}

.pokemon-browser__toggle:hover {
  color: var(--accent);
}

.pokemon-browser__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.pokemon-browser__badge,
.pokemon-browser__linked-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.pokemon-browser__body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin-top: 0.75rem;
}

.pokemon-browser__help {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.pokemon-browser__search {
  display: block;
}

.pokemon-browser__search input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.58rem 0.72rem;
  outline: none;
  font: inherit;
}

.pokemon-browser__search input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

.pokemon-browser__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.55rem;
  max-height: 46vh;
  overflow: auto;
  padding-right: 0.2rem;
}

.pokemon-browser__card {
  position: relative;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  grid-template-areas:
    "sprite copy"
    "sprite actions";
  gap: 0.45rem 0.6rem;
  align-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper);
  padding: 0.55rem;
}

.pokemon-browser__card.is-linked-team {
  border-color: rgba(255, 31, 45, 0.48);
}

.pokemon-browser__card.is-linked-box {
  border-color: rgba(131, 165, 152, 0.42);
}

.pokemon-browser__sprite {
  grid-area: sprite;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: radial-gradient(circle at center, var(--paper-hover), var(--paper-inset));
  color: var(--ink-faint);
  overflow: hidden;
}

.pokemon-browser__sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  padding: 3px;
}

.pokemon-browser__copy {
  grid-area: copy;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.1rem;
}

.pokemon-browser__name {
  color: var(--ink-bright);
  font-weight: 700;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pokemon-browser__meta,
.pokemon-browser__folder {
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pokemon-browser__folder {
  color: var(--ink-faint);
}

.pokemon-browser__linked-badge {
  position: absolute;
  top: 0.45rem;
  right: 0.45rem;
  padding: 0.12rem 0.5rem;
  background: rgba(5, 6, 8, 0.82);
}

.pokemon-browser__actions {
  grid-area: actions;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.pokemon-browser__action {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.22rem 0.52rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.pokemon-browser__action:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.pokemon-browser__action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pokemon-browser__empty {
  margin: 0.4rem 0.1rem;
  color: var(--ink-muted);
  font-style: italic;
  font-size: 0.85rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
