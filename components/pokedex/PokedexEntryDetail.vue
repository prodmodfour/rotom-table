<script setup lang="ts">
import { formatNationalDexNumber } from '~/utils/pokedex/searchText'
import type { CapabilityToken, MoveToken } from '~/utils/pokedex/entryDetails'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'
import type { TypeMatchupGroup } from '~/utils/pokedex/typeMatchups'
import type { DisplayedPokedexEvolution } from './types'

defineProps<{
  capabilityTokens: CapabilityToken[]
  dietSummary: string | null
  displayedEvolutions: DisplayedPokedexEvolution[]
  eggGroupSummary: string | null
  eggMoveTokens: MoveToken[]
  entry: DisplayPokedexEntry | null
  genderSummary: string | null
  habitatSummary: string | null
  heightLabel: string | null
  isPlacementOnly: boolean
  pageNumber: number | null
  requestedPokemonName: string | null
  skillPhrase: string
  spriteUrl: string | null
  tmHmTokens: MoveToken[]
  tutorMoveTokens: MoveToken[]
  typeMatchupGroups: TypeMatchupGroup[]
  weightLabel: string | null
}>()
</script>

<template>
  <main class="pokedex-detail">
    <article v-if="entry" class="book-page">
      <header class="book-page__header">
        <h2 class="species-name">{{ entry.species.toUpperCase() }}</h2>
        <div class="header-badges">
          <span v-if="entry.nationalDexNumber" class="badge">
            {{ formatNationalDexNumber(entry.nationalDexNumber) }}
          </span>
          <span v-if="entry.source_gen" class="badge">{{ entry.source_gen }}</span>
          <span v-if="isPlacementOnly" class="badge warn">Placement only</span>
        </div>
      </header>

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
          :weight-label="weightLabel"
        />

        <!-- RIGHT COLUMN -->
        <section class="book-column book-column--right">
          <section v-if="capabilityTokens.length" class="book-section">
            <h3 class="book-section__title">Capability List</h3>
            <p class="paragraph">
              <template v-for="(token, i) in capabilityTokens" :key="`cap-${i}`"
                ><span v-if="i > 0">, </span
                ><RefLink
                  v-if="token.ref"
                  kind="capability"
                  :name="token.ref"
                  :display="token.display"
                /><span v-else>{{ token.display }}</span
              ></template>
            </p>
          </section>

          <section v-if="skillPhrase" class="book-section">
            <h3 class="book-section__title">Skill List</h3>
            <p class="paragraph">{{ skillPhrase }}</p>
          </section>

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

    <section v-else class="book-page book-page--empty">
      <h2>{{ requestedPokemonName ? 'Pokémon not found' : 'No entry selected' }}</h2>
      <p v-if="requestedPokemonName">
        No Pokédex entry exists for <code>{{ requestedPokemonName }}</code>.
      </p>
      <p v-else>Pick a Pokémon from the sidebar to inspect its PTU data.</p>
    </section>
  </main>
</template>

<style src="./pokedexDetail.css"></style>
