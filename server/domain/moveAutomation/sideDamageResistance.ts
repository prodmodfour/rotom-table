import {
  createEmptyEncounterState,
  encounterStateHasSide,
  parseEncounterState,
  type EncounterSideDirectory,
  type EncounterSideId,
} from '#shared/moveAutomation/encounterState'
import type {
  EncounterEffect,
  EncounterEffectNumericDamageClass,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { MoveSpecPhase } from '#shared/moveAutomation/spec'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { resistMultiplierOneStepFurther } from '~/utils/typeChart'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'
import { reduceMoveResolutionTrace } from './trace'

export const SIDE_DAMAGE_RESISTANCE_REASON_CODES = Object.freeze({
  activated: 'side-damage-resistance.activated',
  chargeConsumed: 'side-damage-resistance.charge-consumed',
  classMismatch: 'side-damage-resistance.damage-class-mismatch',
  depleted: 'side-damage-resistance.charges-depleted',
  immune: 'side-damage-resistance.target-immune',
  suppressed: 'side-damage-resistance.effect-suppressed',
  responsiveActivationBlocked: 'side-damage-resistance.responsive-activation-blocked',
  unavailable: 'side-damage-resistance.unavailable',
  unknownSide: 'side-damage-resistance.target-side-unknown',
} as const)

export type SideDamageResistanceReasonCode = Exclude<
  (typeof SIDE_DAMAGE_RESISTANCE_REASON_CODES)[keyof typeof SIDE_DAMAGE_RESISTANCE_REASON_CODES],
  typeof SIDE_DAMAGE_RESISTANCE_REASON_CODES.chargeConsumed
>

export type SideDamageResistanceEvaluationStatus = 'activated' | 'not-applicable'

export interface SideDamageResistanceEvaluation {
  readonly damageOperationId: string
  readonly targetPlacementId: string
  readonly targetSideId: EncounterSideId | null
  readonly damageClass: 'physical' | 'special'
  readonly status: SideDamageResistanceEvaluationStatus
  readonly reasonCode: SideDamageResistanceReasonCode
  readonly effectId: string | null
  readonly resistanceSteps: number
  readonly previousMultiplier: number
  readonly adjustedMultiplier: number
  readonly chargeBefore: number | null
  readonly chargeAfter: number | null
}

export interface SideDamageResistanceResolution {
  readonly evaluations: readonly SideDamageResistanceEvaluation[]
  readonly activations: readonly SideDamageResistanceEvaluation[]
}

export interface SideDamageResistanceResolver {
  resolve(input: {
    readonly damageOperationId: string
    readonly targetPlacementId: string
    readonly damageClass: 'physical' | 'special'
    readonly effectivenessMultiplier: number
  }): SideDamageResistanceEvaluation
  snapshot(): SideDamageResistanceResolution | null
}

export type SideDamageResistanceErrorCode =
  | 'duplicate-damage-event'
  | 'invalid-consumption'

export class SideDamageResistanceError extends Error {
  readonly code: SideDamageResistanceErrorCode

  constructor(code: SideDamageResistanceErrorCode, message: string) {
    super(message)
    this.name = 'SideDamageResistanceError'
    this.code = code
  }
}

const fail = (code: SideDamageResistanceErrorCode, message: string): never => {
  throw new SideDamageResistanceError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/** Typed side resistance used by Reflect and the later screen family. */
export const isSideDamageResistanceEffect = (
  effect: EncounterEffect,
): effect is EncounterNumericModifierEffect => (
  effect.kind === 'numeric-modifier'
  && effect.payload.attribute === 'damage-reduction'
  && effect.payload.operation === 'resist-step'
  && effect.payload.damageClass !== undefined
  && effect.affected.placementIds.length === 0
  && effect.affected.sideIds.length > 0
  && effect.affected.cells.length === 0
  && effect.charges !== null
  && effect.charges > 0
  && effect.chargePolicy.kind === 'consume-on-trigger'
  && effect.chargePolicy.amount === 1
)

const appliesToDamageClass = (
  effectClass: EncounterEffectNumericDamageClass,
  damageClass: 'physical' | 'special',
): boolean => effectClass === 'any' || effectClass === damageClass

const resistBySteps = (multiplier: number, steps: number): number => {
  let adjusted = multiplier
  for (let index = 0; index < steps; index += 1) {
    adjusted = resistMultiplierOneStepFurther(adjusted)
  }
  return adjusted
}

const placementSideDirectory = (input: {
  readonly placements: readonly Pick<SheetPlacement, 'id' | 'sideId'>[]
  readonly sides: EncounterSideDirectory
}): ReadonlyMap<string, EncounterSideId | null> => new Map(input.placements.map(placement => [
  placement.id,
  encounterStateHasSide({ sides: input.sides }, placement.sideId)
    ? placement.sideId
    : null,
]))

const frozenEvaluation = (
  value: SideDamageResistanceEvaluation,
): SideDamageResistanceEvaluation => deepFreeze({ ...value })

/**
 * Build one resolution-local activation ledger. Calls are idempotent by damage
 * operation and recipient; finite charges are reserved in authoritative call
 * order without mutating the encounter snapshot.
 */
export const createSideDamageResistanceResolver = (input: {
  readonly placements: readonly Pick<SheetPlacement, 'id' | 'sideId'>[]
  readonly sides: EncounterSideDirectory
  readonly effects: readonly EncounterEffect[]
  /** Exact Blessing effect IDs barred from responding to this acting creature. */
  readonly responsiveActivationBlockedEffectIds?: ReadonlySet<string>
}): SideDamageResistanceResolver => {
  const placementSides = placementSideDirectory(input)
  const effects = input.effects.filter(isSideDamageResistanceEffect)
  const remaining = new Map(effects.map(effect => [effect.id, effect.charges]))
  const evaluations: SideDamageResistanceEvaluation[] = []
  const byDamageEvent = new Map<string, {
    readonly input: Parameters<SideDamageResistanceResolver['resolve']>[0]
    readonly evaluation: SideDamageResistanceEvaluation
  }>()

  const notApplicable = (options: {
    readonly request: Parameters<SideDamageResistanceResolver['resolve']>[0]
    readonly targetSideId: EncounterSideId | null
    readonly reasonCode: SideDamageResistanceReasonCode
    readonly effect?: EncounterNumericModifierEffect
  }): SideDamageResistanceEvaluation => frozenEvaluation({
    damageOperationId: options.request.damageOperationId,
    targetPlacementId: options.request.targetPlacementId,
    targetSideId: options.targetSideId,
    damageClass: options.request.damageClass,
    status: 'not-applicable',
    reasonCode: options.reasonCode,
    effectId: options.effect?.id ?? null,
    resistanceSteps: 0,
    previousMultiplier: options.request.effectivenessMultiplier,
    adjustedMultiplier: options.request.effectivenessMultiplier,
    chargeBefore: options.effect ? remaining.get(options.effect.id) ?? null : null,
    chargeAfter: options.effect ? remaining.get(options.effect.id) ?? null : null,
  })

  const resolve: SideDamageResistanceResolver['resolve'] = (request) => {
    if (effects.length === 0) {
      const targetSideId = placementSides.get(request.targetPlacementId) ?? null
      return notApplicable({
        request,
        targetSideId,
        reasonCode: targetSideId === null
          ? SIDE_DAMAGE_RESISTANCE_REASON_CODES.unknownSide
          : SIDE_DAMAGE_RESISTANCE_REASON_CODES.unavailable,
      })
    }

    const eventKey = `${request.damageOperationId}\u0000${request.targetPlacementId}`
    const existing = byDamageEvent.get(eventKey)
    if (existing) {
      if (!sameJsonValue(existing.input, request)) {
        return fail(
          'duplicate-damage-event',
          `Damage event ${request.damageOperationId} for ${request.targetPlacementId} changed its authoritative inputs.`,
        )
      }
      return existing.evaluation
    }

    const targetSideId = placementSides.get(request.targetPlacementId) ?? null
    const sideEffects = targetSideId === null
      ? []
      : effects.filter(effect => effect.affected.sideIds.includes(targetSideId))
    const classEffects = sideEffects.filter(effect => appliesToDamageClass(
      effect.payload.damageClass!,
      request.damageClass,
    ))
    const activeClassEffects = classEffects.filter(
      effect => effect.suppression.sources.length === 0,
    )
    const responsiveClassEffects = activeClassEffects.filter(effect => (
      !input.responsiveActivationBlockedEffectIds?.has(effect.id)
    ))
    const available = responsiveClassEffects.find((effect) => {
      const charges = remaining.get(effect.id)
      return charges === null || (charges ?? 0) > 0
    })

    let evaluation: SideDamageResistanceEvaluation
    if (targetSideId === null) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.unknownSide,
      })
    }
    else if (sideEffects.length === 0) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.unavailable,
      })
    }
    else if (classEffects.length === 0) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.classMismatch,
        effect: sideEffects[0],
      })
    }
    else if (activeClassEffects.length === 0) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.suppressed,
        effect: classEffects[0],
      })
    }
    else if (responsiveClassEffects.length === 0) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.responsiveActivationBlocked,
        effect: activeClassEffects[0],
      })
    }
    else if (request.effectivenessMultiplier === 0) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.immune,
        effect: responsiveClassEffects[0],
      })
    }
    else if (!available) {
      evaluation = notApplicable({
        request,
        targetSideId,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.depleted,
        effect: activeClassEffects[0],
      })
    }
    else {
      const chargeBefore = remaining.get(available.id) ?? null
      const chargeAfter = chargeBefore === null ? null : chargeBefore - 1
      remaining.set(available.id, chargeAfter)
      const resistanceSteps = available.payload.value
      evaluation = frozenEvaluation({
        damageOperationId: request.damageOperationId,
        targetPlacementId: request.targetPlacementId,
        targetSideId,
        damageClass: request.damageClass,
        status: 'activated',
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.activated,
        effectId: available.id,
        resistanceSteps,
        previousMultiplier: request.effectivenessMultiplier,
        adjustedMultiplier: resistBySteps(request.effectivenessMultiplier, resistanceSteps),
        chargeBefore,
        chargeAfter,
      })
    }

    evaluations.push(evaluation)
    byDamageEvent.set(eventKey, { input: deepFreeze({ ...request }), evaluation })
    return evaluation
  }

  return Object.freeze({
    resolve,
    snapshot: (): SideDamageResistanceResolution | null => {
      if (effects.length === 0 || evaluations.length === 0) return null
      const frozenEvaluations = deepFreeze([...evaluations])
      return deepFreeze({
        evaluations: frozenEvaluations,
        activations: frozenEvaluations.filter(evaluation => evaluation.status === 'activated'),
      })
    },
  })
}

const activeTracePhase = (trace: MoveResolutionAuditTrace): MoveSpecPhase | null => {
  let phase: MoveSpecPhase | null = null
  for (const event of trace.events) {
    if (event.kind === 'phase-transition') phase = event.to
  }
  return phase
}

/** Add bounded activation, skipped, and planned charge-consumption evidence. */
export const appendSideDamageResistanceTrace = (
  trace: MoveResolutionAuditTrace,
  resolution: SideDamageResistanceResolution,
): MoveResolutionAuditTrace => {
  const phase = activeTracePhase(trace)
  if (phase === null) return trace
  return resolution.evaluations.reduce((current, evaluation, index) => {
    const ordinal = index + 1
    const activationTrace = reduceMoveResolutionTrace(current, {
      kind: 'predicate',
      phase,
      predicateId: `side-damage-resistance.${ordinal}.activation`,
      outcome: evaluation.status === 'activated',
      reasonCode: evaluation.reasonCode,
      input: evaluation as unknown as MoveResolutionTraceJsonValue,
    })
    if (evaluation.status !== 'activated') return activationTrace
    return reduceMoveResolutionTrace(activationTrace, {
      kind: 'predicate',
      phase,
      predicateId: `side-damage-resistance.${ordinal}.consumption`,
      outcome: true,
      reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.chargeConsumed,
      input: {
        damageOperationId: evaluation.damageOperationId,
        targetPlacementId: evaluation.targetPlacementId,
        effectId: evaluation.effectId,
        chargeBefore: evaluation.chargeBefore,
        chargeAfter: evaluation.chargeAfter,
      },
    })
  }, trace)
}

export interface SideDamageResistanceResolutionCarrier {
  readonly transaction: MoveAutomationTransaction
  readonly auditTrace: MoveResolutionAuditTrace
  readonly nativeV2?: {
    readonly trace?: MoveResolutionAuditTrace
  }
}

/** Attach server-only consumption evidence after every damage calculation finishes. */
export const attachSideDamageResistanceResolution = <
  Resolution extends SideDamageResistanceResolutionCarrier,
>(
  resolver: SideDamageResistanceResolver,
  resolution: Resolution,
): Resolution & { readonly sideDamageResistance?: SideDamageResistanceResolution } => {
  const sideDamageResistance = resolver.snapshot()
  if (!sideDamageResistance) return resolution
  const auditTrace = appendSideDamageResistanceTrace(
    resolution.auditTrace,
    sideDamageResistance,
  )
  return Object.freeze({
    ...resolution,
    auditTrace,
    ...(resolution.nativeV2
      ? { nativeV2: Object.freeze({ ...resolution.nativeV2, trace: auditTrace }) }
      : {}),
    sideDamageResistance,
  })
}

export interface SideDamageResistanceConsumptionResult {
  readonly map: TabletopMap
  readonly changed: boolean
  readonly consumedEffectIds: readonly string[]
}

/** Consume every reserved activation through the generic effect lifecycle reducer. */
export const consumeSideDamageResistance = (input: {
  readonly map: TabletopMap
  readonly resolution?: SideDamageResistanceResolution
}): SideDamageResistanceConsumptionResult => {
  const activations = input.resolution?.activations ?? []
  if (activations.length === 0) {
    return Object.freeze({ map: input.map, changed: false, consumedEffectIds: [] })
  }

  const map = deepCloneJson(input.map)
  let encounterState = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const placementSides = placementSideDirectory({
    placements: map.placements,
    sides: encounterState.sides,
  })
  const consumedEffectIds: string[] = []

  for (const activation of activations) {
    if (!activation.effectId || activation.targetSideId === null) {
      return fail('invalid-consumption', 'Activated side resistance lost its effect or side identity.')
    }
    const effect = encounterState.effects.find(candidate => candidate.id === activation.effectId)
    const currentSide = placementSides.get(activation.targetPlacementId) ?? null
    if (
      !effect
      || !isSideDamageResistanceEffect(effect)
      || currentSide !== activation.targetSideId
      || !effect.affected.sideIds.includes(activation.targetSideId)
      || !appliesToDamageClass(effect.payload.damageClass!, activation.damageClass)
      || effect.payload.value !== activation.resistanceSteps
      || effect.suppression.sources.length > 0
      || effect.charges !== activation.chargeBefore
      || resistBySteps(activation.previousMultiplier, activation.resistanceSteps)
        !== activation.adjustedMultiplier
    ) {
      return fail(
        'invalid-consumption',
        `Side resistance activation ${activation.damageOperationId} no longer matches its authoritative effect.`,
      )
    }
    const transition = applyEncounterEffectLifecycleEvent(
      { effects: encounterState.effects },
      { kind: 'effect-triggered', effectId: effect.id },
    )
    const transitionedEffect = transition.effects.find(candidate => candidate.id === effect.id)
    const actualChargeAfter = transitionedEffect?.charges ?? 0
    if (!transition.changed || actualChargeAfter !== (activation.chargeAfter ?? 0)) {
      return fail(
        'invalid-consumption',
        `Side resistance effect ${effect.id} could not consume its reserved activation.`,
      )
    }
    encounterState = parseEncounterState({
      ...encounterState,
      effects: transition.effects,
    })
    consumedEffectIds.push(effect.id)
  }

  map.encounterState = encounterState
  return Object.freeze({
    map,
    changed: true,
    consumedEffectIds: Object.freeze(consumedEffectIds),
  })
}
