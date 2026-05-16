import {
  conditionBaseName,
  normalizeConditionNames,
} from '~/utils/statusConditions'

export const FLINCH_CONDITION_NAME = 'Flinch'
export const VULNERABLE_CONDITION_NAME = 'Vulnerable'

const conditionsAppliedWith = (condition: string): string[] => {
  const canonical = conditionBaseName(condition) ?? condition
  return canonical === FLINCH_CONDITION_NAME ? [VULNERABLE_CONDITION_NAME] : []
}

export const addAppliedCondition = (
  currentConditions: readonly string[] | null | undefined,
  condition: unknown,
): string[] => {
  const normalizedAdditions = normalizeConditionNames([condition])
  if (!normalizedAdditions.length) return normalizeConditionNames(currentConditions)

  let next = normalizeConditionNames(currentConditions)
  for (const addition of normalizedAdditions) {
    next = normalizeConditionNames([
      ...next,
      addition,
      ...conditionsAppliedWith(addition),
    ])
  }
  return next
}

export const mergeAppliedConditions = (
  currentConditions: readonly string[] | null | undefined,
  additions: readonly unknown[] | null | undefined,
): string[] => {
  let next = normalizeConditionNames(currentConditions)
  for (const addition of normalizeConditionNames(additions)) {
    next = addAppliedCondition(next, addition)
  }
  return next
}

export const removeAppliedCondition = (
  currentConditions: readonly string[] | null | undefined,
  condition: unknown,
): string[] => {
  const removals = normalizeConditionNames([condition])
  if (!removals.length) return normalizeConditionNames(currentConditions)

  const removalSet = new Set(removals)
  return normalizeConditionNames(
    normalizeConditionNames(currentConditions).filter((entry) => !removalSet.has(entry)),
  )
}
