import type { CharacterSheetCapabilities } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import type { ValuedOtherCapabilityBonus } from '~/utils/sheets/pokemonMoveGrantedCapabilities'

const NATUREWALK_PATTERN = /^Naturewalk\s*\(([^)]*)\)\s*$/i
const TRAILING_CAPABILITY_VALUE_PATTERN = /\s+\d+(?:\/\d+)?\s*$/
const TRAILING_SINGLE_VALUE_PATTERN = /^(.+?)\s+(\d+)\s*$/

export interface AdditionalOtherCapabilityDefaults {
  other?: readonly string[] | null
  valuedBonuses?: readonly ValuedOtherCapabilityBonus[] | null
}

export const normalizeCapabilityLabel = (capability: string): string =>
  capability.trim().replace(/\s+/g, ' ')

const capabilityExactKey = (capability: string): string =>
  normalizeCapabilityLabel(capability).toLowerCase()

const capabilityIdentityKey = (capability: string): string =>
  capabilityExactKey(capability)
    .replace(TRAILING_CAPABILITY_VALUE_PATTERN, '')
    .trim()

const uniqueNormalizedCapabilities = (capabilities: readonly string[] | null | undefined): string[] => {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const rawCapability of capabilities ?? []) {
    const capability = normalizeCapabilityLabel(rawCapability)
    if (!capability) continue
    const key = capabilityExactKey(capability)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(capability)
  }
  return unique
}

export const isNaturewalkCapability = (capability: string): boolean =>
  NATUREWALK_PATTERN.test(normalizeCapabilityLabel(capability))

const uniqueNormalizedOtherCapabilities = (
  capabilities: readonly string[] | null | undefined,
): string[] => uniqueNormalizedCapabilities(capabilities)
  .filter((capability) => !isNaturewalkCapability(capability))

const parseCapabilitySingleValue = (capability: string): { label: string; value: number } | null => {
  const match = TRAILING_SINGLE_VALUE_PATTERN.exec(normalizeCapabilityLabel(capability))
  if (!match) return null
  const value = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isFinite(value)) return null
  return { label: normalizeCapabilityLabel(match[1] ?? ''), value }
}

const formatCapabilitySingleValue = (label: string, value: number): string =>
  `${normalizeCapabilityLabel(label)} ${value}`

const applyValuedOtherCapabilityBonuses = (
  capabilities: readonly string[],
  bonuses: readonly ValuedOtherCapabilityBonus[] | null | undefined,
): string[] => {
  const next = uniqueNormalizedOtherCapabilities(capabilities)
  for (const bonus of bonuses ?? []) {
    if (bonus.bonus <= 0) continue
    const bonusIdentity = capabilityIdentityKey(bonus.capability)
    const existingIndex = next.findIndex((capability) => capabilityIdentityKey(capability) === bonusIdentity)
    if (existingIndex === -1) {
      next.push(formatCapabilitySingleValue(bonus.capability, bonus.bonus))
      continue
    }

    const existing = next[existingIndex]!
    const parsed = parseCapabilitySingleValue(existing)
    const label = parsed?.label ?? existing
    const baseValue = parsed?.value ?? 0
    next[existingIndex] = formatCapabilitySingleValue(label, baseValue + bonus.bonus)
  }
  return next
}

const removeValuedOtherCapabilityBonusesForStorage = (
  capabilities: readonly string[] | null | undefined,
  bonuses: readonly ValuedOtherCapabilityBonus[] | null | undefined,
): string[] => {
  let next = uniqueNormalizedOtherCapabilities(capabilities)
  for (const bonus of bonuses ?? []) {
    if (bonus.bonus <= 0) continue
    const bonusIdentity = capabilityIdentityKey(bonus.capability)
    next = next.flatMap((capability) => {
      if (capabilityIdentityKey(capability) !== bonusIdentity) return [capability]
      const parsed = parseCapabilitySingleValue(capability)
      if (!parsed) return [capability]
      const baseValue = parsed.value - bonus.bonus
      return baseValue > 0 ? [formatCapabilitySingleValue(parsed.label, baseValue)] : []
    })
  }
  return next
}

const removeAutomaticOtherCapabilitiesForStorage = (
  capabilities: readonly string[] | null | undefined,
  automaticCapabilities: readonly string[] | null | undefined,
): string[] => {
  const automaticExactKeys = new Set(uniqueNormalizedOtherCapabilities(automaticCapabilities).map(capabilityExactKey))
  return uniqueNormalizedOtherCapabilities(capabilities)
    .filter((capability) => !automaticExactKeys.has(capabilityExactKey(capability)))
}

const naturewalkValueFromCapabilities = (
  capabilities: readonly string[] | null | undefined,
): string | undefined => {
  const values = (capabilities ?? [])
    .map((capability) => NATUREWALK_PATTERN.exec(normalizeCapabilityLabel(capability))?.[1]?.trim())
    .filter((value): value is string => Boolean(value))

  return values.length ? values.join(', ') : undefined
}

export const pokedexNaturewalkDefault = (
  species: PokedexRecord | null | undefined,
): string | undefined => naturewalkValueFromCapabilities(species?.capabilities?.other)

export const resolvePokemonNaturewalk = (
  species: PokedexRecord | null | undefined,
  sheetCapabilities: CharacterSheetCapabilities | null | undefined,
): string | undefined => sheetCapabilities?.naturewalk
  ?? naturewalkValueFromCapabilities(sheetCapabilities?.other)
  ?? pokedexNaturewalkDefault(species)

export const pokedexOtherCapabilityDefaults = (
  species: PokedexRecord | null | undefined,
): string[] => uniqueNormalizedOtherCapabilities(species?.capabilities?.other)

export const mergeDefaultCapabilities = (
  defaults: readonly string[] | null | undefined,
  overrides: readonly string[] | null | undefined,
): string[] => {
  const defaultCapabilities = uniqueNormalizedCapabilities(defaults)
  const overrideCapabilities = uniqueNormalizedCapabilities(overrides)
  const defaultExactKeys = new Set(defaultCapabilities.map(capabilityExactKey))
  const changedOverrideIdentityKeys = new Set(
    overrideCapabilities
      .filter((capability) => !defaultExactKeys.has(capabilityExactKey(capability)))
      .map(capabilityIdentityKey),
  )

  return [
    ...defaultCapabilities.filter((capability) => !changedOverrideIdentityKeys.has(capabilityIdentityKey(capability))),
    ...overrideCapabilities.filter((capability) => !defaultExactKeys.has(capabilityExactKey(capability))),
  ]
}

export const removeDefaultCapabilitiesForStorage = (
  capabilities: readonly string[] | null | undefined,
  defaults: readonly string[] | null | undefined,
  additionalDefaults: AdditionalOtherCapabilityDefaults = {},
): string[] => {
  const withoutValuedBonuses = removeValuedOtherCapabilityBonusesForStorage(
    capabilities,
    additionalDefaults.valuedBonuses,
  )
  const withoutAutomatic = removeAutomaticOtherCapabilitiesForStorage(
    withoutValuedBonuses,
    additionalDefaults.other,
  )
  const defaultExactKeys = new Set(uniqueNormalizedOtherCapabilities(defaults).map(capabilityExactKey))
  return uniqueNormalizedOtherCapabilities(withoutAutomatic)
    .filter((capability) => !defaultExactKeys.has(capabilityExactKey(capability)))
}

export const resolvePokemonOtherCapabilities = (
  species: PokedexRecord | null | undefined,
  sheetCapabilities: CharacterSheetCapabilities | null | undefined,
  additionalDefaults: AdditionalOtherCapabilityDefaults = {},
): string[] => applyValuedOtherCapabilityBonuses(
  mergeDefaultCapabilities(
    mergeDefaultCapabilities(
      pokedexOtherCapabilityDefaults(species),
      uniqueNormalizedOtherCapabilities(sheetCapabilities?.other),
    ),
    uniqueNormalizedOtherCapabilities(additionalDefaults.other),
  ),
  additionalDefaults.valuedBonuses,
)
