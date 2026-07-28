import type { AbilityClientCapability } from '#shared/abilityAutomation/clientCapabilities'
import { lookupAbilityReference } from '~/utils/sheetAbilityLookup'
import { deriveTrainerAutomaticAbilities } from '~/utils/sheets/trainerCombatDerivations'
import type { CharacterSheet, CharacterSheetAbility } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { PtuAbility } from '~/types/ptuReference'
import type { TrainerAbilityEntry, TrainerSheet } from '~/types/trainerSheet'

export type TokenSheetAbility = CharacterSheetAbility | TrainerAbilityEntry

export interface TokenAbilityMenuOption {
  readonly instanceId: string | null
  readonly canonicalId: string
  readonly name: string
  readonly frequency: string | null
  readonly trigger: string | null
  readonly effect: string | null
  readonly bonus: string | null
  /** Server-issued, revision-bound capability; absent means default-deny. */
  readonly capability: AbilityClientCapability | null
}
export interface TokenAbilityUseReference {
  readonly abilityInstanceId: string
  readonly canonicalId: string
}

export interface MapTokenAbilitySheetLookup {
  pokemon?: Map<string, CharacterSheet>
  trainer?: Map<string, TrainerSheet>
}

const fallback = <T>(...values: T[]): NonNullable<T> | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as NonNullable<T>
  }
  return null
}

export const pokemonAbilityEntriesForSheet = (sheet: CharacterSheet): TokenSheetAbility[] => [
  ...(sheet.abilities ?? []),
]

export const trainerAbilityEntriesForSheet = (sheet: TrainerSheet): TokenSheetAbility[] => [
  ...deriveTrainerAutomaticAbilities(sheet).map((ability) => ability.entry),
  ...(sheet.abilities ?? []),
]

export const abilityEntriesForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'> | null | undefined,
  sheets: MapTokenAbilitySheetLookup,
): TokenSheetAbility[] => {
  if (!placement) return []
  if (placement.sheetKind === 'pokemon') {
    const sheet = sheets.pokemon?.get(placement.sheetSlug)
    return sheet ? pokemonAbilityEntriesForSheet(sheet) : []
  }
  const sheet = sheets.trainer?.get(placement.sheetSlug)
  return sheet ? trainerAbilityEntriesForSheet(sheet) : []
}

const optionForAbility = (
  ability: TokenSheetAbility,
  capability: AbilityClientCapability | null,
  reference: PtuAbility | null = lookupAbilityReference(ability),
): TokenAbilityMenuOption => ({
  instanceId: capability?.instanceId ?? ability.automation?.instanceId ?? null,
  canonicalId: capability?.canonicalId ?? ability.automation?.canonicalId ?? reference?.name ?? ability.name,
  name: capability?.displayName ?? reference?.name ?? ability.name,
  frequency: fallback(reference?.frequency, ability.frequency),
  trigger: fallback(reference?.trigger, ability.trigger),
  effect: fallback(reference?.effect, ability.effect),
  bonus: fallback(reference?.bonus),
  capability,
})

/**
 * Merge sheet presentation with server capabilities. The sheet cannot make an
 * ability invocable; unmatched entries remain visible with a blocked badge.
 */
export const buildTokenAbilityMenuOptions = (
  entries: readonly TokenSheetAbility[],
  capabilities: readonly AbilityClientCapability[] = [],
): TokenAbilityMenuOption[] => {
  const unused = new Set(capabilities.map(capability => capability.instanceId))
  const options = entries.map((ability) => {
    const reference = lookupAbilityReference(ability)
    const canonicalId = ability.automation?.canonicalId ?? reference?.name ?? ability.name
    const capability = capabilities.find(candidate => (
      unused.has(candidate.instanceId)
      && (candidate.instanceId === ability.automation?.instanceId || candidate.canonicalId === canonicalId)
    )) ?? null
    if (capability) unused.delete(capability.instanceId)
    return optionForAbility(ability, capability, reference)
  })
  for (const capability of capabilities) {
    if (!unused.has(capability.instanceId)) continue
    options.push({
      instanceId: capability.instanceId,
      canonicalId: capability.canonicalId,
      name: capability.displayName,
      frequency: null,
      trigger: null,
      effect: null,
      bonus: null,
      capability,
    })
  }
  return options
}

export const tokenAbilityUseReference = (
  ability: TokenAbilityMenuOption,
): TokenAbilityUseReference | null => ability.capability?.status === 'ready' && ability.instanceId
  ? Object.freeze({ abilityInstanceId: ability.instanceId, canonicalId: ability.canonicalId })
  : null
