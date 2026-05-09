<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import pokedexData from '~/ptu-data/data/pokedex.json'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { POKEMON_TYPES, isPokemonType, singleTypeMultiplier, type PokemonType } from '~/utils/typeChart'
import {
  allTogetherFilterField,
  filterFieldConfigs,
  formatNationalDexNumber,
  searchFieldConfigs,
  toPokedexSlug,
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'
import {
  buildPokedexEntries,
  buildPokedexEntryBySlug,
  pokedexEntryPath,
  routeParamToPokedexSlug,
  type DisplayPokedexEntry,
} from '~/utils/pokedex/entryIndex'
import { matchesActiveSearchFilters, parseSearchExpression, type ActiveSearchFilter } from '~/utils/pokedex/searchQuery'
import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(to.path.startsWith('/pokedex') && from.path.startsWith('/pokedex')),
})

const route = useRoute()

const sidebarRef = ref<HTMLElement | null>(null)
const entryListRef = ref<HTMLElement | null>(null)
const sidebarScrollTop = useState('pokedex-sidebar-scroll-top', () => 0)
const entryListScrollTop = useState('pokedex-entry-list-scroll-top', () => 0)

const saveSidebarScroll = () => {
  if (sidebarRef.value) {
    sidebarScrollTop.value = sidebarRef.value.scrollTop
  }

  if (entryListRef.value) {
    entryListScrollTop.value = entryListRef.value.scrollTop
  }
}

const restoreSidebarScroll = async () => {
  if (!import.meta.client) return

  await nextTick()
  window.requestAnimationFrame(() => {
    if (sidebarRef.value) {
      sidebarRef.value.scrollTop = sidebarScrollTop.value
    }

    if (entryListRef.value) {
      entryListRef.value.scrollTop = entryListScrollTop.value
    }
  })
}

onMounted(restoreSidebarScroll)
onBeforeUnmount(saveSidebarScroll)

onBeforeRouteUpdate((to, from) => {
  if (to.path.startsWith('/pokedex') && from.path.startsWith('/pokedex')) {
    saveSidebarScroll()
  }
})

watch(() => route.fullPath, (to, from) => {
  if (typeof from === 'string' && to.startsWith('/pokedex') && from.startsWith('/pokedex')) {
    restoreSidebarScroll()
  }
})

const allEntries = buildPokedexEntries(pokedexData as PokedexRecord[])
const entryBySlug = buildPokedexEntryBySlug(allEntries)
const pokemonRouteSlug = computed(() => routeParamToPokedexSlug(route.params.pokemon_name))

const filterMode = useState<FilterMode>('pokedex-filter-mode', () => 'fields')
const searchFilters = reactive<Record<PokedexSearchTextKey, string>>(
  useState<Record<PokedexSearchTextKey, string>>(
    'pokedex-search-filters',
    () => Object.fromEntries(searchFieldConfigs.map(({ key }) => [key, ''])) as Record<PokedexSearchTextKey, string>,
  ).value,
)
const filterOperators = reactive<Record<FieldFilterKey, FilterOperator>>(
  useState<Record<FieldFilterKey, FilterOperator>>(
    'pokedex-filter-operators',
    () => Object.fromEntries(filterFieldConfigs.map(({ key }) => [key, 'and'])) as Record<FieldFilterKey, FilterOperator>,
  ).value,
)

const activeSearchFilters = computed<ActiveSearchFilter[]>(() => {
  if (filterMode.value === 'advanced') {
    const expression = parseSearchExpression(searchFilters.any)
    return expression ? [{ key: 'any', expression, operator: 'and' }] : []
  }

  const filters: ActiveSearchFilter[] = []

  for (const { key } of filterFieldConfigs) {
    const expression = parseSearchExpression(searchFilters[key])
    if (expression) {
      filters.push({ key, expression, operator: filterOperators[key] })
    }
  }

  return filters
})

const filteredEntries = computed(() => {
  const filters = activeSearchFilters.value

  if (filters.length === 0) {
    return allEntries
  }

  return allEntries.filter((entry) => matchesActiveSearchFilters(entry, filters))
})

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

const isPlacementOnly = computed(() => {
  if (!selectedEntry.value) {
    return false
  }

  return !selectedEntry.value.base_stats && !selectedEntry.value.abilities && !selectedEntry.value.level_up_moves
})

const genderSummary = computed(() => {
  const entry = selectedEntry.value

  if (!entry) {
    return null
  }

  if (entry.genderless) {
    return 'Genderless'
  }

  if (entry.male_pct != null || entry.female_pct != null) {
    return `${entry.male_pct ?? 0}% M / ${entry.female_pct ?? 0}% F`
  }

  return null
})

// One-page index for the bottom-right page number.
const pageNumber = computed(() => {
  if (!selectedId.value) return null

  const filteredIndex = filteredEntries.value.findIndex((entry) => entry.id === selectedId.value)
  if (filteredIndex >= 0) return filteredIndex + 1

  const allIndex = allEntries.findIndex((entry) => entry.id === selectedId.value)
  return allIndex >= 0 ? allIndex + 1 : null
})

// "Capability List" rendered as a sequence of items (mostly RefLinks). Each
// entry has a ``ref`` name (the canonical capability for the link lookup) and
// a ``display`` string (which may include numbers or ``(args)``). Movement
// keywords (Overland/Sky/Swim/...) have no link target — RefLink renders them
// as plain text in that case.
interface CapabilityToken {
  display: string
  /** Link lookup name, or null to render as plain text only. */
  ref: string | null
}
const capabilityTokens = computed<CapabilityToken[]>(() => {
  const capabilities = selectedEntry.value?.capabilities as PokedexCapabilities | undefined
  if (!capabilities) return []

  const numbered: Array<[string, number | string | undefined]> = [
    ['Overland', capabilities.overland],
    ['Sky', capabilities.sky],
    ['Swim', capabilities.swim],
    ['Levitate', capabilities.levitate],
    ['Burrow', capabilities.burrow],
    ['Jump', capabilities.jump],
    ['Power', capabilities.power],
  ]

  const tokens: CapabilityToken[] = []
  for (const [label, value] of numbered) {
    if (value === undefined || value === null || value === 0 || value === '0') continue
    // Movement caps: not in capabilities.json, render as plain text.
    tokens.push({ display: `${label} ${value}`, ref: null })
  }
  for (const extra of capabilities.other ?? []) {
    if (!extra) continue
    // Use the raw label as both display and ref; RefLink will normalise the
    // ref via stripCapabilityParams() / aliases.
    tokens.push({ display: extra, ref: extra })
  }
  return tokens
})

// TM/HM, Egg, and Tutor moves rendered as arrays of link tokens so the
// template can interleave commas between RefLinks.
interface MoveToken { name: string; display: string }
const tmHmTokens = computed<MoveToken[]>(() => {
  const moves = selectedEntry.value?.tm_hm_moves
  if (!moves || moves.length === 0) return []
  return moves.map((move) => {
    const prefix = move.kind === 'HM' ? 'H' : ''
    return { name: move.name, display: `${prefix}${move.number} ${move.name}` }
  })
})
const eggMoveTokens = computed<MoveToken[]>(
  () => (selectedEntry.value?.egg_moves ?? []).map((name) => ({ name, display: name })),
)
const tutorMoveTokens = computed<MoveToken[]>(
  () => (selectedEntry.value?.tutor_moves ?? []).map((move) => ({
    name: move.name,
    display: move.heart_scale ? `${move.name} (N)` : move.name,
  })),
)

// Skill abbreviations matching the printed book (Athl, Acro, Percep…).
const SKILL_ABBREVIATIONS: Record<string, string> = {
  Athletics: 'Athl',
  Acrobatics: 'Acro',
  Combat: 'Combat',
  Stealth: 'Stealth',
  Perception: 'Percep',
  Focus: 'Focus',
}

const skillPhrase = computed(() => {
  const skills = selectedEntry.value?.skills
  if (!skills) return ''

  return Object.entries(skills)
    .map(([skill, value]) => `${SKILL_ABBREVIATIONS[skill] ?? skill} ${value}`)
    .join(', ')
})

const heightLabel = computed(() => {
  const entry = selectedEntry.value
  if (!entry || entry.height == null) return null

  const meters = entry.height
  const totalInches = meters / 0.0254
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches - feet * 12)
  const sizeSuffix = entry.size ? ` (${entry.size})` : ''
  return `${feet}' ${inches}" / ${meters.toFixed(1)}m${sizeSuffix}`
})

const weightLabel = computed(() => {
  const entry = selectedEntry.value
  if (!entry || entry.weight == null) return null
  // PTU "weight class" is a small integer; we only know the class number.
  return `Weight Class ${entry.weight}`
})

const eggGroupSummary = computed(() => {
  const groups = selectedEntry.value?.egg_groups
  if (!groups || groups.length === 0) return null
  return groups.join(' / ')
})

const dietSummary = computed(() => {
  const diet = selectedEntry.value?.diet
  if (!diet || diet.length === 0) return null
  return diet.join(', ')
})

const habitatSummary = computed(() => {
  const habitat = selectedEntry.value?.habitat
  if (!habitat || habitat.length === 0) return null
  return habitat.join(', ')
})

type TypeMatchupGroupKey = 'weaknesses' | 'resistances' | 'immunities'

interface TypeMatchupItem {
  type: PokemonType
  multiplier: number
  label: string
}

interface TypeMatchupGroup {
  key: TypeMatchupGroupKey
  label: string
  items: TypeMatchupItem[]
}

const TYPE_MATCHUP_ORDER = new Map<PokemonType, number>(
  POKEMON_TYPES.map((type, index) => [type, index] as const),
)

const compareTypeMatchupOrder = (a: TypeMatchupItem, b: TypeMatchupItem) => (
  (TYPE_MATCHUP_ORDER.get(a.type) ?? 0) - (TYPE_MATCHUP_ORDER.get(b.type) ?? 0)
)

const computePtuTypeMultiplier = (attacker: PokemonType, defenders: PokemonType[]): number => {
  let effectivenessSteps = 0

  for (const defender of defenders) {
    const singleTypeMatchup = singleTypeMultiplier(attacker, defender)

    if (singleTypeMatchup === 0) return 0
    if (singleTypeMatchup > 1) effectivenessSteps += 1
    if (singleTypeMatchup < 1) effectivenessSteps -= 1
  }

  if (effectivenessSteps < 0) return 1 / (2 ** Math.abs(effectivenessSteps))
  if (effectivenessSteps === 1) return 1.5
  if (effectivenessSteps >= 2) return effectivenessSteps
  return 1
}

const formatPtuMultiplier = (multiplier: number): string => {
  if (multiplier === 0) return '0'
  if (multiplier === 0.125) return '1/8'
  if (multiplier === 0.25) return '1/4'
  if (multiplier === 0.5) return '1/2'
  return multiplier.toString()
}

const typeMatchupGroups = computed<TypeMatchupGroup[]>(() => {
  const defendingTypes = (selectedEntry.value?.types ?? []).filter(isPokemonType)
  if (defendingTypes.length === 0) return []

  const matchups = POKEMON_TYPES.map((type): TypeMatchupItem => {
    const multiplier = computePtuTypeMultiplier(type, defendingTypes)
    return {
      type,
      multiplier,
      label: formatPtuMultiplier(multiplier),
    }
  })

  const weaknesses = matchups
    .filter((matchup) => matchup.multiplier > 1)
    .sort((a, b) => (b.multiplier - a.multiplier) || compareTypeMatchupOrder(a, b))
  const resistances = matchups
    .filter((matchup) => matchup.multiplier > 0 && matchup.multiplier < 1)
    .sort((a, b) => (a.multiplier - b.multiplier) || compareTypeMatchupOrder(a, b))
  const immunities = matchups.filter((matchup) => matchup.multiplier === 0)

  return [
    { key: 'weaknesses', label: 'Weaknesses', items: weaknesses },
    { key: 'resistances', label: 'Resistances', items: resistances },
    { key: 'immunities', label: 'Immunities', items: immunities },
  ].filter((group) => group.items.length > 0)
})

</script>

<template>
  <div class="pokedex-layout">
    <aside ref="sidebarRef" class="pokedex-sidebar" @scroll.passive="saveSidebarScroll">
      <AppNavigation />

      <section class="sidebar-card">
        <div class="sidebar-heading">
          <h1>Pokédex</h1>
          <span class="badge">{{ filteredEntries.length }} shown</span>
        </div>

        <p class="sidebar-copy">
          Browse every Pokémon entry from <code>ptu-data/data/pokedex.json</code>.
        </p>

        <div class="filter-browser">
          <div class="filter-panel">
            <div class="filter-mode" role="group" aria-label="Filter mode">
              <button
                type="button"
                :class="['filter-mode__button', { active: filterMode === 'fields' }]"
                @click="filterMode = 'fields'"
              >
                Field filters
              </button>
              <button
                type="button"
                :class="['filter-mode__button', { active: filterMode === 'advanced' }]"
                @click="filterMode = 'advanced'"
              >
                All together
              </button>
            </div>

            <div v-if="filterMode === 'advanced'" class="filter-fields" aria-label="All together filter">
              <label class="filter-field">
                <span class="filter-field__label">{{ allTogetherFilterField.label }}</span>
                <input
                  v-model.trim="searchFilters.any"
                  type="search"
                  :placeholder="allTogetherFilterField.placeholder"
                />
              </label>
            </div>

            <div v-else class="filter-fields" aria-label="Pokédex field filters">
              <template v-for="(field, index) in filterFieldConfigs" :key="field.key">
                <div v-if="index > 0" class="filter-operator">
                  <span class="filter-operator__rule" />
                  <select
                    v-model="filterOperators[field.key]"
                    class="filter-operator__select"
                    :aria-label="`Combine ${field.label} filter with previous filled filter`"
                  >
                    <option value="and">and</option>
                    <option value="or">or</option>
                  </select>
                  <span class="filter-operator__rule" />
                </div>
                <label class="filter-field">
                  <span class="filter-field__label">{{ field.label }}</span>
                  <input
                    v-model.trim="searchFilters[field.key]"
                    type="search"
                    :placeholder="field.placeholder"
                  />
                </label>
              </template>
            </div>
            <p class="filter-help">
              Use <code>and</code>, <code>or</code>, parentheses, and <code>-term</code> exclusions inside any filter. Numeric/dice terms are minimums (for example, <code>sky 5</code> matches Sky 5+ and <code>3d6</code> matches 3d6+). Field filters combine using the toggles.
            </p>
          </div>

          <div class="entry-list-panel">
            <div v-if="filteredEntries.length > 0" ref="entryListRef" class="entry-list" @scroll.passive="saveSidebarScroll">
              <NuxtLink
                v-for="entry in filteredEntries"
                :key="entry.id"
                :to="pokedexEntryPath(entry)"
                :class="['entry-button', { active: entry.id === selectedId }]"
                :aria-current="entry.id === selectedId ? 'page' : undefined"
                prefetch-on="interaction"
              >
                <span class="entry-name">{{ entry.species }}</span>
                <span class="entry-meta">
                  <template v-if="entry.nationalDexNumber">
                    {{ formatNationalDexNumber(entry.nationalDexNumber) }} ·
                  </template>
                  <span v-if="entry.types?.length" class="entry-type-badges">
                    <TypeBadge
                      v-for="type in entry.types"
                      :key="`${entry.id}-${type}`"
                      :type="type"
                      size="xs"
                    />
                  </span>
                  <span v-else>Unknown type</span>
                  <template v-if="entry.source_gen"> · {{ entry.source_gen }}</template>
                </span>
              </NuxtLink>
            </div>

            <p v-else class="empty-state">
              No Pokédex entries match those filters.
            </p>
          </div>
        </div>
      </section>
    </aside>

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

/* ------------------------------------------------------------------ */
/* Sidebar (kept utilitarian, dark, app-style)                         */
/* ------------------------------------------------------------------ */

.pokedex-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: hidden;
}

.sidebar-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  padding: 0.85rem;
}

.sidebar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.sidebar-heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.4rem;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
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

.sidebar-copy,
.empty-state {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
}

.filter-browser {
  display: grid;
  grid-template-columns: 340px minmax(190px, 1fr);
  gap: 0.75rem;
  min-height: 0;
  flex: 1;
}

.filter-panel,
.entry-list-panel {
  min-height: 0;
}

.filter-panel {
  overflow: auto;
  padding-right: 0.25rem;
}

.entry-list-panel {
  display: flex;
  flex-direction: column;
}

.filter-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
}

.filter-mode__button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-muted);
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
}

.filter-mode__button:hover,
.filter-mode__button.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.filter-fields {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-field__label {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.filter-operator {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.45rem;
  margin: -0.1rem 0;
}

.filter-operator__rule {
  height: 1px;
  background: var(--rule-soft);
}

.filter-help {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

input,
select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.filter-operator__select {
  width: auto;
  min-width: 4.8rem;
  padding: 0.25rem 0.45rem;
  border-radius: 999px;
  font-size: 0.72rem;
  text-transform: uppercase;
}

.entry-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  overflow: auto;
}

.entry-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.entry-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.entry-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.entry-button.active {
  border-color: var(--accent);
  background: var(--paper-active);
  color: var(--ink-bright);
}

.entry-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.entry-meta {
  color: var(--ink-muted);
  font-size: 0.78rem;
  line-height: 1.3;
}

.entry-type-badges,
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

  .pokedex-sidebar {
    max-height: none;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
  .filter-browser {
    grid-template-columns: 1fr;
  }

  .filter-panel,
  .entry-list-panel {
    overflow: visible;
  }

  .entry-list {
    max-height: 50vh;
    overflow: auto;
  }

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
