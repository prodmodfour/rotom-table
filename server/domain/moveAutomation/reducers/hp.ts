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
import type { AuthoritativeMoveRulesContext } from '../context'
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
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

interface MoveHpCalculationResolution {
  readonly kind: MoveHpCalculation['kind'] | 'copy' | 'split' | 'full'
  readonly rawValue: number
  readonly roundedValue: number
  readonly basisValue: number | null
  readonly sourcePlacementId: string | null
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
  calculation: Exclude<MoveHpCalculation, { readonly kind: 'fixed' | 'formula' }>,
  snapshot: MoveCoreHpStateSnapshot,
  pool: 'hit-points' | 'temporary-hit-points',
): number => {
  if (calculation.kind === 'percent-max') return snapshot.fullMaxHp
  const current = poolValue(snapshot, pool)
  if (calculation.kind === 'percent-current') return Math.max(0, current)
  return Math.max(0, snapshot.fullMaxHp - current)
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
}): MoveHpCalculationResolution => {
  const { calculation } = options
  let rawValue: number
  let basisValue: number | null = null
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
    rounded(rawValue, options.rounding),
    options.operationId,
    'rounded calculation',
  )
  return {
    kind: calculation.kind,
    rawValue,
    roundedValue,
    basisValue,
    sourcePlacementId: null,
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

const applyDirectPoolValue = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly previous: MoveCoreHpStateSnapshot
  readonly requestedPoolValue: number
  readonly calculation: MoveHpCalculationResolution
  readonly consultedPlacementIds: readonly string[]
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator, previous } = options
  const previousPoolValue = poolValue(previous, operation.payload.pool)
  const boundedPoolValue = assertBoundedHpValue(
    boundedFinalValue(options.requestedPoolValue, operation.payload.bounds),
    operation.id,
    'bounded final HP',
  )
  const directionSafePoolValue = operation.payload.mode === 'lose'
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
    injury: injuryDetails(operation.payload.injury, injuryResult),
  })
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(
      recipient,
      previous,
      'hp-unchanged',
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
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  if (operation.payload.mode === 'split') {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-recipient-count',
      `Split HP operation ${operation.id} must reduce its recipient set together.`,
    )
  }
  const previous = hpSnapshot(accumulator, recipient)
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
    })
  }

  const previousPoolValue = poolValue(previous, operation.payload.pool)
  const requestedPoolValue = operation.payload.mode === 'lose'
    ? previousPoolValue - calculation.roundedValue
    : calculation.roundedValue
  return applyDirectPoolValue({
    operation,
    recipient,
    accumulator,
    previous,
    requestedPoolValue,
    calculation,
    consultedPlacementIds,
  })
}

/**
 * Split the selected pool's operation-entry total equally across every
 * authoritative recipient. All requested final values are calculated before
 * any recipient is changed, so HP-marker Injuries observe the completed split.
 */
export const reduceSplitDirectHpEffectForRecipients = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipients: readonly MoveCoreTokenEffectRecipient[]
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): readonly MoveCoreTokenEffectRecipientResult[] => {
  const { operation, recipients, accumulator } = options
  if (operation.payload.mode !== 'split') {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-calculation',
      `HP operation ${operation.id} is not a split.`,
    )
  }
  if (recipients.length < 2) {
    return failMoveCoreTokenEffectReduction(
      'invalid-hp-recipient-count',
      `Split HP operation ${operation.id} requires at least two recipients.`,
    )
  }

  const previous = recipients.map(recipient => hpSnapshot(accumulator, recipient))
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
    evaluationTrace: [],
  }
  const immunities = recipients.map(recipient => directHpImmunity({
    operation,
    recipient,
    immunities: options.immunities,
  }))

  return recipients.map((recipient, index) => {
    const snapshot = previous[index]!
    const immunity = immunities[index]!
    if (immunity.blockedBy) {
      return preventedDirectHpResult({ recipient, previous: snapshot, immunity })
    }
    if (operation.payload.pool === 'temporary-hit-points' && !options.temporaryHpAvailable) {
      return noOpHpResult(
        recipient,
        snapshot,
        'temporary-hp-scene-unavailable',
        immunity.consultedPlacementIds,
      )
    }
    return applyDirectPoolValue({
      operation,
      recipient,
      accumulator,
      previous: snapshot,
      requestedPoolValue: roundedValue,
      calculation,
      consultedPlacementIds: immunity.consultedPlacementIds,
    })
  })
}

export const reduceHealEffectForRecipient = (options: {
  readonly operation: MoveHealEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
  readonly context: AuthoritativeMoveRulesContext
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = hpSnapshot(accumulator, recipient)
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
    injury: {
      policy: operation.payload.injury,
      injuryDelta: 0,
      massiveDamageInjuries: 0,
      markerInjuries: 0,
      crossedMarkers: [],
    },
  })
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(recipient, previous, 'hp-at-cap', [], details)
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
