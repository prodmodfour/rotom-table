import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveDamageEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectRoundingPolicy,
  type MoveHealEffectOperation,
  type MoveHpCalculation,
  type MoveHpFinalBounds,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import {
  normalizeTemporaryHpAmount,
} from '~/utils/mapTemporaryHitPoints'
import type { MoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import { moveAutomationRecoilImmunitySource } from '~/utils/moveAutomationRecoil'
import type { AuthoritativeMoveRulesContext } from '../context'
import { authoritativeAbilityHealingBlocked } from '../../abilityAutomation/healingPrevention'
import {
  evaluateMoveExpression,
  evaluateMoveSelector,
  type MoveRuleEvaluationTraceEntry,
  type MoveRuleSelectorState,
} from '../evaluateExpression'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type {
  MoveCoreHpStateSnapshot,
  MoveCoreTokenDamageQuery,
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperationResult,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

interface MoveHpDamageSourceRecipientResolution {
  readonly recipientId: string
  readonly outcome: MoveCoreTokenEffectRecipientResult['outcome']
  readonly effectiveHpLost: number
  readonly prevented: boolean
}

interface MoveHpDamageSourceResolution {
  readonly operationId: string
  readonly aggregation: 'per-target' | 'aggregate'
  readonly percent: number
  readonly preventedDamage: 'zero'
  readonly totalEffectiveHpLost: number
  readonly recipients: readonly MoveHpDamageSourceRecipientResolution[]
}

interface MoveHpLossSourceRecipientResolution {
  readonly recipientId: string
  readonly outcome: MoveCoreTokenEffectRecipientResult['outcome']
  readonly hpLost: number
  readonly prevented: boolean
}

interface MoveHpLossSourceResolution {
  readonly operationId: string
  readonly pool: 'hit-points' | 'temporary-hit-points'
  readonly aggregation: 'per-target' | 'aggregate'
  readonly percent: number
  readonly totalHpLost: number
  readonly recipients: readonly MoveHpLossSourceRecipientResolution[]
}

interface MoveHpCalculationResolution {
  readonly kind: MoveHpCalculation['kind'] | 'copy' | 'split' | 'swap' | 'full'
  readonly rawValue: number
  readonly roundedValue: number
  readonly basisValue: number | null
  readonly sourcePlacementId: string | null
  readonly damageSource: MoveHpDamageSourceResolution | null
  readonly hpLossSource: MoveHpLossSourceResolution | null
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

const wholeNonNegative = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
)

const hpSnapshot = (
  accumulator: MoveAutomationHpUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
): MoveCoreHpStateSnapshot => ({
  kind: 'hp',
  currentHp: accumulator.get(recipient.token),
  temporaryHp: accumulator.getTemporaryHp(recipient.token),
  injuries: accumulator.getInjuries(recipient.token),
  maxHp: accumulator.getMaxHp(recipient.token),
  fullMaxHp: recipient.token.fullMaxHp ?? accumulator.getMaxHp(recipient.token),
})

const snapshotsEqual = (
  previous: MoveCoreHpStateSnapshot,
  current: MoveCoreHpStateSnapshot,
): boolean => (
  previous.currentHp === current.currentHp
  && previous.temporaryHp === current.temporaryHp
  && previous.injuries === current.injuries
  && previous.maxHp === current.maxHp
  && previous.fullMaxHp === current.fullMaxHp
)

const changedHpFields = (
  previous: MoveCoreHpStateSnapshot,
  current: MoveCoreHpStateSnapshot,
): MoveCoreTokenEffectRecipientResult['changedFields'] => {
  const fields: Array<'hp' | 'temporaryHitPoints'> = []
  if (
    previous.currentHp !== current.currentHp
    || previous.injuries !== current.injuries
    || previous.maxHp !== current.maxHp
  ) fields.push('hp')
  if (previous.temporaryHp !== current.temporaryHp) fields.push('temporaryHitPoints')
  return fields
}

const noOpHpResult = (
  recipient: MoveCoreTokenEffectRecipient,
  snapshot: MoveCoreHpStateSnapshot,
  reasonCode: string,
  consultedPlacementIds: readonly string[] = [],
  details?: MoveCoreTokenEffectRecipientResult['details'],
): MoveCoreTokenEffectRecipientResult => ({
  recipientId: recipient.placement.id,
  outcome: 'no-op',
  reasonCode,
  blockers: [],
  ...(details === undefined ? {} : { details }),
  consultedPlacementIds,
  previous: snapshot,
  current: snapshot,
  changedFields: [],
})

const rounded = (value: number, policy: MoveEffectRoundingPolicy): number => {
  if (policy === 'ceil') return Math.ceil(value)
  if (policy === 'round') return Math.round(value)
  return Math.floor(value)
}

const poolValue = (
  snapshot: MoveCoreHpStateSnapshot,
  pool: 'hit-points' | 'temporary-hit-points',
): number => pool === 'hit-points' ? snapshot.currentHp : snapshot.temporaryHp

const selectorStateFor = (recipientId: string): MoveRuleSelectorState => ({
  targetIds: [recipientId],
  hitTargetIds: [recipientId],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
})

const assertBoundedHpValue = (
  value: number,
  operationId: string,
  label: string,
): number => {
  if (
    !Number.isFinite(value)
    || Math.abs(value) > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
    || (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-calculation',
      `HP operation ${operationId} resolved invalid ${label} ${String(value)}.`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

const calculationBasis = (
  calculation: Extract<MoveHpCalculation, {
    readonly kind: 'percent-max' | 'percent-current' | 'percent-missing'
  }>,
  snapshot: MoveCoreHpStateSnapshot,
  pool: 'hit-points' | 'temporary-hit-points',
): number => {
  if (calculation.kind === 'percent-max') return snapshot.fullMaxHp
  const current = poolValue(snapshot, pool)
  if (calculation.kind === 'percent-current') return Math.max(0, current)
  return Math.max(0, snapshot.fullMaxHp - current)
}

interface ActualDamageSourceSummary {
  readonly operationId: string
  readonly totalEffectiveHpLost: number
  readonly recipients: readonly MoveHpDamageSourceRecipientResolution[]
}

const actualDamageSource = (options: {
  readonly damageOperationId: string
  readonly operationId: string
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): ActualDamageSourceSummary => {
  const source = options.priorOperationResults.find(result => (
    result.operationId === options.damageOperationId
  ))
  if (!source || source.operationKind !== 'damage') {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-source',
      `HP operation ${options.operationId} requires earlier damage operation ${options.damageOperationId}.`,
    )
  }
  let totalEffectiveHpLost = 0
  const recipients = source.recipients.map((recipient): MoveHpDamageSourceRecipientResolution => {
    if (recipient.previous.kind !== 'hp' || recipient.current.kind !== 'hp') {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Damage operation ${source.operationId} has no HP result for ${recipient.recipientId}.`,
      )
    }
    const previousEffectiveHp = recipient.previous.currentHp + recipient.previous.temporaryHp
    const currentEffectiveHp = recipient.current.currentHp + recipient.current.temporaryHp
    const effectiveHpLost = Math.max(0, previousEffectiveHp - currentEffectiveHp)
    if (!Number.isSafeInteger(effectiveHpLost)) {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Damage operation ${source.operationId} produced unsafe effective HP loss.`,
      )
    }
    totalEffectiveHpLost += effectiveHpLost
    if (!Number.isSafeInteger(totalEffectiveHpLost)) {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Damage operation ${source.operationId} produced an unsafe aggregate HP loss.`,
      )
    }
    return {
      recipientId: recipient.recipientId,
      outcome: recipient.outcome,
      effectiveHpLost,
      prevented: recipient.outcome === 'prevented',
    }
  })
  return {
    operationId: source.operationId,
    totalEffectiveHpLost,
    recipients,
  }
}

interface ActualHpLossSourceSummary {
  readonly operationId: string
  readonly pool: 'hit-points' | 'temporary-hit-points'
  readonly totalHpLost: number
  readonly recipients: readonly MoveHpLossSourceRecipientResolution[]
}

const actualHpLossSource = (options: {
  readonly hpOperationId: string
  readonly pool: 'hit-points' | 'temporary-hit-points'
  readonly operationId: string
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): ActualHpLossSourceSummary => {
  const source = options.priorOperationResults.find(result => (
    result.operationId === options.hpOperationId
  ))
  if (!source || source.operationKind !== 'direct-hp') {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-source',
      `HP operation ${options.operationId} requires earlier direct HP operation ${options.hpOperationId}.`,
    )
  }
  let totalHpLost = 0
  const recipients = source.recipients.map((recipient): MoveHpLossSourceRecipientResolution => {
    if (recipient.previous.kind !== 'hp' || recipient.current.kind !== 'hp') {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Direct HP operation ${source.operationId} has no HP result for ${recipient.recipientId}.`,
      )
    }
    const hpLost = Math.max(
      0,
      poolValue(recipient.previous, options.pool) - poolValue(recipient.current, options.pool),
    )
    if (!Number.isSafeInteger(hpLost)) {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Direct HP operation ${source.operationId} produced unsafe ${options.pool} loss.`,
      )
    }
    totalHpLost += hpLost
    if (!Number.isSafeInteger(totalHpLost)) {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Direct HP operation ${source.operationId} produced unsafe aggregate HP loss.`,
      )
    }
    return {
      recipientId: recipient.recipientId,
      outcome: recipient.outcome,
      hpLost,
      prevented: recipient.outcome === 'prevented',
    }
  })
  return {
    operationId: source.operationId,
    pool: options.pool,
    totalHpLost,
    recipients,
  }
}

const resolveHpCalculation = (options: {
  readonly calculation: MoveHpCalculation
  readonly rounding: MoveEffectRoundingPolicy
  readonly operationId: string
  readonly pool: 'hit-points' | 'temporary-hit-points'
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly snapshot: MoveCoreHpStateSnapshot
  readonly context: AuthoritativeMoveRulesContext
  readonly requireNonNegative: boolean
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): MoveHpCalculationResolution => {
  const { calculation } = options
  let rawValue: number
  let roundedOverride: number | null = null
  let basisValue: number | null = null
  let damageSource: MoveHpDamageSourceResolution | null = null
  let hpLossSource: MoveHpLossSourceResolution | null = null
  let evaluationTrace: readonly MoveRuleEvaluationTraceEntry[] = []

  if (calculation.kind === 'fixed') rawValue = calculation.value
  else if (calculation.kind === 'formula') {
    const evaluation = evaluateMoveExpression({
      expression: calculation.expression,
      context: options.context,
      selectorState: selectorStateFor(options.recipient.placement.id),
      canonicalMoveId: options.context.intent.moveName,
      rootNodeId: `${options.operationId}.hp.${options.recipient.placement.id}`,
    })
    if (typeof evaluation.value !== 'number') {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-calculation',
        `HP operation ${options.operationId} formula did not resolve a number for ${options.recipient.placement.id}.`,
      )
    }
    rawValue = evaluation.value
    evaluationTrace = evaluation.trace
  }
  else if (calculation.kind === 'damage-dealt') {
    const source = actualDamageSource({
      damageOperationId: calculation.damageOperationId,
      operationId: options.operationId,
      priorOperationResults: options.priorOperationResults,
    })
    basisValue = source.totalEffectiveHpLost
    rawValue = basisValue * calculation.percent / 100
    if (calculation.aggregation === 'per-target') {
      roundedOverride = source.recipients.reduce(
        (sum, recipient) => sum + rounded(
          recipient.effectiveHpLost * calculation.percent / 100,
          options.rounding,
        ),
        0,
      )
    }
    damageSource = {
      operationId: source.operationId,
      aggregation: calculation.aggregation,
      percent: calculation.percent,
      preventedDamage: calculation.preventedDamage,
      totalEffectiveHpLost: source.totalEffectiveHpLost,
      recipients: source.recipients,
    }
  }
  else if (calculation.kind === 'hp-lost') {
    const source = actualHpLossSource({
      hpOperationId: calculation.hpOperationId,
      pool: calculation.pool,
      operationId: options.operationId,
      priorOperationResults: options.priorOperationResults,
    })
    basisValue = source.totalHpLost
    rawValue = basisValue * calculation.percent / 100
    if (calculation.aggregation === 'per-target') {
      roundedOverride = source.recipients.reduce(
        (sum, recipient) => sum + rounded(
          recipient.hpLost * calculation.percent / 100,
          options.rounding,
        ),
        0,
      )
    }
    hpLossSource = {
      operationId: source.operationId,
      pool: source.pool,
      aggregation: calculation.aggregation,
      percent: calculation.percent,
      totalHpLost: source.totalHpLost,
      recipients: source.recipients,
    }
  }
  else {
    basisValue = calculationBasis(calculation, options.snapshot, options.pool)
    rawValue = basisValue * calculation.percent / 100
  }

  assertBoundedHpValue(rawValue, options.operationId, 'calculation')
  if (options.requireNonNegative && rawValue < 0) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-calculation',
      `HP operation ${options.operationId} resolved a negative healing/loss magnitude.`,
    )
  }
  const roundedValue = assertBoundedHpValue(
    roundedOverride ?? rounded(rawValue, options.rounding),
    options.operationId,
    'rounded calculation',
  )
  return {
    kind: calculation.kind,
    rawValue,
    roundedValue,
    basisValue,
    sourcePlacementId: null,
    damageSource,
    hpLossSource,
    evaluationTrace,
  }
}

const boundedFinalValue = (
  value: number,
  bounds: MoveHpFinalBounds,
): number => {
  let bounded = value
  if (bounds.minimum !== null) bounded = Math.max(bounds.minimum, bounded)
  if (bounds.maximum !== null) bounded = Math.min(bounds.maximum, bounded)
  return bounded
}

const hpTraceDetails = (value: Record<string, unknown>): MoveResolutionTraceJsonValue => (
  value as MoveResolutionTraceJsonValue
)

const injuryDetails = (
  policy: MoveDirectHpEffectOperation['payload']['injury'],
  result: ReturnType<MoveAutomationHpUpdateAccumulator['setWithInjuryAutomation']> | null,
): Record<string, unknown> => ({
  policy: {
    hitPointMarkers: policy.hitPointMarkers,
    massiveDamage: policy.massiveDamage,
  },
  injuryDelta: result?.injuryDelta ?? 0,
  massiveDamageInjuries: 0,
  markerInjuries: result?.markerInjuries ?? 0,
  crossedMarkers: result?.crossedMarkers ?? [],
})

const preventedDirectHpResult = (options: {
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly previous: MoveCoreHpStateSnapshot
  readonly immunity: MoveCoreTokenEffectImmunityDecision
}): MoveCoreTokenEffectRecipientResult => ({
  recipientId: options.recipient.placement.id,
  outcome: 'prevented',
  reasonCode: 'type-immunity',
  blockers: [{ subject: null, source: options.immunity.blockedBy! }],
  consultedPlacementIds: options.immunity.consultedPlacementIds,
  previous: options.previous,
  current: options.previous,
  changedFields: [],
})

const preventedRecoilResult = (options: {
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly previous: MoveCoreHpStateSnapshot
  readonly blockedBy: string
  readonly calculation: MoveHpCalculationResolution
}): MoveCoreTokenEffectRecipientResult => ({
  recipientId: options.recipient.placement.id,
  outcome: 'prevented',
  reasonCode: 'recoil-immunity',
  blockers: [{ subject: 'Recoil', source: options.blockedBy }],
  details: hpTraceDetails({
    calculation: options.calculation,
    previousPoolValue: options.previous.currentHp,
    appliedPoolValue: options.previous.currentHp,
  }),
  consultedPlacementIds: [],
  previous: options.previous,
  current: options.previous,
  changedFields: [],
})

const directHpImmunity = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectImmunityDecision => options.operation.payload.applyTypeImmunity
  ? options.immunities.directHp({
      operation: options.operation,
      recipient: options.recipient,
    })
  : { blockedBy: null, consultedPlacementIds: [] }

interface MoveHpCostTriggerDecision {
  readonly applies: boolean
  readonly details: MoveResolutionTraceJsonValue
}

const resolveHpCostTrigger = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly hitTargetIds: readonly string[]
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): MoveHpCostTriggerDecision => {
  const cost = options.operation.payload.cost
  if (cost === null) return { applies: true, details: null }
  if (cost.timing === 'hit') {
    return {
      applies: options.hitTargetIds.length > 0,
      details: hpTraceDetails({
        kind: cost.kind,
        timing: cost.timing,
        minimumRemaining: cost.minimumRemaining,
        hitTargetIds: [...options.hitTargetIds],
      }),
    }
  }
  if (cost.timing === 'damage') {
    const damageOperationId = cost.damageOperationId
      ?? failMoveCoreTokenEffectReduction(
        'invalid-hp-source',
        `Damage-timed HP cost ${options.operation.id} has no damage operation ID.`,
      )
    const damage = actualDamageSource({
      damageOperationId,
      operationId: options.operation.id,
      priorOperationResults: options.priorOperationResults,
    })
    return {
      applies: damage.totalEffectiveHpLost > 0,
      details: hpTraceDetails({
        kind: cost.kind,
        timing: cost.timing,
        minimumRemaining: cost.minimumRemaining,
        damageOperationId: damage.operationId,
        totalEffectiveHpLost: damage.totalEffectiveHpLost,
        preventedDamage: 'zero',
      }),
    }
  }
  return {
    applies: true,
    details: hpTraceDetails({
      kind: cost.kind,
      timing: cost.timing,
      minimumRemaining: cost.minimumRemaining,
    }),
  }
}

const applyDirectPoolValue = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly previous: MoveCoreHpStateSnapshot
  readonly requestedPoolValue: number
  readonly calculation: MoveHpCalculationResolution
  readonly consultedPlacementIds: readonly string[]
  readonly costTriggerDetails: MoveResolutionTraceJsonValue
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator, previous } = options
  const previousPoolValue = poolValue(previous, operation.payload.pool)
  const boundedPoolValue = assertBoundedHpValue(
    boundedFinalValue(options.requestedPoolValue, operation.payload.bounds),
    operation.id,
    'bounded final HP',
  )
  const directionSafePoolValue = (
    operation.payload.mode === 'lose'
    || operation.payload.cost?.kind === 'sacrifice'
  )
    ? Math.min(previousPoolValue, boundedPoolValue)
    : boundedPoolValue
  let injuryResult: ReturnType<MoveAutomationHpUpdateAccumulator['setWithInjuryAutomation']> | null = null

  if (operation.payload.pool === 'temporary-hit-points') {
    accumulator.setTemporaryHp(
      recipient.token,
      normalizeTemporaryHpAmount(directionSafePoolValue),
    )
  }
  else if (
    directionSafePoolValue < previous.currentHp
    && operation.payload.injury.hitPointMarkers === 'apply-after-operation'
  ) {
    injuryResult = accumulator.setWithInjuryAutomation(
      recipient.token,
      directionSafePoolValue,
      'hp-loss',
    )
  }
  else {
    accumulator.set(recipient.token, directionSafePoolValue)
  }
  if (operation.payload.cost?.kind === 'sacrifice') {
    accumulator.setTemporaryHp(recipient.token, 0)
  }

  const current = hpSnapshot(accumulator, recipient)
  const details = hpTraceDetails({
    mode: operation.payload.mode,
    pool: operation.payload.pool,
    calculation: options.calculation,
    bounds: operation.payload.bounds,
    previousPoolValue,
    requestedPoolValue: options.requestedPoolValue,
    boundedPoolValue,
    appliedPoolValue: poolValue(current, operation.payload.pool),
    cost: operation.payload.cost === null
      ? null
      : { ...operation.payload.cost, trigger: options.costTriggerDetails },
    injury: injuryDetails(operation.payload.injury, injuryResult),
  })
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(
      recipient,
      previous,
      options.calculation.kind === 'damage-dealt' && options.calculation.roundedValue === 0
        ? 'linked-damage-zero'
        : options.calculation.kind === 'hp-lost' && options.calculation.roundedValue === 0
          ? 'linked-hp-zero'
          : 'hp-unchanged',
      options.consultedPlacementIds,
      details,
    )
  }
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    details,
    consultedPlacementIds: options.consultedPlacementIds,
    previous,
    current,
    changedFields: changedHpFields(previous, current),
  }
}

export const reduceDamageEffectForRecipient = (options: {
  readonly operation: MoveDamageEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly damage: MoveCoreTokenDamageQuery
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = hpSnapshot(accumulator, recipient)
  const resolution = options.damage.resolve({ operation, recipient })
  if (
    typeof resolution.hpLoss !== 'number'
    || !Number.isFinite(resolution.hpLoss)
    || resolution.hpLoss < 0
    || resolution.hpLoss > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    return failMoveCoreTokenEffectReduction(
      'invalid-damage-resolution',
      `Damage operation ${operation.id} returned an invalid HP loss.`,
    )
  }
  if (resolution.preventedBy) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'prevented',
      reasonCode: 'damage-immunity',
      blockers: [{
        subject: resolution.moveType
          ?? (typeof operation.payload.moveType === 'string' ? operation.payload.moveType : null),
        source: resolution.preventedBy,
      }],
      ...(resolution.details === undefined ? {} : { details: resolution.details }),
      consultedPlacementIds: resolution.consultedPlacementIds,
      previous,
      current: previous,
      changedFields: [],
    }
  }

  const requestedHpLoss = wholeNonNegative(resolution.hpLoss)
  if (requestedHpLoss === 0) {
    return noOpHpResult(
      recipient,
      previous,
      'damage-zero',
      resolution.consultedPlacementIds,
      resolution.details,
    )
  }
  const applied = accumulator.applyLossWithInjuryAutomation(
    recipient.token,
    requestedHpLoss,
    'damage',
  )
  const current = hpSnapshot(accumulator, recipient)
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(
      recipient,
      previous,
      'damage-zero',
      resolution.consultedPlacementIds,
      resolution.details,
    )
  }
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    details: {
      requestedHpLoss,
      effectiveHpLost: applied.effectiveHpLost,
      realHpLost: applied.realHpLost,
      absorbedByTemporaryHp: applied.absorbedByTemporaryHp,
      injuryDelta: applied.injuryResult.injuryDelta,
      massiveDamageInjuries: applied.injuryResult.massiveDamageInjuries,
      markerInjuries: applied.injuryResult.markerInjuries,
      crossedMarkers: applied.injuryResult.crossedMarkers,
      ...(resolution.details === undefined ? {} : { calculation: resolution.details }),
    },
    consultedPlacementIds: resolution.consultedPlacementIds,
    previous,
    current,
    changedFields: changedHpFields(previous, current),
  }
}

const copyCalculation = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly context: AuthoritativeMoveRulesContext
}): {
  readonly calculation: MoveHpCalculationResolution
  readonly consultedPlacementIds: readonly string[]
} => {
  const selector = options.operation.payload.copySource
    ?? failMoveCoreTokenEffectReduction(
      'invalid-hp-calculation',
      `Copy HP operation ${options.operation.id} has no copy source.`,
    )
  const sourceIds = evaluateMoveSelector({
    selector,
    context: options.context,
    selectorState: selectorStateFor(options.recipient.placement.id),
  })
  if (sourceIds.length !== 1) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-source',
      `Copy HP operation ${options.operation.id} must resolve exactly one source for ${options.recipient.placement.id}.`,
    )
  }
  const sourceId = sourceIds[0]!
  const sourcePlacement = options.context.queries.placements.get(sourceId)
  const sourceToken = options.context.queries.tokens.get(sourceId)
  if (!sourcePlacement || !sourceToken) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-source',
      `Copy HP operation ${options.operation.id} source ${sourceId} is unavailable.`,
    )
  }
  options.context.reads.recordPlacement(sourcePlacement)
  const sourceSnapshot: MoveCoreHpStateSnapshot = {
    kind: 'hp',
    currentHp: options.accumulator.get(sourceToken),
    temporaryHp: options.accumulator.getTemporaryHp(sourceToken),
    injuries: options.accumulator.getInjuries(sourceToken),
    maxHp: options.accumulator.getMaxHp(sourceToken),
    fullMaxHp: sourceToken.fullMaxHp ?? options.accumulator.getMaxHp(sourceToken),
  }
  const rawValue = poolValue(sourceSnapshot, options.operation.payload.pool)
  const roundedValue = assertBoundedHpValue(
    rounded(rawValue, options.operation.payload.rounding),
    options.operation.id,
    'copied HP',
  )
  return {
    calculation: {
      kind: 'copy',
      rawValue,
      roundedValue,
      basisValue: rawValue,
      sourcePlacementId: sourceId,
      damageSource: null,
      hpLossSource: null,
      evaluationTrace: [],
    },
    consultedPlacementIds: sourceId === options.recipient.placement.id ? [] : [sourceId],
  }
}

export const reduceDirectHpEffectForRecipient = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly context: AuthoritativeMoveRulesContext
  readonly hitTargetIds: readonly string[]
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  if (operation.payload.mode === 'split' || operation.payload.mode === 'swap') {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-recipient-count',
      `Redistribution HP operation ${operation.id} must reduce its recipient set together.`,
    )
  }
  const previous = hpSnapshot(accumulator, recipient)
  if (operation.reasonCode === 'ability.bully.add-injury'
    || operation.reasonCode === 'ability.cruelty.add-injury') {
    accumulator.addInjuries(recipient.token, 1)
    const current = hpSnapshot(accumulator, recipient)
    return {
      recipientId: recipient.placement.id,
      outcome: 'applied', reasonCode: operation.reasonCode, blockers: [],
      consultedPlacementIds: [], previous, current,
      changedFields: changedHpFields(previous, current),
    }
  }
  const costTrigger = resolveHpCostTrigger(options)
  if (!costTrigger.applies) {
    return noOpHpResult(
      recipient,
      previous,
      'hp-cost-trigger-not-met',
      [],
      hpTraceDetails({ cost: costTrigger.details }),
    )
  }
  const immunity = directHpImmunity(options)
  if (immunity.blockedBy) return preventedDirectHpResult({ recipient, previous, immunity })
  if (operation.payload.pool === 'temporary-hit-points' && !options.temporaryHpAvailable) {
    return noOpHpResult(
      recipient,
      previous,
      'temporary-hp-scene-unavailable',
      immunity.consultedPlacementIds,
    )
  }

  let calculation: MoveHpCalculationResolution
  let consultedPlacementIds = immunity.consultedPlacementIds
  if (operation.payload.mode === 'copy') {
    const copied = copyCalculation(options)
    calculation = copied.calculation
    consultedPlacementIds = [
      ...immunity.consultedPlacementIds,
      ...copied.consultedPlacementIds.filter(id => !immunity.consultedPlacementIds.includes(id)),
    ]
  }
  else {
    const authored = operation.payload.calculation
      ?? failMoveCoreTokenEffectReduction(
        'invalid-hp-calculation',
        `HP operation ${operation.id} has no authored calculation.`,
      )
    calculation = resolveHpCalculation({
      calculation: authored,
      rounding: operation.payload.rounding,
      operationId: operation.id,
      pool: operation.payload.pool,
      recipient,
      snapshot: previous,
      context: options.context,
      requireNonNegative: operation.payload.mode === 'lose',
      priorOperationResults: options.priorOperationResults,
    })
  }

  const recoilImmunity = calculation.kind === 'damage-dealt'
    && calculation.roundedValue > 0
    ? options.context.queries.abilities.has(recipient.placement.id, 'Abominable')
      ? 'Abominable'
      : moveAutomationRecoilImmunitySource(recipient.token.abilityNames)
    : null
  if (recoilImmunity) {
    return preventedRecoilResult({
      recipient,
      previous,
      blockedBy: recoilImmunity,
      calculation,
    })
  }

  const cost = operation.payload.cost
  if (
    cost?.kind === 'cost'
    && cost.minimumRemaining !== null
    && previous.currentHp - calculation.roundedValue < cost.minimumRemaining
  ) {
    return failMoveCoreTokenEffectReduction(
      'hp-precondition-failed',
      `HP cost ${operation.id} requires at least ${cost.minimumRemaining} HP after payment.`,
    )
  }

  const previousPoolValue = poolValue(previous, operation.payload.pool)
  const requestedPoolValue = operation.payload.mode === 'lose'
    ? previousPoolValue - calculation.roundedValue
    : calculation.roundedValue
  if (requestedPoolValue > previousPoolValue
    && authoritativeAbilityHealingBlocked({ map: options.context.map, placementId: recipient.placement.id })) {
    return noOpHpResult(recipient, previous, 'ability-cruelty-healing-blocked')
  }
  return applyDirectPoolValue({
    operation,
    recipient,
    accumulator,
    previous,
    requestedPoolValue,
    calculation,
    consultedPlacementIds,
    costTriggerDetails: costTrigger.details,
  })
}

/**
 * Average or swap the selected pool from one operation-entry snapshot. Every
 * requested final value and every immunity decision is resolved before any
 * recipient changes, so redistribution cannot duplicate HP through a partial
 * swap and HP-marker Injuries observe only the completed result.
 */
export const reduceRedistributionDirectHpEffectForRecipients = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipients: readonly MoveCoreTokenEffectRecipient[]
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): readonly MoveCoreTokenEffectRecipientResult[] => {
  const { operation, recipients, accumulator } = options
  const mode = operation.payload.mode
  if (mode !== 'split' && mode !== 'swap') {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-calculation',
      `HP operation ${operation.id} is not a redistribution.`,
    )
  }
  if (mode === 'split' && recipients.length < 2) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-recipient-count',
      `Split HP operation ${operation.id} requires at least two recipients.`,
    )
  }
  if (mode === 'swap' && recipients.length !== 2) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-recipient-count',
      `Swap HP operation ${operation.id} requires exactly two recipients.`,
    )
  }

  const previous = recipients.map(recipient => hpSnapshot(accumulator, recipient))
  const calculations: MoveHpCalculationResolution[] = []
  const requestedPoolValues: number[] = []
  if (mode === 'split') {
    const total = previous.reduce(
      (sum, snapshot) => sum + poolValue(snapshot, operation.payload.pool),
      0,
    )
    if (!Number.isSafeInteger(total)) {
      return failMoveCoreTokenEffectReduction(
        'invalid-hp-calculation',
        `Split HP operation ${operation.id} produced an unsafe recipient total.`,
      )
    }
    const rawValue = total / recipients.length
    const roundedValue = assertBoundedHpValue(
      rounded(rawValue, operation.payload.rounding),
      operation.id,
      'split HP',
    )
    const calculation: MoveHpCalculationResolution = {
      kind: 'split',
      rawValue,
      roundedValue,
      basisValue: total,
      sourcePlacementId: null,
      damageSource: null,
      hpLossSource: null,
      evaluationTrace: [],
    }
    for (const _recipient of recipients) {
      calculations.push(calculation)
      requestedPoolValues.push(roundedValue)
    }
  }
  else {
    for (const [index, recipient] of recipients.entries()) {
      const sourceIndex = index === 0 ? 1 : 0
      const sourceValue = poolValue(previous[sourceIndex]!, operation.payload.pool)
      const roundedValue = assertBoundedHpValue(
        rounded(sourceValue, operation.payload.rounding),
        operation.id,
        'swapped HP',
      )
      calculations.push({
        kind: 'swap',
        rawValue: sourceValue,
        roundedValue,
        basisValue: sourceValue,
        sourcePlacementId: recipients[sourceIndex]!.placement.id,
        damageSource: null,
        hpLossSource: null,
        evaluationTrace: [],
      })
      requestedPoolValues.push(roundedValue)
      if (recipient.placement.id === recipients[sourceIndex]!.placement.id) {
        return failMoveCoreTokenEffectReduction(
          'invalid-hp-recipient-count',
          `Swap HP operation ${operation.id} requires distinct recipients.`,
        )
      }
    }
  }

  const immunities = recipients.map(recipient => directHpImmunity({
    operation,
    recipient,
    immunities: options.immunities,
  }))
  const blockedRecipientIds = recipients
    .filter((_recipient, index) => immunities[index]!.blockedBy !== null)
    .map(recipient => recipient.placement.id)
  if (blockedRecipientIds.length > 0) {
    const consultedPlacementIds = [...new Set(
      immunities.flatMap(immunity => immunity.consultedPlacementIds),
    )]
    return recipients.map((recipient, index) => {
      const immunity = immunities[index]!
      return immunity.blockedBy
        ? preventedDirectHpResult({ recipient, previous: previous[index]!, immunity })
        : noOpHpResult(
            recipient,
            previous[index]!,
            'hp-redistribution-prevented',
            consultedPlacementIds,
            hpTraceDetails({ mode, blockedRecipientIds }),
          )
    })
  }
  if (operation.payload.pool === 'temporary-hit-points' && !options.temporaryHpAvailable) {
    return recipients.map((recipient, index) => noOpHpResult(
      recipient,
      previous[index]!,
      'temporary-hp-scene-unavailable',
      immunities[index]!.consultedPlacementIds,
    ))
  }

  return recipients.map((recipient, index) => applyDirectPoolValue({
    operation,
    recipient,
    accumulator,
    previous: previous[index]!,
    requestedPoolValue: requestedPoolValues[index]!,
    calculation: calculations[index]!,
    consultedPlacementIds: immunities[index]!.consultedPlacementIds,
    costTriggerDetails: null,
  }))
}

export const reduceHealEffectForRecipient = (options: {
  readonly operation: MoveHealEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
  readonly context: AuthoritativeMoveRulesContext
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = hpSnapshot(accumulator, recipient)
  if (authoritativeAbilityHealingBlocked({ map: options.context.map, placementId: recipient.placement.id })) {
    return noOpHpResult(recipient, previous, 'ability-cruelty-healing-blocked')
  }
  const outcomeTrigger = operation.payload.operationOutcomeTrigger
  if (outcomeTrigger) {
    const prior = options.priorOperationResults.find(result => (
      result.operationId === outcomeTrigger.operationId
    )) ?? failMoveCoreTokenEffectReduction(
      'invalid-hp-source',
      `Heal operation ${operation.id} cannot find prior operation ${outcomeTrigger.operationId}.`,
    )
    if (prior.outcome !== outcomeTrigger.outcome) {
      return noOpHpResult(
        recipient,
        previous,
        'heal-operation-trigger-not-met',
        [],
        hpTraceDetails({
          operationOutcomeTrigger: {
            operationId: prior.operationId,
            expectedOutcome: outcomeTrigger.outcome,
            actualOutcome: prior.outcome,
            matched: false,
          },
        }),
      )
    }
  }
  if (operation.payload.pool === 'temporary-hit-points' && !options.temporaryHpAvailable) {
    return noOpHpResult(recipient, previous, 'temporary-hp-scene-unavailable')
  }

  let calculation: MoveHpCalculationResolution
  let requestedPoolValue: number
  const previousPoolValue = poolValue(previous, operation.payload.pool)
  if (operation.payload.mode === 'full') {
    calculation = {
      kind: 'full',
      rawValue: previous.maxHp,
      roundedValue: previous.maxHp,
      basisValue: previous.maxHp,
      sourcePlacementId: null,
      damageSource: null,
      hpLossSource: null,
      evaluationTrace: [],
    }
    requestedPoolValue = previous.maxHp
  }
  else {
    const authored = operation.payload.calculation
      ?? failMoveCoreTokenEffectReduction(
        'invalid-hp-calculation',
        `Heal operation ${operation.id} has no authored calculation.`,
      )
    calculation = resolveHpCalculation({
      calculation: authored,
      rounding: operation.payload.rounding,
      operationId: operation.id,
      pool: operation.payload.pool,
      recipient,
      snapshot: previous,
      context: options.context,
      requireNonNegative: true,
      priorOperationResults: options.priorOperationResults,
    })
    requestedPoolValue = previousPoolValue + calculation.roundedValue
  }

  const boundedPoolValue = assertBoundedHpValue(
    boundedFinalValue(requestedPoolValue, operation.payload.bounds),
    operation.id,
    'bounded final healing HP',
  )
  // A healing operation never turns a restrictive maximum into HP loss.
  const directionSafePoolValue = Math.max(previousPoolValue, boundedPoolValue)
  if (operation.payload.pool === 'temporary-hit-points') {
    accumulator.setTemporaryHp(
      recipient.token,
      normalizeTemporaryHpAmount(directionSafePoolValue),
    )
  }
  else {
    accumulator.set(recipient.token, directionSafePoolValue)
  }

  const current = hpSnapshot(accumulator, recipient)
  const details = hpTraceDetails({
    mode: operation.payload.mode,
    pool: operation.payload.pool,
    calculation,
    bounds: operation.payload.bounds,
    previousPoolValue,
    requestedPoolValue,
    boundedPoolValue,
    appliedPoolValue: poolValue(current, operation.payload.pool),
    ...(outcomeTrigger ? {
      operationOutcomeTrigger: {
        operationId: outcomeTrigger.operationId,
        expectedOutcome: outcomeTrigger.outcome,
        actualOutcome: outcomeTrigger.outcome,
        matched: true,
      },
    } : {}),
    injury: {
      policy: operation.payload.injury,
      injuryDelta: 0,
      massiveDamageInjuries: 0,
      markerInjuries: 0,
      crossedMarkers: [],
    },
  })
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(
      recipient,
      previous,
      calculation.kind === 'damage-dealt' && calculation.roundedValue === 0
        ? 'linked-damage-zero'
        : calculation.kind === 'hp-lost' && calculation.roundedValue === 0
          ? 'linked-hp-zero'
          : 'hp-at-cap',
      [],
      details,
    )
  }
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    details,
    consultedPlacementIds: [],
    previous,
    current,
    changedFields: changedHpFields(previous, current),
  }
}
