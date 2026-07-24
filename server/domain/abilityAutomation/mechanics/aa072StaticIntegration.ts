import {
  AA072_GLUTTONY_FOOD_BUFF_CAPACITY,
  AA072_GLUTTONY_FOOD_BUFF_USES_PER_SCENE,
  AA072_GLUTTONY_REFRESHMENTS_PER_HALF_HOUR,
  AA072_GORILLA_LOCK_CAPABILITY,
} from '#shared/abilityAutomation/aa072'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import { aa071ResistDamageType } from './aa071StaticIntegration'

const activeEffect = (effect: EncounterEffect): boolean => (
  effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)

export const aa072FurCoatDamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly damageClass: string
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  if (input.damageClass.trim().toLowerCase() !== 'physical'
    || !input.context.queries.abilities.has(input.recipientId, 'Fur Coat')) return input.resolved
  return aa071ResistDamageType({
    resolved: input.resolved,
    steps: 1,
    sources: ['Fur Coat'],
  })
}

export interface Aa072GluttonyLimits {
  readonly foodBuffCapacity: number
  readonly foodBuffUsesPerScene: number
  readonly refreshmentsPerHalfHour: number
}
export const aa072GluttonyLimits = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): Aa072GluttonyLimits => input.context.queries.abilities.has(input.placementId, 'Gluttony')
  ? Object.freeze({
      foodBuffCapacity: AA072_GLUTTONY_FOOD_BUFF_CAPACITY,
      foodBuffUsesPerScene: AA072_GLUTTONY_FOOD_BUFF_USES_PER_SCENE,
      refreshmentsPerHalfHour: AA072_GLUTTONY_REFRESHMENTS_PER_HALF_HOUR,
    })
  : Object.freeze({ foodBuffCapacity: 1, foodBuffUsesPerScene: 1, refreshmentsPerHalfHour: 1 })

export const aa072GorillaTacticsLockActive = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): boolean => (input.context.map.encounterState?.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && activeEffect(effect)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA072_GORILLA_LOCK_CAPABILITY
  && effect.affected.placementIds.includes(input.placementId)
))

export const aa072GorillaTacticsMoveAllowed = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
  readonly canonicalMoveId: string
}): boolean => {
  const restrictions = (input.context.map.encounterState?.effects ?? []).filter(effect => (
    effect.kind === 'move-list-overlay'
    && activeEffect(effect)
    && effect.payload.action === 'restrict'
    && effect.tags.includes('gorilla-tactics')
    && effect.affected.placementIds.includes(input.placementId)
  ))
  return restrictions.every(effect => (
    effect.kind === 'move-list-overlay'
    && effect.payload.action === 'restrict'
    && effect.payload.canonicalMoveIds.includes(input.canonicalMoveId)
  ))
}
