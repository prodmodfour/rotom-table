import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'
import type { SearchBucketValue } from '~/utils/pokedex/searchBuckets'
import {
  buildMinimumBaseStatAliases,
  buildMinimumCapabilityAliases,
  buildMinimumLabelledCapabilityAliases,
  buildMinimumSkillAliases,
  hasPokedexCapabilityValue,
} from '~/utils/pokedex/searchAliases'
import { buildEggGroupSearchValues } from '~/utils/pokedex/searchListValues'
import { stripParenthetical } from '~/utils/pokedex/searchValueRanges'

export type PokedexSearchableEntry = PokedexRecord & {
  slug: string
  nationalDexNumber: number | null
}

export type PokedexSearchFieldValue = SearchBucketValue
export { buildDietSearchValues, buildHabitatSearchValues, buildTypeSearchValues } from '~/utils/pokedex/searchListValues'
export { buildMoveSearchValues } from '~/utils/pokedex/searchMoveValues'

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

export const buildIdentitySearchValues = (entry: PokedexSearchableEntry): PokedexSearchFieldValue[] => {
  const values: PokedexSearchFieldValue[] = [entry.species, entry.slug.replace(/-/g, ' '), entry.source_gen]

  if (entry.source_gen) {
    values.push(`gen ${entry.source_gen}`, `source ${entry.source_gen}`)
  }

  if (entry.nationalDexNumber) {
    const paddedNumber = entry.nationalDexNumber.toString().padStart(3, '0')
    values.push(
      entry.nationalDexNumber,
      paddedNumber,
      `#${paddedNumber}`,
      `dex ${entry.nationalDexNumber}`,
      `dex ${paddedNumber}`,
      `national dex ${entry.nationalDexNumber}`,
      formatNationalDexNumber(entry.nationalDexNumber),
    )
  }

  return values
}

export const buildAbilitySearchValues = (entry: Pick<PokedexRecord, 'abilities'>): PokedexSearchFieldValue[] => {
  if (!entry.abilities) return []

  const values: PokedexSearchFieldValue[] = []
  const abilityGroups = [
    ['basic ability', entry.abilities.basic],
    ['advanced ability', entry.abilities.advanced],
    ['high ability', entry.abilities.high],
  ] as const

  for (const [label, abilities] of abilityGroups) {
    for (const ability of abilities ?? []) {
      values.push(
        ability,
        `ability ${ability}`,
        `abilities ${ability}`,
        `${ability} ability`,
        `${label} ${ability}`,
      )
    }
  }

  return values
}

export const buildCapabilitySearchValues = (entry: Pick<PokedexRecord, 'capabilities'>): PokedexSearchFieldValue[] => {
  if (!entry.capabilities) return []

  const values: PokedexSearchFieldValue[] = []

  for (const [key, label] of CAPABILITY_SEARCH_FIELDS) {
    const value = entry.capabilities[key]
    if (!hasPokedexCapabilityValue(value)) continue

    values.push(
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
      ...buildMinimumCapabilityAliases(label, value),
    )
  }

  for (const capability of entry.capabilities.other ?? []) {
    if (!capability) continue

    const baseCapability = stripParenthetical(capability)
    values.push(
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
      ...buildMinimumLabelledCapabilityAliases(capability),
    )
  }

  return values
}

export const buildBreedingSearchValues = (
  entry: Pick<PokedexRecord, 'egg_groups' | 'genderless' | 'male_pct' | 'female_pct' | 'hatch_rate'>,
): PokedexSearchFieldValue[] => {
  const values: PokedexSearchFieldValue[] = []

  values.push(...buildEggGroupSearchValues(entry.egg_groups))

  if (entry.genderless) {
    values.push('genderless')
  }

  if (entry.male_pct != null || entry.female_pct != null) {
    values.push(
      `male ${entry.male_pct ?? 0}`,
      `female ${entry.female_pct ?? 0}`,
      `gender ratio ${entry.male_pct ?? 0} ${entry.female_pct ?? 0}`,
    )
  }

  if (entry.hatch_rate) {
    values.push(entry.hatch_rate, `hatch ${entry.hatch_rate}`, `hatch rate ${entry.hatch_rate}`)
  }

  return values
}

export const buildSkillSearchValues = (entry: Pick<PokedexRecord, 'skills'>): PokedexSearchFieldValue[] => {
  if (!entry.skills) return []

  const values: PokedexSearchFieldValue[] = []
  for (const [skill, value] of Object.entries(entry.skills)) {
    values.push(
      skill,
      value,
      `dice ${value}`,
      `${value} dice`,
      `skill ${skill}`,
      `${skill} ${value}`,
      `skill ${skill} ${value}`,
      ...buildMinimumSkillAliases(skill, value),
    )
  }

  return values
}

export const buildBaseStatSearchValues = (entry: Pick<PokedexRecord, 'base_stats'>): PokedexSearchFieldValue[] => {
  if (!entry.base_stats) return []

  const values: PokedexSearchFieldValue[] = []
  for (const [key, label, shortLabel] of BASE_STAT_SEARCH_FIELDS) {
    const value = entry.base_stats[key]
    values.push(
      label,
      shortLabel,
      `stat ${label}`,
      `${label} ${value}`,
      `${shortLabel} ${value}`,
      `base ${label} ${value}`,
      `base stat ${label} ${value}`,
      ...buildMinimumBaseStatAliases(label, shortLabel, value),
    )
  }

  return values
}

export const buildSizeSearchValues = (
  entry: Pick<PokedexRecord, 'size' | 'height' | 'weight' | 'width'>,
): PokedexSearchFieldValue[] => {
  const values: PokedexSearchFieldValue[] = [entry.size ? `size ${entry.size}` : null, entry.size]

  if (entry.height != null) {
    values.push(`height ${entry.height}`, `${entry.height}m`)
  }
  if (entry.weight != null) {
    values.push(`weight ${entry.weight}`, `weight class ${entry.weight}`)
  }
  if (entry.width != null) {
    values.push(`width ${entry.width}`)
  }

  return values
}
