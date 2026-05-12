import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import { COMBAT_STAGE_KEYS, clampCombatStage, normalizeCombatStages } from '~/utils/combatStages'
import { normalizeConditionNames } from '~/utils/statusConditions'

export interface CombatStagesDialogState {
  id: string
  species: string
  originalStages: CombatStageMap
  stages: CombatStageMap
}

export interface ConditionsDialogState {
  id: string
  species: string
  originalConditions: string[]
  conditions: string[]
}

type CombatDialogPokemon = Pick<SpawnedPokemon, 'id' | 'species' | 'combatStages'>
type ConditionsDialogPokemon = Pick<SpawnedPokemon, 'id' | 'species' | 'conditions'>

export const createCombatStagesDialogState = (
  pokemon: CombatDialogPokemon,
): CombatStagesDialogState => {
  const stages = normalizeCombatStages(pokemon.combatStages)
  return {
    id: pokemon.id,
    species: pokemon.species,
    originalStages: { ...stages },
    stages: { ...stages },
  }
}

export const isCombatStagesDialogChanged = (
  dialog: CombatStagesDialogState | null,
): boolean => {
  if (!dialog) return false
  const current = normalizeCombatStages(dialog.stages)
  return COMBAT_STAGE_KEYS.some((key) => current[key] !== dialog.originalStages[key])
}

export const getAdjustedCombatStage = (value: unknown, delta: number): number =>
  clampCombatStage(clampCombatStage(value) + delta)

export const getNormalizedCombatDialogStages = (
  dialog: CombatStagesDialogState,
): CombatStageMap => normalizeCombatStages(dialog.stages)

export const formatCombatStage = (value: unknown): string => {
  const clamped = clampCombatStage(value)
  return clamped > 0 ? `+${clamped}` : String(clamped)
}

export const createConditionsDialogState = (
  pokemon: ConditionsDialogPokemon,
): ConditionsDialogState => {
  const conditions = normalizeConditionNames(pokemon.conditions)
  return {
    id: pokemon.id,
    species: pokemon.species,
    originalConditions: [...conditions],
    conditions: [...conditions],
  }
}

export const isConditionsDialogChanged = (
  dialog: ConditionsDialogState | null,
): boolean => {
  if (!dialog) return false
  const current = normalizeConditionNames(dialog.conditions)
  const original = normalizeConditionNames(dialog.originalConditions)
  if (current.length !== original.length) return true
  return current.some((name, index) => name !== original[index])
}

export const updateConditionsDialogFromPokemon = (
  dialog: ConditionsDialogState,
  pokemon: ConditionsDialogPokemon,
): ConditionsDialogState => ({
  ...dialog,
  species: pokemon.species,
  originalConditions: normalizeConditionNames(pokemon.conditions),
})
