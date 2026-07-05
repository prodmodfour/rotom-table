<script setup lang="ts">
import type { SpriteVisualBounds } from '~/types/pokemon'
import type { CapabilityToken, DisplayedPokedexEvolution, MoveToken } from '~/utils/pokedex/entryDetails'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'
import type { TypeMatchupGroup } from '~/utils/pokedex/typeMatchups'

defineProps<{
  capabilityTokens: CapabilityToken[]
  dietSummary: string | null
  displayedEvolutions: DisplayedPokedexEvolution[]
  eggGroupSummary: string | null
  eggMoveTokens: MoveToken[]
  entry: PokedexEntryDetail | null
  genderSummary: string | null
  habitatSummary: string | null
  heightLabel: string | null
  isPlacementOnly: boolean
  pageNumber: number | null
  requestedPokemonName: string | null
  skillPhrase: string
  spriteUrl: string | null
  spriteVisualBounds?: SpriteVisualBounds | null
  showSpriteVisualBoundsOverlay?: boolean
  tmHmTokens: MoveToken[]
  tutorMoveTokens: MoveToken[]
  typeMatchupGroups: TypeMatchupGroup[]
  weightLabel: string | null
}>()
</script>

<template>
  <main class="pokedex-detail">
    <article v-if="entry" class="book-page">
      <PokedexEntryHeader
        :is-placement-only="isPlacementOnly"
        :national-dex-number="entry.nationalDexNumber"
        :source-gen="entry.source_gen"
        :species="entry.species"
      />

      <div class="book-columns">
        <PokedexProfileColumn
          :diet-summary="dietSummary"
          :displayed-evolutions="displayedEvolutions"
          :egg-group-summary="eggGroupSummary"
          :entry="entry"
          :gender-summary="genderSummary"
          :habitat-summary="habitatSummary"
          :height-label="heightLabel"
          :sprite-url="spriteUrl"
          :sprite-visual-bounds="spriteVisualBounds ?? entry.spriteVisualBounds ?? null"
          :show-sprite-visual-bounds-overlay="showSpriteVisualBoundsOverlay"
          :weight-label="weightLabel"
        />

        <!-- RIGHT COLUMN -->
        <section class="book-column book-column--right">
          <PokedexCapabilitiesSkillsPanel
            :capability-tokens="capabilityTokens"
            :skill-phrase="skillPhrase"
          />

          <PokedexTypeMatchupsPanel :groups="typeMatchupGroups" />

          <PokedexMoveListPanel
            :egg-move-tokens="eggMoveTokens"
            :level-up-moves="entry.level_up_moves"
            :tm-hm-tokens="tmHmTokens"
            :tutor-move-tokens="tutorMoveTokens"
          />
        </section>
      </div>

      <footer v-if="pageNumber != null" class="book-page__footer">
        <span class="page-number">{{ pageNumber }}</span>
      </footer>
    </article>

    <PokedexEntryEmptyState
      v-else
      :requested-pokemon-name="requestedPokemonName"
    />
  </main>
</template>

<style src="./pokedexDetail.css"></style>
