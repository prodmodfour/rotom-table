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
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { aa060MoveAccuracyBonus } from '../abilityAutomation/mechanics/aa060MoveIntegration'
import { applyEncounterNumericModifiers } from './encounterNumericModifiers'
import { aa071MoveAccuracyModifiers } from '../abilityAutomation/mechanics/aa071StaticIntegration'
import {
  aa074HungerSwitchAccuracyModifier,
  aa074HustleAccuracyModifier,
} from '../abilityAutomation/mechanics/aa074StaticIntegration'
import { aa075IlluminateAccuracyModifier } from '../abilityAutomation/mechanics/aa075StaticIntegration'
import {
  aa076KeenEyeActive,
  aa076TokenWithEffectiveKeenEye,
} from '../abilityAutomation/mechanics/aa076StaticIntegration'

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
  options: { readonly ignoreAccuracyPenalties?: boolean } = {},
): AuthoritativeMoveSightAccuracyResolution => {
  const sourcePlacementId = context.actor.placement.id
  const lineOfSight = context.queries.lineOfSight.resolve(
    sourcePlacementId,
    targetPlacementId,
  )
  const effectiveCoverModifier = options.ignoreAccuracyPenalties
    ? Math.max(0, lineOfSight.accuracyModifier)
    : lineOfSight.accuracyModifier
  const coverModifier: MoveAutomationRollModifier[] = effectiveCoverModifier === 0
    ? []
    : [{
        sourceId: lineOfSight.coverZoneIds[0]
          ?? lineOfSight.coverPlacementIds[0]
          ?? `rough-terrain:${sourcePlacementId}:${targetPlacementId}`,
        reason: lineOfSight.coverZoneIds.length > 0
          ? 'Barrier cover'
          : 'Rough Terrain cover',
        value: effectiveCoverModifier,
      }]
  const afterCover = baseValue + effectiveCoverModifier
  const rawSmoke = context.queries.barriersAndSmoke.accuracy({
    sourcePlacementId,
    target: { kind: 'placement', placementId: targetPlacementId },
    baseValue: afterCover,
  })
  const smokeModifiers = options.ignoreAccuracyPenalties
    ? rawSmoke.modifiers.filter(modifier => modifier.value >= 0)
    : rawSmoke.modifiers
  const appliedSmokeSourceIds = new Set(smokeModifiers.map(modifier => modifier.sourceId))
  const ignoredSmokeZoneIds = options.ignoreAccuracyPenalties
    ? new Set(rawSmoke.affectingZoneIds.filter(zoneId => !appliedSmokeSourceIds.has(zoneId)))
    : new Set<string>()
  const smokeValue = afterCover + smokeModifiers.reduce((total, modifier) => total + modifier.value, 0)
  const smoke: BattlefieldSmokeAccuracyResolution = {
    ...rawSmoke,
    baseValue: afterCover,
    value: smokeValue,
    modifierTotal: smokeValue - afterCover,
    affectingZoneIds: rawSmoke.affectingZoneIds.filter(zoneId => !ignoredSmokeZoneIds.has(zoneId)),
    modifiers: smokeModifiers,
    trace: rawSmoke.trace.map(entry => ignoredSmokeZoneIds.has(entry.zoneId)
      && entry.outcome !== 'outside-zone'
      ? {
          ...entry,
          outcome: 'superseded' as const,
          reasonCode: 'ability.keen-eye.accuracy-penalty-ignored',
          value: null,
        }
      : entry),
  }
  const modifiers = [...coverModifier, ...smokeModifiers]
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
  options: { readonly targetPlacementId?: string; readonly script?: MoveAutomationScript } = {},
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
  const compoundEyesActive = context.queries.abilities.has(context.actor.placement.id, 'Compound Eyes')
  const actorToken = aa076TokenWithEffectiveKeenEye({
    context,
    token: helpingHand.length > 0
      ? withoutHelpingHandCondition(context.actor.token)
      : context.actor.token,
  })
  const keenEye = aa076KeenEyeActive(context)
  const actorAccuracy = moveAutomationUserAccuracy(
    {
      ...actorToken,
      abilityNames: actorToken.abilityNames?.filter(name => name !== 'Compound Eyes'),
    },
    {
      heldItemEffectsSuppressed,
      // Gravity is composed below from the authoritative global-field query.
      // Keep the retained browser/legacy compatibility projection out of v2.
      fieldAccuracyBonus: 0,
    },
  )
  const gravity = context.queries.gravity.accuracy()
  const compoundEyesBonus = compoundEyesActive ? 3 : 0
  const modifiers: MoveAutomationRollModifier[] = [{
    sourceId: 'actor-accuracy',
    reason: 'Actor Accuracy',
    value: actorAccuracy,
  }]
  if (compoundEyesBonus !== 0) {
    modifiers.push({
      sourceId: 'ability.compound-eyes',
      reason: 'Compound Eyes Accuracy',
      value: compoundEyesBonus,
    })
  }
  if (helpingHand[0]) {
    modifiers.push({
      sourceId: helpingHand[0].id,
      reason: 'Helping Hand Accuracy',
      value: HELPING_HAND_ACCURACY_BONUS,
    })
  }
  const aa060Bonus = options.script ? aa060MoveAccuracyBonus(context, options.script) : 0
  if (aa060Bonus !== 0) {
    modifiers.push({
      sourceId: 'ability.accelerate',
      reason: 'Accelerate Accuracy',
      value: aa060Bonus,
    })
  }
  if (gravity.bonus !== 0 && gravity.source) {
    modifiers.push({
      sourceId: gravity.source.zoneId,
      reason: 'Gravity Accuracy',
      value: gravity.bonus,
    })
  }
  const aa071Modifiers = (options.script ? aa071MoveAccuracyModifiers({
    context,
    script: options.script,
    ...(options.targetPlacementId ? { targetPlacementId: options.targetPlacementId } : {}),
  }) : []).filter(modifier => !keenEye || modifier.value >= 0)
  modifiers.push(...aa071Modifiers)
  const hustleModifier = keenEye ? 0 : aa074HustleAccuracyModifier({
    context,
    placementId: context.actor.placement.id,
  })
  if (hustleModifier !== 0) {
    modifiers.push({
      sourceId: 'ability.hustle',
      reason: 'Hustle Accuracy',
      value: hustleModifier,
    })
  }
  const hungerSwitchModifier = aa074HungerSwitchAccuracyModifier({
    context,
    placementId: context.actor.placement.id,
  })
  if (hungerSwitchModifier !== 0) {
    modifiers.push({
      sourceId: 'ability.hunger-switch',
      reason: 'Hunger Switch Accuracy',
      value: hungerSwitchModifier,
    })
  }
  const illuminateModifier = keenEye ? 0 : aa075IlluminateAccuracyModifier({
    context,
    ...(options.targetPlacementId ? { targetPlacementId: options.targetPlacementId } : {}),
  })
  if (illuminateModifier !== 0) {
    modifiers.push({
      sourceId: 'ability.illuminate',
      reason: 'Illuminate Accuracy',
      value: illuminateModifier,
    })
  }
  const preEncounterValue = actorAccuracy
    + compoundEyesBonus
    + (helpingHand.length > 0 ? HELPING_HAND_ACCURACY_BONUS : 0)
    + aa060Bonus
    + gravity.bonus
    + aa071Modifiers.reduce((total, modifier) => total + modifier.value, 0)
    + hustleModifier
    + hungerSwitchModifier
    + illuminateModifier
  const encounterAccuracy = applyEncounterNumericModifiers({
    map: context.map,
    placementId: context.actor.placement.id,
    attribute: 'accuracy',
    baseValue: preEncounterValue,
    changePolicy: keenEye ? 'non-decreasing' : 'all',
  })
  modifiers.push(...encounterAccuracy.steps.map(step => ({
    sourceId: step.effectId,
    reason: step.reason,
    value: step.delta,
  })))
  const baseValue = encounterAccuracy.value
  const sight = options.targetPlacementId
    ? resolveAuthoritativeMoveSightAccuracy(
        context,
        options.targetPlacementId,
        baseValue,
        { ignoreAccuracyPenalties: keenEye },
      )
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
