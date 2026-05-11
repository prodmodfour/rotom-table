import { normalizeCombatStages } from '~/utils/combatStages'
import { addCombatStageDeltas } from '~/utils/moveAutomationDialog'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionSuggestion,
  MoveAutomationConditionUpdate,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface MoveAutomationConditionUpdateAccumulator {
  merge(token: SpawnedPokemon, conditions: readonly string[]): void
  applySuggestion(token: SpawnedPokemon, suggestion: MoveAutomationConditionSuggestion): void
  toUpdates(): MoveAutomationConditionUpdate[]
}

export interface MoveAutomationCombatStageUpdateAccumulator {
  addDeltas(token: SpawnedPokemon, deltas: Partial<Record<CombatStageKey, number>>): void
  toUpdates(): MoveAutomationCombatStageUpdate[]
}

const conditionSetForToken = (
  updates: Map<string, Set<string>>,
  token: SpawnedPokemon,
): Set<string> => {
  const existing = updates.get(token.id)
  if (existing) return existing

  const set = new Set(normalizeConditionNames(token.conditions))
  updates.set(token.id, set)
  return set
}

export const createMoveAutomationConditionUpdateAccumulator = (): MoveAutomationConditionUpdateAccumulator => {
  const conditionById = new Map<string, Set<string>>()

  return {
    merge: (token, conditions) => {
      const normalized = normalizeConditionNames(conditions)
      if (!normalized.length) return

      const set = conditionSetForToken(conditionById, token)
      for (const condition of normalized) set.add(condition)
    },
    applySuggestion: (token, suggestion) => {
      const set = conditionSetForToken(conditionById, token)
      if (suggestion.action === 'clear') {
        set.clear()
        return
      }

      const normalized = normalizeConditionNames([suggestion.condition])
      for (const condition of normalized) {
        if (suggestion.action === 'remove') set.delete(condition)
        else set.add(condition)
      }
    },
    toUpdates: () => Array.from(conditionById.entries()).map(([id, conditions]) => ({
      id,
      conditions: normalizeConditionNames(Array.from(conditions)),
    })),
  }
}

export const createMoveAutomationCombatStageUpdateAccumulator = (): MoveAutomationCombatStageUpdateAccumulator => {
  const stagesById = new Map<string, CombatStageMap>()

  return {
    addDeltas: (token, deltas) => {
      stagesById.set(
        token.id,
        addCombatStageDeltas(stagesById.get(token.id) ?? normalizeCombatStages(token.combatStages), deltas),
      )
    },
    toUpdates: () => Array.from(stagesById.entries()).map(([id, stages]) => ({ id, stages })),
  }
}
