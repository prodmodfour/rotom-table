import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import { splitMoveRangeKeywords } from '~/utils/moveAutomationText'
import { parseMoveFrequency } from '~/utils/moveUsage'
import {
  conditionBaseName,
  conditionDisplayName,
  isMoveDisabledByConditions,
  normalizeConditionNames,
} from '~/utils/statusConditions'

export interface ConditionRestrictedMove {
  name: string
  aliases?: readonly string[] | null
  damageClass?: string | null
  range?: string | null
  frequency?: string | null
}

export interface MoveConditionUseBlock {
  condition: string
  label: string
  reason: string
}

const ENRAGED_CONDITION_NAME = 'Rage'
const DISABLED_CONDITION_NAME = 'Disabled'
const STUCK_CONDITION_NAME = 'Stuck'
const SUPPRESSED_CONDITION_NAME = 'Suppressed'

const normalizedDamageClass = (value: string | null | undefined): string =>
  String(value ?? '').trim().toLowerCase()

const moveNamesForConditionChecks = (move: ConditionRestrictedMove): string[] => [
  move.name,
  ...(move.aliases ?? []),
]
  .map((name) => name.trim())
  .filter(Boolean)

export const conditionsIncludeEnraged = (
  conditions: readonly string[] | null | undefined,
): boolean => normalizeConditionNames(conditions)
  .some((condition) => conditionBaseName(condition) === ENRAGED_CONDITION_NAME)

export const moveAllowedWhileEnraged = (move: ConditionRestrictedMove): boolean => {
  if (isStruggleAttackMoveName(move.name)) return true
  return ['physical', 'special'].includes(normalizedDamageClass(move.damageClass))
}

const conditionsIncludeStuck = (
  conditions: readonly string[] | null | undefined,
): boolean => normalizeConditionNames(conditions)
  .some(condition => conditionBaseName(condition) === STUCK_CONDITION_NAME)

export const moveDashConditionUseBlock = (
  range: string | null | undefined,
  conditions: readonly string[] | null | undefined,
): MoveConditionUseBlock | null => {
  const hasDashKeyword = splitMoveRangeKeywords(range ?? '')
    .some(keyword => /^Dash$/i.test(keyword))
  if (!hasDashKeyword || !conditionsIncludeStuck(conditions)) return null
  return {
    condition: STUCK_CONDITION_NAME,
    label: STUCK_CONDITION_NAME,
    reason: 'Moves with the Dash keyword cannot be used while Stuck.',
  }
}

export const moveConditionUseBlock = (
  move: ConditionRestrictedMove,
  conditions: readonly string[] | null | undefined,
): MoveConditionUseBlock | null => {
  if (moveNamesForConditionChecks(move).some((name) => isMoveDisabledByConditions(name, conditions))) {
    return {
      condition: DISABLED_CONDITION_NAME,
      label: DISABLED_CONDITION_NAME,
      reason: `${move.name} is Disabled and cannot be used.`,
    }
  }

  const dashBlock = moveDashConditionUseBlock(move.range, conditions)
  if (dashBlock) return dashBlock

  if (normalizeConditionNames(conditions).some(condition => (
    conditionBaseName(condition) === SUPPRESSED_CONDITION_NAME
  )) && parseMoveFrequency(move.frequency).kind !== 'at-will') {
    return {
      condition: SUPPRESSED_CONDITION_NAME,
      label: SUPPRESSED_CONDITION_NAME,
      reason: `${move.name} is not At-Will and cannot be used while Suppressed.`,
    }
  }

  if (conditionsIncludeEnraged(conditions) && !moveAllowedWhileEnraged(move)) {
    const label = conditionDisplayName(ENRAGED_CONDITION_NAME)
    return {
      condition: ENRAGED_CONDITION_NAME,
      label,
      reason: `${label} targets must use a damaging Physical or Special Move, or a Struggle Attack.`,
    }
  }

  return null
}

export const isMoveBlockedByConditions = (
  move: ConditionRestrictedMove,
  conditions: readonly string[] | null | undefined,
): boolean => moveConditionUseBlock(move, conditions) != null
