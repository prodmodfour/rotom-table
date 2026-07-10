import { conditionSaveAutomationRule } from '#shared/conditionAutomation'
import type { EncounterEffectConditionSaveTiming } from '#shared/moveAutomation/encounterEffects'
import type {
  MoveConditionCleanseFilter,
  MoveConditionEffectOperation,
  MoveEffectConditionGroup,
} from '#shared/moveAutomation/effects'
import {
  addAppliedCondition,
} from '~/utils/conditionApplication'
import {
  conditionBaseName,
  conditionByName,
  conditionStackCount,
  isStackableCondition,
  normalizeConditionName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import { failMoveCoreConditionReduction } from './conditionError'

/** Pokémon-style major ailments; every other PTU status affliction is minor. */
const MAJOR_CONDITIONS = new Set([
  'Burned',
  'Frozen',
  'Paralysis',
  'Poisoned',
  'Badly Poisoned',
  'Sleep',
])

const STATUS_CATEGORIES = new Set(['Persistent Affliction', 'Volatile Affliction'])

export const canonicalMoveCondition = (conditionId: string): string => {
  const condition = normalizeConditionName(conditionId)
  if (!condition) {
    return failMoveCoreConditionReduction(
      'unknown-condition',
      `Condition effect references unknown canonical condition ${conditionId}.`,
    )
  }
  return condition
}

const conditionCategory = (condition: string): string | null => (
  conditionByName.get(conditionBaseName(condition) ?? condition)?.category ?? null
)

const conditionInGroup = (
  condition: string,
  group: MoveEffectConditionGroup,
): boolean => {
  const canonical = conditionBaseName(condition) ?? condition
  const category = conditionCategory(canonical)
  if (group === 'all') return true
  if (group === 'major') return MAJOR_CONDITIONS.has(canonical)
  if (group === 'minor') {
    return category !== null
      && STATUS_CATEGORIES.has(category)
      && !MAJOR_CONDITIONS.has(canonical)
  }
  if (group === 'persistent') return category === 'Persistent Affliction'
  if (group === 'volatile') return category === 'Volatile Affliction'
  if (group === 'other') return category === 'Other Affliction'
  return category !== null && STATUS_CATEGORIES.has(category)
}

const canonicalFilterIds = (ids: readonly string[]): readonly string[] => (
  ids.map(canonicalMoveCondition)
)

export const conditionMatchesMoveCleanseFilter = (
  condition: string,
  filter: MoveConditionCleanseFilter | null,
): boolean => {
  if (filter === null) return true
  const canonical = conditionBaseName(condition) ?? canonicalMoveCondition(condition)
  const includedIds = canonicalFilterIds(filter.conditionIds)
  const excludedIds = canonicalFilterIds(filter.excludedConditionIds)
  if (excludedIds.includes(canonical)) return false
  const hasInclusions = filter.groups.length > 0 || includedIds.length > 0
  return !hasInclusions
    || includedIds.includes(canonical)
    || filter.groups.some(group => conditionInGroup(canonical, group))
}

export const removeMatchingPersistentConditions = (
  conditions: readonly string[],
  matches: (condition: string) => boolean,
): readonly string[] => normalizeConditionNames(
  conditions.filter(condition => !matches(conditionBaseName(condition) ?? condition)),
)

/** Transfer removes exactly one stack while ordinary remove/cleanse removes every match. */
export const removeOnePersistentMoveCondition = (
  conditions: readonly string[],
  condition: string,
): readonly string[] => {
  const normalized = normalizeConditionNames(conditions)
  const index = normalized.findIndex(entry => conditionBaseName(entry) === condition)
  return index < 0
    ? normalized
    : normalizeConditionNames(normalized.filter((_entry, entryIndex) => entryIndex !== index))
}

export const applyPersistentMoveCondition = (options: {
  readonly conditions: readonly string[]
  readonly condition: string
  readonly operation: MoveConditionEffectOperation
}): { readonly conditions: readonly string[]; readonly capped: boolean } => {
  const policy = options.operation.payload.stackPolicy
  if (policy.kind === 'independent-instance') {
    return failMoveCoreConditionReduction(
      'invalid-condition-stack-policy',
      `Persistent condition operation ${options.operation.id} cannot create independent instances.`,
    )
  }
  if (policy.kind === 'add-stack') {
    if (!isStackableCondition(options.condition)) {
      return failMoveCoreConditionReduction(
        'invalid-condition-stack-policy',
        `Condition ${options.condition} is not stackable.`,
      )
    }
    const count = conditionStackCount(options.conditions, options.condition)
    if (count >= policy.maxStacks) return { conditions: options.conditions, capped: true }
    return {
      conditions: addAppliedCondition(options.conditions, options.condition),
      capped: false,
    }
  }
  const withoutExisting = policy.kind === 'replace'
    ? removeMatchingPersistentConditions(
        options.conditions,
        condition => condition === options.condition,
      )
    : options.conditions
  return {
    conditions: addAppliedCondition(withoutExisting, options.condition),
    capped: false,
  }
}

export const resolvedMoveConditionSaveTiming = (
  condition: string,
  operation: MoveConditionEffectOperation,
): EncounterEffectConditionSaveTiming | null => {
  const timing = operation.payload.saveTiming
  if (timing === 'none') return null
  if (timing === 'start-turn' || timing === 'end-turn') return timing
  return conditionSaveAutomationRule(condition)?.timing ?? null
}
