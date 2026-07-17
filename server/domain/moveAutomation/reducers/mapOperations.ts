import type { MoveLogEffectOperation } from '#shared/moveAutomation/effects'
import { createLivePlayMovePresentationFromOutcome } from '#shared/livePlayMovePresentation'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import {
  appendMoveLogEntry,
  buildMoveUseLogLines,
  createMoveStructuredLogProjection,
  type MoveStructuredLogProjection,
} from '~/utils/moveLog'
import { deepCloneJson } from '~/utils/serialization'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import {
  canonicalMoveEffectPlacementIds,
  expectedMoveEffectRecipientIds,
  moveEffectRecipientIdsEqual,
  resolveMoveEffectDynamicRecipients,
} from './effectRecipients'
import { reduceMoveGlobalFields } from './mapFieldEffects'
import { reduceMoveHazardZones } from './mapHazardEffects'
import { reduceMoveTemporaryEffect } from './mapTemporaryEffects'
import {
  failMoveMapOperationReduction,
  MoveMapOperationReductionError,
} from './mapOperationError'
import {
  buildMoveMapOperationStateChanges,
  type MoveMapOperationLane,
  type MoveMapOperationTouch,
} from './mapOperationPlan'
import { applyMoveMapOperationResultsToTrace } from './mapOperationTrace'
import type {
  MoveMapEffectOperation,
  MoveMapOperationReduction,
  MoveMapOperationResult,
  MoveResolvedMapEffectOperation,
  MoveUsageOperationProjection,
  ReduceMoveMapOperationsInput,
} from './mapOperationTypes'
import { createMoveUsageOperationReducer } from './mapUsageEffects'

const MAP_OPERATION_KINDS = new Set<string>([
  'field',
  'hazard',
  'temporary-effect',
  'usage',
  'log',
])

export { MoveMapOperationReductionError }
export type { MoveMapOperationReductionErrorCode } from './mapOperationError'
export type {
  MoveAcceptedPresentationProjection,
  MoveHazardGeometryResolution,
  MoveMapEffectOperation,
  MoveMapOperationReduction,
  MoveMapOperationResult,
  MoveResolvedMapEffectOperation,
  MoveUsageEffectResource,
  MoveUsageOperationProjection,
  ReduceMoveMapOperationsInput,
} from './mapOperationTypes'
export { applyMoveMapOperationResultsToTrace } from './mapOperationTrace'

export const isMoveMapOperationEmission = (
  value: MoveSpecEmittedOperation,
): value is MoveResolvedMapEffectOperation => MAP_OPERATION_KINDS.has(value.operation.kind)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const resultFor = (options: {
  readonly operation: MoveMapEffectOperation
  readonly recipientIds: readonly string[]
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}): MoveMapOperationResult => ({
  operationId: options.operation.id,
  operationKind: options.operation.kind,
  phase: options.operation.phase,
  reasonCode: options.operation.reasonCode,
  recipientIds: [...options.recipientIds],
  outcome: options.changed ? 'applied' : 'no-op',
  details: options.details,
})

const structuredLogFor = (
  operation: MoveLogEffectOperation,
  recipientIds: readonly string[],
): MoveStructuredLogProjection => createMoveStructuredLogProjection({
  operationId: operation.id,
  phase: operation.phase,
  reasonCode: operation.reasonCode,
  messageKey: operation.payload.messageKey,
  recipientIds,
  arguments: operation.payload.arguments,
})

const operationDetails = (value: unknown): MoveResolutionTraceJsonValue => (
  value as MoveResolutionTraceJsonValue
)

/**
 * Reduce MoveSpec map/usage/log operations into one immutable immediate-write
 * envelope. Native hazard operations mutate typed encounter zones while
 * all resource revisions and accepted presentation/log projections are ready
 * for the same atomic command boundary used by v1.
 */
export const reduceMoveMapOperations = (
  input: ReduceMoveMapOperationsInput,
): MoveMapOperationReduction => {
  const previousMap = deepCloneJson(input.context.map)
  const previousRevision = normalizeRevision(previousMap.revision)
  const dynamic = resolveMoveEffectDynamicRecipients(
    input.context,
    input.dynamicRecipients,
    failMoveMapOperationReduction,
  )
  const usageReducer = createMoveUsageOperationReducer({
    context: input.context,
    resources: input.usageResources,
  })
  const laneTouches = new Map<MoveMapOperationLane, MoveMapOperationTouch[]>()
  const operationIds = new Set<string>()
  const operationResults: MoveMapOperationResult[] = []
  const usage: MoveUsageOperationProjection[] = []
  const structuredLog: MoveStructuredLogProjection[] = []
  let workingMap = deepCloneJson(input.initialMap ?? previousMap)

  const touch = (lane: MoveMapOperationLane, value: MoveMapOperationTouch): void => {
    const entries = laneTouches.get(lane) ?? []
    entries.push(value)
    laneTouches.set(lane, entries)
  }

  input.operations.forEach((emission, order) => {
    const { operation } = emission
    const operationContext = input.contextForOperation?.(operation) ?? input.context
    if (!MAP_OPERATION_KINDS.has(operation.kind)) {
      failMoveMapOperationReduction(
        'unsupported-operation',
        `Operation ${operation.id} is not a map, usage, or log operation.`,
      )
    }
    if (operationIds.has(operation.id)) {
      failMoveMapOperationReduction(
        'duplicate-operation-id',
        `Map operation ${operation.id} is duplicated.`,
      )
    }
    operationIds.add(operation.id)

    const emittedIds = canonicalMoveEffectPlacementIds(
      input.context,
      emission.recipientIds,
      `operation ${operation.id} recipients`,
      failMoveMapOperationReduction,
    )
    const expectedIds = emission.childResolutionId
      ? emittedIds
      : expectedMoveEffectRecipientIds(
          input.context,
          operation,
          dynamic,
          failMoveMapOperationReduction,
        )
    if (
      !moveEffectRecipientIdsEqual(emission.recipientIds, emittedIds)
      || !moveEffectRecipientIdsEqual(emittedIds, expectedIds)
    ) {
      failMoveMapOperationReduction(
        'recipient-set-mismatch',
        `Operation ${operation.id} recipients do not match selector ${operation.recipients.kind}.`,
      )
    }

    const operationTouch: MoveMapOperationTouch = {
      order,
      operationId: operation.id,
      reasonCode: operation.reasonCode,
    }

    if (operation.kind === 'field') {
      const reduced = reduceMoveGlobalFields({
        map: workingMap,
        operation,
        context: operationContext,
        recipientIds: expectedIds,
        resolutions: input.hazards,
      })
      if (reduced.changed) {
        workingMap = deepCloneJson(reduced.currentMap)
        touch('encounterState', operationTouch)
        touch('fieldEffects', operationTouch)
      }
      operationResults.push(resultFor({
        operation,
        recipientIds: expectedIds,
        changed: reduced.changed,
        details: reduced.details,
      }))
      return
    }

    if (operation.kind === 'hazard') {
      const reduced = reduceMoveHazardZones({
        context: operationContext,
        previous: workingMap.encounterState,
        operation,
        recipientIds: expectedIds,
        resolutions: input.hazards,
      })
      if (reduced.changed) {
        workingMap.encounterState = deepCloneJson(reduced.current)
        touch('encounterState', operationTouch)
      }
      operationResults.push(resultFor({
        operation,
        recipientIds: expectedIds,
        changed: reduced.changed,
        details: reduced.details,
      }))
      return
    }

    if (operation.kind === 'temporary-effect') {
      const reduced = reduceMoveTemporaryEffect({
        context: operationContext,
        previous: workingMap.encounterState,
        operation,
        recipientIds: expectedIds,
      })
      if (reduced.changed) {
        workingMap.encounterState = deepCloneJson(reduced.current)
        touch('encounterState', operationTouch)
      }
      operationResults.push(resultFor({
        operation,
        recipientIds: expectedIds,
        changed: reduced.changed,
        details: reduced.details,
      }))
      return
    }

    if (operation.kind === 'usage') {
      const reduced = usageReducer.reduce({
        map: workingMap,
        operation,
        recipientIds: expectedIds,
        touch: operationTouch,
      })
      workingMap = reduced.map
      if (reduced.mapChanged) touch('moveUsage', operationTouch)
      usage.push(reduced.projection)
      operationResults.push(resultFor({
        operation,
        recipientIds: expectedIds,
        changed: reduced.changed,
        details: reduced.details,
      }))
      return
    }

    const projection = structuredLogFor(operation, expectedIds)
    structuredLog.push(projection)
    touch('metadata', operationTouch)
    operationResults.push(resultFor({
      operation,
      recipientIds: expectedIds,
      changed: true,
      details: operationDetails({
        messageKey: projection.messageKey,
        argumentCount: projection.arguments.length,
      }),
    }))
  })

  const selectedTargetIds = input.presentation.selectedTargetIds === undefined
    ? undefined
    : canonicalMoveEffectPlacementIds(
        input.context,
        input.presentation.selectedTargetIds,
        'presentation selectedTargetIds',
        failMoveMapOperationReduction,
      )
  const presentation = createLivePlayMovePresentationFromOutcome({
    operationId: input.presentation.operationId,
    actorPlacementId: input.context.actor.placement.id,
    move: input.presentation.move,
    attackedTargetIds: dynamic['attacked-targets'],
    hitTargetIds: dynamic['hit-targets'],
    ...(selectedTargetIds === undefined ? {} : { selectedTargetIds }),
    ...(input.presentation.area === undefined ? {} : { area: input.presentation.area }),
    ...(input.presentation.pass === undefined ? {} : { pass: input.presentation.pass }),
  })

  const actorName = input.actorName?.trim() || input.context.actor.token.species
  workingMap.metadata = appendMoveLogEntry(
    workingMap.metadata,
    {
      operationId: input.presentation.operationId,
      userId: input.context.actor.placement.id,
      userName: actorName,
      moveName: input.presentation.move.name,
      scriptKind: input.trace.program.runtimeKind,
      scriptVersion: input.trace.program.runtimeVersion,
      definitionHash: input.trace.program.definitionHash,
      lines: input.logLines
        ? [...input.logLines]
        : buildMoveUseLogLines(actorName, input.presentation.move.name, input.frequency),
      structured: structuredLog,
    },
    {
      now: () => input.context.time,
      maxLogEntries: input.maxLogEntries,
    },
  )

  const revision = nextRevision(previousRevision)
  const stateChanges = buildMoveMapOperationStateChanges({
    previousMap,
    workingMap,
    previousRevision,
    time: input.context.time,
    laneTouches,
    sheets: usageReducer.sheetProjections(),
    implicitLogOrder: input.operations.length,
  })
  const nextMap: TabletopMap = {
    ...deepCloneJson(workingMap),
    revision,
    updatedAt: input.context.time,
  }
  const trace: MoveResolutionAuditTrace = applyMoveMapOperationResultsToTrace(
    input.trace,
    operationResults,
  )

  return deepFreeze({
    previousMap,
    nextMap,
    previousRevision,
    revision,
    stateChanges,
    operationResults: deepCloneJson(operationResults),
    usage: deepCloneJson(usage),
    structuredLog: deepCloneJson(structuredLog),
    presentation: deepCloneJson(presentation),
    sheetReads: usageReducer.sheetReads(),
    trace,
  })
}
