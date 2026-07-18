import type {
  EncounterEffect,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import { isSideDamageResistanceEffect } from './sideDamageResistance'

export const REFLECT_MOVE_SOURCE_ID = 'move.reflect' as const
export const REFLECT_OPERATION_ID = 'reflect.apply-side-blessing' as const
export const REFLECT_EFFECT_BASE_ID = 'reflect.blessing' as const
export const REFLECT_ACTIVATIONS = 2 as const
export const REFLECT_RESISTANCE_STEPS = 1 as const

/** Match only the reviewed side-owned physical resistance emitted by Reflect. */
export const isReflectSideEffect = (
  effect: EncounterEffect,
): effect is EncounterNumericModifierEffect => (
  isSideDamageResistanceEffect(effect)
  && effect.source.moveId === REFLECT_MOVE_SOURCE_ID
  && effect.source.operationId === REFLECT_OPERATION_ID
  && effect.id.startsWith(`${REFLECT_EFFECT_BASE_ID}.`)
  && effect.affected.sideIds.length === 1
  && effect.duration.kind === 'scene'
  && effect.stacks === 1
  && (effect.charges === 1 || effect.charges === REFLECT_ACTIVATIONS)
  && effect.stackPolicy.kind === 'replace'
  && effect.chargePolicy.kind === 'consume-on-trigger'
  && effect.chargePolicy.amount === 1
  && effect.payload.damageClass === 'physical'
  && effect.payload.value === REFLECT_RESISTANCE_STEPS
  && (effect.transferPolicy ?? 'retain') === 'retain'
)
