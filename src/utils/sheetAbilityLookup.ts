import { findAbility } from '~~/data/ptuReference'
import {
  clearSheetAbilityActivation,
  isSheetActivatableAbility,
} from '~/utils/sheetAbilityActivation'
import type { CharacterSheetAbility } from '~/types/characterSheet'
import type { PtuAbility } from '~/types/ptuReference'
import type { TrainerAbilityEntry } from '~/types/trainerSheet'

export type SheetAbilityLike = CharacterSheetAbility | TrainerAbilityEntry

export interface AbilityLookupRow<T extends SheetAbilityLike> {
  ability: T
  reference: PtuAbility | null
}

const LOOKUP_BACKED_ABILITY_KEYS = [
  'frequency',
  'trigger',
  'effect',
] as const

export const lookupAbilityReference = (ability: Pick<SheetAbilityLike, 'name'>): PtuAbility | null => {
  const name = typeof ability.name === 'string' ? ability.name.trim() : ''
  return name ? findAbility(name) : null
}

export const makeAbilityLookupRows = <T extends SheetAbilityLike>(
  abilities: readonly T[] | undefined,
): AbilityLookupRow<T>[] =>
  (abilities ?? []).map((ability) => ({
    ability,
    reference: lookupAbilityReference(ability),
  }))

export const clearLookupBackedAbilityFields = (ability: SheetAbilityLike): void => {
  const target = ability as unknown as Record<string, unknown>
  for (const key of LOOKUP_BACKED_ABILITY_KEYS) delete target[key]
}

export const setLookupAbilityName = (ability: SheetAbilityLike, value: unknown): void => {
  ability.name = typeof value === 'string' ? value : value == null ? '' : String(value)
  // The sheet stores only the selected ability name; display details come from
  // data/reference/abilities.json via data/ptuReference.ts.
  clearLookupBackedAbilityFields(ability)
  if (!isSheetActivatableAbility(ability)) clearSheetAbilityActivation(ability)
}
