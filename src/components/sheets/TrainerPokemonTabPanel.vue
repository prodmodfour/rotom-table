<script setup lang="ts">
import { computed } from 'vue'
import { getSpriteUrl } from '~~/data/characterSheets'
import TrainerPokemonBrowser from './TrainerPokemonBrowser.vue'
import TrainerPokemonCard from './TrainerPokemonCard.vue'
import { useLiveSheets } from '~/composables/useLiveSheets'
import {
  addPokemonToTrainerTeam,
  boxPokemonForTrainer,
  buildTrainerPokemonBrowserEntries,
  normalizePokemonSlugList,
  resolveTrainerPokemonLinks,
  trainerTeamSlotCount,
  unlinkPokemonFromTrainer,
  TRAINER_TEAM_LIMIT,
} from '~/utils/trainerPokemonLinks'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const props = defineProps<{
  sheet: TrainerSheet
}>()

const { pokemonBySlug } = useLiveSheets()
const EMPTY_POKEMON_BY_SLUG: ReadonlyMap<string, CharacterSheet> = new Map()
const livePokemonBySlug = computed<ReadonlyMap<string, CharacterSheet>>(() => (
  pokemonBySlug.value ?? EMPTY_POKEMON_BY_SLUG
))

const visibleTeamSlugs = computed(() => (
  normalizePokemonSlugList(props.sheet.currentTeam).slice(0, TRAINER_TEAM_LIMIT)
))

const teamMembers = computed(() => resolveTrainerPokemonLinks({
  slugs: visibleTeamSlugs.value,
  pokemonBySlug: livePokemonBySlug.value,
  spriteUrlForSpecies: getSpriteUrl,
}))

const visibleBoxSlugs = computed(() => {
  const teamSlugs = new Set(normalizePokemonSlugList(props.sheet.currentTeam))
  return normalizePokemonSlugList(props.sheet.boxedPokemon).filter((slug) => !teamSlugs.has(slug))
})

const boxedMembers = computed(() => resolveTrainerPokemonLinks({
  slugs: visibleBoxSlugs.value,
  pokemonBySlug: livePokemonBySlug.value,
  spriteUrlForSpecies: getSpriteUrl,
}))

const browserEntries = computed(() => buildTrainerPokemonBrowserEntries({
  pokemonSheets: livePokemonBySlug.value.values(),
  currentTeam: props.sheet.currentTeam,
  boxedPokemon: props.sheet.boxedPokemon,
  spriteUrlForSpecies: getSpriteUrl,
  playerOnly: props.sheet.player === true,
}))

const teamCount = computed(() => trainerTeamSlotCount(props.sheet))
const teamIsFull = computed(() => teamCount.value >= TRAINER_TEAM_LIMIT)
const emptyTeamSlots = computed(() => Array.from({
  length: Math.max(0, TRAINER_TEAM_LIMIT - teamMembers.value.length),
}))
const extraTeamSlugs = computed(() => (
  normalizePokemonSlugList(props.sheet.currentTeam).slice(TRAINER_TEAM_LIMIT)
))

const addToTeam = (slug: string) => {
  addPokemonToTrainerTeam(props.sheet, slug)
}

const addToBox = (slug: string) => {
  boxPokemonForTrainer(props.sheet, slug)
}

const unlink = (slug: string) => {
  unlinkPokemonFromTrainer(props.sheet, slug)
}
</script>

<template>
  <section class="trainer-pokemon-tab tab-panel">
    <div class="trainer-pokemon-layout">
      <section class="pokemon-box-panel" aria-labelledby="trainer-pokemon-box-title">
        <header class="pokemon-panel-heading">
          <div>
            <h2 id="trainer-pokemon-box-title">Box</h2>
            <p>Linked Pokémon not currently in the active party.</p>
          </div>
          <span class="pokemon-panel-badge">{{ boxedMembers.length }}</span>
        </header>

        <div v-if="boxedMembers.length" class="pokemon-box-grid">
          <TrainerPokemonCard
            v-for="member in boxedMembers"
            :key="member.slug"
            :member="member"
            variant="box"
            :can-move-to-team="!teamIsFull"
            @move-to-team="addToTeam"
            @unlink="unlink"
          />
        </div>
        <p v-else class="pokemon-empty-state">No boxed Pokémon linked yet. Use the browser below to add one.</p>
      </section>

      <aside class="pokemon-team-strip" aria-labelledby="trainer-pokemon-team-title">
        <header class="pokemon-team-strip__header">
          <h2 id="trainer-pokemon-team-title">Team</h2>
          <span class="pokemon-panel-badge">{{ teamCount }}/{{ TRAINER_TEAM_LIMIT }}</span>
        </header>

        <div class="pokemon-team-strip__list">
          <TrainerPokemonCard
            v-for="member in teamMembers"
            :key="member.slug"
            :member="member"
            variant="team"
            @move-to-box="addToBox"
            @unlink="unlink"
          />

          <div
            v-for="(_, index) in emptyTeamSlots"
            :key="`empty-team-slot-${index}`"
            class="pokemon-team-strip__empty-slot"
          >
            <span>Empty Slot</span>
          </div>
        </div>

        <p v-if="extraTeamSlugs.length" class="pokemon-team-strip__warning">
          {{ extraTeamSlugs.length }} extra linked team Pokémon hidden; move extras to the box.
        </p>
      </aside>
    </div>

    <TrainerPokemonBrowser
      :entries="browserEntries"
      :team-count="teamCount"
      :team-limit="TRAINER_TEAM_LIMIT"
      @add-to-team="addToTeam"
      @add-to-box="addToBox"
    />
  </section>
</template>

<style scoped>
.trainer-pokemon-tab {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.trainer-pokemon-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(210px, 260px);
  gap: 0.85rem;
  align-items: stretch;
}

.pokemon-box-panel,
.pokemon-team-strip {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
  padding: 0.85rem;
}

.pokemon-panel-heading,
.pokemon-team-strip__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.pokemon-panel-heading h2,
.pokemon-team-strip__header h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
}

.pokemon-panel-heading p {
  margin: 0.2rem 0 0;
  color: var(--ink-muted);
  font-size: 0.82rem;
  line-height: 1.4;
}

.pokemon-panel-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.2rem;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.pokemon-box-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.6rem;
}

.pokemon-empty-state {
  margin: 0;
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  color: var(--ink-muted);
  padding: 1.1rem;
  text-align: center;
  font-size: 0.88rem;
}

.pokemon-team-strip {
  background:
    linear-gradient(180deg, rgba(250, 189, 47, 0.08), transparent 40%),
    var(--paper-inset);
}

.pokemon-team-strip__header {
  align-items: center;
}

.pokemon-team-strip__list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.pokemon-team-strip__empty-slot {
  min-height: 64px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  color: var(--ink-faint);
  background: rgba(29, 32, 33, 0.24);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pokemon-team-strip__warning {
  margin: 0.7rem 0 0;
  color: var(--warn);
  font-size: 0.78rem;
  line-height: 1.35;
}

@media (max-width: 860px) {
  .trainer-pokemon-layout {
    grid-template-columns: 1fr;
  }

  .pokemon-team-strip {
    order: -1;
  }
}
</style>
