<script setup lang="ts">
import type { DisplayedPokedexEvolution } from '~/utils/pokedex/entryDetails'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

defineProps<{
  dietSummary: string | null
  displayedEvolutions: DisplayedPokedexEvolution[]
  eggGroupSummary: string | null
  entry: DisplayPokedexEntry
  genderSummary: string | null
  habitatSummary: string | null
  heightLabel: string | null
  spriteUrl: string | null
  weightLabel: string | null
}>()
</script>

<template>
  <section class="book-column book-column--left">
    <PokedexProfileSpriteFrame
      :species="entry.species"
      :sprite-url="spriteUrl"
    />

    <PokedexBaseStatsPanel :base-stats="entry.base_stats" />

    <PokedexBasicInfoPanel :entry="entry" />

    <PokedexEvolutionPanel :displayed-evolutions="displayedEvolutions" />

    <PokedexBiologyPanel
      :diet-summary="dietSummary"
      :egg-group-summary="eggGroupSummary"
      :gender-summary="genderSummary"
      :habitat-summary="habitatSummary"
      :hatch-rate="entry.hatch_rate"
      :height-label="heightLabel"
      :weight-label="weightLabel"
    />
  </section>
</template>
