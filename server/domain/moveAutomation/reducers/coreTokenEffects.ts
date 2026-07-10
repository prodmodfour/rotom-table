import type { MoveResolutionAuditTrace } from '#shared/moveAutomation/trace'
import { deepCloneJson } from '~/utils/serialization'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import {
  createMoveAutomationCombatStageUpdateAccumulator,
  createMoveAutomationConditionUpdateAccumulator,
} from '~/utils/moveAutomationStatusUpdates'
import {
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveRulesContext,
  type AuthoritativeMoveSheetRead,
} from '../context'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import type { MoveStateChangePlan } from '../plan'
import {
  reduceCombatStageEffect,
  reduceCombatStageEffectForRecipient,
} from './combatStage'
import {
  createMoveConditionEncounterStateAccumulator,
  reduceConditionEffect,
} from './condition'
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
import { evaluateMoveSelector, type MoveRuleSelectorState } from '../evaluateExpression'
import type { MoveSelector } from '#shared/moveAutomation/selectors'
import {
  reduceDamageEffectForRecipient,
  reduceDirectHpEffectForRecipient,
  reduceHealEffectForRecipient,
  reduceRedistributionDirectHpEffectForRecipients,
} from './hp'
import type {
  MoveCoreTokenDamageQuery,
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperation,
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

export interface ReduceMoveCoreTokenOperationStateInput {
  readonly context: AuthoritativeMoveRulesContext
  /** Exact server-emitted operations, retained in canonical phase/operation order. */
  readonly operations: readonly MoveResolvedCoreTokenEffectOperation[]
  readonly dynamicRecipients: MoveCoreTokenDynamicRecipientSets
  /** Required only when a `damage` operation is present. */
  readonly damage?: MoveCoreTokenDamageQuery
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  /**
   * Optional server-owned recipient query for non-MoveSpec orchestration such
   * as lifecycle facts. Emitted IDs must still match this canonical result.
   */
  readonly recipientIdsForOperation?: (
    operation: MoveResolvedCoreTokenEffectOperation['operation'],
  ) => readonly string[]
}

export interface ReduceMoveCoreTokenEffectsInput
  extends ReduceMoveCoreTokenOperationStateInput {
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveCoreTokenOperationStateReduction {
  readonly stateChanges: MoveStateChangePlan
  readonly operationResults: readonly MoveCoreTokenEffectOperationResult[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
}

export interface MoveCoreTokenEffectReduction
  extends MoveCoreTokenOperationStateReduction {
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

const authoritativeSourceRecipient = (options: {
  readonly selector: MoveSelector | null
  readonly operationId: string
  readonly label: 'Combat-stage' | 'Condition'
  readonly errorCode: 'invalid-stage-source' | 'invalid-condition-source'
  readonly context: AuthoritativeMoveRulesContext
  readonly dynamic: Readonly<Record<
    | 'attacked-targets'
    | 'hit-targets'
    | 'missed-targets'
    | 'damaged-targets'
    | 'fainted-targets',
    readonly string[]
  >>
  readonly recipientsById: Map<string, MoveCoreTokenEffectRecipient>
  readonly sheetReads: AuthoritativeMoveSheetRead[]
  readonly sheetReadsByKey: Map<string, AuthoritativeMoveSheetRead>
}): MoveCoreTokenEffectRecipient | undefined => {
  if (!options.selector) return undefined
  const selectorState: MoveRuleSelectorState = {
    targetIds: options.dynamic['attacked-targets'],
    hitTargetIds: options.dynamic['hit-targets'],
    missedTargetIds: options.dynamic['missed-targets'],
    damagedTargetIds: options.dynamic['damaged-targets'],
    faintedTargetIds: options.dynamic['fainted-targets'],
  }
  const sourceIds = evaluateMoveSelector({
    selector: options.selector,
    context: options.context,
    selectorState,
  })
  if (sourceIds.length !== 1) {
    return failMoveCoreTokenEffectReduction(
      options.errorCode,
      `${options.label} operation ${options.operationId} must resolve exactly one authoritative source.`,
    )
  }
  const sourceId = sourceIds[0]!
  const source = options.recipientsById.get(sourceId)
    ?? resolveMoveCoreTokenRecipient(options.context, sourceId)
  options.recipientsById.set(sourceId, source)
  recordMoveCoreTokenRecipientRead(
    options.sheetReads,
    options.sheetReadsByKey,
    source,
  )
  return source
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
  readonly context: AuthoritativeMoveRulesContext
  readonly hitTargetIds: readonly string[]
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
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
      context: options.context,
      hitTargetIds: options.hitTargetIds,
      priorOperationResults: options.priorOperationResults,
    })
  }
  if (operation.kind === 'heal') {
    return reduceHealEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      temporaryHpAvailable: options.temporaryHpAvailable,
      context: options.context,
      priorOperationResults: options.priorOperationResults,
    })
  }
  if (operation.kind === 'condition') {
    return failMoveCoreTokenEffectReduction(
      'invalid-condition-recipient-count',
      `Condition operation ${operation.id} requires grouped condition reduction.`,
    )
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
export const reduceMoveCoreTokenOperationState = (
  input: ReduceMoveCoreTokenOperationStateInput,
): MoveCoreTokenOperationStateReduction => {
  const dynamic = resolveMoveCoreTokenDynamicRecipients(
    input.context,
    input.dynamicRecipients,
  )
  const hpAccumulator = createMoveAutomationHpUpdateAccumulator()
  const conditionAccumulator = createMoveAutomationConditionUpdateAccumulator()
  const conditionEncounterAccumulator = createMoveConditionEncounterStateAccumulator(input.context)
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

    const expectedIds = input.recipientIdsForOperation
      ? canonicalMoveCoreTokenPlacementIds(
          input.context,
          input.recipientIdsForOperation(operation),
          `operation ${operation.id} authoritative recipients`,
        )
      : expectedMoveCoreTokenRecipientIds(input.context, operation, dynamic)
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
    let recipientResults: readonly MoveCoreTokenEffectRecipientResult[]
    if (operation.kind === 'condition') {
      recipientResults = reduceConditionEffect({
        operation,
        recipients,
        sourceRecipient: authoritativeSourceRecipient({
          selector: operation.payload.conditionSource,
          operationId: operation.id,
          label: 'Condition',
          errorCode: 'invalid-condition-source',
          context: input.context,
          dynamic,
          recipientsById,
          sheetReads,
          sheetReadsByKey,
        }),
        accumulator: conditionAccumulator,
        encounter: conditionEncounterAccumulator,
        immunities: input.immunities,
        context: input.context,
      })
    }
    else if (operation.kind === 'combat-stage') {
      recipientResults = reduceCombatStageEffect({
        operation,
        recipients,
        sourceRecipient: authoritativeSourceRecipient({
          selector: operation.payload.stageSource,
          operationId: operation.id,
          label: 'Combat-stage',
          errorCode: 'invalid-stage-source',
          context: input.context,
          dynamic,
          recipientsById,
          sheetReads,
          sheetReadsByKey,
        }),
        accumulator: stageAccumulator,
        immunities: input.immunities,
      })
    }
    else if (
      operation.kind === 'direct-hp'
      && (operation.payload.mode === 'split' || operation.payload.mode === 'swap')
    ) {
      recipientResults = reduceRedistributionDirectHpEffectForRecipients({
        operation,
        recipients,
        accumulator: hpAccumulator,
        temporaryHpAvailable,
        immunities: input.immunities,
      })
    }
    else {
      recipientResults = recipients.map(recipient => reduceRecipient({
        emission,
        recipient,
        hpAccumulator,
        conditionAccumulator,
        stageAccumulator,
        temporaryHpAvailable,
        damage: input.damage,
        immunities: input.immunities,
        context: input.context,
        hitTargetIds: dynamic['hit-targets'],
        priorOperationResults: operationResults,
      }))
    }
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
    encounterStateUpdate: conditionEncounterAccumulator.update(),
  })
  return Object.freeze({
    stateChanges,
    operationResults: frozenResults,
    sheetReads: deepFreeze(deepCloneJson(deduplicateAuthoritativeMoveSheetReads([
      ...sheetReads,
      ...input.context.reads.snapshot(),
    ]))),
  })
}

/** Reduce MoveSpec core operations and project their outcomes into its audit trace. */
export const reduceMoveCoreTokenEffects = (
  input: ReduceMoveCoreTokenEffectsInput,
): MoveCoreTokenEffectReduction => {
  const reduction = reduceMoveCoreTokenOperationState({
    context: input.context,
    operations: input.operations,
    dynamicRecipients: input.dynamicRecipients,
    ...(input.damage === undefined ? {} : { damage: input.damage }),
    immunities: input.immunities,
    ...(input.recipientIdsForOperation === undefined
      ? {}
      : { recipientIdsForOperation: input.recipientIdsForOperation }),
  })
  return Object.freeze({
    ...reduction,
    trace: applyMoveCoreTokenEffectResultsToTrace(input.trace, reduction.operationResults),
  })
}
