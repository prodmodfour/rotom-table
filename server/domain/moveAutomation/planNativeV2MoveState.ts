import { normalizeRevision } from '#shared/sessionRevisions'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
} from '#shared/moveAutomation/trace'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { moveUsageKey } from '~/utils/moveUsage'
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
  applyMoveItemEffectResultsToTrace,
} from './itemEffectInterpreter'
import type {
  AuthoritativeMoveItemResources,
} from './itemResources'
import type { PlannedMoveItemMutations } from './itemMutationTypes'
import { mergeDisjointMoveSheetStateChanges } from './mergeSheetStateChanges'
import { planMoveItemMutations } from './planItemMutations'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveStateChange,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
import { applyAuthoritativeMovePlacementTransition } from './placementTransition'
import { planAuthoritativeMoveSwitch } from './planMoveSwitch'
import { cleanupEncounterTransformationsForKnockouts } from './transformationLifecycle'
import { cleanupYawnEffectsForKnockouts } from './yawn'
import { consumeHelpingHandBonus } from './helpingHand'
import { planMoveSwitchCombatStageTransfer } from './planSwitchCombatStages'
import type { MoveAutomationRuntimeRegistry } from './registry'
import { createMoveSpecOperationContextResolver } from './resolveImmediateSpec'
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

export const applyNativeCoreMapChanges = (
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
    if (change.kind === 'map-initiative') {
      if (change.current === undefined) delete next.initiative
      else next.initiative = deepCloneJson(change.current)
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

const placementStateChanges = (options: {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly resolution: AuthoritativeMoveResolution
}): readonly MoveStateChangeInput[] => {
  const actorId = options.resolution.actorPlacementId
  const previous = options.previousMap.placements.find(placement => placement.id === actorId)
    ?? fail('actor-placement-missing', `Actor placement ${actorId} was not found.`)
  const switchTransition = options.resolution.switchTransition
  if (switchTransition) {
    const currentActor = options.nextMap.placements.find(placement => placement.id === actorId)
    const sentOut = options.nextMap.placements.find(
      placement => placement.id === switchTransition.sentOutPlacement.id,
    )
    if (currentActor || !sentOut) {
      return fail(
        'state-change-conflict',
        `${options.resolution.canonicalMoveName} did not produce an exact recall/send-out pair.`,
      )
    }
    const common = {
      expectedRevision: normalizeRevision(options.previousMap.revision),
      sourceOperationId: switchTransition.operationId,
      reasonCode: 'move-switch-recall-and-send-out',
      compensation: unavailableMoveStateCompensation(
        'accepted-switch-placement-may-be-observed',
        'externally-observed',
      ),
    } as const
    return [
      {
        ...common,
        kind: 'placement-state',
        scope: {
          kind: 'placement',
          mapSlug: options.previousMap.slug,
          placementId: actorId,
        },
        previous: deepCloneJson(previous),
        current: null,
      },
      {
        ...common,
        kind: 'placement-state',
        scope: {
          kind: 'placement',
          mapSlug: options.previousMap.slug,
          placementId: sentOut.id,
        },
        previous: null,
        current: deepCloneJson(sentOut),
      },
    ]
  }

  const current = options.nextMap.placements.find(placement => placement.id === actorId)
    ?? fail('actor-placement-missing', `Actor placement ${actorId} disappeared during planning.`)
  if (sameJsonValue(previous, current)) return []

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
  return [{
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
  }]
}

const switchMapStateChanges = (options: {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly resolution: AuthoritativeMoveResolution
  readonly existing: readonly MoveStateChange[]
}): readonly MoveStateChangeInput[] => {
  const transition = options.resolution.switchTransition
  if (!transition) return []
  const expectedRevision = normalizeRevision(options.previousMap.revision)
  const mapScope = { kind: 'map' as const, mapSlug: options.previousMap.slug }
  const sourceFor = (kind: MoveStateChange['kind']): string | null => (
    options.existing.some(change => change.kind === kind)
      ? null
      : transition.operationId
  )
  const changes: MoveStateChangeInput[] = []
  if (!sameJsonValue(options.previousMap.temporaryHitPoints, options.nextMap.temporaryHitPoints)) {
    changes.push({
      kind: 'map-temporary-hit-points',
      scope: mapScope,
      expectedRevision,
      sourceOperationId: sourceFor('map-temporary-hit-points'),
      reasonCode: 'move-switch-source-leave-temporary-hp',
      previous: deepCloneJson(options.previousMap.temporaryHitPoints),
      current: deepCloneJson(options.nextMap.temporaryHitPoints),
      compensation: unavailableMoveStateCompensation(
        'accepted-switch-source-leave-cleanup',
        'externally-observed',
      ),
    })
  }
  if (!sameJsonValue(options.previousMap.initiative, options.nextMap.initiative)) {
    changes.push({
      kind: 'map-initiative',
      scope: mapScope,
      expectedRevision,
      sourceOperationId: transition.operationId,
      reasonCode: 'move-switch-inherit-initiative-slot',
      previous: deepCloneJson(options.previousMap.initiative),
      current: deepCloneJson(options.nextMap.initiative),
      compensation: unavailableMoveStateCompensation(
        'accepted-switch-initiative-may-be-observed',
        'externally-observed',
      ),
    })
  }
  const previousEncounter = parseEncounterState(
    options.previousMap.encounterState ?? createEmptyEncounterState(),
  )
  const currentEncounter = parseEncounterState(
    options.nextMap.encounterState ?? createEmptyEncounterState(),
  )
  if (!sameJsonValue(previousEncounter, currentEncounter)) {
    changes.push({
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: options.previousMap.slug },
      expectedRevision,
      sourceOperationId: sourceFor('encounter-state'),
      reasonCode: sourceFor('encounter-state') === null
        ? 'move-effects-and-switch-lifecycle'
        : 'move-switch-source-leave-lifecycle',
      previous: deepCloneJson(previousEncounter),
      current: deepCloneJson(currentEncounter),
      compensation: unavailableMoveStateCompensation(
        'accepted-switch-lifecycle-may-be-observed',
        'externally-observed',
      ),
    })
  }
  return changes
}

const stateSlotKey = (input: MoveStateChangeInput): string => {
  if (input.scope.kind === 'map') return `map:${input.kind}`
  if (input.scope.kind === 'encounter') return 'encounter'
  if (input.scope.kind === 'placement') return `placement:${input.scope.placementId}`
  if (input.scope.kind === 'sheet') return `sheet:${input.scope.sheetKind}:${input.scope.sheetSlug}`
  return `external:${input.scope.resourceKind}:${input.scope.resourceId}`
}

const combinedStateChanges = (options: {
  readonly previousMap: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly plannedAt: number
  readonly resolution: AuthoritativeMoveResolution
  readonly mapPlan: MoveStateChangePlan
  readonly itemPlan: PlannedMoveItemMutations
  readonly placements: readonly MoveStateChangeInput[]
  readonly switchMapChanges: readonly MoveStateChangeInput[]
}): MoveStateChangePlan => {
  const native = options.resolution.nativeV2
    ?? fail('native-projection-missing', 'Native resolution projection is missing.')
  const operationOrder = new Map(
    native.operations.map(({ operation }, index) => [operation.id, index]),
  )
  const replacedSlots = new Set(options.switchMapChanges.map(stateSlotKey))
  const mapInputs = options.mapPlan.changes.map(stripPlanIdentity)
  const itemInputs = options.itemPlan.stateChanges.changes.map(stripPlanIdentity)
  const permanentMoveListInputs = native.permanentMoveListStateChanges.changes
    .map(stripPlanIdentity)
  const coreInputs = native.coreStateChanges.changes.map(stripPlanIdentity)
  const mapEncounter = mapInputs.find(input => input.kind === 'encounter-state')
  const itemEncounter = itemInputs.find(input => input.kind === 'encounter-state')
  const coreEncounter = coreInputs.find(input => input.kind === 'encounter-state')
  const coalescedItemInputs = itemInputs.flatMap((input): MoveStateChangeInput[] => {
    if (input.kind !== 'encounter-state') return [input]
    if (mapEncounter) return []
    return [{
      ...input,
      sourceOperationId: coreEncounter ? null : input.sourceOperationId,
      reasonCode: coreEncounter
        ? 'core-effects-and-item-state'
        : input.reasonCode,
      previous: deepCloneJson(
        coreEncounter?.previous
          ?? parseEncounterState(
            options.previousMap.encounterState ?? createEmptyEncounterState(),
          ),
      ),
    }]
  })
  const coalescedCoreInputs = coreInputs.filter(input => !(
    input.kind === 'encounter-state' && (mapEncounter || itemEncounter)
  ))
  const coalescedMapInputs = mapInputs.map((input): MoveStateChangeInput => (
    input.kind === 'encounter-state' && (coreEncounter || itemEncounter)
      ? {
          ...input,
          sourceOperationId: null,
          reasonCode: 'core-item-and-battlefield-state',
        }
      : input
  ))
  const existingInputs = [
    ...coalescedCoreInputs,
    ...permanentMoveListInputs,
    ...coalescedItemInputs,
    ...options.placements,
    ...coalescedMapInputs,
  ].filter(input => !replacedSlots.has(stateSlotKey(input)))
  const rawInputs = [
    ...existingInputs,
    ...options.switchMapChanges,
  ]

  try {
    const transition = options.resolution.switchTransition
    const mergedInputs = transition
      ? planMoveSwitchCombatStageTransfer({
          stateChanges: rawInputs,
          recalledPlacement: actorPlacement(
            options.previousMap,
            transition.recalledPlacementId,
          ),
          sentOutPlacement: transition.sentOutPlacement,
          pokemonSheets: options.pokemonSheets,
          operationId: transition.operationId,
          plannedAt: options.plannedAt,
          stateTransferPolicy: transition.stateTransferPolicy,
        }).stateChanges
      : mergeDisjointMoveSheetStateChanges(rawInputs)
    const inputs = mergedInputs.map((input, index) => ({
      input,
      index,
      operationOrder: input.sourceOperationId === null
        ? Number.MAX_SAFE_INTEGER
        : operationOrder.get(input.sourceOperationId) ?? Number.MAX_SAFE_INTEGER,
    })).sort((left, right) => (
      left.operationOrder - right.operationOrder || left.index - right.index
    )).map(({ input }) => input)
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
  resolution: Pick<
    AuthoritativeMoveResolution,
    'actorPlacementId' | 'selectedTargetIds' | 'area' | 'switchTransition'
  >,
): ReadonlySet<string> => new Set([
  resolution.actorPlacementId,
  ...resolution.selectedTargetIds,
  ...(resolution.area?.candidateTargetIds ?? []),
  ...(resolution.switchTransition ? [resolution.switchTransition.sentOutPlacement.id] : []),
])

export const nativeSheetWritesFromStateChanges = (
  map: TabletopMap,
  resolution: Pick<
    AuthoritativeMoveResolution,
    'actorPlacementId' | 'selectedTargetIds' | 'area' | 'switchTransition'
  >,
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
        ...(movement.direction ? { direction: movement.direction } : {}),
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
  readonly itemResources?: AuthoritativeMoveItemResources
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
    itemResources: options.itemResources,
  })
  context.reads.recordPlacement(context.actor.placement)

  const originOperationId = options.operationId ?? 'op_nativeplan0001'
  const mapWithCoreEffects = applyNativeCoreMapChanges(
    options.map,
    native.coreStateChanges,
  )
  const mapAfterHelpingHand = consumeHelpingHandBonus({
    map: mapWithCoreEffects,
    resolution: options.resolution.helpingHandBonus,
  }).map
  const mapAfterTransformationCleanup = cleanupEncounterTransformationsForKnockouts({
    map: mapAfterHelpingHand,
    placementIds: native.faintedPlacementIds,
  }).map
  const mapAfterKnockoutCleanup = cleanupYawnEffectsForKnockouts({
    map: mapAfterTransformationCleanup,
    placementIds: native.faintedPlacementIds,
  }).map
  const itemPlan = planMoveItemMutations({
    map: mapAfterKnockoutCleanup,
    pokemonSheets: options.pokemonSheets,
    trainerSheets: options.trainerSheets,
    groupInventories: options.itemResources?.groupInventories ?? new Map(),
    operations: native.itemEffects.mutations,
    consumedItems: options.itemResources?.consumedItems ?? [],
    originOperationId,
    plannedAt: options.plannedAt,
  })
  const itemTrace = applyMoveItemEffectResultsToTrace({
    trace: native.trace,
    interpretation: native.itemEffects,
    mutationResults: itemPlan.operationResults,
  })
  const mapOperations = native.operations.filter(isMoveMapOperationEmission)
  const contextForOperation = createMoveSpecOperationContextResolver({
    root: context,
    children: native.childExecutions,
  })
  const usageResources = mapOperations.flatMap((emission) => {
    const { operation } = emission
    if (operation.kind !== 'usage') return []
    if (!emission.childResolutionId) {
      return [{
        resourceId: operation.payload.resourceId,
        placementId: options.resolution.actorPlacementId,
        move: {
          moveName: options.resolution.canonicalMoveName,
          moveKey: options.resolution.moveKey,
          frequency: options.resolution.frequency,
        },
      }]
    }
    const child = native.childExecutions.find(execution => (
      execution.resolutionId === emission.childResolutionId
    )) ?? fail(
      'state-change-conflict',
      `Usage operation ${operation.id} lost its reviewed child execution identity.`,
    )
    const move = findMove(child.canonicalId)
    const childMoveKey = moveUsageKey(child.canonicalId)
    if (!move || !childMoveKey) {
      return fail(
        'usage-projection-missing',
        `Reviewed child ${child.canonicalId} has no canonical usage metadata.`,
      )
    }
    return [{
      resourceId: operation.payload.resourceId,
      placementId: child.actorPlacementId,
      move: {
        moveName: child.canonicalId,
        moveKey: childMoveKey,
        frequency: move.frequency ?? null,
      },
    }]
  })
  const mapReduction = reduceMoveMapOperations({
    context,
    initialMap: itemPlan.nextMap,
    operations: mapOperations,
    dynamicRecipients: native.dynamicRecipients,
    contextForOperation,
    usageResources,
    hazards: {
      cellSets: new Map(native.resolvedHazardCells.map(selection => [
        selection.cellSetId,
        selection.cells,
      ])),
    },
    presentation: {
      operationId: originOperationId,
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
      ...(options.resolution.movement?.kind === 'pass' ? {
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
    trace: itemTrace,
    maxLogEntries: options.maxMoveLogEntries,
  })
  const rootUsageOperationId = mapOperations.find(emission => (
    emission.operation.kind === 'usage' && !emission.childResolutionId
  ))?.operation.id
  const usageProjection = mapReduction.usage.find(projection => (
    projection.operationId === rootUsageOperationId
  )) ?? fail(
    'usage-projection-missing',
    `${options.resolution.canonicalMoveName} did not emit its reviewed usage operation.`,
  )

  const placementTransitionMap = applyAuthoritativeMovePlacementTransition({
    map: mapReduction.nextMap,
    actorPlacement: actorPlacement(options.map, options.resolution.actorPlacementId),
    movement: options.resolution.movement,
    desiredFacing: options.resolution.desiredFacing,
    fail: (code, message) => fail(
      code === 'pass-source-position-mismatch' || code === 'shift-source-position-mismatch'
        ? 'state-change-conflict'
        : 'unsupported-core-map-change',
      `${code}: ${message}`,
    ),
  })
  const switchedMap = options.resolution.switchTransition
    ? planAuthoritativeMoveSwitch({
        map: placementTransitionMap,
        transition: options.resolution.switchTransition,
      }).nextMap
    : placementTransitionMap
  const nextMap: TabletopMap = {
    ...switchedMap,
    revision: mapReduction.revision,
    updatedAt: options.plannedAt,
  }
  const placements = placementStateChanges({
    previousMap: options.map,
    nextMap,
    resolution: options.resolution,
  })
  const existingChanges = [
    ...native.coreStateChanges.changes,
    ...native.permanentMoveListStateChanges.changes,
    ...itemPlan.stateChanges.changes,
    ...mapReduction.stateChanges.changes,
  ]
  const switchMapChanges = switchMapStateChanges({
    previousMap: options.map,
    nextMap,
    resolution: options.resolution,
    existing: existingChanges,
  })
  const stateChanges = combinedStateChanges({
    previousMap: options.map,
    pokemonSheets: options.pokemonSheets,
    plannedAt: options.plannedAt,
    resolution: options.resolution,
    mapPlan: mapReduction.stateChanges,
    itemPlan,
    placements,
    switchMapChanges,
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
    sheetWrites: nativeSheetWritesFromStateChanges(nextMap, options.resolution, stateChanges),
    mapChanges: buildAuthoritativeMoveMapChanges(options.map, nextMap),
    stateChanges,
    auditTrace,
  }
}
