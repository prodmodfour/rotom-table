import type { MoveAutomationRollModifier } from '#shared/moveAutomation/random'
import type { AuthoritativeMoveRulesContext } from './context'
import { moveAutomationUserAccuracy } from '~/utils/moveAutomationAccuracy'

export interface AuthoritativeMoveUserAccuracyResolution {
  readonly value: number
  readonly heldItemEffectsSuppressed: boolean
  readonly gravityBonus: number
  readonly modifiers: readonly MoveAutomationRollModifier[]
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/**
 * Compose actor-owned Accuracy with authoritative Magic Room and Gravity
 * queries. Browser field state cannot provide either modifier at this boundary.
 */
export const resolveAuthoritativeMoveUserAccuracy = (
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMoveUserAccuracyResolution => {
  const heldItemEffectsSuppressed = context.actor.placement.sheetKind === 'pokemon'
    && context.queries.itemEffects.resolve({
      placementId: context.actor.placement.id,
      scope: 'pokemon-held',
      timing: 'static',
    }).suppressed
  const actorAccuracy = moveAutomationUserAccuracy(context.actor.token, {
    heldItemEffectsSuppressed,
    // Gravity is composed below from the authoritative global-field query.
    // Keep the retained browser/legacy compatibility projection out of v2.
    fieldAccuracyBonus: 0,
  })
  const gravity = context.queries.gravity.accuracy()
  const modifiers: MoveAutomationRollModifier[] = [{
    sourceId: 'actor-accuracy',
    reason: 'Actor Accuracy',
    value: actorAccuracy,
  }]
  if (gravity.bonus !== 0 && gravity.source) {
    modifiers.push({
      sourceId: gravity.source.zoneId,
      reason: 'Gravity Accuracy',
      value: gravity.bonus,
    })
  }
  return deepFreeze({
    value: actorAccuracy + gravity.bonus,
    heldItemEffectsSuppressed,
    gravityBonus: gravity.bonus,
    modifiers,
  })
}
