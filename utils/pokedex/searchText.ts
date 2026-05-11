import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'
import {
  addSearchValuesToBucket,
  buildSearchText,
  buildSearchTextsFromBuckets,
  createSearchBuckets as createSearchBucketsForKeys,
  normalizeSearchText,
  type SearchBucketValue,
} from '~/utils/pokedex/searchBuckets'
import {
  maximumNumericComponent,
  minimumIntegerSearchValues,
  minimumSkillDiceSearchValues,
  stripParenthetical,
} from '~/utils/pokedex/searchValueRanges'

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

type MovementCapabilityKey = Exclude<keyof PokedexCapabilities, 'other'>

type PokedexSearchableEntry = PokedexRecord & {
  slug: string
  nationalDexNumber: number | null
}

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

export const normalizeText = normalizeSearchText

export const formatNationalDexNumber = (number: number | null | undefined): string | null => (
  number == null ? null : `#${number.toString().padStart(3, '0')}`
)

export const toPokedexSlug = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const POKEDEX_SEARCH_KEYS = searchFieldConfigs.map(({ key }) => key)

const createPokedexSearchBuckets = (): PokedexSearchTextBuckets => createSearchBucketsForKeys(POKEDEX_SEARCH_KEYS)

const addBucketSearchValues = (
  buckets: PokedexSearchTextBuckets,
  key: Exclude<PokedexSearchTextKey, 'any'>,
  ...rawValues: SearchValue[]
) => {
  addSearchValuesToBucket(buckets, key, 'any', ...rawValues)
}

const hasCapabilityValue = (value: PokedexCapabilities[MovementCapabilityKey]) => {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return value !== 0

  const normalized = normalizeText(value)
  return normalized.length > 0 && normalized !== '0' && normalized !== '0 0'
}

const addMinimumCapabilitySearchValues = (
  buckets: PokedexSearchTextBuckets,
  label: string,
  value: PokedexCapabilities[MovementCapabilityKey],
) => {
  for (const minimum of minimumIntegerSearchValues(maximumNumericComponent(value))) {
    addBucketSearchValues(
      buckets,
      'capability',
      `${label} ${minimum}`,
      `cap ${label} ${minimum}`,
      `caps ${label} ${minimum}`,
      `capability ${label} ${minimum}`,
      `capabilities ${label} ${minimum}`,
    )
  }
}

const addMinimumLabelledCapabilitySearchValues = (buckets: PokedexSearchTextBuckets, capability: string) => {
  const match = stripParenthetical(capability).replace(/\s+/g, ' ').trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/)
  if (!match) return

  const [, label, rawValue] = match
  const maximum = Number(rawValue)
  if (!label || !Number.isFinite(maximum)) return

  for (const minimum of minimumIntegerSearchValues(maximum)) {
    addBucketSearchValues(
      buckets,
      'capability',
      `${label} ${minimum}`,
      `cap ${label} ${minimum}`,
      `capability ${label} ${minimum}`,
      `capabilities ${label} ${minimum}`,
    )
  }
}

const addMinimumSkillSearchValues = (buckets: PokedexSearchTextBuckets, skill: string, value: string) => {
  for (const minimumValue of minimumSkillDiceSearchValues(value)) {
    addBucketSearchValues(
      buckets,
      'skill',
      minimumValue,
      `dice ${minimumValue}`,
      `${minimumValue} dice`,
      `skill ${minimumValue}`,
      `skills ${minimumValue}`,
      `${skill} ${minimumValue}`,
      `skill ${skill} ${minimumValue}`,
    )
  }
}

const addMinimumBaseStatSearchValues = (
  buckets: PokedexSearchTextBuckets,
  label: string,
  shortLabel: string,
  value: number,
) => {
  for (const minimum of minimumIntegerSearchValues(value)) {
    addBucketSearchValues(
      buckets,
      'stat',
      `${label} ${minimum}`,
      `${shortLabel} ${minimum}`,
      `stat ${label} ${minimum}`,
      `stat ${shortLabel} ${minimum}`,
      `base ${label} ${minimum}`,
      `base stat ${label} ${minimum}`,
    )
  }
}

export { buildSearchText }

export const buildPokedexSearchTexts = (entry: PokedexSearchableEntry): PokedexSearchTexts => {
  const buckets = createPokedexSearchBuckets()

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
      addMinimumCapabilitySearchValues(buckets, label, value)
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
      addMinimumLabelledCapabilitySearchValues(buckets, capability)
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
      addMinimumSkillSearchValues(buckets, skill, value)
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
      addMinimumBaseStatSearchValues(buckets, label, shortLabel, value)
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

  return buildSearchTextsFromBuckets(POKEDEX_SEARCH_KEYS, buckets) as PokedexSearchTexts
}
