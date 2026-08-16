import type {
  MoveCriticalHitPolicy,
  MoveCriticalHitTrigger,
  MoveDamageEffectOperation,
} from '#shared/moveAutomation/effects'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { aa077LancerCriticalRangeBonus } from '../abilityAutomation/mechanics/aa077StaticIntegration'
import { aa079MercilessForcesCritical } from '../abilityAutomation/mechanics/aa079StaticIntegration'
import { trainerBadMoodCriticalRangeBonus } from '../edgeAutomation/trainerCombat'
import type { TrainerSheet } from '~/types/trainerSheet'
import { itemCriticalRangeBonus } from '../itemAutomation/combatEffects'

export const CRITICAL_HIT_PREVENTING_ABILITIES = Object.freeze([
  'Battle Armor',
  'Shell Armor',
] as const)

export type MoveCriticalHitResolutionErrorCode =
  | 'critical-target-unavailable'
  | 'invalid-critical-natural-roll'

export class MoveCriticalHitResolutionError extends Error {
  readonly code: MoveCriticalHitResolutionErrorCode
  readonly operationId: string
  readonly recipientId: string

  constructor(
    code: MoveCriticalHitResolutionErrorCode,
    operationId: string,
    recipientId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MoveCriticalHitResolutionError'
    this.code = code
    this.operationId = operationId
    this.recipientId = recipientId
  }
}

export interface MoveCriticalHitResolution {
  readonly operationId: string
  readonly recipientId: string
  readonly trigger: MoveCriticalHitTrigger
  readonly triggerSource: 'canonical' | 'operation' | 'ability' | 'item'
  readonly naturalRoll: number | null
  readonly candidate: boolean
  readonly preventionPolicy: MoveCriticalHitPolicy['prevention']
  readonly preventedBy: string | null
  readonly critical: boolean
  readonly reasonCode:
    | 'critical-hit'
    | 'critical-prevented'
    | 'critical-trigger-not-met'
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const fail = (
  code: MoveCriticalHitResolutionErrorCode,
  operation: MoveDamageEffectOperation,
  recipientId: string,
  message: string,
): never => {
  throw new MoveCriticalHitResolutionError(code, operation.id, recipientId, message)
}

const canonicalCriticalMinimum = (
  script: Pick<MoveAutomationScript, 'damaging' | 'directHpLoss' | 'criticalRange'>,
): number | null => script.criticalRange
  ?? (script.damaging && !script.directHpLoss ? 20 : null)

const canonicalTrigger = (
  script: Pick<MoveAutomationScript, 'damaging' | 'directHpLoss' | 'criticalRange'>,
): MoveCriticalHitTrigger => {
  const minimum = canonicalCriticalMinimum(script)
  return minimum === null ? { kind: 'never' } : { kind: 'range', minimum }
}

const criticalCandidate = (
  trigger: MoveCriticalHitTrigger,
  naturalRoll: number | null,
  legacyCritical: boolean,
): boolean => {
  if (trigger.kind === 'always') return true
  if (trigger.kind === 'never') return false
  if (trigger.kind === 'standard') return legacyCritical
  if (trigger.kind === 'range') {
    return naturalRoll === null ? legacyCritical : naturalRoll >= trigger.minimum
  }
  return naturalRoll === null ? legacyCritical : trigger.values.includes(naturalRoll)
}

const preventingAbility = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): string | null => CRITICAL_HIT_PREVENTING_ABILITIES.find(ability => (
  context.queries.abilities.has(placementId, ability)
)) ?? null

/** Resolve one target's critical trigger from a natural server roll and target prevention state. */
export const resolveMoveCriticalHit = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'damaging' | 'directHpLoss' | 'criticalRange' | 'targetMode' | 'range'>
  readonly recipientId: string
  readonly naturalRoll: number | null
  /** Compatibility fallback for direct kernel callers that do not expose the natural roll. */
  readonly legacyCritical?: boolean
}): MoveCriticalHitResolution => {
  const placement = options.context.queries.placements.get(options.recipientId)
  const target = options.context.queries.tokens.get(options.recipientId)
  if (!placement || !target) {
    return fail(
      'critical-target-unavailable',
      options.operation,
      options.recipientId,
      `Critical-hit recipient ${options.recipientId} is unavailable.`,
    )
  }
  if (
    options.naturalRoll !== null
    && (!Number.isSafeInteger(options.naturalRoll)
      || options.naturalRoll < 1
      || options.naturalRoll > 20)
  ) {
    return fail(
      'invalid-critical-natural-roll',
      options.operation,
      options.recipientId,
      'Critical-hit natural roll must be an integer from 1 through 20.',
    )
  }
  options.context.reads.recordPlacement(placement)

  const authoredPolicy = options.operation.payload.criticalHit
  const merciless = aa079MercilessForcesCritical({
    context: options.context,
    recipientId: options.recipientId,
    damaging: options.script.damaging && !options.script.directHpLoss,
  })
  const baseTrigger = merciless
    ? { kind: 'always' as const }
    : authoredPolicy?.trigger.kind === 'standard'
      ? canonicalTrigger(options.script)
      : authoredPolicy?.trigger ?? canonicalTrigger(options.script)
  const beamCannon = options.context.queries.abilities.has(options.context.actor.placement.id, 'Beam Cannon')
    && options.script.targetMode === 'one-target'
    && !options.script.range.toLowerCase().includes('melee')
  const lancerBonus = aa077LancerCriticalRangeBonus({
    context: options.context,
    placementId: options.context.actor.placement.id,
  })
  const actorId = options.context.actor.placement.id
  const equipmentCriticalRangeBonus = options.context.queries.equipment.metric({
    placementId: actorId,
    metric: 'critical-range',
    targetId: 'all',
    base: 0,
  })?.final ?? 0
  const rareLeekMasteryBonus = options.context.queries.abilities.has(actorId, 'Leek Mastery')
    && options.context.queries.targetStates.resolve(actorId)?.itemIds.includes('rare-leek') === true
    && !options.context.queries.itemEffects.resolve({
      placementId: actorId,
      scope: 'pokemon-held',
      timing: 'static',
    }).suppressed
    ? 2
    : 0
  const razorEdgeBonus = options.context.queries.abilities.has(actorId, 'Razor Edge')
    ? /(?:^|\s)tail(?:\s|$)/i.test(options.script.moveName) ? 3 : 2
    : 0
  const superLuckBonus = options.context.queries.abilities.has(actorId, 'Super Luck') ? 2 : 0
  const viciousBonus = options.context.map.encounterState?.effects.some(effect => (
    effect.kind === 'capability'
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === 'aa097.vicious.critical-range-plus-two'
    && effect.tags.includes('aa097-vicious-critical')
    && effect.source.placementId === actorId
    && effect.affected.placementIds.includes(actorId)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  )) ? 2 : 0
  const direHitBonus = itemCriticalRangeBonus({
    effects: options.context.map.encounterState?.effects,
    placementId: actorId,
  })
  const badMoodBonus = options.context.actor.placement.sheetKind === 'trainer'
    ? trainerBadMoodCriticalRangeBonus(
        options.context.actor.sheet.sheet as TrainerSheet,
        options.context.actor.token.conditions ?? [],
      )
    : 0
  const trigger: MoveCriticalHitTrigger = baseTrigger.kind === 'range'
    ? {
        ...baseTrigger,
        minimum: Math.max(
          1,
          baseTrigger.minimum - (beamCannon ? 3 : 0) - lancerBonus - equipmentCriticalRangeBonus
            - rareLeekMasteryBonus - razorEdgeBonus - superLuckBonus - viciousBonus - direHitBonus - badMoodBonus,
        ),
      }
    : baseTrigger
  const candidate = criticalCandidate(
    trigger,
    options.naturalRoll,
    options.legacyCritical ?? false,
  )
  const preventionPolicy = merciless ? 'honor' : authoredPolicy?.prevention ?? 'honor'
  const preventedBy = candidate && preventionPolicy === 'honor'
    ? preventingAbility(options.context, options.recipientId)
    : null
  const critical = candidate && preventedBy === null

  return deepFreeze({
    operationId: options.operation.id,
    recipientId: options.recipientId,
    trigger,
    triggerSource: merciless ? 'ability'
      : authoredPolicy ? 'operation'
        : direHitBonus > 0 || equipmentCriticalRangeBonus > 0 || rareLeekMasteryBonus > 0 ? 'item'
          : 'canonical',
    naturalRoll: options.naturalRoll,
    candidate,
    preventionPolicy,
    preventedBy,
    critical,
    reasonCode: critical
      ? 'critical-hit'
      : preventedBy
        ? 'critical-prevented'
        : 'critical-trigger-not-met',
  })
}
