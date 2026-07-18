import type { MoveAutomationRollModifier } from '#shared/moveAutomation/random'
import type { AuthoritativeMoveRulesContext } from './context'
import type { BattlefieldSmokeAccuracyResolution } from './barriersAndSmoke'
import type { MoveAutomationLineOfSightResult } from './lineOfSight'
import { moveAutomationUserAccuracy } from '~/utils/moveAutomationAccuracy'
import {
  HELPING_HAND_ACCURACY_BONUS,
  activeHelpingHandBonusEffects,
  withoutHelpingHandCondition,
} from './helpingHand'

export interface AuthoritativeMoveSightAccuracyResolution {
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly baseValue: number
  readonly value: number
  readonly modifierTotal: number
  readonly modifiers: readonly MoveAutomationRollModifier[]
  readonly lineOfSight: MoveAutomationLineOfSightResult
  readonly smoke: BattlefieldSmokeAccuracyResolution
}

export interface AuthoritativeMoveUserAccuracyResolution {
  readonly value: number
  readonly heldItemEffectsSuppressed: boolean
  readonly gravityBonus: number
  readonly modifiers: readonly MoveAutomationRollModifier[]
  readonly sight: AuthoritativeMoveSightAccuracyResolution | null
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/** Resolve target-specific Rough Terrain/Barrier cover and Smokescreen modifiers. */
export const resolveAuthoritativeMoveSightAccuracy = (
  context: AuthoritativeMoveRulesContext,
  targetPlacementId: string,
  baseValue: number,
): AuthoritativeMoveSightAccuracyResolution => {
  const sourcePlacementId = context.actor.placement.id
  const lineOfSight = context.queries.lineOfSight.resolve(
    sourcePlacementId,
    targetPlacementId,
  )
  const coverModifier: MoveAutomationRollModifier[] = lineOfSight.accuracyModifier === 0
    ? []
    : [{
        sourceId: lineOfSight.coverZoneIds[0]
          ?? lineOfSight.coverPlacementIds[0]
          ?? `rough-terrain:${sourcePlacementId}:${targetPlacementId}`,
        reason: lineOfSight.coverZoneIds.length > 0
          ? 'Barrier cover'
          : 'Rough Terrain cover',
        value: lineOfSight.accuracyModifier,
      }]
  const afterCover = baseValue + lineOfSight.accuracyModifier
  const smoke = context.queries.barriersAndSmoke.accuracy({
    sourcePlacementId,
    target: { kind: 'placement', placementId: targetPlacementId },
    baseValue: afterCover,
  })
  const modifiers = [...coverModifier, ...smoke.modifiers]
  return deepFreeze({
    sourcePlacementId,
    targetPlacementId,
    baseValue,
    value: smoke.value,
    modifierTotal: smoke.value - baseValue,
    modifiers,
    lineOfSight,
    smoke,
  })
}

/**
 * Compose actor-owned Accuracy with authoritative Magic Room, Gravity, cover,
 * and smoke queries. Browser field state cannot provide any modifier here.
 */
export const resolveAuthoritativeMoveUserAccuracy = (
  context: AuthoritativeMoveRulesContext,
  options: { readonly targetPlacementId?: string } = {},
): AuthoritativeMoveUserAccuracyResolution => {
  const heldItemEffectsSuppressed = context.actor.placement.sheetKind === 'pokemon'
    && context.queries.itemEffects.resolve({
      placementId: context.actor.placement.id,
      scope: 'pokemon-held',
      timing: 'static',
    }).suppressed
  const helpingHand = activeHelpingHandBonusEffects({
    map: context.map,
    placementId: context.actor.placement.id,
  })
  const actorAccuracy = moveAutomationUserAccuracy(
    helpingHand.length > 0
      ? withoutHelpingHandCondition(context.actor.token)
      : context.actor.token,
    {
      heldItemEffectsSuppressed,
      // Gravity is composed below from the authoritative global-field query.
      // Keep the retained browser/legacy compatibility projection out of v2.
      fieldAccuracyBonus: 0,
    },
  )
  const gravity = context.queries.gravity.accuracy()
  const modifiers: MoveAutomationRollModifier[] = [{
    sourceId: 'actor-accuracy',
    reason: 'Actor Accuracy',
    value: actorAccuracy,
  }]
  if (helpingHand[0]) {
    modifiers.push({
      sourceId: helpingHand[0].id,
      reason: 'Helping Hand Accuracy',
      value: HELPING_HAND_ACCURACY_BONUS,
    })
  }
  if (gravity.bonus !== 0 && gravity.source) {
    modifiers.push({
      sourceId: gravity.source.zoneId,
      reason: 'Gravity Accuracy',
      value: gravity.bonus,
    })
  }
  const baseValue = actorAccuracy
    + (helpingHand.length > 0 ? HELPING_HAND_ACCURACY_BONUS : 0)
    + gravity.bonus
  const sight = options.targetPlacementId
    ? resolveAuthoritativeMoveSightAccuracy(context, options.targetPlacementId, baseValue)
    : null
  modifiers.push(...(sight?.modifiers ?? []))
  return deepFreeze({
    value: sight?.value ?? baseValue,
    heldItemEffectsSuppressed,
    gravityBonus: gravity.bonus,
    modifiers,
    sight,
  })
}
