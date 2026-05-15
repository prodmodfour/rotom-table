import type { CharacterSheetCapabilities } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'

const NATUREWALK_PATTERN = /^Naturewalk\s*\(([^)]*)\)\s*$/i
const TRAILING_CAPABILITY_VALUE_PATTERN = /\s+\d+(?:\/\d+)?\s*$/

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
): string[] => {
  const defaultExactKeys = new Set(uniqueNormalizedOtherCapabilities(defaults).map(capabilityExactKey))
  return uniqueNormalizedOtherCapabilities(capabilities)
    .filter((capability) => !defaultExactKeys.has(capabilityExactKey(capability)))
}

export const resolvePokemonOtherCapabilities = (
  species: PokedexRecord | null | undefined,
  sheetCapabilities: CharacterSheetCapabilities | null | undefined,
): string[] => mergeDefaultCapabilities(
  pokedexOtherCapabilityDefaults(species),
  uniqueNormalizedOtherCapabilities(sheetCapabilities?.other),
)
