import { normalizeRevision } from '#shared/sessionRevisions'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
} from '#shared/moveAutomation/trace'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type {
  AuthoritativeMoveMapChanges,
  AuthoritativeMoveSheetWritePlan,
} from '../planAuthoritativeMoveState'
import type { AuthoritativeMoveResolution } from '../resolveAuthoritativeMove'
import {
  buildAuthoritativeMoveRulesContext,
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveSheetRead,
} from './context'
import { buildAuthoritativeMoveMapChanges } from './mapChanges'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChange,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
import { applyAuthoritativeMovePlacementTransition } from './placementTransition'
import type { MoveAutomationRuntimeRegistry } from './registry'
import {
  isMoveMapOperationEmission,
  reduceMoveMapOperations,
} from './reducers/mapOperations'
import type { UseMoveUsageSummary } from '../planMoveUsageTransition'

export type NativeMoveSpecPlanErrorCode =
  | 'native-projection-missing'
  | 'actor-placement-missing'
  | 'usage-projection-missing'
  | 'unsupported-core-map-change'
  | 'movement-operation-missing'
  | 'state-change-conflict'

export class NativeMoveSpecPlanError extends Error {
  readonly code: NativeMoveSpecPlanErrorCode

  constructor(code: NativeMoveSpecPlanErrorCode, message: string) {
    super(message)
    this.name = 'NativeMoveSpecPlanError'
    this.code = code
  }
}

export interface PlannedNativeV2MoveState {
  readonly nextMap: TabletopMap
  readonly revision: number
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
  readonly mapChanges: AuthoritativeMoveMapChanges
  readonly stateChanges: MoveStateChangePlan
  readonly auditTrace: MoveResolutionAuditTrace
}

const fail = (code: NativeMoveSpecPlanErrorCode, message: string): never => {
  throw new NativeMoveSpecPlanError(code, message)
}

const stripPlanIdentity = (change: MoveStateChange): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return {
    ...deepCloneJson(input),
    // Optional map slots use an own `undefined` value to represent absence.
    // JSON cloning drops those keys, so restore both required value fields.
    previous: deepCloneJson(input.previous),
    current: deepCloneJson(input.current),
  } as MoveStateChangeInput
}

const applyCoreMapChanges = (
  map: TabletopMap,
  plan: MoveStateChangePlan,
): TabletopMap => {
  const next = deepCloneJson(map)
  for (const change of plan.changes) {
    if (change.kind === 'map-temporary-hit-points') {
      if (change.current === undefined) delete next.temporaryHitPoints
      else next.temporaryHitPoints = deepCloneJson(change.current)
      continue
    }
    if (change.kind === 'encounter-state') {
      next.encounterState = parseEncounterState(change.current)
      continue
    }
    if (change.scope.kind === 'map' || change.scope.kind === 'placement') {
      return fail(
        'unsupported-core-map-change',
        `Native core reduction unexpectedly emitted ${change.kind}.`,
      )
    }
  }
  return next
}

const placementStateChange = (options: {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly resolution: AuthoritativeMoveResolution
}): MoveStateChangeInput | null => {
  const actorId = options.resolution.actorPlacementId
  const previous = options.previousMap.placements.find(placement => placement.id === actorId)
    ?? fail('actor-placement-missing', `Actor placement ${actorId} was not found.`)
  const current = options.nextMap.placements.find(placement => placement.id === actorId)
    ?? fail('actor-placement-missing', `Actor placement ${actorId} disappeared during planning.`)
  if (sameJsonValue(previous, current)) return null

  const moved = !sameJsonValue(previous.position, current.position)
  const operation = moved
    ? options.resolution.nativeV2?.operations.find(({ operation: candidate }) => (
        candidate.kind === 'movement-request'
      ))?.operation
    : null
  if (moved && (!operation || operation.kind !== 'movement-request')) {
    return fail(
      'movement-operation-missing',
      `${options.resolution.canonicalMoveName} changed position without a movement operation.`,
    )
  }
  return {
    kind: 'placement-state',
    scope: {
      kind: 'placement',
      mapSlug: options.previousMap.slug,
      placementId: actorId,
    },
    expectedRevision: normalizeRevision(options.previousMap.revision),
    sourceOperationId: operation?.id ?? null,
    reasonCode: operation?.reasonCode ?? 'move-facing',
    previous: deepCloneJson(previous),
    current: deepCloneJson(current),
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const combinedStateChanges = (options: {
  readonly resolution: AuthoritativeMoveResolution
  readonly mapPlan: MoveStateChangePlan
  readonly placement: MoveStateChangeInput | null
}): MoveStateChangePlan => {
  const native = options.resolution.nativeV2
    ?? fail('native-projection-missing', 'Native resolution projection is missing.')
  const operationOrder = new Map(
    native.operations.map(({ operation }, index) => [operation.id, index]),
  )
  const inputs = [
    ...native.coreStateChanges.changes.map(stripPlanIdentity),
    ...(options.placement ? [options.placement] : []),
    ...options.mapPlan.changes.map(stripPlanIdentity),
  ].map((input, index) => ({
    input,
    index,
    operationOrder: input.sourceOperationId === null
      ? Number.MAX_SAFE_INTEGER
      : operationOrder.get(input.sourceOperationId) ?? Number.MAX_SAFE_INTEGER,
  })).sort((left, right) => (
    left.operationOrder - right.operationOrder || left.index - right.index
  )).map(({ input }) => input)

  try {
    return createMoveStateChangePlan(inputs)
  }
  catch (error) {
    return fail(
      'state-change-conflict',
      `Native state-change plans could not be combined: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const relatedPlacementIds = (
  resolution: AuthoritativeMoveResolution,
): ReadonlySet<string> => new Set([
  resolution.actorPlacementId,
  ...resolution.selectedTargetIds,
  ...(resolution.area?.candidateTargetIds ?? []),
])

const sheetWritesFromStateChanges = (
  map: TabletopMap,
  resolution: AuthoritativeMoveResolution,
  stateChanges: MoveStateChangePlan,
): readonly AuthoritativeMoveSheetWritePlan[] => {
  const related = relatedPlacementIds(resolution)
  return stateChanges.changes.flatMap((change): AuthoritativeMoveSheetWritePlan[] => {
    if (change.kind !== 'sheet-state') return []
    const placementIds = map.placements
      .filter(placement => (
        related.has(placement.id)
        && placement.sheetKind === change.scope.sheetKind
        && placement.sheetSlug === change.scope.sheetSlug
      ))
      .map(placement => placement.id)
    return [{
      kind: change.scope.sheetKind,
      slug: change.scope.sheetSlug,
      expectedRevision: change.expectedRevision,
      revision: change.current.revision ?? change.expectedRevision + 1,
      previousSheet: deepCloneJson(change.previous),
      nextSheet: deepCloneJson(change.current),
      placementIds,
      changedFields: [...change.changedFields],
    }]
  })
}

const applyMovementTrace = (options: {
  readonly trace: MoveResolutionAuditTrace
  readonly resolution: AuthoritativeMoveResolution
}): MoveResolutionAuditTrace => {
  const movement = options.resolution.movement
  if (!movement) return options.trace
  const operation = options.resolution.nativeV2?.operations.find(({ operation: candidate }) => (
    candidate.kind === 'movement-request'
  ))?.operation
  if (!operation || operation.kind !== 'movement-request') {
    return fail('movement-operation-missing', 'Movement trace operation is missing.')
  }
  let matched = false
  const events = options.trace.events.map((event) => {
    if (event.kind !== 'operation' || event.operationId !== operation.id) return event
    matched = true
    return {
      ...event,
      outcome: 'applied' as const,
      result: {
        status: 'applied',
        from: movement.from,
        destination: movement.destination,
        direction: movement.direction,
        pathCells: movement.pathCells,
      },
    }
  })
  if (!matched) return fail('movement-operation-missing', 'Movement trace event is missing.')
  return parseMoveResolutionAuditTrace({ ...options.trace, events })
}

const actorPlacement = (
  map: TabletopMap,
  actorId: string,
): SheetPlacement => map.placements.find(placement => placement.id === actorId)
  ?? fail('actor-placement-missing', `Actor placement ${actorId} was not found.`)

/** Reduce native map operations and compose one atomic immediate state plan. */
export const planNativeV2MoveState = (options: {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly resolution: AuthoritativeMoveResolution
  readonly plannedAt: number
  readonly operationId?: string
  readonly maxMoveLogEntries?: number
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  readonly legacyScripts?: ReadonlyMap<string, MoveAutomationScript>
  readonly existingSheetReads: readonly AuthoritativeMoveSheetRead[]
}): PlannedNativeV2MoveState => {
  const native = options.resolution.nativeV2
    ?? fail('native-projection-missing', 'Native resolution projection is missing.')
  const context = buildAuthoritativeMoveRulesContext({
    map: options.map,
    pokemonSheets: options.pokemonSheets,
    trainerSheets: options.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: options.resolution.actorPlacementId,
      moveName: options.resolution.canonicalMoveName,
      selection: options.resolution.area
        ? {
            kind: 'area',
            areaTemplateId: options.resolution.area.areaTemplateId,
            ...(options.resolution.area.direction
              ? { direction: options.resolution.area.direction }
              : {}),
          }
        : { kind: 'self' },
    },
    candidatePlacementIds: options.resolution.area?.candidateTargetIds,
    selectedPlacementIds: options.resolution.selectedTargetIds,
    random: () => 0,
    time: options.plannedAt,
    runtimeRegistry: options.runtimeRegistry,
    legacyScripts: options.legacyScripts,
  })
  context.reads.recordPlacement(context.actor.placement)

  const mapOperations = native.operations.filter(isMoveMapOperationEmission)
  const usageResources = mapOperations.flatMap(({ operation }) => operation.kind === 'usage'
    ? [{
        resourceId: operation.payload.resourceId,
        placementId: options.resolution.actorPlacementId,
        move: {
          moveName: options.resolution.canonicalMoveName,
          moveKey: options.resolution.moveKey,
          frequency: options.resolution.frequency,
        },
      }]
    : [])
  const mapReduction = reduceMoveMapOperations({
    context,
    operations: mapOperations,
    dynamicRecipients: native.dynamicRecipients,
    usageResources,
    presentation: {
      operationId: options.operationId ?? 'op_nativeplan0001',
      move: {
        name: options.resolution.moveName,
        type: options.resolution.script.type,
      },
      selectedTargetIds: options.resolution.selectedTargetIds,
      ...(options.resolution.area ? {
        area: {
          templateKind: options.resolution.area.template.kind,
          cells: options.resolution.area.cells,
          ...(options.resolution.area.direction
            ? { direction: options.resolution.area.direction }
            : {}),
        },
      } : {}),
      ...(options.resolution.movement ? {
        pass: {
          from: options.resolution.movement.from,
          destination: options.resolution.movement.destination,
          pathCells: options.resolution.movement.pathCells,
          direction: options.resolution.movement.direction,
        },
      } : {}),
    },
    actorName: options.resolution.transaction.userName,
    frequency: options.resolution.frequency,
    logLines: options.resolution.transaction.logLines,
    trace: native.trace,
    maxLogEntries: options.maxMoveLogEntries,
  })
  const usageProjection = mapReduction.usage[0]
    ?? fail(
      'usage-projection-missing',
      `${options.resolution.canonicalMoveName} did not emit its reviewed usage operation.`,
    )

  const mapWithCore = applyCoreMapChanges(mapReduction.nextMap, native.coreStateChanges)
  const transitionedMap = applyAuthoritativeMovePlacementTransition({
    map: mapWithCore,
    actorPlacement: actorPlacement(options.map, options.resolution.actorPlacementId),
    movement: options.resolution.movement,
    desiredFacing: options.resolution.desiredFacing,
    fail: (code, message) => fail(
      code === 'pass-source-position-mismatch'
        ? 'state-change-conflict'
        : 'unsupported-core-map-change',
      `${code}: ${message}`,
    ),
  })
  const nextMap: TabletopMap = {
    ...transitionedMap,
    revision: mapReduction.revision,
    updatedAt: options.plannedAt,
  }
  const placement = placementStateChange({
    previousMap: options.map,
    nextMap,
    resolution: options.resolution,
  })
  const stateChanges = combinedStateChanges({
    resolution: options.resolution,
    mapPlan: mapReduction.stateChanges,
    placement,
  })
  const auditTrace = applyMovementTrace({
    trace: mapReduction.trace,
    resolution: options.resolution,
  })
  const sheetReads = deduplicateAuthoritativeMoveSheetReads([
    ...options.existingSheetReads,
    ...mapReduction.sheetReads,
  ])

  return {
    nextMap: deepCloneJson(nextMap),
    revision: mapReduction.revision,
    previousUsage: deepCloneJson(usageProjection.previousUsage),
    usage: deepCloneJson(usageProjection.usage),
    sheetReads: deepCloneJson(sheetReads),
    sheetWrites: sheetWritesFromStateChanges(options.map, options.resolution, stateChanges),
    mapChanges: buildAuthoritativeMoveMapChanges(options.map, nextMap),
    stateChanges,
    auditTrace,
  }
}
