import { normalizeCombatStages } from '~/utils/combatStages'
import {
  addAppliedCondition,
  mergeAppliedConditions,
  removeAppliedCondition,
} from '~/utils/conditionApplication'
import { addCombatStageDeltas } from '~/utils/moveAutomationDialog'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { tokenSheetConditionNames } from '~/utils/sheetConditions'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionSuggestion,
  MoveAutomationConditionUpdate,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface MoveAutomationConditionUpdateAccumulator {
  get(token: SpawnedPokemon): readonly string[]
  set(token: SpawnedPokemon, conditions: readonly string[]): void
  merge(token: SpawnedPokemon, conditions: readonly string[]): void
  applySuggestion(token: SpawnedPokemon, suggestion: MoveAutomationConditionSuggestion): void
  toUpdates(): MoveAutomationConditionUpdate[]
}

export interface MoveAutomationCombatStageUpdateAccumulator {
  get(token: SpawnedPokemon): CombatStageMap
  set(token: SpawnedPokemon, stages: CombatStageMap): void
  addDeltas(token: SpawnedPokemon, deltas: Partial<Record<CombatStageKey, number>>): void
  toUpdates(): MoveAutomationCombatStageUpdate[]
}

const conditionListForToken = (
  updates: Map<string, string[]>,
  token: SpawnedPokemon,
): string[] => {
  const existing = updates.get(token.id)
  if (existing) return existing

  const conditions = tokenSheetConditionNames(token)
  updates.set(token.id, conditions)
  return conditions
}

const setConditionListForToken = (
  updates: Map<string, string[]>,
  token: SpawnedPokemon,
  conditions: string[],
): void => {
  updates.set(token.id, normalizeConditionNames(conditions))
}

export const createMoveAutomationConditionUpdateAccumulator = (): MoveAutomationConditionUpdateAccumulator => {
  const conditionById = new Map<string, string[]>()

  return {
    get: token => [...(conditionById.get(token.id) ?? tokenSheetConditionNames(token))],
    set: (token, conditions) => {
      setConditionListForToken(conditionById, token, [...conditions])
    },
    merge: (token, conditions) => {
      const normalized = normalizeConditionNames(conditions)
      if (!normalized.length) return

      const current = conditionListForToken(conditionById, token)
      setConditionListForToken(conditionById, token, mergeAppliedConditions(current, normalized))
    },
    applySuggestion: (token, suggestion) => {
      if (suggestion.action === 'clear') {
        setConditionListForToken(conditionById, token, [])
        return
      }

      const normalized = normalizeConditionNames([suggestion.condition])
      if (!normalized.length) return

      const current = conditionListForToken(conditionById, token)
      const next = suggestion.action === 'remove'
        ? normalized.reduce((conditions, condition) => removeAppliedCondition(conditions, condition), current)
        : normalized.reduce((conditions, condition) => addAppliedCondition(conditions, condition), current)
      setConditionListForToken(conditionById, token, next)
    },
    toUpdates: () => Array.from(conditionById.entries()).map(([id, conditions]) => ({
      id,
      conditions: normalizeConditionNames(conditions),
    })),
  }
}

export const createMoveAutomationCombatStageUpdateAccumulator = (): MoveAutomationCombatStageUpdateAccumulator => {
  const stagesById = new Map<string, CombatStageMap>()

  return {
    get: token => ({ ...(stagesById.get(token.id) ?? normalizeCombatStages(token.combatStages)) }),
    set: (token, stages) => {
      stagesById.set(token.id, normalizeCombatStages(stages))
    },
    addDeltas: (token, deltas) => {
      stagesById.set(
        token.id,
        addCombatStageDeltas(stagesById.get(token.id) ?? normalizeCombatStages(token.combatStages), deltas),
      )
    },
    toUpdates: () => Array.from(stagesById.entries()).map(([id, stages]) => ({ id, stages })),
  }
}
