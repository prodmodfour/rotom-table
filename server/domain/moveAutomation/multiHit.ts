import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveCombatStageEffectOperation,
  type MoveConditionEffectOperation,
  type MoveDamageEffectOperation,
  type MoveEffectMultiHitEffectTrigger,
  type MoveMultiHitCount,
  type MoveMultiHitEffectOperation,
  type MoveMultiHitEffectTemplate,
} from '#shared/moveAutomation/effects'
import {
  MOVE_AUTOMATION_ROLL_LEDGER_LIMITS,
  type MoveAutomationRollLedgerEntry,
} from '#shared/moveAutomation/random'
import type {
  MoveResolutionTraceJsonValue,
  MoveResolutionTraceOperationOutcome,
} from '#shared/moveAutomation/trace'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
  MoveAutomationScript,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import {
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRule,
} from '~/utils/moveAutomationResolution'
import {
  createMoveAutomationCombatStageUpdateAccumulator,
  createMoveAutomationConditionUpdateAccumulator,
} from '~/utils/moveAutomationStatusUpdates'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import { resolveMoveSpecDamageRollFormula } from './damageRollFormula'
import {
  resolveMoveDamageType,
  type MoveDamageTypeResolution,
} from './damageTypes'
import {
  resolveMoveSpecDamageCalculation,
  type MoveSpecDamageCalculation,
} from './damageStats'
import type { MoveStateChangePlan } from './plan'
import { reduceCombatStageEffectForRecipient } from './reducers/combatStage'
import { reduceConditionEffectForRecipient } from './reducers/condition'
import {
  buildMoveCoreTokenStateChanges,
  recordMoveCoreTokenEffectTouches,
  type MoveCoreTokenEffectTouches,
} from './reducers/coreTokenPlan'
import { resolveMoveCoreTokenRecipient } from './reducers/coreTokenRecipients'
import { reduceDamageEffectForRecipient } from './reducers/hp'
import { createStandardMoveCoreTokenEffectImmunityQueries } from './reducers/immunities'
import type {
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './reducers/coreTokenEffectTypes'

export type MoveMultiHitResolutionErrorCode =
  | 'invalid-hit-count'
  | 'roll-budget-exceeded'
  | 'generated-id-too-long'
  | 'damage-formula-unsupported'
  | 'recipient-unavailable'

export class MoveMultiHitResolutionError extends Error {
  readonly code: MoveMultiHitResolutionErrorCode
  readonly operationId: string

  constructor(
    code: MoveMultiHitResolutionErrorCode,
    operationId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MoveMultiHitResolutionError'
    this.code = code
    this.operationId = operationId
  }
}

export type MoveMultiHitRollPurpose =
  | 'hit-count'
  | 'accuracy'
  | 'critical'
  | 'damage'

export interface MoveMultiHitResolvedRoll {
  readonly operationId: string
  readonly referenceId: string
  readonly purpose: MoveMultiHitRollPurpose
  readonly recipientId: string | null
  readonly hitIndex: number | null
  readonly rollId: string
}

export interface MoveMultiHitAccuracyResolution {
  readonly rollId: string | null
  readonly naturalResult: number | null
  readonly finalValue: number | null
  readonly hit: boolean
  readonly criticalCandidate: boolean
  readonly reasonCode: string
  readonly contextualRule: MoveAutomationAccuracyRule | null
}

export interface MoveMultiHitEffectResolution {
  readonly effectId: string
  readonly timing: MoveMultiHitEffectTemplate['timing']
  readonly trigger: MoveMultiHitEffectTemplate['trigger']
  readonly recipient: MoveMultiHitEffectTemplate['recipient']
  readonly recipientId: string
  readonly kind: MoveMultiHitEffectTemplate['kind']
  readonly outcome: MoveCoreTokenEffectRecipientResult['outcome']
  readonly reasonCode: string
  readonly result: MoveCoreTokenEffectRecipientResult
}

export interface MoveMultiHitTriggerResolution {
  readonly timing: MoveMultiHitEffectTemplate['timing']
  readonly targetId: string | null
  readonly hitIndex: number | null
  readonly hit: boolean
  readonly damaged: boolean
  readonly knockout: boolean
  readonly effects: readonly MoveMultiHitEffectResolution[]
  readonly skippedEffectIds: readonly string[]
}

export interface MoveMultiHitDamageResolution {
  readonly rollId: string
  readonly naturalResult: number
  readonly finalValue: number
  readonly outcome: MoveCoreTokenEffectRecipientResult['outcome']
  readonly requestedHpLoss: number
  readonly effectiveHpLost: number
  readonly realHpLost: number
  readonly absorbedByTemporaryHp: number
  readonly targetHpAfter: number
  readonly targetTemporaryHpAfter: number
  readonly moveType: MoveDamageTypeResolution
  readonly contextualDamageBase: MoveContextualDamageBaseResolution | null
  readonly criticalHit: MoveSpecDamageCalculation['criticalHit']
  readonly damagePipeline: MoveSpecDamageCalculation['damagePipeline']
  readonly result: MoveCoreTokenEffectRecipientResult
}

export interface MoveMultiHitStrikeResolution {
  /** One-based scheduled strike position, including misses. */
  readonly hitIndex: number
  readonly targetId: string
  readonly accuracy: MoveMultiHitAccuracyResolution
  readonly criticalRollId: string | null
  readonly damage: MoveMultiHitDamageResolution | null
  readonly knockout: boolean
  readonly stoppedAfterStrike: boolean
  readonly afterEach: MoveMultiHitTriggerResolution
}

export type MoveMultiHitStopReason =
  | 'completed'
  | 'accuracy-missed'
  | 'stop-on-miss'
  | 'knockout'

export interface MoveMultiHitTargetResolution {
  readonly targetId: string
  readonly hitCountRollId: string | null
  readonly plannedHitCount: number | null
  readonly attemptedHitCount: number
  readonly successfulHitCount: number
  readonly missedHitCount: number
  readonly totalRequestedHpLoss: number
  readonly totalEffectiveHpLost: number
  readonly stopReason: MoveMultiHitStopReason
  readonly strikes: readonly MoveMultiHitStrikeResolution[]
  readonly afterAll: MoveMultiHitTriggerResolution
}

export interface MoveMultiHitAggregateResolution {
  readonly operationId: string
  readonly recipientIds: readonly string[]
  readonly countKind: MoveMultiHitCount['kind']
  readonly countScope: 'fixed' | 'sequence' | 'recipient'
  readonly totalAttemptedHitCount: number
  readonly totalSuccessfulHitCount: number
  readonly totalRequestedHpLoss: number
  readonly totalEffectiveHpLost: number
  readonly stoppedForKnockout: boolean
  readonly targets: readonly MoveMultiHitTargetResolution[]
  readonly afterAllActor: MoveMultiHitTriggerResolution
}

export interface MoveMultiHitExecution {
  readonly operationId: string
  readonly recipientIds: readonly string[]
  readonly outcome: MoveResolutionTraceOperationOutcome
  readonly resolution: MoveMultiHitAggregateResolution
  /** Bounded audit projection; full reducer snapshots remain server-only above. */
  readonly traceResult: MoveResolutionTraceJsonValue
  readonly rollLedgerEntries: readonly MoveAutomationRollLedgerEntry[]
  readonly resolvedRolls: readonly MoveMultiHitResolvedRoll[]
  readonly stateChanges: MoveStateChangePlan
  readonly hpUpdates: readonly MoveAutomationHpUpdate[]
  readonly conditionUpdates: readonly MoveAutomationConditionUpdate[]
  readonly combatStageUpdates: readonly MoveAutomationCombatStageUpdate[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
}

interface TriggerState {
  readonly hit: boolean
  readonly damaged: boolean
  readonly knockout: boolean
}

interface CountResolution {
  readonly hits: number
  readonly rollId: string | null
}

interface AccuracyRollResolution {
  readonly result: MoveMultiHitAccuracyResolution
  readonly naturalResult: number | null
}

const fail = (
  code: MoveMultiHitResolutionErrorCode,
  operation: MoveMultiHitEffectOperation,
  message: string,
): never => {
  throw new MoveMultiHitResolutionError(code, operation.id, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const generatedId = (
  operation: MoveMultiHitEffectOperation,
  base: string,
  suffix: string,
): string => {
  const id = `${base}${suffix}`
  if (id.length > MOVE_EFFECT_OPERATION_LIMITS.identifierLength) {
    return fail(
      'generated-id-too-long',
      operation,
      `Generated multi-hit ID ${id} exceeds ${MOVE_EFFECT_OPERATION_LIMITS.identifierLength} characters.`,
    )
  }
  return id
}

const maximumHitCount = (count: MoveMultiHitCount): number => {
  if (count.kind === 'fixed') return count.hits
  if (count.kind === 'roll') return count.maximum
  return Math.max(...count.entries.map(entry => entry.hits))
}

const assertRollBudget = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveMultiHitEffectOperation
  readonly recipientCount: number
}): void => {
  const maximum = maximumHitCount(options.operation.payload.count)
  const countRolls = options.operation.payload.count.kind === 'fixed'
    ? 0
    : options.operation.payload.count.scope === 'sequence'
      ? 1
      : options.recipientCount
  const accuracyRolls = options.operation.payload.accuracy.kind === 'automatic'
    ? 0
    : options.operation.payload.accuracy.kind === 'once'
      ? options.recipientCount
      : options.recipientCount * maximum
  const criticalRolls = options.operation.payload.critical.kind === 'per-hit'
    ? options.recipientCount * maximum
    : 0
  const damageRolls = options.recipientCount * maximum
  const required = countRolls + accuracyRolls + criticalRolls + damageRolls
  const remaining = MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.entries
    - options.context.random.snapshot().length
  if (required > remaining) {
    fail(
      'roll-budget-exceeded',
      options.operation,
      `Multi-hit operation may require ${required} ledger entries, but only ${remaining} remain.`,
    )
  }
}

const preflightGeneratedIds = (
  operation: MoveMultiHitEffectOperation,
  recipientCount: number,
): void => {
  const maximum = maximumHitCount(operation.payload.count)
  const targetOrdinal = Math.max(1, recipientCount)
  generatedId(operation, operation.id, `.t${targetOrdinal}.h${maximum}.damage`)
  if (operation.payload.count.kind !== 'fixed') {
    const suffix = operation.payload.count.scope === 'recipient'
      ? `.t${targetOrdinal}`
      : ''
    generatedId(operation, operation.payload.count.rollId, suffix)
  }
  if (operation.payload.accuracy.kind !== 'automatic') {
    const suffix = operation.payload.accuracy.kind === 'once'
      ? `.t${targetOrdinal}`
      : `.t${targetOrdinal}.h${maximum}`
    generatedId(operation, operation.payload.accuracy.rollId, suffix)
  }
  if (operation.payload.critical.kind === 'per-hit') {
    generatedId(
      operation,
      operation.payload.critical.rollId,
      `.t${targetOrdinal}.h${maximum}`,
    )
  }
}

const projectedToken = (options: {
  readonly token: SpawnedPokemon
  readonly hp: ReturnType<typeof createMoveAutomationHpUpdateAccumulator>
  readonly conditions: ReturnType<typeof createMoveAutomationConditionUpdateAccumulator>
  readonly stages: ReturnType<typeof createMoveAutomationCombatStageUpdateAccumulator>
}): SpawnedPokemon => {
  const sheetConditions = options.conditions.get(options.token)
  const originalSheetConditions = normalizeConditionNames(
    options.token.sheetConditions ?? options.token.conditions,
  )
  const encounterConditions = normalizeConditionNames(options.token.conditions)
    .filter(condition => !originalSheetConditions.includes(condition))
  return {
    ...options.token,
    currentHp: options.hp.get(options.token),
    temporaryHp: options.hp.getTemporaryHp(options.token),
    injuries: options.hp.getInjuries(options.token),
    maxHp: options.hp.getMaxHp(options.token),
    combatStages: options.stages.get(options.token),
    sheetConditions: [...sheetConditions],
    conditions: normalizeConditionNames([...sheetConditions, ...encounterConditions]),
  }
}

const damageOperationForStrike = (
  operation: MoveMultiHitEffectOperation,
  targetOrdinal: number,
  hitIndex: number,
): MoveDamageEffectOperation => ({
  id: generatedId(operation, operation.id, `.t${targetOrdinal}.h${hitIndex}.damage`),
  kind: 'damage',
  source: { kind: 'operation', id: operation.id },
  recipients: operation.recipients,
  phase: operation.phase,
  reasonCode: operation.reasonCode,
  payload: operation.payload.damage,
})

const countRollId = (
  operation: MoveMultiHitEffectOperation,
  targetOrdinal: number,
): string => {
  const count = operation.payload.count
  if (count.kind === 'fixed') {
    return fail('invalid-hit-count', operation, 'Fixed hit counts do not own a roll ID.')
  }
  return generatedId(
    operation,
    count.rollId,
    count.scope === 'recipient' ? `.t${targetOrdinal}` : '',
  )
}

const resolveRolledCount = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveMultiHitEffectOperation
  readonly targetOrdinal: number
  readonly recipientId: string | null
  readonly resolvedRolls: MoveMultiHitResolvedRoll[]
}): CountResolution => {
  const count = options.operation.payload.count
  if (count.kind === 'fixed') return { hits: count.hits, rollId: null }
  const rollId = countRollId(options.operation, options.targetOrdinal)
  const result = count.kind === 'roll'
    ? options.context.random.roll({
        rollId,
        parentEffectId: options.operation.id,
        formula: count.formula,
        reason: `${options.operation.reasonCode} hit count`,
      })
    : options.context.random.rollTable({
        rollId,
        parentEffectId: options.operation.id,
        formula: { kind: 'table', tableId: count.tableId },
        drawFormula: count.drawFormula,
        entries: count.entries.map(entry => ({
          minimum: entry.minimum,
          maximum: entry.maximum,
          value: entry.hits,
        })),
        reason: `${options.operation.reasonCode} hit-count table`,
      })
  const hits = result.finalValue
  if (
    !Number.isSafeInteger(hits)
    || hits < 1
    || hits > MOVE_EFFECT_OPERATION_LIMITS.multiHitStrikes
    || (count.kind === 'roll' && (hits < count.minimum || hits > count.maximum))
  ) {
    return fail(
      'invalid-hit-count',
      options.operation,
      `Hit-count roll ${rollId} resolved invalid count ${hits}.`,
    )
  }
  options.resolvedRolls.push({
    operationId: options.operation.id,
    referenceId: count.rollId,
    purpose: 'hit-count',
    recipientId: options.recipientId,
    hitIndex: null,
    rollId,
  })
  return { hits, rollId }
}

const rollAccuracy = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveMultiHitEffectOperation
  readonly script: MoveAutomationScript
  readonly target: SpawnedPokemon
  readonly targetOrdinal: number
  readonly hitIndex: number | null
  readonly actor: SpawnedPokemon
  readonly resolvedRolls: MoveMultiHitResolvedRoll[]
}): AccuracyRollResolution => {
  const accuracy = options.operation.payload.accuracy
  if (accuracy.kind === 'automatic') {
    return {
      naturalResult: null,
      result: {
        rollId: null,
        naturalResult: null,
        finalValue: null,
        hit: true,
        criticalCandidate: false,
        reasonCode: 'multi-hit-automatic-hit',
        contextualRule: null,
      },
    }
  }
  const suffix = accuracy.kind === 'once'
    ? `.t${options.targetOrdinal}`
    : `.t${options.targetOrdinal}.h${options.hitIndex}`
  const rollId = generatedId(options.operation, accuracy.rollId, suffix)
  const userAccuracy = moveAutomationUserAccuracy(options.actor)
  const targetEvasion = resolveMoveAutomationTargetEvasion(
    options.script,
    options.target,
    { attacker: options.actor },
  ).value
  const rolled = options.context.random.roll({
    rollId,
    parentEffectId: options.operation.id,
    formula: accuracy.formula,
    reason: `${options.operation.reasonCode} accuracy for ${options.target.id}`,
    modifiers: [{
      sourceId: 'actor-accuracy',
      reason: 'Actor Accuracy',
      value: userAccuracy,
    }],
  })
  const weatherAccuracy = options.context.queries.weather.accuracy({
    canonicalMoveId: options.script.moveName,
  })
  const result = resolveMoveAutomationAccuracyRoll(options.script, rolled.naturalResult, {
    userAccuracy,
    targetEvasion,
    accuracyRule: weatherAccuracy.rule,
  })
  options.resolvedRolls.push({
    operationId: options.operation.id,
    referenceId: accuracy.rollId,
    purpose: 'accuracy',
    recipientId: options.target.id,
    hitIndex: options.hitIndex,
    rollId,
  })
  return {
    naturalResult: rolled.naturalResult,
    result: {
      rollId,
      naturalResult: rolled.naturalResult,
      finalValue: rolled.finalValue,
      hit: result.hit,
      criticalCandidate: result.crit,
      reasonCode: result.hit ? 'multi-hit-accuracy-hit' : 'multi-hit-accuracy-miss',
      contextualRule: result.accuracyRule ?? null,
    },
  }
}

const rollCritical = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveMultiHitEffectOperation
  readonly targetOrdinal: number
  readonly hitIndex: number
  readonly recipientId: string
  readonly accuracyNaturalResult: number | null
  readonly resolvedRolls: MoveMultiHitResolvedRoll[]
}): { readonly naturalResult: number | null; readonly rollId: string | null } => {
  const critical = options.operation.payload.critical
  if (critical.kind === 'none') return { naturalResult: null, rollId: null }
  if (critical.kind === 'accuracy') {
    return { naturalResult: options.accuracyNaturalResult, rollId: null }
  }
  const rollId = generatedId(
    options.operation,
    critical.rollId,
    `.t${options.targetOrdinal}.h${options.hitIndex}`,
  )
  const result = options.context.random.roll({
    rollId,
    parentEffectId: options.operation.id,
    formula: critical.formula,
    reason: `${options.operation.reasonCode} critical for ${options.recipientId}`,
  })
  options.resolvedRolls.push({
    operationId: options.operation.id,
    referenceId: critical.rollId,
    purpose: 'critical',
    recipientId: options.recipientId,
    hitIndex: options.hitIndex,
    rollId,
  })
  return { naturalResult: result.naturalResult, rollId }
}

const effectMatches = (
  trigger: MoveEffectMultiHitEffectTrigger,
  state: TriggerState,
): boolean => trigger === 'always'
  || (trigger === 'hit' && state.hit)
  || (trigger === 'damage' && state.damaged)
  || (trigger === 'knockout' && state.knockout)

const operationForEffect = (
  parent: MoveMultiHitEffectOperation,
  effect: MoveMultiHitEffectTemplate,
): MoveConditionEffectOperation | MoveCombatStageEffectOperation => ({
  id: parent.id,
  kind: effect.kind,
  source: { kind: 'operation', id: parent.id },
  recipients: effect.recipient === 'actor'
    ? { kind: 'actor' }
    : { kind: 'hit-targets' },
  phase: parent.phase,
  reasonCode: effect.reasonCode,
  payload: effect.payload,
}) as MoveConditionEffectOperation | MoveCombatStageEffectOperation

const triggerEffects = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly parent: MoveMultiHitEffectOperation
  readonly timing: MoveMultiHitEffectTemplate['timing']
  readonly target: MoveCoreTokenEffectRecipient | null
  readonly targetId: string | null
  readonly hitIndex: number | null
  readonly trigger: TriggerState
  readonly hp: ReturnType<typeof createMoveAutomationHpUpdateAccumulator>
  readonly conditions: ReturnType<typeof createMoveAutomationConditionUpdateAccumulator>
  readonly stages: ReturnType<typeof createMoveAutomationCombatStageUpdateAccumulator>
  readonly recipientsById: Map<string, MoveCoreTokenEffectRecipient>
  readonly touches: MoveCoreTokenEffectTouches
  readonly nextOperationOrder: () => number
  readonly moveType: string | null
}): MoveMultiHitTriggerResolution => {
  const effects = options.parent.payload.effects.filter(effect => effect.timing === options.timing)
  const applied: MoveMultiHitEffectResolution[] = []
  const skippedEffectIds: string[] = []
  const actor = options.recipientsById.get(options.context.actor.placement.id)
    ?? resolveMoveCoreTokenRecipient(options.context, options.context.actor.placement.id)
  options.recipientsById.set(actor.placement.id, actor)

  for (const effect of effects) {
    if (!effectMatches(effect.trigger, options.trigger)) {
      skippedEffectIds.push(effect.id)
      continue
    }
    const recipient = effect.recipient === 'actor' ? actor : options.target
    if (!recipient) {
      skippedEffectIds.push(effect.id)
      continue
    }
    options.context.reads.recordPlacement(recipient.placement)
    const operation = operationForEffect(options.parent, effect)
    const immunities = createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: options.moveType,
      context: options.context,
    })
    const result = operation.kind === 'condition'
      ? reduceConditionEffectForRecipient({
          operation,
          recipient,
          accumulator: options.conditions,
          immunities,
          context: options.context,
        })
      : reduceCombatStageEffectForRecipient({
          operation,
          recipient,
          accumulator: options.stages,
          immunities,
        })
    recordMoveCoreTokenEffectTouches(
      options.touches,
      result,
      { id: options.parent.id, reasonCode: options.parent.reasonCode },
      options.nextOperationOrder(),
    )
    for (const consultedId of result.consultedPlacementIds) {
      const consulted = options.recipientsById.get(consultedId)
        ?? resolveMoveCoreTokenRecipient(options.context, consultedId)
      options.recipientsById.set(consultedId, consulted)
      options.context.reads.recordPlacement(consulted.placement)
    }
    applied.push({
      effectId: effect.id,
      timing: effect.timing,
      trigger: effect.trigger,
      recipient: effect.recipient,
      recipientId: recipient.placement.id,
      kind: effect.kind,
      outcome: result.outcome,
      reasonCode: result.reasonCode,
      result,
    })
  }

  return {
    timing: options.timing,
    targetId: options.targetId,
    hitIndex: options.hitIndex,
    ...options.trigger,
    effects: applied,
    skippedEffectIds,
  }
}

const aggregateOutcome = (
  results: readonly MoveCoreTokenEffectRecipientResult[],
): MoveResolutionTraceOperationOutcome => {
  if (results.some(result => result.outcome === 'applied')) return 'applied'
  if (results.some(result => result.outcome === 'prevented')) return 'prevented'
  return 'no-op'
}

const ledgerEntriesAfter = (
  context: AuthoritativeMoveRulesContext,
  previousCount: number,
): readonly MoveAutomationRollLedgerEntry[] => context.random.snapshot().slice(previousCount)

const triggerTrace = (
  trigger: MoveMultiHitTriggerResolution,
): MoveResolutionTraceJsonValue => ({
  timing: trigger.timing,
  targetId: trigger.targetId,
  hitIndex: trigger.hitIndex,
  hit: trigger.hit,
  damaged: trigger.damaged,
  knockout: trigger.knockout,
  effects: trigger.effects.map(effect => ({
    effectId: effect.effectId,
    recipientId: effect.recipientId,
    kind: effect.kind,
    outcome: effect.outcome,
    reasonCode: effect.reasonCode,
  })),
  skippedEffectIds: [...trigger.skippedEffectIds],
})

const resolutionTrace = (
  resolution: MoveMultiHitAggregateResolution,
): MoveResolutionTraceJsonValue => ({
  operationId: resolution.operationId,
  recipientIds: [...resolution.recipientIds],
  countKind: resolution.countKind,
  countScope: resolution.countScope,
  totalAttemptedHitCount: resolution.totalAttemptedHitCount,
  totalSuccessfulHitCount: resolution.totalSuccessfulHitCount,
  totalRequestedHpLoss: resolution.totalRequestedHpLoss,
  totalEffectiveHpLost: resolution.totalEffectiveHpLost,
  stoppedForKnockout: resolution.stoppedForKnockout,
  targets: resolution.targets.map(target => ({
    targetId: target.targetId,
    hitCountRollId: target.hitCountRollId,
    plannedHitCount: target.plannedHitCount,
    attemptedHitCount: target.attemptedHitCount,
    successfulHitCount: target.successfulHitCount,
    missedHitCount: target.missedHitCount,
    totalRequestedHpLoss: target.totalRequestedHpLoss,
    totalEffectiveHpLost: target.totalEffectiveHpLost,
    stopReason: target.stopReason,
    strikes: target.strikes.map(strike => ({
      hitIndex: strike.hitIndex,
      accuracy: strike.accuracy,
      criticalRollId: strike.criticalRollId,
      damage: strike.damage === null ? null : {
        rollId: strike.damage.rollId,
        naturalResult: strike.damage.naturalResult,
        finalValue: strike.damage.finalValue,
        outcome: strike.damage.outcome,
        requestedHpLoss: strike.damage.requestedHpLoss,
        effectiveHpLost: strike.damage.effectiveHpLost,
        realHpLost: strike.damage.realHpLost,
        absorbedByTemporaryHp: strike.damage.absorbedByTemporaryHp,
        targetHpAfter: strike.damage.targetHpAfter,
        targetTemporaryHpAfter: strike.damage.targetTemporaryHpAfter,
        moveType: strike.damage.moveType.moveType,
        critical: strike.damage.criticalHit.critical,
        criticalReasonCode: strike.damage.criticalHit.reasonCode,
        damagePipelineHpLoss: strike.damage.damagePipeline?.hpLoss ?? null,
      },
      knockout: strike.knockout,
      stoppedAfterStrike: strike.stoppedAfterStrike,
      afterEach: triggerTrace(strike.afterEach),
    })),
    afterAll: triggerTrace(target.afterAll),
  })),
  afterAllActor: triggerTrace(resolution.afterAllActor),
}) as unknown as MoveResolutionTraceJsonValue

/**
 * Resolve one bounded multi-hit operation in exact strike order. Randomness,
 * damage, simple per-hit effects, and KO stopping are computed against local
 * accumulators; the authoritative context and repositories remain unchanged.
 */
export const executeMoveMultiHitOperation = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveMultiHitEffectOperation
  readonly script: MoveAutomationScript
  readonly canonicalMoveId: string
  readonly recipientIds: readonly string[]
}): MoveMultiHitExecution => {
  const { context, operation } = options
  assertRollBudget({ context, operation, recipientCount: options.recipientIds.length })
  preflightGeneratedIds(operation, options.recipientIds.length)
  const ledgerStart = context.random.snapshot().length
  const hp = createMoveAutomationHpUpdateAccumulator()
  const conditions = createMoveAutomationConditionUpdateAccumulator()
  const stages = createMoveAutomationCombatStageUpdateAccumulator()
  const touches: MoveCoreTokenEffectTouches = new Map()
  const recipientsById = new Map<string, MoveCoreTokenEffectRecipient>()
  const resolvedRolls: MoveMultiHitResolvedRoll[] = []
  const mutationResults: MoveCoreTokenEffectRecipientResult[] = []
  const targetResults: MoveMultiHitTargetResolution[] = []
  const hitTargetIds = new Set<string>()
  const damagedTargetIds = new Set<string>()
  const faintedTargetIds = new Set<string>()
  let operationOrder = 0
  const nextOperationOrder = (): number => operationOrder++
  let sequenceCount: CountResolution | null = operation.payload.count.kind === 'fixed'
    ? { hits: operation.payload.count.hits, rollId: null }
    : null

  const actorRecipient = resolveMoveCoreTokenRecipient(context, context.actor.placement.id)
  recipientsById.set(actorRecipient.placement.id, actorRecipient)
  context.reads.recordPlacement(actorRecipient.placement)

  for (const [targetIndex, recipientId] of options.recipientIds.entries()) {
    const targetOrdinal = targetIndex + 1
    const targetRecipient = resolveMoveCoreTokenRecipient(context, recipientId)
    recipientsById.set(recipientId, targetRecipient)
    context.reads.recordPlacement(targetRecipient.placement)

    const actorBeforeAccuracy = projectedToken({
      token: actorRecipient.token,
      hp,
      conditions,
      stages,
    })
    const targetBeforeAccuracy = projectedToken({
      token: targetRecipient.token,
      hp,
      conditions,
      stages,
    })
    const sharedAccuracy = operation.payload.accuracy.kind === 'once'
      ? rollAccuracy({
          context,
          operation,
          script: options.script,
          target: targetBeforeAccuracy,
          targetOrdinal,
          hitIndex: null,
          actor: actorBeforeAccuracy,
          resolvedRolls,
        })
      : null

    let countResolution: CountResolution | null = operation.payload.count.kind === 'fixed'
      ? { hits: operation.payload.count.hits, rollId: null }
      : operation.payload.count.scope === 'sequence'
        ? sequenceCount
        : null
    const canResolveCount = sharedAccuracy === null || sharedAccuracy.result.hit
    if (!countResolution && canResolveCount) {
      countResolution = resolveRolledCount({
        context,
        operation,
        targetOrdinal,
        recipientId: operation.payload.count.kind !== 'fixed'
          && operation.payload.count.scope === 'recipient'
          ? recipientId
          : null,
        resolvedRolls,
      })
      if (operation.payload.count.kind !== 'fixed'
        && operation.payload.count.scope === 'sequence') {
        sequenceCount = countResolution
      }
    }

    const strikes: MoveMultiHitStrikeResolution[] = []
    let successfulHitCount = 0
    let missedHitCount = 0
    let totalRequestedHpLoss = 0
    let totalEffectiveHpLost = 0
    let stopReason: MoveMultiHitStopReason = sharedAccuracy && !sharedAccuracy.result.hit
      ? 'accuracy-missed'
      : 'completed'
    const plannedHitCount = countResolution?.hits ?? null

    if (sharedAccuracy?.result.hit !== false && countResolution) {
      for (let hitIndex = 1; hitIndex <= countResolution.hits; hitIndex += 1) {
        const actor = projectedToken({ token: actorRecipient.token, hp, conditions, stages })
        const target = projectedToken({ token: targetRecipient.token, hp, conditions, stages })
        const accuracy = operation.payload.accuracy.kind === 'per-hit'
          ? rollAccuracy({
              context,
              operation,
              script: options.script,
              target,
              targetOrdinal,
              hitIndex,
              actor,
              resolvedRolls,
            })
          : sharedAccuracy ?? {
              naturalResult: null,
              result: {
                rollId: null,
                naturalResult: null,
                finalValue: null,
                hit: true,
                criticalCandidate: false,
                reasonCode: 'multi-hit-automatic-hit',
                contextualRule: null,
              },
            }

        let damage: MoveMultiHitDamageResolution | null = null
        let knockout = false
        if (accuracy.result.hit) {
          successfulHitCount += 1
          hitTargetIds.add(recipientId)
          const critical = rollCritical({
            context,
            operation,
            targetOrdinal,
            hitIndex,
            recipientId,
            accuracyNaturalResult: accuracy.naturalResult,
            resolvedRolls,
          })
          const damageOperation = damageOperationForStrike(operation, targetOrdinal, hitIndex)
          const resolvedType = resolveMoveDamageType({
            context,
            operation: damageOperation,
            script: options.script,
            recipientId,
            canonicalMoveId: options.canonicalMoveId,
          })
          const formula = resolveMoveSpecDamageRollFormula({
            context,
            operation: damageOperation,
            recipientId,
            canonicalMoveId: options.canonicalMoveId,
            resolvedType,
            failUnsupported: message => fail(
              'damage-formula-unsupported',
              operation,
              message,
            ),
          })
          const damageRollId = generatedId(
            operation,
            operation.id,
            `.t${targetOrdinal}.h${hitIndex}.roll`,
          )
          const damageRoll = context.random.roll({
            rollId: damageRollId,
            parentEffectId: operation.id,
            formula: {
              kind: 'dice',
              count: formula.count,
              sides: formula.sides,
              modifier: formula.modifier,
            },
            reason: `${operation.reasonCode} strike ${hitIndex} damage for ${recipientId}`,
          })
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.id,
            purpose: 'damage',
            recipientId,
            hitIndex,
            rollId: damageRollId,
          })
          const projectedActor = projectedToken({
            token: actorRecipient.token,
            hp,
            conditions,
            stages,
          })
          const projectedTarget = projectedToken({
            token: targetRecipient.token,
            hp,
            conditions,
            stages,
          })
          const calculation = resolveMoveSpecDamageCalculation({
            context,
            operation: damageOperation,
            script: options.script,
            actor: projectedActor,
            recipient: projectedTarget,
            resolution: {
              accuracyRoll: accuracy.naturalResult === null ? '' : String(accuracy.naturalResult),
              hit: true,
              crit: false,
              damageRoll: {
                formula: `${formula.count}d${formula.sides}${formula.modifier >= 0 ? '+' : ''}${formula.modifier}`,
                count: formula.count,
                sides: formula.sides,
                mod: formula.modifier,
                rolls: [...damageRoll.naturalResults],
                total: damageRoll.finalValue,
              },
              manualHpLoss: '',
              applyDamage: true,
            },
            fieldEffects: context.queries.weather.projectFieldEffects(),
            selectedTargets: options.recipientIds.flatMap((id) => {
              const selected = context.queries.tokens.get(id)
              return selected ? [selected] : []
            }),
            resolvedMoveType: resolvedType,
            naturalCriticalRoll: critical.naturalResult,
            ...(formula.contextualDamageBase
              ? { contextualDamageBase: formula.contextualDamageBase }
              : {}),
          })
          const damageResult = reduceDamageEffectForRecipient({
            operation: damageOperation,
            recipient: targetRecipient,
            accumulator: hp,
            damage: {
              resolve: () => ({
                hpLoss: calculation.breakdown.hpLoss,
                preventedBy: calculation.moveType.immunitySource,
                moveType: calculation.moveType.moveType,
                consultedPlacementIds: [],
                details: {
                  moveType: calculation.moveType,
                  criticalHit: calculation.criticalHit,
                  contextualDamageBase: calculation.contextualDamageBase,
                  attackStat: calculation.stats.attackStat ?? null,
                  defenseStat: calculation.stats.defenseStat ?? null,
                  evaluationTrace: calculation.evaluationTrace,
                  damagePipeline: calculation.damagePipeline,
                  terrain: calculation.terrain.trace,
                  weather: calculation.weather.trace,
                } as unknown as MoveResolutionTraceJsonValue,
              }),
            },
          })
          mutationResults.push(damageResult)
          recordMoveCoreTokenEffectTouches(
            touches,
            damageResult,
            { id: operation.id, reasonCode: operation.reasonCode },
            nextOperationOrder(),
          )
          const previous = damageResult.previous.kind === 'hp' ? damageResult.previous : null
          const current = damageResult.current.kind === 'hp' ? damageResult.current : null
          const effectiveHpLost = previous && current
            ? Math.max(
                0,
                previous.currentHp + previous.temporaryHp
                  - current.currentHp - current.temporaryHp,
              )
            : 0
          const realHpLost = previous && current
            ? Math.max(0, previous.currentHp - current.currentHp)
            : 0
          const absorbedByTemporaryHp = previous && current
            ? Math.max(0, previous.temporaryHp - current.temporaryHp)
            : 0
          knockout = Boolean(previous && current
            && previous.currentHp > 0
            && current.currentHp <= 0)
          if (effectiveHpLost > 0) damagedTargetIds.add(recipientId)
          if (knockout) faintedTargetIds.add(recipientId)
          totalRequestedHpLoss += calculation.breakdown.hpLoss
          totalEffectiveHpLost += effectiveHpLost
          damage = {
            rollId: damageRollId,
            naturalResult: damageRoll.naturalResult,
            finalValue: damageRoll.finalValue,
            outcome: damageResult.outcome,
            requestedHpLoss: calculation.breakdown.hpLoss,
            effectiveHpLost,
            realHpLost,
            absorbedByTemporaryHp,
            targetHpAfter: current?.currentHp ?? target.currentHp,
            targetTemporaryHpAfter: current?.temporaryHp ?? target.temporaryHp ?? 0,
            moveType: calculation.moveType,
            contextualDamageBase: calculation.contextualDamageBase,
            criticalHit: calculation.criticalHit,
            damagePipeline: calculation.damagePipeline,
            result: damageResult,
          }
        }
        else {
          missedHitCount += 1
        }

        const triggerState: TriggerState = {
          hit: accuracy.result.hit,
          damaged: (damage?.effectiveHpLost ?? 0) > 0,
          knockout,
        }
        const afterEach = triggerEffects({
          context,
          parent: operation,
          timing: 'after-each',
          target: targetRecipient,
          targetId: recipientId,
          hitIndex,
          trigger: triggerState,
          hp,
          conditions,
          stages,
          recipientsById,
          touches,
          nextOperationOrder,
          moveType: damage?.moveType.moveType ?? options.script.type,
        })
        for (const effect of afterEach.effects) mutationResults.push(effect.result)

        const stopOnMiss = !accuracy.result.hit
          && operation.payload.accuracy.kind === 'per-hit'
          && operation.payload.accuracy.stopOnMiss
        const stoppedAfterStrike = knockout || stopOnMiss
        strikes.push({
          hitIndex,
          targetId: recipientId,
          accuracy: accuracy.result,
          criticalRollId: operation.payload.critical.kind === 'per-hit'
            ? resolvedRolls.findLast(roll => (
                roll.purpose === 'critical'
                && roll.recipientId === recipientId
                && roll.hitIndex === hitIndex
              ))?.rollId ?? null
            : null,
          damage,
          knockout,
          stoppedAfterStrike,
          afterEach,
        })
        if (knockout) {
          stopReason = 'knockout'
          break
        }
        if (stopOnMiss) {
          stopReason = 'stop-on-miss'
          break
        }
      }
    }

    targetResults.push({
      targetId: recipientId,
      hitCountRollId: countResolution?.rollId ?? null,
      plannedHitCount,
      attemptedHitCount: strikes.length,
      successfulHitCount,
      missedHitCount,
      totalRequestedHpLoss,
      totalEffectiveHpLost,
      stopReason,
      strikes,
      // Filled after every target sequence so after-all effects cannot affect later strikes.
      afterAll: {
        timing: 'after-all',
        targetId: recipientId,
        hitIndex: null,
        hit: successfulHitCount > 0,
        damaged: totalEffectiveHpLost > 0,
        knockout: stopReason === 'knockout',
        effects: [],
        skippedEffectIds: [],
      },
    })
  }

  const completedTargetResults = targetResults.map((targetResult) => {
    const target = recipientsById.get(targetResult.targetId)
      ?? fail('recipient-unavailable', operation, `Target ${targetResult.targetId} disappeared.`)
    const afterAll = triggerEffects({
      context,
      parent: {
        ...operation,
        payload: {
          ...operation.payload,
          effects: operation.payload.effects.filter(effect => effect.recipient === 'target'),
        },
      },
      timing: 'after-all',
      target,
      targetId: targetResult.targetId,
      hitIndex: null,
      trigger: {
        hit: targetResult.successfulHitCount > 0,
        damaged: targetResult.totalEffectiveHpLost > 0,
        knockout: targetResult.stopReason === 'knockout',
      },
      hp,
      conditions,
      stages,
      recipientsById,
      touches,
      nextOperationOrder,
      moveType: options.script.type,
    })
    for (const effect of afterAll.effects) {
      if (effect.recipient === 'target') mutationResults.push(effect.result)
    }
    return { ...targetResult, afterAll }
  })

  // Actor-owned after-all templates execute once for the whole operation, not once per target.
  const afterAllActor = triggerEffects({
    context,
    parent: {
      ...operation,
      payload: {
        ...operation.payload,
        effects: operation.payload.effects.filter(effect => effect.recipient === 'actor'),
      },
    },
    timing: 'after-all',
    target: null,
    targetId: null,
    hitIndex: null,
    trigger: {
      hit: completedTargetResults.some(result => result.successfulHitCount > 0),
      damaged: completedTargetResults.some(result => result.totalEffectiveHpLost > 0),
      knockout: completedTargetResults.some(result => result.stopReason === 'knockout'),
    },
    hp,
    conditions,
    stages,
    recipientsById,
    touches,
    nextOperationOrder,
    moveType: options.script.type,
  })
  for (const effect of afterAllActor.effects) mutationResults.push(effect.result)

  // Remove actor effects from per-target after-all evidence; they are represented once above.
  const normalizedTargetResults = completedTargetResults.map(result => ({
    ...result,
    afterAll: {
      ...result.afterAll,
      effects: result.afterAll.effects.filter(effect => effect.recipient === 'target'),
      skippedEffectIds: result.afterAll.skippedEffectIds.filter((effectId) => {
        const effect = operation.payload.effects.find(candidate => candidate.id === effectId)
        return effect?.recipient === 'target'
      }),
    },
  }))

  const stateChanges = buildMoveCoreTokenStateChanges({
    context,
    recipientsById,
    touches,
    hpUpdates: hp.toUpdates(),
    conditionUpdates: conditions.toUpdates(),
    stageUpdates: stages.toUpdates(),
    encounterStateUpdate: null,
  })
  const hpUpdates = hp.toUpdates()
  const conditionUpdates = conditions.toUpdates()
  const combatStageUpdates = stages.toUpdates()
  const totalAttemptedHitCount = normalizedTargetResults.reduce(
    (total, result) => total + result.attemptedHitCount,
    0,
  )
  const totalSuccessfulHitCount = normalizedTargetResults.reduce(
    (total, result) => total + result.successfulHitCount,
    0,
  )
  const totalRequestedHpLoss = normalizedTargetResults.reduce(
    (total, result) => total + result.totalRequestedHpLoss,
    0,
  )
  const totalEffectiveHpLost = normalizedTargetResults.reduce(
    (total, result) => total + result.totalEffectiveHpLost,
    0,
  )
  const resolution: MoveMultiHitAggregateResolution = {
    operationId: operation.id,
    recipientIds: [...options.recipientIds],
    countKind: operation.payload.count.kind,
    countScope: operation.payload.count.kind === 'fixed'
      ? 'fixed'
      : operation.payload.count.scope,
    totalAttemptedHitCount,
    totalSuccessfulHitCount,
    totalRequestedHpLoss,
    totalEffectiveHpLost,
    stoppedForKnockout: normalizedTargetResults.some(result => result.stopReason === 'knockout'),
    targets: normalizedTargetResults,
    afterAllActor,
  }
  const hitTargetIdList = options.recipientIds.filter(id => hitTargetIds.has(id))
  const damagedTargetIdList = options.recipientIds.filter(id => damagedTargetIds.has(id))
  const faintedTargetIdList = options.recipientIds.filter(id => faintedTargetIds.has(id))

  return deepFreeze({
    operationId: operation.id,
    recipientIds: [...options.recipientIds],
    outcome: aggregateOutcome(mutationResults),
    resolution,
    traceResult: resolutionTrace(resolution),
    rollLedgerEntries: ledgerEntriesAfter(context, ledgerStart),
    resolvedRolls,
    stateChanges,
    hpUpdates,
    conditionUpdates,
    combatStageUpdates,
    hitTargetIds: hitTargetIdList,
    missedTargetIds: options.recipientIds.filter(id => !hitTargetIds.has(id)),
    damagedTargetIds: damagedTargetIdList,
    faintedTargetIds: faintedTargetIdList,
  })
}
