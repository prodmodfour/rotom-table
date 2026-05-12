import type { PokedexCapabilities } from '~/types/pokemon'
import { normalizeSearchText } from '~/utils/pokedex/searchBuckets'
import {
  maximumNumericComponent,
  minimumIntegerSearchValues,
  minimumSkillDiceSearchValues,
  stripParenthetical,
} from '~/utils/pokedex/searchValueRanges'

type MovementCapabilityKey = Exclude<keyof PokedexCapabilities, 'other'>

export type MovementCapabilityValue = PokedexCapabilities[MovementCapabilityKey]

const capabilityMinimumAliases = (label: string, minimum: number, includeCapsAlias: boolean): string[] => {
  const aliases = [
    `${label} ${minimum}`,
    `cap ${label} ${minimum}`,
    `capability ${label} ${minimum}`,
    `capabilities ${label} ${minimum}`,
  ]

  if (includeCapsAlias) {
    aliases.splice(2, 0, `caps ${label} ${minimum}`)
  }

  return aliases
}

export const hasPokedexCapabilityValue = (value: MovementCapabilityValue | null): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return value !== 0

  const normalized = normalizeSearchText(value)
  return normalized.length > 0 && normalized !== '0' && normalized !== '0 0'
}

export const buildMinimumCapabilityAliases = (label: string, value: MovementCapabilityValue | null): string[] => (
  minimumIntegerSearchValues(maximumNumericComponent(value))
    .flatMap((minimum) => capabilityMinimumAliases(label, minimum, true))
)

export const buildMinimumLabelledCapabilityAliases = (capability: string): string[] => {
  const match = stripParenthetical(capability).replace(/\s+/g, ' ').trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/)
  if (!match) return []

  const [, label, rawValue] = match
  const maximum = Number(rawValue)
  if (!label || !Number.isFinite(maximum)) return []

  return minimumIntegerSearchValues(maximum)
    .flatMap((minimum) => capabilityMinimumAliases(label, minimum, false))
}

export const buildMinimumSkillAliases = (skill: string, value: string): string[] => (
  minimumSkillDiceSearchValues(value).flatMap((minimumValue) => [
    minimumValue,
    `dice ${minimumValue}`,
    `${minimumValue} dice`,
    `skill ${minimumValue}`,
    `skills ${minimumValue}`,
    `${skill} ${minimumValue}`,
    `skill ${skill} ${minimumValue}`,
  ])
)

export const buildMinimumBaseStatAliases = (
  label: string,
  shortLabel: string,
  value: number,
): string[] => (
  minimumIntegerSearchValues(value).flatMap((minimum) => [
    `${label} ${minimum}`,
    `${shortLabel} ${minimum}`,
    `stat ${label} ${minimum}`,
    `stat ${shortLabel} ${minimum}`,
    `base ${label} ${minimum}`,
    `base stat ${label} ${minimum}`,
  ])
)
