<script setup lang="ts">
import { formatNationalDexNumber } from '~/utils/pokedex/searchText'
import type { CapabilityToken, MoveToken } from '~/utils/pokedex/entryDetails'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'
import type { TypeMatchupGroup } from '~/utils/pokedex/typeMatchups'
import type { PokedexEvolution } from '~/types/pokemon'

export interface DisplayedPokedexEvolution extends PokedexEvolution {
  href: string | null
}

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
        <!-- LEFT COLUMN -->
        <section class="book-column book-column--left">
          <div class="sprite-frame">
            <div class="sprite-frame__inner">
              <img
                v-if="spriteUrl"
                :src="spriteUrl"
                :alt="entry.species"
              />
              <span v-else class="sprite-missing">no sprite</span>
            </div>
            <span class="bracket bracket--tl" />
            <span class="bracket bracket--tr" />
            <span class="bracket bracket--bl" />
            <span class="bracket bracket--br" />
          </div>

          <section v-if="entry.base_stats" class="book-section">
            <h3 class="book-section__title">Base Stats:</h3>
            <dl class="stat-list">
              <div><dt>HP:</dt><dd>{{ entry.base_stats.hp }}</dd></div>
              <div><dt>Attack:</dt><dd>{{ entry.base_stats.atk }}</dd></div>
              <div><dt>Defense:</dt><dd>{{ entry.base_stats.def }}</dd></div>
              <div><dt>Special Attack:</dt><dd>{{ entry.base_stats.spatk }}</dd></div>
              <div><dt>Special Defense:</dt><dd>{{ entry.base_stats.spdef }}</dd></div>
              <div><dt>Speed:</dt><dd>{{ entry.base_stats.spd }}</dd></div>
            </dl>
          </section>

          <section class="book-section">
            <h3 class="book-section__title">Basic Information</h3>
            <p class="info-line info-line--types">
              <span>Type :</span>
              <span v-if="entry.types?.length" class="type-badge-row">
                <TypeBadge
                  v-for="type in entry.types"
                  :key="`selected-${type}`"
                  :type="type"
                  size="xs"
                />
              </span>
              <span v-else>Unknown type</span>
            </p>
            <template v-if="entry.abilities">
              <p
                v-for="(ability, index) in entry.abilities.basic ?? []"
                :key="`basic-${ability}`"
                class="info-line"
              >
                Basic Ability {{ index + 1 }}: <RefLink kind="ability" :name="ability" />
              </p>
              <p
                v-for="(ability, index) in entry.abilities.advanced ?? []"
                :key="`adv-${ability}`"
                class="info-line"
              >
                Adv Ability {{ index + 1 }}: <RefLink kind="ability" :name="ability" />
              </p>
              <p
                v-for="ability in entry.abilities.high ?? []"
                :key="`high-${ability}`"
                class="info-line"
              >
                High Ability: <RefLink kind="ability" :name="ability" />
              </p>
            </template>
          </section>

          <section v-if="displayedEvolutions.length" class="book-section">
            <h3 class="book-section__title">Evolution:</h3>
            <p
              v-for="evolution in displayedEvolutions"
              :key="`${evolution.stage}-${evolution.species}`"
              class="info-line"
            >
              {{ evolution.stage }} -
              <NuxtLink
                v-if="evolution.href"
                :to="evolution.href"
                class="evolution-link"
                prefetch-on="interaction"
              >{{ evolution.species }}</NuxtLink><span v-else>{{ evolution.species }}</span><template v-if="evolution.min_level && evolution.min_level > 0"> Minimum {{ evolution.min_level }}</template>
            </p>
          </section>

          <section v-if="heightLabel || weightLabel" class="book-section">
            <h3 class="book-section__title">Size Information</h3>
            <p v-if="heightLabel" class="info-line">Height : {{ heightLabel }}</p>
            <p v-if="weightLabel" class="info-line">Weight : {{ weightLabel }}</p>
          </section>

          <section
            v-if="genderSummary || eggGroupSummary || entry.hatch_rate"
            class="book-section"
          >
            <h3 class="book-section__title">Breeding Information</h3>
            <p v-if="genderSummary" class="info-line">Gender Ratio : {{ genderSummary }}</p>
            <p v-if="eggGroupSummary" class="info-line">Egg Group : {{ eggGroupSummary }}</p>
            <p v-if="entry.hatch_rate" class="info-line">
              Average Hatch Rate: {{ entry.hatch_rate }}
            </p>
          </section>

          <section v-if="dietSummary || habitatSummary" class="book-section book-section--plain">
            <p v-if="dietSummary" class="info-line">Diet : {{ dietSummary }}</p>
            <p v-if="habitatSummary" class="info-line">Habitat : {{ habitatSummary }}</p>
          </section>
        </section>

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
