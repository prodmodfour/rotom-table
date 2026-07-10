import type { MoveResolutionAuditTrace } from '#shared/moveAutomation/trace'
import { deepCloneJson } from '~/utils/serialization'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import {
  createMoveAutomationCombatStageUpdateAccumulator,
  createMoveAutomationConditionUpdateAccumulator,
} from '~/utils/moveAutomationStatusUpdates'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from '../context'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import type { MoveStateChangePlan } from '../plan'
import { reduceCombatStageEffectForRecipient } from './combatStage'
import { reduceConditionEffectForRecipient } from './condition'
import {
  MoveCoreTokenEffectReductionError,
  failMoveCoreTokenEffectReduction,
} from './coreTokenEffectError'
import {
  buildMoveCoreTokenStateChanges,
  recordMoveCoreTokenEffectTouches,
  type MoveCoreTokenEffectTouches,
} from './coreTokenPlan'
import {
  canonicalMoveCoreTokenPlacementIds,
  expectedMoveCoreTokenRecipientIds,
  moveCoreTokenRecipientIdsEqual,
  recordMoveCoreTokenRecipientRead,
  resolveMoveCoreTokenDynamicRecipients,
  resolveMoveCoreTokenRecipient,
} from './coreTokenRecipients'
import { applyMoveCoreTokenEffectResultsToTrace } from './coreTokenTrace'
import {
  reduceDamageEffectForRecipient,
  reduceDirectHpEffectForRecipient,
  reduceHealEffectForRecipient,
} from './hp'
import type {
  MoveCoreTokenDamageQuery,
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperationResult,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
  MoveResolvedCoreTokenEffectOperation,
} from './coreTokenEffectTypes'

const CORE_TOKEN_EFFECT_KINDS = new Set<string>([
  'damage',
  'direct-hp',
  'heal',
  'condition',
  'combat-stage',
])

export { MoveCoreTokenEffectReductionError }
export type { MoveCoreTokenEffectReductionErrorCode } from './coreTokenEffectError'
export { applyMoveCoreTokenEffectResultsToTrace } from './coreTokenTrace'

export interface ReduceMoveCoreTokenEffectsInput {
  readonly context: AuthoritativeMoveRulesContext
  /** Exact server-emitted operations, retained in canonical phase/operation order. */
  readonly operations: readonly MoveResolvedCoreTokenEffectOperation[]
  readonly dynamicRecipients: MoveCoreTokenDynamicRecipientSets
  /** Required only when a `damage` operation is present. */
  readonly damage?: MoveCoreTokenDamageQuery
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveCoreTokenEffectReduction {
  readonly stateChanges: MoveStateChangePlan
  readonly operationResults: readonly MoveCoreTokenEffectOperationResult[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly trace: MoveResolutionAuditTrace
}

export const isMoveCoreTokenEffectEmission = (
  value: MoveSpecEmittedOperation,
): value is MoveResolvedCoreTokenEffectOperation => CORE_TOKEN_EFFECT_KINDS.has(value.operation.kind)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const aggregateOutcome = (
  recipients: readonly MoveCoreTokenEffectRecipientResult[],
): MoveCoreTokenEffectOperationResult['outcome'] => {
  if (recipients.some(result => result.outcome === 'applied')) return 'applied'
  if (recipients.some(result => result.outcome === 'prevented')) return 'prevented'
  return 'no-op'
}

const reduceRecipient = (options: {
  readonly emission: MoveResolvedCoreTokenEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly hpAccumulator: ReturnType<typeof createMoveAutomationHpUpdateAccumulator>
  readonly conditionAccumulator: ReturnType<typeof createMoveAutomationConditionUpdateAccumulator>
  readonly stageAccumulator: ReturnType<typeof createMoveAutomationCombatStageUpdateAccumulator>
  readonly temporaryHpAvailable: boolean
  readonly damage: MoveCoreTokenDamageQuery | undefined
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectRecipientResult => {
  const { operation } = options.emission
  if (operation.kind === 'damage') {
    if (!options.damage) {
      return failMoveCoreTokenEffectReduction(
        'damage-resolution-missing',
        `Damage operation ${operation.id} requires an authoritative damage resolver.`,
      )
    }
    return reduceDamageEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      damage: options.damage,
    })
  }
  if (operation.kind === 'direct-hp') {
    return reduceDirectHpEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      temporaryHpAvailable: options.temporaryHpAvailable,
      immunities: options.immunities,
    })
  }
  if (operation.kind === 'heal') {
    return reduceHealEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      temporaryHpAvailable: options.temporaryHpAvailable,
    })
  }
  if (operation.kind === 'condition') {
    return reduceConditionEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.conditionAccumulator,
      immunities: options.immunities,
    })
  }
  return reduceCombatStageEffectForRecipient({
    operation,
    recipient: options.recipient,
    accumulator: options.stageAccumulator,
    immunities: options.immunities,
  })
}

/**
 * Purely reduce authoritative core-token operations. All mutation is confined
 * to local accumulators; map/sheets/context and emitted operations stay intact.
 */
export const reduceMoveCoreTokenEffects = (
  input: ReduceMoveCoreTokenEffectsInput,
): MoveCoreTokenEffectReduction => {
  const dynamic = resolveMoveCoreTokenDynamicRecipients(
    input.context,
    input.dynamicRecipients,
  )
  const hpAccumulator = createMoveAutomationHpUpdateAccumulator()
  const conditionAccumulator = createMoveAutomationConditionUpdateAccumulator()
  const stageAccumulator = createMoveAutomationCombatStageUpdateAccumulator()
  const temporaryHpAvailable = Boolean(input.context.map.activeScene)
  const operationIds = new Set<string>()
  const operationResults: MoveCoreTokenEffectOperationResult[] = []
  const recipientsById = new Map<string, MoveCoreTokenEffectRecipient>()
  const touches: MoveCoreTokenEffectTouches = new Map()
  const sheetReads: AuthoritativeMoveSheetRead[] = []
  const sheetReadsByKey = new Map<string, AuthoritativeMoveSheetRead>()

  input.operations.forEach((emission, operationOrder) => {
    const { operation } = emission
    if (!CORE_TOKEN_EFFECT_KINDS.has(operation.kind)) {
      failMoveCoreTokenEffectReduction(
        'unsupported-operation',
        `Operation ${operation.id} is not a core token effect.`,
      )
    }
    if (operationIds.has(operation.id)) {
      failMoveCoreTokenEffectReduction(
        'duplicate-operation-id',
        `Core effect operation ${operation.id} is duplicated.`,
      )
    }
    operationIds.add(operation.id)

    const expectedIds = expectedMoveCoreTokenRecipientIds(input.context, operation, dynamic)
    const emittedIds = canonicalMoveCoreTokenPlacementIds(
      input.context,
      emission.recipientIds,
      `operation ${operation.id} recipients`,
    )
    if (
      !moveCoreTokenRecipientIdsEqual(emission.recipientIds, emittedIds)
      || !moveCoreTokenRecipientIdsEqual(emittedIds, expectedIds)
    ) {
      failMoveCoreTokenEffectReduction(
        'recipient-set-mismatch',
        `Operation ${operation.id} recipients do not match selector ${operation.recipients.kind}.`,
      )
    }

    const recipients = expectedIds.map((recipientId) => {
      const recipient = recipientsById.get(recipientId)
        ?? resolveMoveCoreTokenRecipient(input.context, recipientId)
      recipientsById.set(recipientId, recipient)
      recordMoveCoreTokenRecipientRead(sheetReads, sheetReadsByKey, recipient)
      return recipient
    })
    const recipientResults = recipients.map(recipient => reduceRecipient({
      emission,
      recipient,
      hpAccumulator,
      conditionAccumulator,
      stageAccumulator,
      temporaryHpAvailable,
      damage: input.damage,
      immunities: input.immunities,
    }))
    for (const result of recipientResults) {
      const consultedIds = canonicalMoveCoreTokenPlacementIds(
        input.context,
        result.consultedPlacementIds,
        `operation ${operation.id} consulted placements`,
      )
      for (const consultedId of consultedIds) {
        const consulted = recipientsById.get(consultedId)
          ?? resolveMoveCoreTokenRecipient(input.context, consultedId)
        recipientsById.set(consultedId, consulted)
        recordMoveCoreTokenRecipientRead(sheetReads, sheetReadsByKey, consulted)
      }
      recordMoveCoreTokenEffectTouches(touches, result, operation, operationOrder)
    }
    operationResults.push({
      operationId: operation.id,
      operationKind: operation.kind,
      phase: operation.phase,
      reasonCode: operation.reasonCode,
      recipientIds: [...expectedIds],
      outcome: aggregateOutcome(recipientResults),
      recipients: recipientResults,
    })
  })

  const frozenResults = deepFreeze(deepCloneJson(operationResults))
  const stateChanges = buildMoveCoreTokenStateChanges({
    context: input.context,
    recipientsById,
    touches,
    hpUpdates: hpAccumulator.toUpdates(),
    conditionUpdates: conditionAccumulator.toUpdates(),
    stageUpdates: stageAccumulator.toUpdates(),
  })
  const trace = applyMoveCoreTokenEffectResultsToTrace(input.trace, frozenResults)

  return Object.freeze({
    stateChanges,
    operationResults: frozenResults,
    sheetReads: deepFreeze(deepCloneJson(sheetReads)),
    trace,
  })
}
