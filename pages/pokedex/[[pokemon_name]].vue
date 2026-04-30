<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import pokedexData from '~/ptu-data/data/pokedex.json'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { compareByNationalDex, getNationalDexNumber } from '~/utils/nationalDex'
import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(to.path.startsWith('/pokedex') && from.path.startsWith('/pokedex')),
})

type DisplayPokedexEntry = PokedexRecord & {
  id: string
  slug: string
  nationalDexNumber: number | null
  searchText: string
  searchTexts: PokedexSearchTexts
}

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

const normalizeText = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^a-z0-9#]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const formatNationalDexNumber = (number: number | null | undefined): string | null => (
  number == null ? null : `#${number.toString().padStart(3, '0')}`
)

const toPokedexSlug = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const searchFieldConfigs = [
  { key: 'any', label: 'All Together', placeholder: 'Filter species, move, ability, cap, type…' },
  { key: 'identity', label: 'Species / Dex / Gen', placeholder: 'Pikachu, #025, gen 1…' },
  { key: 'type', label: 'Type', placeholder: 'fire type or water…' },
  { key: 'ability', label: 'Ability', placeholder: 'Intimidate or Magic Guard…' },
  { key: 'capability', label: 'Capability', placeholder: 'mountable or darkvision…' },
  { key: 'move', label: 'Move', placeholder: 'thunder punch or tm35…' },
  { key: 'habitat', label: 'Habitat', placeholder: 'forest or urban…' },
  { key: 'breeding', label: 'Breeding', placeholder: 'monster egg or genderless…' },
  { key: 'diet', label: 'Diet', placeholder: 'herbivore or carnivore…' },
  { key: 'skill', label: 'Skill', placeholder: '4d6 or acrobatics 4d6+2…' },
  { key: 'stat', label: 'Base Stats', placeholder: 'attack 8 or hp 5…' },
  { key: 'size', label: 'Size / Weight', placeholder: 'small or weight class 2…' },
] as const

type PokedexSearchTextKey = typeof searchFieldConfigs[number]['key']
type FieldFilterKey = Exclude<PokedexSearchTextKey, 'any'>
type PokedexSearchTexts = Record<PokedexSearchTextKey, string>
type PokedexSearchTextBuckets = Record<PokedexSearchTextKey, string[]>
type SearchValue = string | number | null | undefined
type FilterMode = 'fields' | 'advanced'
type FilterOperator = 'and' | 'or'

const allTogetherFilterField = searchFieldConfigs[0]
const filterFieldConfigs = searchFieldConfigs.filter(
  (field): field is Extract<typeof searchFieldConfigs[number], { key: FieldFilterKey }> => field.key !== 'any',
)
type MovementCapabilityKey = Exclude<keyof PokedexCapabilities, 'other'>

const CAPABILITY_SEARCH_FIELDS: Array<[MovementCapabilityKey, string]> = [
  ['overland', 'Overland'],
  ['sky', 'Sky'],
  ['swim', 'Swim'],
  ['levitate', 'Levitate'],
  ['burrow', 'Burrow'],
  ['jump', 'Jump'],
  ['power', 'Power'],
]

const BASE_STAT_SEARCH_FIELDS = [
  ['hp', 'HP', 'HP'],
  ['atk', 'Attack', 'Atk'],
  ['def', 'Defense', 'Def'],
  ['spatk', 'Special Attack', 'SpAtk'],
  ['spdef', 'Special Defense', 'SpDef'],
  ['spd', 'Speed', 'Spd'],
] as const

const createSearchBuckets = (): PokedexSearchTextBuckets => Object.fromEntries(
  searchFieldConfigs.map(({ key }) => [key, [] as string[]]),
) as PokedexSearchTextBuckets

const addSearchValue = (values: string[], value: SearchValue) => {
  if (value === undefined || value === null) return

  const stringValue = String(value).trim()
  if (stringValue) values.push(stringValue)
}

const addSearchValues = (values: string[], ...rawValues: SearchValue[]) => {
  for (const value of rawValues) {
    addSearchValue(values, value)
  }
}

const addBucketSearchValues = (
  buckets: PokedexSearchTextBuckets,
  key: Exclude<PokedexSearchTextKey, 'any'>,
  ...rawValues: SearchValue[]
) => {
  addSearchValues(buckets[key], ...rawValues)
  addSearchValues(buckets.any, ...rawValues)
}

const hasCapabilityValue = (value: PokedexCapabilities[MovementCapabilityKey]) => {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return value !== 0

  const normalized = normalizeText(value)
  return normalized.length > 0 && normalized !== '0' && normalized !== '0 0'
}

const stripParenthetical = (value: string) => value.replace(/\s*\([^)]*\)/g, '').trim()

const buildSearchText = (values: string[]): string => {
  const normalizedValues = new Set<string>()

  for (const value of values) {
    const normalized = normalizeText(value)
    if (!normalized) continue

    normalizedValues.add(normalized)

    // Also index a no-space version so "thunderpunch" and "tm35" work even
    // when the source data says "Thunder Punch" or "TM 35".
    const compact = normalized.replace(/\s+/g, '')
    if (compact && compact !== normalized) {
      normalizedValues.add(compact)
    }
  }

  return Array.from(normalizedValues).join(' ')
}

const buildPokedexSearchTexts = (entry: PokedexRecord & { slug: string; nationalDexNumber: number | null }): PokedexSearchTexts => {
  const buckets = createSearchBuckets()

  addBucketSearchValues(buckets, 'identity', entry.species, entry.slug.replace(/-/g, ' '), entry.source_gen)
  if (entry.source_gen) {
    addBucketSearchValues(buckets, 'identity', `gen ${entry.source_gen}`, `source ${entry.source_gen}`)
  }

  if (entry.nationalDexNumber) {
    const paddedNumber = entry.nationalDexNumber.toString().padStart(3, '0')
    addBucketSearchValues(
      buckets,
      'identity',
      entry.nationalDexNumber,
      paddedNumber,
      `#${paddedNumber}`,
      `dex ${entry.nationalDexNumber}`,
      `dex ${paddedNumber}`,
      `national dex ${entry.nationalDexNumber}`,
      formatNationalDexNumber(entry.nationalDexNumber),
    )
  }

  if (entry.types?.length) {
    addBucketSearchValues(buckets, 'type', ...entry.types, `type ${entry.types.join(' ')}`, `types ${entry.types.join(' ')}`)
    for (const type of entry.types) {
      addBucketSearchValues(buckets, 'type', `type ${type}`, `${type} type`)
    }
  }

  if (entry.habitat?.length) {
    addBucketSearchValues(buckets, 'habitat', ...entry.habitat, `habitat ${entry.habitat.join(' ')}`, `habitats ${entry.habitat.join(' ')}`)
    for (const habitat of entry.habitat) {
      addBucketSearchValues(buckets, 'habitat', `habitat ${habitat}`, `${habitat} habitat`)
    }
  }

  if (entry.abilities) {
    const abilityGroups = [
      ['basic ability', entry.abilities.basic],
      ['advanced ability', entry.abilities.advanced],
      ['high ability', entry.abilities.high],
    ] as const

    for (const [label, abilities] of abilityGroups) {
      for (const ability of abilities ?? []) {
        addBucketSearchValues(
          buckets,
          'ability',
          ability,
          `ability ${ability}`,
          `abilities ${ability}`,
          `${ability} ability`,
          `${label} ${ability}`,
        )
      }
    }
  }

  if (entry.capabilities) {
    for (const [key, label] of CAPABILITY_SEARCH_FIELDS) {
      const value = entry.capabilities[key]
      if (!hasCapabilityValue(value)) continue

      addBucketSearchValues(
        buckets,
        'capability',
        label,
        `cap ${label}`,
        `caps ${label}`,
        `capability ${label}`,
        `capabilities ${label}`,
        `${label} cap`,
        `${label} capability`,
        `${label} ${value}`,
        `cap ${label} ${value}`,
        `capability ${label} ${value}`,
      )
    }

    for (const capability of entry.capabilities.other ?? []) {
      if (!capability) continue

      const baseCapability = stripParenthetical(capability)
      addBucketSearchValues(
        buckets,
        'capability',
        capability,
        baseCapability,
        `cap ${capability}`,
        `capability ${capability}`,
        `capabilities ${capability}`,
        `${capability} cap`,
        `${capability} capability`,
        baseCapability ? `cap ${baseCapability}` : null,
        baseCapability ? `capability ${baseCapability}` : null,
        baseCapability ? `${baseCapability} cap` : null,
        baseCapability ? `${baseCapability} capability` : null,
      )
    }
  }

  for (const move of entry.level_up_moves ?? []) {
    addBucketSearchValues(
      buckets,
      'move',
      move.name,
      `move ${move.name}`,
      `moves ${move.name}`,
      `${move.name} move`,
      `level up ${move.name}`,
      `level ${move.level} ${move.name}`,
    )
  }

  for (const move of entry.tm_hm_moves ?? []) {
    const machine = `${move.kind}${move.number}`
    addBucketSearchValues(
      buckets,
      'move',
      move.name,
      `move ${move.name}`,
      `moves ${move.name}`,
      `${move.name} move`,
      `${move.kind} ${move.number}`,
      machine,
      `${move.kind} ${move.number} ${move.name}`,
      `${machine} ${move.name}`,
    )
  }

  for (const moveName of entry.egg_moves ?? []) {
    addBucketSearchValues(buckets, 'move', moveName, `move ${moveName}`, `moves ${moveName}`, `${moveName} move`, `egg move ${moveName}`)
  }

  for (const move of entry.tutor_moves ?? []) {
    addBucketSearchValues(buckets, 'move', move.name, `move ${move.name}`, `moves ${move.name}`, `${move.name} move`, `tutor move ${move.name}`)
    if (move.heart_scale) {
      addBucketSearchValues(buckets, 'move', `heart scale move ${move.name}`)
    }
  }

  if (entry.egg_groups?.length) {
    addBucketSearchValues(buckets, 'breeding', ...entry.egg_groups, `egg group ${entry.egg_groups.join(' ')}`)
    for (const group of entry.egg_groups) {
      addBucketSearchValues(buckets, 'breeding', `egg group ${group}`, `${group} egg group`)
    }
  }
  if (entry.genderless) {
    addBucketSearchValues(buckets, 'breeding', 'genderless')
  }
  if (entry.male_pct != null || entry.female_pct != null) {
    addBucketSearchValues(
      buckets,
      'breeding',
      `male ${entry.male_pct ?? 0}`,
      `female ${entry.female_pct ?? 0}`,
      `gender ratio ${entry.male_pct ?? 0} ${entry.female_pct ?? 0}`,
    )
  }
  if (entry.hatch_rate) {
    addBucketSearchValues(buckets, 'breeding', entry.hatch_rate, `hatch ${entry.hatch_rate}`, `hatch rate ${entry.hatch_rate}`)
  }

  if (entry.diet?.length) {
    addBucketSearchValues(buckets, 'diet', ...entry.diet, `diet ${entry.diet.join(' ')}`)
    for (const diet of entry.diet) {
      addBucketSearchValues(buckets, 'diet', `diet ${diet}`, `${diet} diet`)
    }
  }

  if (entry.skills) {
    for (const [skill, value] of Object.entries(entry.skills)) {
      addBucketSearchValues(
        buckets,
        'skill',
        skill,
        value,
        `dice ${value}`,
        `${value} dice`,
        `skill ${skill}`,
        `${skill} ${value}`,
        `skill ${skill} ${value}`,
      )
    }
  }

  if (entry.base_stats) {
    for (const [key, label, shortLabel] of BASE_STAT_SEARCH_FIELDS) {
      const value = entry.base_stats[key]
      addBucketSearchValues(
        buckets,
        'stat',
        label,
        shortLabel,
        `stat ${label}`,
        `${label} ${value}`,
        `${shortLabel} ${value}`,
        `base ${label} ${value}`,
        `base stat ${label} ${value}`,
      )
    }
  }

  addBucketSearchValues(buckets, 'size', entry.size ? `size ${entry.size}` : null, entry.size)
  if (entry.height != null) {
    addBucketSearchValues(buckets, 'size', `height ${entry.height}`, `${entry.height}m`)
  }
  if (entry.weight != null) {
    addBucketSearchValues(buckets, 'size', `weight ${entry.weight}`, `weight class ${entry.weight}`)
  }
  if (entry.width != null) {
    addBucketSearchValues(buckets, 'size', `width ${entry.width}`)
  }

  return Object.fromEntries(
    searchFieldConfigs.map(({ key }) => [key, buildSearchText(buckets[key])]),
  ) as PokedexSearchTexts
}

const allEntries: DisplayPokedexEntry[] = [...(pokedexData as PokedexRecord[])]
  .filter((entry): entry is PokedexRecord => Boolean(entry?.species))
  .sort(compareByNationalDex)
  .map((entry, index) => {
    const slug = toPokedexSlug(entry.species)
    const displayEntry = {
      ...entry,
      id: `${index}-${slug || 'entry'}`,
      slug,
      nationalDexNumber: getNationalDexNumber(entry.species),
    }

    const searchTexts = buildPokedexSearchTexts(displayEntry)

    return {
      ...displayEntry,
      searchText: searchTexts.any,
      searchTexts,
    }
  })

const entryBySlug = new Map<string, DisplayPokedexEntry>()
for (const entry of allEntries) {
  // A few upstream parser artifacts share the same bogus species label. Keep
  // the first so every real Pokémon still resolves to a stable name URL.
  if (!entry.slug || entryBySlug.has(entry.slug)) continue
  entryBySlug.set(entry.slug, entry)
}

const pokedexEntryPath = (entry: DisplayPokedexEntry) => `/pokedex/${entry.slug}`

const pokemonRouteSlug = computed(() => {
  const raw = route.params.pokemon_name
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.trim().length === 0) return null

  // Accept copied URLs that use underscores, while links we generate use the
  // canonical hyphenated slug.
  return toPokedexSlug(value.replace(/_/g, ' ')) || null
})

const filterMode = ref<FilterMode>('fields')
const searchFilters = reactive<Record<PokedexSearchTextKey, string>>(
  Object.fromEntries(searchFieldConfigs.map(({ key }) => [key, ''])) as Record<PokedexSearchTextKey, string>,
)
const filterOperators = reactive<Record<FieldFilterKey, FilterOperator>>(
  Object.fromEntries(filterFieldConfigs.map(({ key }) => [key, 'and'])) as Record<FieldFilterKey, FilterOperator>,
)

interface SearchCriterion {
  kind: 'criterion'
  query: string
  compactQuery: string
}

interface SearchBooleanExpression {
  kind: 'and' | 'or'
  left: SearchExpression
  right: SearchExpression
}

type SearchExpression = SearchCriterion | SearchBooleanExpression

type SearchToken =
  | { kind: 'term'; value: string }
  | { kind: 'and' | 'or' | 'open' | 'close' }

const normalizeSearchQuery = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^a-z0-9#()]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const toSearchCriterion = (value: string): SearchCriterion | null => {
  const query = normalizeText(value)
  if (!query) return null

  return {
    kind: 'criterion',
    query,
    compactQuery: query.replace(/\s+/g, ''),
  }
}

const tokenizeSearchQuery = (value: string): SearchToken[] => {
  const normalized = normalizeSearchQuery(value)
  if (!normalized) return []

  return normalized
    .split(/(\(|\)|\band\b|\bor\b)/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): SearchToken => {
      if (part === '(') return { kind: 'open' }
      if (part === ')') return { kind: 'close' }
      if (part === 'and' || part === 'or') return { kind: part }
      return { kind: 'term', value: part }
    })
}

const parseSearchExpression = (value: string): SearchExpression | null => {
  const tokens = tokenizeSearchQuery(value)
  let index = 0

  const peek = () => tokens[index] ?? null

  const parsePrimary = (): SearchExpression | null => {
    const token = peek()
    if (!token) return null

    if (token.kind === 'term') {
      index += 1
      return toSearchCriterion(token.value)
    }

    if (token.kind === 'open') {
      index += 1
      const expression = parseOr()
      if (peek()?.kind === 'close') {
        index += 1
      }
      return expression
    }

    return null
  }

  const parseAnd = (): SearchExpression | null => {
    let expression = parsePrimary()

    while (peek()?.kind === 'and') {
      index += 1
      const right = parsePrimary()
      if (!right) break
      expression = expression ? { kind: 'and', left: expression, right } : right
    }

    return expression
  }

  const parseOr = (): SearchExpression | null => {
    let expression = parseAnd()

    while (peek()?.kind === 'or') {
      index += 1
      const right = parseAnd()
      if (!right) break
      expression = expression ? { kind: 'or', left: expression, right } : right
    }

    return expression
  }

  return parseOr()
}

const matchesSearchCriterion = (searchText: string, criterion: SearchCriterion): boolean => (
  searchText.includes(criterion.query)
  || (criterion.compactQuery !== criterion.query && searchText.includes(criterion.compactQuery))
)

const matchesSearchExpression = (searchText: string, expression: SearchExpression): boolean => {
  if (expression.kind === 'criterion') {
    return matchesSearchCriterion(searchText, expression)
  }

  if (expression.kind === 'and') {
    return matchesSearchExpression(searchText, expression.left) && matchesSearchExpression(searchText, expression.right)
  }

  return matchesSearchExpression(searchText, expression.left) || matchesSearchExpression(searchText, expression.right)
}

interface ActiveSearchFilter {
  key: PokedexSearchTextKey
  expression: SearchExpression
  operator: FilterOperator
}

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

const matchesActiveSearchFilters = (entry: DisplayPokedexEntry, filters: ActiveSearchFilter[]): boolean => {
  if (filters.length === 0) return true

  let matches = matchesSearchExpression(entry.searchTexts[filters[0].key], filters[0].expression)

  for (let index = 1; index < filters.length; index += 1) {
    const filter = filters[index]
    const currentMatches = matchesSearchExpression(entry.searchTexts[filter.key], filter.expression)
    matches = filter.operator === 'and' ? matches && currentMatches : matches || currentMatches
  }

  return matches
}

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
              Use <code>and</code>, <code>or</code>, and parentheses inside any filter. Field filters combine using the toggles.
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

            <section
              v-if="selectedEntry.level_up_moves?.length || tmHmTokens.length || eggMoveTokens.length || tutorMoveTokens.length"
              class="book-section"
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
  grid-template-columns: max-content max-content max-content 1fr;
  column-gap: 0.5rem;
  row-gap: 0.05rem;
  padding-left: 1.6rem; /* matches the indent in the printed book */
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
