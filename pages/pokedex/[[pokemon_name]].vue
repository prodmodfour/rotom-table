<script setup lang="ts">
import { computed } from 'vue'
import pokedexData from '~/ptu-data/data/pokedex.json'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { usePokedexFilters } from '~/composables/pokedex/usePokedexFilters'
import { formatNationalDexNumber, toPokedexSlug } from '~/utils/pokedex/searchText'
import {
  capabilityTokensForEntry,
  dietSummaryForEntry,
  eggGroupSummaryForEntry,
  eggMoveTokensForEntry,
  genderSummaryForEntry,
  habitatSummaryForEntry,
  heightLabelForEntry,
  isPlacementOnlyEntry,
  pageNumberForSelectedEntry,
  skillPhraseForEntry,
  tmHmTokensForEntry,
  tutorMoveTokensForEntry,
  weightLabelForEntry,
} from '~/utils/pokedex/entryDetails'
import {
  buildPokedexEntries,
  buildPokedexEntryBySlug,
  pokedexEntryPath,
  routeParamToPokedexSlug,
  type DisplayPokedexEntry,
} from '~/utils/pokedex/entryIndex'
import { buildTypeMatchupGroups } from '~/utils/pokedex/typeMatchups'
import type { PokedexRecord } from '~/types/pokemon'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(to.path.startsWith('/pokedex') && from.path.startsWith('/pokedex')),
})

const route = useRoute()

const allEntries = buildPokedexEntries(pokedexData as PokedexRecord[])
const entryBySlug = buildPokedexEntryBySlug(allEntries)
const pokemonRouteSlug = computed(() => routeParamToPokedexSlug(route.params.pokemon_name))

const { filteredEntries, filterMode, filterOperators, searchFilters } = usePokedexFilters(allEntries)

const routedEntry = computed(() => (
  pokemonRouteSlug.value ? entryBySlug.get(pokemonRouteSlug.value) ?? null : null
))

const selectedEntry = computed(() => {
  if (pokemonRouteSlug.value) {
    return routedEntry.value
  }

  return filteredEntries.value[0] ?? null
})

const selectedId = computed(() => selectedEntry.value?.id ?? null)

const resolvePokedexSpecies = (species: string): DisplayPokedexEntry | null => (
  entryBySlug.get(toPokedexSlug(species)) ?? null
)

const displayedEvolutions = computed(() => (
  (selectedEntry.value?.evolutions ?? []).map((evolution) => {
    const entry = resolvePokedexSpecies(evolution.species)
    return {
      ...evolution,
      href: entry && entry.id !== selectedId.value ? pokedexEntryPath(entry) : null,
    }
  })
))

const requestedPokemonName = computed(() => {
  if (!pokemonRouteSlug.value || selectedEntry.value) return null
  const raw = route.params.pokemon_name
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : pokemonRouteSlug.value
})

useHead(() => ({
  title: pokemonRouteSlug.value
    ? selectedEntry.value
      ? `${selectedEntry.value.species} · Pokédex · Rotom Table`
      : 'Pokémon not found · Pokédex · Rotom Table'
    : 'Pokédex · Rotom Table',
}))

const selectedSprite = computed(() => {
  if (!selectedEntry.value) {
    return null
  }

  return pokemonCatalogBySpecies.get(selectedEntry.value.species) ?? null
})

const isPlacementOnly = computed(() => isPlacementOnlyEntry(selectedEntry.value))
const genderSummary = computed(() => genderSummaryForEntry(selectedEntry.value))
const pageNumber = computed(() => pageNumberForSelectedEntry(selectedId.value, filteredEntries.value, allEntries))
const capabilityTokens = computed(() => capabilityTokensForEntry(selectedEntry.value))
const tmHmTokens = computed(() => tmHmTokensForEntry(selectedEntry.value))
const eggMoveTokens = computed(() => eggMoveTokensForEntry(selectedEntry.value))
const tutorMoveTokens = computed(() => tutorMoveTokensForEntry(selectedEntry.value))
const skillPhrase = computed(() => skillPhraseForEntry(selectedEntry.value))
const heightLabel = computed(() => heightLabelForEntry(selectedEntry.value))
const weightLabel = computed(() => weightLabelForEntry(selectedEntry.value))
const eggGroupSummary = computed(() => eggGroupSummaryForEntry(selectedEntry.value))
const dietSummary = computed(() => dietSummaryForEntry(selectedEntry.value))
const habitatSummary = computed(() => habitatSummaryForEntry(selectedEntry.value))

const typeMatchupGroups = computed(() => buildTypeMatchupGroups(selectedEntry.value?.types))

</script>

<template>
  <div class="pokedex-layout">
    <PokedexSidebar
      v-model:filter-mode="filterMode"
      :entries="filteredEntries"
      :filter-operators="filterOperators"
      :search-filters="searchFilters"
      :selected-id="selectedId"
    />

    <main class="pokedex-detail">
      <article v-if="selectedEntry" class="book-page">
        <header class="book-page__header">
          <h2 class="species-name">{{ selectedEntry.species.toUpperCase() }}</h2>
          <div class="header-badges">
            <span v-if="selectedEntry.nationalDexNumber" class="badge">
              {{ formatNationalDexNumber(selectedEntry.nationalDexNumber) }}
            </span>
            <span v-if="selectedEntry.source_gen" class="badge">{{ selectedEntry.source_gen }}</span>
            <span v-if="isPlacementOnly" class="badge warn">Placement only</span>
          </div>
        </header>

        <div class="book-columns">
          <!-- LEFT COLUMN -->
          <section class="book-column book-column--left">
            <div class="sprite-frame">
              <div class="sprite-frame__inner">
                <img
                  v-if="selectedSprite"
                  :src="selectedSprite.spriteUrl"
                  :alt="selectedEntry.species"
                />
                <span v-else class="sprite-missing">no sprite</span>
              </div>
              <span class="bracket bracket--tl" />
              <span class="bracket bracket--tr" />
              <span class="bracket bracket--bl" />
              <span class="bracket bracket--br" />
            </div>

            <section v-if="selectedEntry.base_stats" class="book-section">
              <h3 class="book-section__title">Base Stats:</h3>
              <dl class="stat-list">
                <div><dt>HP:</dt><dd>{{ selectedEntry.base_stats.hp }}</dd></div>
                <div><dt>Attack:</dt><dd>{{ selectedEntry.base_stats.atk }}</dd></div>
                <div><dt>Defense:</dt><dd>{{ selectedEntry.base_stats.def }}</dd></div>
                <div><dt>Special Attack:</dt><dd>{{ selectedEntry.base_stats.spatk }}</dd></div>
                <div><dt>Special Defense:</dt><dd>{{ selectedEntry.base_stats.spdef }}</dd></div>
                <div><dt>Speed:</dt><dd>{{ selectedEntry.base_stats.spd }}</dd></div>
              </dl>
            </section>

            <section class="book-section">
              <h3 class="book-section__title">Basic Information</h3>
              <p class="info-line info-line--types">
                <span>Type :</span>
                <span v-if="selectedEntry.types?.length" class="type-badge-row">
                  <TypeBadge
                    v-for="type in selectedEntry.types"
                    :key="`selected-${type}`"
                    :type="type"
                    size="xs"
                  />
                </span>
                <span v-else>Unknown type</span>
              </p>
              <template v-if="selectedEntry.abilities">
                <p
                  v-for="(ability, index) in selectedEntry.abilities.basic ?? []"
                  :key="`basic-${ability}`"
                  class="info-line"
                >
                  Basic Ability {{ index + 1 }}: <RefLink kind="ability" :name="ability" />
                </p>
                <p
                  v-for="(ability, index) in selectedEntry.abilities.advanced ?? []"
                  :key="`adv-${ability}`"
                  class="info-line"
                >
                  Adv Ability {{ index + 1 }}: <RefLink kind="ability" :name="ability" />
                </p>
                <p
                  v-for="ability in selectedEntry.abilities.high ?? []"
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
              v-if="genderSummary || eggGroupSummary || selectedEntry.hatch_rate"
              class="book-section"
            >
              <h3 class="book-section__title">Breeding Information</h3>
              <p v-if="genderSummary" class="info-line">Gender Ratio : {{ genderSummary }}</p>
              <p v-if="eggGroupSummary" class="info-line">Egg Group : {{ eggGroupSummary }}</p>
              <p v-if="selectedEntry.hatch_rate" class="info-line">
                Average Hatch Rate: {{ selectedEntry.hatch_rate }}
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
              v-if="selectedEntry.level_up_moves?.length || tmHmTokens.length || eggMoveTokens.length || tutorMoveTokens.length"
              class="book-section book-section--moves"
            >
              <h3 class="book-section__title">Move List</h3>

              <template v-if="selectedEntry.level_up_moves?.length">
                <p class="subsection-title">Level Up Move List</p>
                <ul class="move-list">
                  <li
                    v-for="move in selectedEntry.level_up_moves"
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
  </div>
</template>

<style scoped>
.pokedex-layout {
  display: grid;
  grid-template-columns: minmax(560px, 700px) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper);
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge.warn {
  background: rgba(254, 128, 25, 0.18);
  color: var(--warn);
}

.type-badge-row {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  vertical-align: middle;
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}

/* ------------------------------------------------------------------ */
/* Book-style detail panel                                             */
/* ------------------------------------------------------------------ */

.pokedex-detail {
  min-width: 0;
  padding: 1.5rem;
  background: var(--paper);
  display: flex;
  justify-content: center;
}

.book-page {
  position: relative;
  width: 100%;
  max-width: 960px;
  min-height: calc(100vh - 3rem);
  padding: 2.4rem 2.4rem 3.4rem;
  background: var(--paper-soft);
  border: 1px solid var(--rule);
  box-shadow:
    0 0 0 1px var(--rule),
    0 30px 60px rgba(0, 0, 0, 0.55);
  color: var(--ink);
  font-family: var(--font-book);
  font-size: 1.02rem;
  line-height: 1.55;
}

.book-page--empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  color: var(--ink-muted);
}

.book-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
}

.species-name {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent);
}

.header-badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.book-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 2.6rem;
  row-gap: 1.4rem;
  align-items: start;
}

.book-column {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  min-width: 0;
}

/* ---- Sprite frame with checker + corner brackets ----------------- */

.sprite-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 0.4rem;
}

.sprite-frame__inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background-color: var(--paper);
  background-image:
    linear-gradient(45deg, rgba(235, 219, 178, 0.05) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(235, 219, 178, 0.05) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(235, 219, 178, 0.05) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(235, 219, 178, 0.05) 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}

.sprite-frame__inner img {
  /* Fill the framed area. BW/Showdown sprites are tiny (≈50px); the
     ``image-rendering: pixelated`` rule keeps the upscale crisp. */
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.55));
}

.sprite-missing {
  color: var(--ink-faint);
  font-size: 0.85rem;
  font-style: italic;
}

.bracket {
  position: absolute;
  width: 22px;
  height: 22px;
  border-color: var(--accent);
  border-style: solid;
  border-width: 0;
}

.bracket--tl { top: 0;    left: 0;    border-top-width: 2px;    border-left-width: 2px; }
.bracket--tr { top: 0;    right: 0;   border-top-width: 2px;    border-right-width: 2px; }
.bracket--bl { bottom: 0; left: 0;    border-bottom-width: 2px; border-left-width: 2px; }
.bracket--br { bottom: 0; right: 0;   border-bottom-width: 2px; border-right-width: 2px; }

/* ---- Sections, headings, body type ------------------------------- */

.book-section {
  margin: 0;
}

.book-section--plain {
  /* used for the Diet / Habitat block which has no heading in the book */
  margin-top: -0.4rem;
}

.book-section__title {
  margin: 0 0 0.3rem;
  text-align: center;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.subsection-title {
  margin: 0.4rem 0 0.2rem;
  font-weight: 600;
  color: var(--ink-bright);
}

.book-section--moves .subsection-title {
  text-align: center;
}

.info-line,
.paragraph {
  margin: 0.05rem 0;
  color: var(--ink);
}

.evolution-link {
  color: var(--accent);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}

.evolution-link:hover {
  color: var(--ink-bright);
}

.info-line--types {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.paragraph {
  text-align: justify;
  hyphens: auto;
}

.paragraph--indent {
  /* mirrors the leading tab indent the printed book uses for run-on lists */
  text-indent: 1.6rem;
}

/* ---- Defensive type matchups ------------------------------------- */

.book-section--matchups {
  break-inside: avoid;
}

.type-matchups {
  display: grid;
  gap: 0.42rem;
}

.type-matchup-group {
  display: grid;
  grid-template-columns: 6.2rem minmax(0, 1fr);
  gap: 0.55rem;
  align-items: start;
}

.matchup-label {
  margin: 0.08rem 0 0;
  color: var(--ink-bright);
  font-size: 1.08rem;
  font-weight: 600;
  line-height: 1.2;
}

.type-effect-list {
  display: grid;
  grid-template-columns: repeat(3, max-content);
  gap: 0.24rem 0.4rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.type-effect-list li {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  line-height: 1;
}

.type-effect-chip {
  --type-effect-color: var(--ink-muted);
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 1.32rem;
  max-width: 100%;
  padding-right: 1.5rem;
  border-radius: 999px;
  line-height: 1;
  vertical-align: middle;
}

.type-effect-chip :deep(.type-badge) {
  display: block;
  flex: 0 0 auto;
  height: 1.32rem;
}

.type-effect-chip--normal { --type-effect-color: #90a0a0; }
.type-effect-chip--fighting { --type-effect-color: #d04068; }
.type-effect-chip--flying { --type-effect-color: #90a8e0; }
.type-effect-chip--poison { --type-effect-color: #a868c8; }
.type-effect-chip--ground { --type-effect-color: #d87848; }
.type-effect-chip--rock { --type-effect-color: #c8b890; }
.type-effect-chip--bug { --type-effect-color: #90c030; }
.type-effect-chip--ghost { --type-effect-color: #5068b0; }
.type-effect-chip--steel { --type-effect-color: #5890a0; }
.type-effect-chip--fire { --type-effect-color: #ffa058; }
.type-effect-chip--water { --type-effect-color: #5090d8; }
.type-effect-chip--grass { --type-effect-color: #60c058; }
.type-effect-chip--electric { --type-effect-color: #f0d040; }
.type-effect-chip--psychic { --type-effect-color: #f87078; }
.type-effect-chip--ice { --type-effect-color: #70d0c0; }
.type-effect-chip--dragon { --type-effect-color: #0870c0; }
.type-effect-chip--dark { --type-effect-color: #585068; }
.type-effect-chip--fairy { --type-effect-color: #f090e8; }

.type-effect-mult {
  position: absolute;
  top: 50%;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.14),
    inset 0 0 0 1px rgba(255, 255, 255, 0.65);
  color: #1d2021;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  font-weight: 900;
  letter-spacing: -0.06em;
  line-height: 1;
  pointer-events: none;
  transform: translateY(-50%);
}

/* ---- Stat list (label : value, value right-aligned) -------------- */

.stat-list {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.2rem;
  row-gap: 0.05rem;
}

.stat-list > div {
  display: contents;
}

.stat-list dt {
  margin: 0;
  color: var(--ink);
}

.stat-list dd {
  margin: 0;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

/* ---- Move list -------------------------------------------------- */

.move-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: max-content max-content max-content max-content;
  justify-content: center;
  column-gap: 0.5rem;
  row-gap: 0.05rem;
}

.move-list > li {
  display: contents;
}

.move-level {
  text-align: right;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.move-name {
  color: var(--ink);
}

.move-sep {
  color: var(--ink-muted);
}

.move-type {
  color: var(--ink);
}

/* ---- Page number ------------------------------------------------ */

.book-page__footer {
  position: absolute;
  right: 1.6rem;
  bottom: 1.2rem;
  color: var(--accent);
  font-weight: 700;
}

.page-number {
  font-size: 0.95rem;
  letter-spacing: 0.04em;
}

/* ---- A11y ------------------------------------------------------- */

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

/* ------------------------------------------------------------------ */
/* Responsive                                                          */
/* ------------------------------------------------------------------ */

@media (max-width: 1040px) {
  .pokedex-layout {
    grid-template-columns: 1fr;
  }

  .pokedex-detail {
    padding: 1rem;
  }

  .book-page {
    padding: 1.6rem 1.4rem 2.6rem;
    min-height: 0;
  }
}

@media (max-width: 760px) {
  .book-columns {
    grid-template-columns: 1fr;
    column-gap: 0;
    row-gap: 1.2rem;
  }

  .sprite-frame {
    max-width: 320px;
    margin: 0 auto;
  }

  .move-list {
    padding-left: 0;
  }
}
</style>
