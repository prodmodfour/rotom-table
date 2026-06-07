<script setup lang="ts">
import { computed } from 'vue'
import { pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import type { DisplayedEncounterRow } from '~/utils/encounterTables'

const props = defineProps<{
  rows: DisplayedEncounterRow[]
}>()

const spriteUrlForSpecies = (species: string): string | null => (
  pokemonCatalogBySpecies.get(species)?.spriteUrl ?? null
)

const rowsWithSprites = computed(() => props.rows.map((row) => ({
  ...row,
  spriteUrl: spriteUrlForSpecies(row.species),
})))
</script>

<template>
  <div class="entry-list">
    <div class="entry-row entry-row--head">
      <span>Entry</span>
      <span>Chance</span>
      <span>Levels</span>
    </div>
    <div
      v-for="(row, index) in rowsWithSprites"
      :key="`${row.species}-${index}`"
      class="entry-row"
    >
      <span class="entry-species">
        <img
          v-if="row.spriteUrl"
          class="entry-sprite"
          :src="row.spriteUrl"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span class="entry-species-name">{{ row.species }}</span>
      </span>
      <span class="entry-chance">{{ row.chancePercentLabel }}</span>
      <span class="entry-levels">{{ row.levelRange }}</span>
    </div>
  </div>
</template>

<style scoped>
.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-variant-numeric: tabular-nums;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5rem 6.5rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
}

.entry-row:nth-child(odd) {
  background: var(--paper-inset);
}

.entry-row--head {
  align-items: end;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  background: transparent !important;
  padding-top: 0;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--rule);
  border-radius: 0;
  margin-bottom: 0.2rem;
}

.entry-row--head span:not(:first-child),
.entry-chance,
.entry-levels {
  text-align: right;
}

.entry-chance,
.entry-levels {
  color: var(--ink-soft);
  font-size: 0.85rem;
}

.entry-species {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  color: var(--ink);
  font-family: var(--font-book);
  font-size: 1.02rem;
  letter-spacing: 0.02em;
}

.entry-sprite {
  width: 1.65rem;
  height: 1.65rem;
  flex: 0 0 1.65rem;
  object-fit: contain;
  image-rendering: pixelated;
}

.entry-species-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .entry-row {
    grid-template-columns: minmax(0, 1fr) 4.25rem 5rem;
  }
}
</style>
