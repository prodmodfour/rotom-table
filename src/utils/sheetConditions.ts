import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SpawnedPokemon } from '~/types/pokemon'
import { mergeLegacyConditions, normalizeConditionNames } from '~/utils/statusConditions'

/**
 * Return only the canonical conditions durably owned by a Pokémon sheet.
 * Encounter-local condition effects are intentionally projected elsewhere.
 */
export const pokemonSheetConditionNames = (sheet: CharacterSheet): string[] => (
  mergeLegacyConditions(sheet.combat?.conditions, sheet.combat?.statusAfflictions)
)

/**
 * Return only the canonical conditions durably owned by a Trainer sheet.
 * Encounter-local condition effects are intentionally projected elsewhere.
 */
export const trainerSheetConditionNames = (sheet: TrainerSheet): string[] => (
  mergeLegacyConditions(sheet.conditions, sheet.statusAfflictions)
)

/** Read a token's persistent layer, with legacy tokens falling back to their effective list. */
export const tokenSheetConditionNames = (
  token: Pick<SpawnedPokemon, 'conditions' | 'sheetConditions'>,
): string[] => normalizeConditionNames(token.sheetConditions ?? token.conditions)

/** Read the persistent condition layer without deriving any encounter state. */
export const sheetConditionNames = (
  kind: SheetKind,
  sheet: CharacterSheet | TrainerSheet,
): string[] => kind === 'pokemon'
  ? pokemonSheetConditionNames(sheet as CharacterSheet)
  : trainerSheetConditionNames(sheet as TrainerSheet)
