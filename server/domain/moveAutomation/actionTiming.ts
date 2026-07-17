import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import type { TerrainActionTiming } from './terrain'

export interface ResolveAuthoritativeMoveActionTimingInput {
  readonly range: string
  /** Non-empty reviewed costs override the retained v1 range adapter. */
  readonly reviewedCosts?: readonly MoveSpecCostDeclaration[]
}

/**
 * Classify only server-reviewed action metadata for terrain legality. Browser
 * intent cannot select or downgrade this timing.
 */
export const resolveAuthoritativeMoveActionTiming = (
  input: ResolveAuthoritativeMoveActionTimingInput,
): TerrainActionTiming => {
  const costs = input.reviewedCosts ?? []
  if (costs.length > 0) {
    if (costs.some(declaration => declaration.cost.kind === 'priority')) {
      return 'priority'
    }
    const action = costs.find(declaration => (
      declaration.cost.kind === 'action-resource'
      && (
        declaration.cost.resource === 'interrupt'
        || declaration.cost.resource === 'reaction'
      )
    ))
    if (
      action?.cost.kind === 'action-resource'
      && (action.cost.resource === 'interrupt' || action.cost.resource === 'reaction')
    ) {
      return action.cost.resource
    }
    return 'ordinary'
  }

  if (/\bPriority(?:\s*\((?:Advanced|Limited)\))?\b/i.test(input.range)) {
    return 'priority'
  }
  if (/\bInterrupt\b/i.test(input.range)) return 'interrupt'
  if (/\bReaction\b/i.test(input.range)) return 'reaction'
  return 'ordinary'
}
