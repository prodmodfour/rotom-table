import type {
  ValidatedMoveSpec,
  ValidatedMoveSpecTargetingRule,
} from './validateSpec'

/**
 * Resolve the only targeting rule an intent may use. Alternate declarations
 * fail closed unless the intent chooses one reviewed branch ID.
 */
export const resolveMoveSpecTargetingRule = (
  spec: ValidatedMoveSpec,
  targetBranchId: string | null | undefined,
): ValidatedMoveSpecTargetingRule | null => {
  const branches = spec.targeting.branches
  if (!branches) return targetBranchId == null ? spec.targeting : null
  if (!targetBranchId) return null
  return branches.find(({ id }) => id === targetBranchId) ?? null
}
