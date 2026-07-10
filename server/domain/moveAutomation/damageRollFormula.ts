import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import { findMoveDamageBase } from '~/utils/moveDamageBase'
import type { AuthoritativeMoveRulesContext } from './context'
import {
  MOVE_CONTEXTUAL_DAMAGE_BASE_STAB_BONUS,
  resolveContextualMoveDamageBase,
  type MoveContextualDamageBaseResolution,
} from './damageBase'
import type { MoveDamageTypeResolution } from './damageTypes'

export interface MoveSpecDamageRollFormula {
  readonly count: number
  readonly sides: number
  readonly modifier: number
  readonly contextualDamageBase: MoveContextualDamageBaseResolution | null
}

/** Resolve one recipient's reviewed DB into its canonical bounded dice formula. */
export const resolveMoveSpecDamageRollFormula = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly canonicalMoveId: string
  readonly resolvedType: MoveDamageTypeResolution
  readonly failUnsupported: (message: string) => never
}): MoveSpecDamageRollFormula => {
  if (typeof options.operation.payload.damageBase !== 'number') {
    const contextualDamageBase = resolveContextualMoveDamageBase({
      context: options.context,
      operation: options.operation,
      recipientId: options.recipientId,
      hasStab: options.resolvedType.hasStab,
      canonicalMoveId: options.canonicalMoveId,
    })
    const definition = findMoveDamageBase(contextualDamageBase.finalDamageBase)
      ?? options.failUnsupported(
        `Damage operation ${options.operation.id} resolved unsupported DB ${contextualDamageBase.finalDamageBase} for ${options.recipientId}.`,
      )
    return {
      count: definition.count,
      sides: definition.sides,
      modifier: definition.mod,
      contextualDamageBase,
    }
  }

  const finalDamageBase = options.operation.payload.damageBase
    + (options.resolvedType.hasStab ? MOVE_CONTEXTUAL_DAMAGE_BASE_STAB_BONUS : 0)
  const definition = findMoveDamageBase(finalDamageBase)
    ?? options.failUnsupported(
      `Damage operation ${options.operation.id} resolved unsupported DB ${finalDamageBase} for ${options.recipientId}.`,
    )
  return {
    count: definition.count,
    sides: definition.sides,
    modifier: definition.mod,
    contextualDamageBase: null,
  }
}
