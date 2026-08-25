import { createHash } from 'node:crypto'
import type { MoveLogEffectOperation } from '#shared/moveAutomation/effects'
import { createLivePlayMovePresentationFromOutcome } from '#shared/livePlayMovePresentation'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
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
import { AA073_GULP_MISSILE_CONSUME_REASON } from '../../abilityAutomation/mechanics/aa073MoveIntegration'
import { AA075_ILLUSION_BREAK_REASON } from '../../abilityAutomation/mechanics/aa075MoveIntegration'
import { aa085to100BoundRecipientId } from '../../abilityAutomation/mechanics/aa085to100MoveIntegration'
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
import {
  FURY_CUTTER_CANONICAL_ID,
  FURY_CUTTER_CHAIN_DETAIL_CODE,
  reduceFuryCutterChainCompletion,
  resetFuryCutterChainForDifferentMove,
} from '../furyCutter'
import { recordAcceptedMoveHistory } from '../recordAcceptedMoveHistory'
import { actionTypeFromMoveRange } from '../planMoveResources'

const MAP_OPERATION_KINDS = new Set<string>([
  'field',
  'hazard',
  'temporary-effect',
  'usage',
  'history',
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

  const encounterBeforeMove = parseEncounterState(
    workingMap.encounterState ?? createEmptyEncounterState(),
  )
  const differentMoveReset = resetFuryCutterChainForDifferentMove({
    history: encounterBeforeMove.history,
    actorPlacementId: input.context.actor.placement.id,
    canonicalMoveId: input.trace.program.canonicalId,
  })
  if (differentMoveReset.changed) {
    workingMap.encounterState = parseEncounterState({
      ...encounterBeforeMove,
      history: differentMoveReset.history,
    })
  }

  // Index only the accepted primary resolution before mechanics reducers so
  // later operation touches retain their existing causal attribution and each
  // action/consecutive mechanic is still applied exactly once.
  if (input.recordAcceptedMoveHistory === true) {
    const encounter = parseEncounterState(
      workingMap.encounterState ?? createEmptyEncounterState(),
    )
    const source = input.context.queries.resolveActorMoveEntry(input.trace.program.canonicalId)
    const entry = source.ok ? source.entry : failMoveMapOperationReduction('unsupported-operation', `Accepted Move history cannot resolve canonical source: ${source.message}`)
    const ancestry = input.context.ancestry.at(-1)
    const origin = entry.moveListSource.kind === 'history'
      ? { kind: 'copied' as const, sourceResolutionId: entry.moveListSource.resolutionId }
      : entry.moveListSource.kind === 'reviewed-pool' && ancestry
        ? { kind: 'random' as const, sourceResolutionId: ancestry.resolutionId }
        : { kind: 'direct' as const }
    workingMap.encounterState = parseEncounterState({
      ...encounter,
      history: recordAcceptedMoveHistory({
        history: encounter.history,
        round: Number.isSafeInteger(workingMap.initiative?.round) ? Number(workingMap.initiative!.round) : encounter.history.currentRound,
        operationId: input.presentation.operationId,
        resolutionId: input.context.resolutionId,
        actorPlacementId: input.context.actor.placement.id,
        canonicalMoveId: entry.canonicalMoveName,
        specVersion: input.trace.program.runtimeVersion,
        actionType: actionTypeFromMoveRange(entry.move.range ?? ''),
        origin,
        moveListSource: entry.moveListSource,
        attackedTargetIds: dynamic['attacked-targets'],
        hitTargetIds: dynamic['hit-targets'],
        knockoutTargetIds: input.acceptedMoveKnockoutTargetIds ?? [],
        branchSelections: input.acceptedMoveBranchSelections ?? [],
      }),
    })
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
    const selectorExpectedIds = emission.childResolutionId
      || operation.recipients.kind === 'response-owner'
      ? emittedIds
      : expectedMoveEffectRecipientIds(
          input.context,
          operation,
          dynamic,
          failMoveMapOperationReduction,
        )
    const illusionTargetId = operation.reasonCode === AA075_ILLUSION_BREAK_REASON
      && operation.source.kind === 'lifecycle-event'
      && operation.source.id.startsWith('ability.illusion.target:')
      ? operation.source.id.slice('ability.illusion.target:'.length)
      : null
    const reviewedIllusionNarrowing = illusionTargetId !== null
      && (
        (emittedIds.length === 1
          && emittedIds[0] === illusionTargetId
          && dynamic['hit-targets'].includes(illusionTargetId))
        || (emittedIds.length === 0
          && !dynamic['hit-targets'].includes(illusionTargetId))
      )
    const boundRecipientId = aa085to100BoundRecipientId({ operation })
    const reviewedExactRecipientNarrowing = boundRecipientId !== null
      && (emittedIds.length === 0
        || (emittedIds.length === 1 && emittedIds[0] === boundRecipientId))
    const reviewedStenchNarrowing = operation.reasonCode === 'ability.stench.flinch-accuracy-penalty'
      && emittedIds.every((id, index) => id === selectorExpectedIds[index])
    const expectedIds = reviewedIllusionNarrowing
      || reviewedExactRecipientNarrowing
      || reviewedStenchNarrowing
      ? emittedIds : selectorExpectedIds
    const dynamicGulpMissileConsume = operation.reasonCode === AA073_GULP_MISSILE_CONSUME_REASON
      && emittedIds.every((id, index) => id === expectedIds[index])
    if (
      !moveEffectRecipientIdsEqual(emission.recipientIds, emittedIds)
      || (!dynamicGulpMissileConsume && !moveEffectRecipientIdsEqual(emittedIds, expectedIds))
    ) {
      failMoveMapOperationReduction(
        'recipient-set-mismatch',
        `Operation ${operation.id} recipients do not match selector ${operation.recipients.kind} (emitted ${emittedIds.join(',') || 'none'}; expected ${expectedIds.join(',') || 'none'}).`,
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
      const recipientIds = dynamicGulpMissileConsume ? emittedIds : expectedIds
      if (dynamicGulpMissileConsume && recipientIds.length === 0) {
        operationResults.push(resultFor({
          operation,
          recipientIds,
          changed: false,
          details: { status: 'trigger-not-reached' },
        }))
        return
      }
      const reduced = reduceMoveTemporaryEffect({
        context: operationContext,
        previous: workingMap.encounterState,
        operation,
        recipientIds,
        faintedRecipientIds: dynamic['fainted-targets'],
      })
      if (reduced.changed) {
        workingMap.encounterState = deepCloneJson(reduced.current)
        touch('encounterState', operationTouch)
      }
      operationResults.push(resultFor({
        operation,
        recipientIds,
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

    if (operation.kind === 'history') {
      if (
        input.presentation.move.name !== FURY_CUTTER_CANONICAL_ID
        || operation.payload.event !== 'move-completed'
        || operation.payload.detailCode !== FURY_CUTTER_CHAIN_DETAIL_CODE
      ) {
        failMoveMapOperationReduction(
          'unsupported-operation',
          `History operation ${operation.id} has no reviewed authoritative state reducer.`,
        )
      }
      const encounter = parseEncounterState(
        workingMap.encounterState ?? createEmptyEncounterState(),
      )
      const resolutionId = input.context.resolutionId
        ?? `resolution-${createHash('sha256')
          .update(input.presentation.operationId, 'utf8')
          .digest('hex')}`
      const reduced = reduceFuryCutterChainCompletion({
        history: encounter.history,
        actorPlacementId: input.context.actor.placement.id,
        attackedTargetIds: dynamic['attacked-targets'],
        hitTargetIds: dynamic['hit-targets'],
        damagedTargetIds: dynamic['damaged-targets'],
        resolutionId,
      })
      if (reduced.changed) {
        workingMap.encounterState = parseEncounterState({
          ...encounter,
          history: reduced.history,
        })
        touch('encounterState', operationTouch)
      }
      operationResults.push(resultFor({
        operation,
        recipientIds: expectedIds,
        changed: reduced.changed,
        details: operationDetails({
          status: reduced.outcome,
          targetPlacementId: reduced.targetPlacementId,
          previousTargetPlacementId: reduced.previousTargetPlacementId,
          previousCount: reduced.previousCount,
          currentCount: reduced.currentCount,
        }),
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

  if (input.recordAcceptedMoveHistory === true && (laneTouches.get('encounterState')?.length ?? 0) === 0) {
    touch('encounterState', {
      order: input.operations.length,
      operationId: input.presentation.operationId,
      reasonCode: 'accepted-move.history-recorded',
    })
  }

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
