import { lookupAbilityReference } from '~/utils/sheetAbilityLookup'
import { deriveTrainerAutomaticAbilities } from '~/utils/sheets/trainerCombatDerivations'
import {
  getAbilityAutomation,
  type AbilityAutomationDefinition,
} from '~/utils/abilityAutomationLegacyCompatibility'
import { isSheetAbilityActivated } from '~/utils/sheetAbilityActivation'
import type { CharacterSheet, CharacterSheetAbility } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { PtuAbility } from '~/types/ptuReference'
import type { TrainerAbilityEntry, TrainerSheet } from '~/types/trainerSheet'

export type TokenSheetAbility = CharacterSheetAbility | TrainerAbilityEntry

export interface TokenAbilityMenuOption {
  name: string
  frequency: string | null
  trigger: string | null
  effect: string | null
  bonus: string | null
  automation: AbilityAutomationDefinition | null
  activated: boolean
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
  reference: PtuAbility | null = lookupAbilityReference(ability),
): TokenAbilityMenuOption => ({
  name: reference?.name ?? ability.name,
  frequency: fallback(reference?.frequency, ability.frequency),
  trigger: fallback(reference?.trigger, ability.trigger),
  effect: fallback(reference?.effect, ability.effect),
  bonus: fallback(reference?.bonus),
  automation: getAbilityAutomation(ability),
  activated: isSheetAbilityActivated(ability),
})

export const buildTokenAbilityMenuOptions = (
  entries: readonly TokenSheetAbility[],
): TokenAbilityMenuOption[] => entries.map((ability) => optionForAbility(ability))
