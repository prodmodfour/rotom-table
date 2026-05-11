import {
  addSearchValuesToBucket,
  buildSearchText,
  buildSearchTextsFromBuckets,
  createSearchBuckets as createSearchBucketsForKeys,
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
  buildMoveSearchValues,
  buildSizeSearchValues,
  buildSkillSearchValues,
  buildTypeSearchValues,
  type PokedexSearchableEntry,
} from '~/utils/pokedex/searchFieldValues'

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

const createPokedexSearchBuckets = (): PokedexSearchTextBuckets => createSearchBucketsForKeys(POKEDEX_SEARCH_KEYS)

const addBucketSearchValues = (
  buckets: PokedexSearchTextBuckets,
  key: Exclude<PokedexSearchTextKey, 'any'>,
  ...rawValues: SearchValue[]
) => {
  addSearchValuesToBucket(buckets, key, 'any', ...rawValues)
}

export const buildPokedexSearchTexts = (entry: PokedexSearchableEntry): PokedexSearchTexts => {
  const buckets = createPokedexSearchBuckets()

  addBucketSearchValues(buckets, 'identity', ...buildIdentitySearchValues(entry))
  addBucketSearchValues(buckets, 'type', ...buildTypeSearchValues(entry))
  addBucketSearchValues(buckets, 'habitat', ...buildHabitatSearchValues(entry))
  addBucketSearchValues(buckets, 'ability', ...buildAbilitySearchValues(entry))
  addBucketSearchValues(buckets, 'capability', ...buildCapabilitySearchValues(entry))
  addBucketSearchValues(buckets, 'move', ...buildMoveSearchValues(entry))
  addBucketSearchValues(buckets, 'breeding', ...buildBreedingSearchValues(entry))
  addBucketSearchValues(buckets, 'diet', ...buildDietSearchValues(entry))
  addBucketSearchValues(buckets, 'skill', ...buildSkillSearchValues(entry))
  addBucketSearchValues(buckets, 'stat', ...buildBaseStatSearchValues(entry))
  addBucketSearchValues(buckets, 'size', ...buildSizeSearchValues(entry))

  return buildSearchTextsFromBuckets(POKEDEX_SEARCH_KEYS, buckets) as PokedexSearchTexts
}
