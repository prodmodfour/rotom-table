import {
  formatDisabledCondition,
  isMoveDisabledByConditions,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import type {
  MoveAutomationConditionUpdate,
  MoveAutomationSpitePrompt,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenSheetMoveEntry } from '~/utils/mapTokenMoves'

export const SPITE_MOVE_NAME = 'Spite'

const normalizeMoveKey = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase()
  : ''

export const isSpiteMoveName = (value: unknown): boolean => normalizeMoveKey(value) === normalizeMoveKey(SPITE_MOVE_NAME)

export const tokenHasUsableSpite = (
  token: Pick<SpawnedPokemon, 'conditions'>,
  moveEntries: readonly TokenSheetMoveEntry[],
): boolean => {
  if (isMoveDisabledByConditions(SPITE_MOVE_NAME, token.conditions)) return false
  return moveEntries.some((entry) => isSpiteMoveName(entry.move.name))
}

export const spiteReactionPromptKey = (
  prompt: Pick<MoveAutomationSpitePrompt, 'defenderId' | 'attackerId' | 'moveName'>,
): string => [prompt.defenderId, prompt.attackerId, normalizeMoveKey(prompt.moveName)].join('|')

const defaultSpitePromptId = (prompt: Omit<MoveAutomationSpitePrompt, 'id'>): string => [
  'spite',
  prompt.defenderId,
  prompt.attackerId,
  normalizeMoveKey(prompt.moveName).replace(/[^a-z0-9]+/g, '-') || 'move',
].join('-')

export interface BuildSpiteReactionPromptsInput {
  attacker: SpawnedPokemon
  moveName: string
  hitTargets: readonly SpawnedPokemon[]
  moveEntriesForTarget: (target: SpawnedPokemon) => readonly TokenSheetMoveEntry[]
  existingPrompts?: readonly MoveAutomationSpitePrompt[]
  idFactory?: (prompt: Omit<MoveAutomationSpitePrompt, 'id'>) => string
}

export const buildSpiteReactionPrompts = ({
  attacker,
  moveName,
  hitTargets,
  moveEntriesForTarget,
  existingPrompts = [],
  idFactory = defaultSpitePromptId,
}: BuildSpiteReactionPromptsInput): MoveAutomationSpitePrompt[] => {
  if (!moveName.trim() || isSpiteMoveName(moveName)) return []
  if (isMoveDisabledByConditions(moveName, attacker.conditions)) return []

  const seen = new Set(existingPrompts.map(spiteReactionPromptKey))
  const prompts: MoveAutomationSpitePrompt[] = []

  for (const defender of hitTargets) {
    if (defender.id === attacker.id) continue
    if (!tokenHasUsableSpite(defender, moveEntriesForTarget(defender))) continue

    const withoutId = {
      defenderId: defender.id,
      defenderName: defender.species,
      attackerId: attacker.id,
      attackerName: attacker.species,
      moveName,
    }
    const key = spiteReactionPromptKey(withoutId)
    if (seen.has(key)) continue

    seen.add(key)
    prompts.push({
      id: idFactory(withoutId),
      ...withoutId,
    })
  }

  return prompts
}

export const buildSpiteReactionConditionUpdate = (
  attacker: SpawnedPokemon,
  moveName: string,
): MoveAutomationConditionUpdate | null => {
  if (!moveName.trim() || isSpiteMoveName(moveName)) return null
  if (isMoveDisabledByConditions(moveName, attacker.conditions)) return null
  return {
    id: attacker.id,
    conditions: normalizeConditionNames([
      ...attacker.conditions,
      formatDisabledCondition(moveName),
    ]),
  }
}
