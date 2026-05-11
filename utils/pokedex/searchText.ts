import {
  addSearchValues,
  buildSearchText,
  normalizeSearchText,
  type SearchBucketValue,
} from '~/utils/pokedex/searchBuckets'
import {
  buildAbilitySearchValues,
  buildBaseStatSearchValues,
  buildBreedingSearchValues,
  buildCapabilitySearchValues,
  buildDietSearchValues,
  buildHabitatSearchValues,
  buildIdentitySearchValues,
  buildSizeSearchValues,
  buildSkillSearchValues,
  buildTypeSearchValues,
  type PokedexSearchableEntry,
} from '~/utils/pokedex/searchFieldValues'
import { buildMoveSearchValues } from '~/utils/pokedex/searchMoveValues'

export const searchFieldConfigs = [
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

export type PokedexSearchTextKey = typeof searchFieldConfigs[number]['key']
export type FieldFilterKey = Exclude<PokedexSearchTextKey, 'any'>
export type PokedexSearchTexts = Record<PokedexSearchTextKey, string>
export type PokedexSearchTextBuckets = Record<PokedexSearchTextKey, string[]>
export type SearchValue = SearchBucketValue
export type FilterMode = 'fields' | 'advanced'
export type FilterOperator = 'and' | 'or'

export const allTogetherFilterField = searchFieldConfigs[0]
export const filterFieldConfigs = searchFieldConfigs.filter(
  (field): field is Extract<typeof searchFieldConfigs[number], { key: FieldFilterKey }> => field.key !== 'any',
)

export const normalizeText = normalizeSearchText
export { buildSearchText }
export { formatNationalDexNumber, toPokedexSlug } from '~/utils/pokedex/searchFieldValues'

const POKEDEX_SEARCH_KEYS = searchFieldConfigs.map(({ key }) => key)
const POKEDEX_FIELD_SEARCH_KEYS = filterFieldConfigs.map(({ key }) => key) as FieldFilterKey[]

export const buildPokedexSearchValues = (
  entry: PokedexSearchableEntry,
  key: FieldFilterKey,
): SearchValue[] => {
  switch (key) {
    case 'identity':
      return buildIdentitySearchValues(entry)
    case 'type':
      return buildTypeSearchValues(entry)
    case 'ability':
      return buildAbilitySearchValues(entry)
    case 'capability':
      return buildCapabilitySearchValues(entry)
    case 'move':
      return buildMoveSearchValues(entry)
    case 'habitat':
      return buildHabitatSearchValues(entry)
    case 'breeding':
      return buildBreedingSearchValues(entry)
    case 'diet':
      return buildDietSearchValues(entry)
    case 'skill':
      return buildSkillSearchValues(entry)
    case 'stat':
      return buildBaseStatSearchValues(entry)
    case 'size':
      return buildSizeSearchValues(entry)
  }
}

export const buildPokedexSearchText = (
  entry: PokedexSearchableEntry,
  key: PokedexSearchTextKey,
): string => {
  const values = key === 'any'
    ? POKEDEX_FIELD_SEARCH_KEYS.flatMap((fieldKey) => buildPokedexSearchValues(entry, fieldKey))
    : buildPokedexSearchValues(entry, key)

  const stringValues: string[] = []
  addSearchValues(stringValues, ...values)

  return buildSearchText(stringValues)
}

export const createLazyPokedexSearchTexts = (entry: PokedexSearchableEntry): PokedexSearchTexts => {
  const cache = new Map<PokedexSearchTextKey, string>()
  const searchTexts = {} as PokedexSearchTexts

  for (const key of POKEDEX_SEARCH_KEYS) {
    Object.defineProperty(searchTexts, key, {
      enumerable: true,
      get: () => {
        const cachedValue = cache.get(key)
        if (cachedValue !== undefined) return cachedValue

        const value = buildPokedexSearchText(entry, key)
        cache.set(key, value)
        return value
      },
    })
  }

  return searchTexts
}

export const buildPokedexSearchTexts = (entry: PokedexSearchableEntry): PokedexSearchTexts => (
  Object.fromEntries(
    POKEDEX_SEARCH_KEYS.map((key) => [key, buildPokedexSearchText(entry, key)]),
  ) as PokedexSearchTexts
)
