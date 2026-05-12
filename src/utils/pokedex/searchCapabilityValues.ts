import type { PokedexCapabilities, PokedexRecord } from '~/types/pokemon'
import type { SearchBucketValue } from '~/utils/pokedex/searchBuckets'
import {
  buildMinimumCapabilityAliases,
  buildMinimumLabelledCapabilityAliases,
  hasPokedexCapabilityValue,
} from '~/utils/pokedex/searchAliases'
import { stripParenthetical } from '~/utils/pokedex/searchValueRanges'

export type PokedexCapabilitySearchValue = SearchBucketValue
export type MovementCapabilityKey = Exclude<keyof PokedexCapabilities, 'other'>

export const CAPABILITY_SEARCH_FIELDS: Array<[MovementCapabilityKey, string]> = [
  ['overland', 'Overland'],
  ['sky', 'Sky'],
  ['swim', 'Swim'],
  ['levitate', 'Levitate'],
  ['burrow', 'Burrow'],
  ['jump', 'Jump'],
  ['power', 'Power'],
]

const buildMovementCapabilitySearchValues = (
  label: string,
  value: PokedexCapabilities[MovementCapabilityKey],
): PokedexCapabilitySearchValue[] => [
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
]

const buildOtherCapabilitySearchValues = (capability: string): PokedexCapabilitySearchValue[] => {
  const baseCapability = stripParenthetical(capability)

  return [
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
  ]
}

export const buildCapabilitySearchValues = (
  entry: Pick<PokedexRecord, 'capabilities'>,
): PokedexCapabilitySearchValue[] => {
  if (!entry.capabilities) return []

  const values: PokedexCapabilitySearchValue[] = []

  for (const [key, label] of CAPABILITY_SEARCH_FIELDS) {
    const value = entry.capabilities[key]
    if (!hasPokedexCapabilityValue(value)) continue

    values.push(...buildMovementCapabilitySearchValues(label, value))
  }

  for (const capability of entry.capabilities.other ?? []) {
    if (!capability) continue
    values.push(...buildOtherCapabilitySearchValues(capability))
  }

  return values
}
