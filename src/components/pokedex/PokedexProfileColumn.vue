<script setup lang="ts">
import type { SpriteVisualBounds } from '~/types/pokemon'
import type { DisplayedPokedexEvolution } from '~/utils/pokedex/entryDetails'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

defineProps<{
  dietSummary: string | null
  displayedEvolutions: DisplayedPokedexEvolution[]
  eggGroupSummary: string | null
  entry: PokedexEntryDetail
  genderSummary: string | null
  habitatSummary: string | null
  heightLabel: string | null
  spriteUrl: string | null
  spriteVisualBounds?: SpriteVisualBounds | null
  showSpriteVisualBoundsOverlay?: boolean
  weightLabel: string | null
}>()
</script>

<template>
  <section class="book-column book-column--left">
    <PokedexProfileSpriteFrame
      :species="entry.species"
      :sprite-url="spriteUrl"
      :visual-bounds="spriteVisualBounds ?? entry.spriteVisualBounds ?? null"
      :show-visual-bounds-overlay="showSpriteVisualBoundsOverlay"
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
