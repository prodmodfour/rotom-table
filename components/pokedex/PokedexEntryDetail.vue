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

          <section v-if="typeMatchupGroups.length" class="book-section book-section--matchups">
            <h3 class="book-section__title">Weaknesses &amp; Resistances</h3>
            <div class="type-matchups">
              <div
                v-for="group in typeMatchupGroups"
                :key="group.key"
                class="type-matchup-group"
              >
                <p class="matchup-label">{{ group.label }}</p>
                <ul class="type-effect-list">
                  <li
                    v-for="item in group.items"
                    :key="`${group.key}-${item.type}`"
                  >
                    <span :class="['type-effect-chip', `type-effect-chip--${item.type.toLowerCase()}`]">
                      <TypeBadge :type="item.type" size="xs" />
                      <span class="type-effect-mult">{{ item.label }}</span>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section
            v-if="entry.level_up_moves?.length || tmHmTokens.length || eggMoveTokens.length || tutorMoveTokens.length"
            class="book-section book-section--moves"
          >
            <h3 class="book-section__title">Move List</h3>

            <template v-if="entry.level_up_moves?.length">
              <p class="subsection-title">Level Up Move List</p>
              <ul class="move-list">
                <li
                  v-for="move in entry.level_up_moves"
                  :key="`${move.level}-${move.name}`"
                >
                  <span class="move-level">{{ move.level }}</span>
                  <span class="move-name"><RefLink kind="move" :name="move.name" /></span>
                  <span class="move-sep">-</span>
                  <span class="move-type"><TypeBadge :type="move.type" size="xs" /></span>
                </li>
              </ul>
            </template>

            <template v-if="tmHmTokens.length">
              <p class="subsection-title">TM/HM Move List</p>
              <p class="paragraph paragraph--indent">
                <template v-for="(token, i) in tmHmTokens" :key="`tm-${i}`"
                  ><span v-if="i > 0">, </span
                  ><RefLink kind="move" :name="token.name" :display="token.display"
                /></template>
              </p>
            </template>

            <template v-if="eggMoveTokens.length">
              <p class="subsection-title">Egg Move List</p>
              <p class="paragraph paragraph--indent">
                <template v-for="(token, i) in eggMoveTokens" :key="`egg-${i}`"
                  ><span v-if="i > 0">, </span
                  ><RefLink kind="move" :name="token.name" :display="token.display"
                /></template>
              </p>
            </template>

            <template v-if="tutorMoveTokens.length">
              <p class="subsection-title">Tutor Move List</p>
              <p class="paragraph paragraph--indent">
                <template v-for="(token, i) in tutorMoveTokens" :key="`tut-${i}`"
                  ><span v-if="i > 0">, </span
                  ><RefLink kind="move" :name="token.name" :display="token.display"
                /></template>
              </p>
            </template>
          </section>
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
