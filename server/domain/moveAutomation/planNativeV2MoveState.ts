import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
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
import { cleanupVortexEffectsForKnockouts } from './vortex'
import { consumeHelpingHandBonus } from './helpingHand'
import { consumeSideDamageResistance } from './sideDamageResistance'
import { planMoveSwitchCombatStageTransfer } from './planSwitchCombatStages'
import type { MoveAutomationRuntimeRegistry } from './registry'
import { createMoveSpecOperationContextResolver } from './resolveImmediateSpec'
import {
  isMoveMapOperationEmission,
  reduceMoveMapOperations,
} from './reducers/mapOperations'
import type { UseMoveUsageSummary } from '../planMoveUsageTransition'
import { createEmptyAbilityOwnedState } from '#shared/abilityAutomation/ownedState'
import {
  createEmptyAbilityDailyUsageLedger,
  parseAbilityDailyUsageLedger,
  parseAbilitySceneUsageLedger,
  type AbilityUsageEntry,
} from '#shared/abilityAutomation/resources'
import { reduceAbilityOwnedStateCommand } from '../abilityAutomation/ownedState'
import { aa060MoveMarkId } from '../abilityAutomation/mechanics/aa060MoveIntegration'
import { Aa060AnchoredMovementError, assertAa060AnchoredDestination } from '../abilityAutomation/mechanics/aa060'
import { aa061AquaBulletStateIdsForMove, aa061BatteryStateIdsForMove } from '../abilityAutomation/mechanics/aa061MoveIntegration'
import { aa062BoneLordReadyStateIds } from '../abilityAutomation/mechanics/aa062MoveIntegration'
import { recordAa065CudChewConsumptions } from '../abilityAutomation/mechanics/aa065ItemIntegration'
import { applyAa061BallFetchSendOutTriggers } from '../abilityAutomation/mechanics/aa061PresenceIntegration'
import { applyAa065CuriousMedicineSendOutTrigger } from '../abilityAutomation/mechanics/aa065PresenceIntegration'
import { recordAa066DeadlyPoisonTriggers } from '../abilityAutomation/mechanics/aa066ConditionIntegration'
import { resolveSheetAbilityInstances } from '../abilityAutomation/instanceParameters'
import { applyAa067DelayedReactionDebts } from '../abilityAutomation/mechanics/aa067LifecycleIntegration'
import { aa067DiamondDefenseMoveFrequency } from '../abilityAutomation/mechanics/aa067StaticIntegration'
import { planEncounterMoveResourceCosts } from './planMoveResources'

export type NativeMoveSpecPlanErrorCode =
  | 'native-projection-missing'
  | 'actor-placement-missing'
  | 'usage-projection-missing'
  | 'unsupported-core-map-change'
  | 'movement-operation-missing'
  | 'spatial-movement-conflict'
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
    if (change.kind === 'map-field-effects') {
      next.fieldEffects = deepCloneJson(change.current)
      continue
    }
    if (change.kind === 'map-hazards') {
      next.hazards = deepCloneJson([...change.current])
      continue
    }
    if (change.kind === 'map-move-usage') {
      if (change.current === undefined) delete next.moveUsage
      else next.moveUsage = deepCloneJson(change.current)
      continue
    }
    if (change.kind === 'placement-state') {
      const index = next.placements.findIndex(placement => placement.id === change.scope.placementId)
      if (change.current === null) {
        if (index >= 0) next.placements.splice(index, 1)
      }
      else if (index >= 0) next.placements[index] = deepCloneJson(change.current)
      else next.placements.push(deepCloneJson(change.current))
      continue
    }
    if (change.kind === 'map-metadata') {
      if (change.current === undefined) delete next.metadata
      else next.metadata = deepCloneJson(change.current)
      continue
    }
    if ((change.scope as { readonly kind: string }).kind === 'map') {
      return fail(
        'unsupported-core-map-change',
        `Native core reduction unexpectedly emitted ${change.kind}.`,
      )
    }
  }
  return next
}

const sameAnchor = (
  left: SheetPlacement['position'],
  right: SheetPlacement['position'],
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

/** Apply only already oracle-validated spatial endpoints in operation order. */
export const applyNativeSpatialMovements = (
  map: TabletopMap,
  movements: NonNullable<AuthoritativeMoveResolution['nativeV2']>['spatialMovements'],
): TabletopMap => {
  const next = deepCloneJson(map)
  for (const movement of movements) {
    const index = next.placements.findIndex(placement => (
      placement.id === movement.recipientPlacementId
    ))
    const placement = next.placements[index]
    if (!placement) {
      return fail(
        'spatial-movement-conflict',
        `Spatial movement ${movement.operationId} references missing placement ${movement.recipientPlacementId}.`,
      )
    }
    if (!sameAnchor(placement.position, movement.origin)) {
      return fail(
        'spatial-movement-conflict',
        `Spatial movement ${movement.operationId} source no longer matches ${movement.recipientPlacementId}.`,
      )
    }
    try {
      assertAa060AnchoredDestination({
        map: next,
        placementId: movement.recipientPlacementId,
        destination: movement.destination,
      })
    }
    catch (error) {
      if (error instanceof Aa060AnchoredMovementError) {
        return fail('spatial-movement-conflict', error.message)
      }
      throw error
    }
    next.placements[index] = {
      ...placement,
      position: deepCloneJson(movement.destination),
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
  if (!options.previousMap.placements.some(placement => placement.id === actorId)) {
    fail('actor-placement-missing', `Actor placement ${actorId} was not found.`)
  }
  const switchTransition = options.resolution.switchTransition
  if (switchTransition) {
    const recalledPlacementId = switchTransition.recalledPlacementId
    const previousRecalled = options.previousMap.placements.find(
      placement => placement.id === recalledPlacementId,
    ) ?? fail('state-change-conflict', `Recalled placement ${recalledPlacementId} disappeared.`)
    const currentRecalled = options.nextMap.placements.find(
      placement => placement.id === recalledPlacementId,
    )
    const sentOut = switchTransition.kind === 'recall-and-send-out'
      ? options.nextMap.placements.find(
          placement => placement.id === switchTransition.sentOutPlacement.id,
        )
      : null
    if (
      currentRecalled
      || (switchTransition.kind === 'recall-and-send-out' && !sentOut)
    ) {
      return fail(
        'state-change-conflict',
        `${options.resolution.canonicalMoveName} did not produce its reviewed recall transition.`,
      )
    }
    const common = {
      expectedRevision: normalizeRevision(options.previousMap.revision),
      sourceOperationId: switchTransition.operationId,
      reasonCode: switchTransition.kind === 'recall-and-send-out'
        ? 'move-switch-recall-and-send-out'
        : 'move-switch-recall-only',
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
          placementId: recalledPlacementId,
        },
        previous: deepCloneJson(previousRecalled),
        current: null,
      },
      ...(sentOut
        ? [{
            ...common,
            kind: 'placement-state' as const,
            scope: {
              kind: 'placement' as const,
              mapSlug: options.previousMap.slug,
              placementId: sentOut.id,
            },
            previous: null,
            current: deepCloneJson(sentOut),
          }]
        : []),
    ]
  }

  const native = options.resolution.nativeV2
    ?? fail('native-projection-missing', 'Native resolution projection is missing.')
  const currentById = new Map(options.nextMap.placements.map(placement => [placement.id, placement]))
  const spatialByPlacement = new Map<string, typeof native.spatialMovements[number][]>()
  for (const movement of native.spatialMovements) {
    const entries = spatialByPlacement.get(movement.recipientPlacementId) ?? []
    entries.push(movement)
    spatialByPlacement.set(movement.recipientPlacementId, entries)
  }
  const actorMovementOperation = options.resolution.movement
    ? native.operations.find(({ operation }) => operation.kind === 'movement-request')?.operation
    : null
  const expectedRevision = normalizeRevision(options.previousMap.revision)
  const changes: MoveStateChangeInput[] = []

  for (const previous of options.previousMap.placements) {
    const current = currentById.get(previous.id)
      ?? fail(
        'state-change-conflict',
        `${options.resolution.canonicalMoveName} unexpectedly removed placement ${previous.id}.`,
      )
    if (sameJsonValue(previous, current)) continue

    const moved = !sameJsonValue(previous.position, current.position)
    const spatial = spatialByPlacement.get(previous.id) ?? []
    const spatialOperationIds = [...new Set(spatial.map(movement => movement.operationId))]
    let sourceOperationId: string | null = null
    let reasonCode = 'move-facing'

    if (spatialOperationIds.length > 0) {
      sourceOperationId = spatialOperationIds.length === 1 ? spatialOperationIds[0]! : null
      reasonCode = sourceOperationId
        ? native.operations.find(({ operation }) => operation.id === sourceOperationId)?.operation.reasonCode
          ?? 'move-spatial-displacement'
        : 'move-spatial-sequence'
    }
    else if (previous.id === actorId && moved) {
      if (!actorMovementOperation || actorMovementOperation.kind !== 'movement-request') {
        return fail(
          'movement-operation-missing',
          `${options.resolution.canonicalMoveName} changed actor position without a movement operation.`,
        )
      }
      sourceOperationId = actorMovementOperation.id
      reasonCode = actorMovementOperation.reasonCode
    }
    else if (previous.id !== actorId) {
      return fail(
        'movement-operation-missing',
        `${options.resolution.canonicalMoveName} changed placement ${previous.id} without a spatial movement operation.`,
      )
    }

    changes.push({
      kind: 'placement-state',
      scope: {
        kind: 'placement',
        mapSlug: options.previousMap.slug,
        placementId: previous.id,
      },
      expectedRevision,
      sourceOperationId,
      reasonCode,
      previous: deepCloneJson(previous),
      current: deepCloneJson(current),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }

  if (currentById.size !== options.previousMap.placements.length) {
    return fail(
      'state-change-conflict',
      `${options.resolution.canonicalMoveName} unexpectedly added a placement without a switch.`,
    )
  }
  return changes
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
  readonly triggeredAbilityPlan: MoveStateChangePlan
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
  const triggeredAbilityInputs = options.triggeredAbilityPlan.changes.map(stripPlanIdentity)
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
    ...triggeredAbilityInputs,
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
    const mergedInputs = transition?.kind === 'recall-and-send-out'
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
  ...(resolution.switchTransition?.kind === 'recall-and-send-out'
    ? [resolution.switchTransition.sentOutPlacement.id]
    : []),
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

const abilityUsageEntryKey = (entry: Pick<AbilityUsageEntry, 'ownerId' | 'abilityInstanceId' | 'canonicalId' | 'clauseId'>): string => (
  `${entry.ownerId}\u0000${entry.abilityInstanceId}\u0000${entry.canonicalId}\u0000${entry.clauseId}`
)

interface TriggeredAbilityPaymentResult {
  readonly map: TabletopMap
  readonly sheetStateChanges: MoveStateChangePlan
}

const applyTriggeredAbilityPayments = (input: {
  readonly map: TabletopMap
  readonly context: ReturnType<typeof buildAuthoritativeMoveRulesContext>
  readonly traces: readonly MoveResolutionAuditTrace[]
  readonly resolutionId: string
}): TriggeredAbilityPaymentResult => {
  const canonicalIdByReason = new Map<string, string>([
    ['ability.absorb-force.optional-resistance', 'Absorb Force'],
    ['ability.aftermath.optional-hp-loss', 'Aftermath'],
    ['ability.anger-point.optional-attack-stage', 'Anger Point'],
    ['ability.aqua-boost.optional-damage', 'Aqua Boost'],
    ['ability.beast-boost.optional-stage', 'Beast Boost'],
    ['ability.bodyguard.optional-redirection', 'Bodyguard'],
    ['ability.bully.optional-effects', 'Bully'],
    ['ability.celebrate.optional-disengage', 'Celebrate'],
    ['ability.chilling-neigh.optional-boost', 'Chilling Neigh'],
    ['ability.color-change.optional-type', 'Color Change'],
    ['ability.combo-striker.optional-struggle', 'Combo Striker'],
    ['ability.conqueror.optional-stages', 'Conqueror'],
    ['ability.corrosive-toxins.optional-bypass', 'Corrosive Toxins'],
    ['ability.cotton-down.optional-burst', 'Cotton Down'],
    ['ability.cruelty.optional-purchases', 'Cruelty'],
    ['ability.crush-trap.optional-struggle', 'Crush Trap'],
    ['ability.cursed-body.optional-disable', 'Cursed Body'],
    ['ability.cute-charm.optional-infatuation', 'Cute Charm'],
    ['ability.cute-tears.optional-stage-loss', 'Cute Tears'],
    ['ability.dancer.optional-copy', 'Dancer'],
    ['ability.danger-syrup.optional-sweet-scent', 'Danger Syrup'],
    ['ability.delayed-reaction.optional-half', 'Delayed Reaction'],
    ['ability.dig-away.optional-avoid', 'Dig Away'],
    ['ability.disguise.optional-avoid', 'Disguise'],
    ['ability.dodge.optional-avoid', 'Dodge'],
    ['ability.dragons-maw.optional-vulnerability', 'Dragon’s Maw'],
    ['ability.dream-smoke.optional-sleep', 'Dream Smoke'],
    ['ability.drown-out.optional-cancel', 'Drown Out'],
    ['ability.effect-spore.optional-condition', 'Effect Spore'],
    ['ability.emergency-exit.optional-switch', 'Emergency Exit'],
    ['ability.fade-away.optional-avoid', 'Fade Away'],
  ])
  const noFrequency = new Set([
    'Anger Point', 'Aqua Boost', 'Beast Boost', 'Celebrate', 'Chilling Neigh',
    'Color Change', 'Combo Striker',
  ])
  const daily = new Set(['Dig Away', 'Disguise', 'Dodge'])
  const triggeringMoveByOperationId = new Map(input.traces.flatMap(trace => (
    trace.events.flatMap(event => event.kind === 'operation'
      ? [[event.operationId, trace.program.canonicalId] as const]
      : [])
  )))
  const selections = input.traces.flatMap(trace => trace.events).filter(event => (
    event.kind === 'operation'
    && canonicalIdByReason.has(event.reasonCode)
    && event.outcome === 'applied'
    && event.recipientIds.length === 1
  ))
  interface DailySheetWork {
    readonly placement: SheetPlacement
    readonly previous: CharacterSheet | TrainerSheet
    current: CharacterSheet | TrainerSheet
    readonly sourceOperationId: string
  }
  const dailySheets = new Map<string, DailySheetWork>()
  let map = input.map
  for (const selection of selections) {
    if (selection.kind !== 'operation') continue
    const ownerId = selection.recipientIds[0]!
    const canonicalId = canonicalIdByReason.get(selection.reasonCode)!
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === canonicalId)
      ?? fail('state-change-conflict', `Selected ${canonicalId} response lost its effective runtime.`)
    const actionResources = canonicalId === 'Celebrate'
      ? (['swift', 'free'] as const)
      : canonicalId === 'Cruelty'
        ? (['swift'] as const)
        : canonicalId === 'Dig Away'
          ? (['free', 'standard'] as const)
          : canonicalId === 'Fade Away'
            ? (['standard'] as const)
            : (['free'] as const)
    const action = planEncounterMoveResourceCosts({
      map,
      placementId: ownerId,
      canonicalMoveId: `ability:${canonicalId}`,
      moveKey: `ability:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
      range: canonicalId === 'Celebrate' || canonicalId === 'Cruelty'
        ? 'Swift Action'
        : canonicalId === 'Fade Away'
          ? 'Standard Action'
          : 'Free Action',
      resolutionId: input.resolutionId,
      sourceOperationId: `${selection.operationId}:action`,
      movement: null,
      reviewedCosts: actionResources.map(resource => ({
        id: `ability.action.${resource}`, phase: 'pay' as const,
        cost: { kind: 'action-resource' as const, resource, amount: 1 },
      })),
      allowLegacyFallback: false,
      minimumPhaseExclusive: null,
      maximumPhaseInclusive: 'pay',
    })
    map = action.nextMap
    if (canonicalId === 'Drown Out') {
      const triggeringMoveName = triggeringMoveByOperationId.get(selection.operationId)
        ?? fail('state-change-conflict', 'Drown Out lost the triggering Move trace identity.')
      const runtime = input.context.queries.rules.runtimeFor(triggeringMoveName)
        ?? fail('state-change-conflict', 'Drown Out could not recover the triggering Move runtime.')
      const script = input.context.queries.rules.reviewedScriptFor(triggeringMoveName)
        ?? fail('state-change-conflict', 'Drown Out could not recover the triggering Move resource definition.')
      const reviewedCosts = runtime.kind === 'movespec-v2' ? runtime.definition.spec.costs : []
      if (!reviewedCosts.some(cost => cost.cost.kind === 'action-resource')) {
        const triggeringMoveKey = moveUsageKey(triggeringMoveName)
          ?? fail('state-change-conflict', 'Drown Out could not derive the triggering Move resource key.')
        map = planEncounterMoveResourceCosts({
          map,
          placementId: input.context.actor.placement.id,
          canonicalMoveId: triggeringMoveName,
          moveKey: triggeringMoveKey,
          range: script.range,
          resolutionId: input.resolutionId,
          sourceOperationId: `${selection.operationId}:triggering-action`,
          movement: null,
          reviewedCosts: [{
            id: 'ability.drown-out.triggering-standard',
            phase: 'pay',
            cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
          }],
          allowLegacyFallback: false,
          minimumPhaseExclusive: null,
          maximumPhaseInclusive: 'pay',
        }).nextMap
      }
    }
    if (noFrequency.has(canonicalId)) continue

    if (daily.has(canonicalId)) {
      const placement = input.context.queries.placements.get(ownerId)
        ?? fail('state-change-conflict', `${canonicalId} response owner disappeared.`)
      const resolved = input.context.queries.sheets.forPlacement(placement)
        ?? fail('state-change-conflict', `${canonicalId} response sheet disappeared.`)
      const key = `${placement.sheetKind}:${placement.sheetSlug}`
      const work = dailySheets.get(key) ?? {
        placement,
        previous: deepCloneJson(resolved.sheet),
        current: deepCloneJson(resolved.sheet),
        sourceOperationId: selection.operationId,
      }
      const baseInstance = resolveSheetAbilityInstances(work.current.abilities).find(candidate => (
        candidate.instanceId === ability.instanceId && candidate.canonicalId === canonicalId
      ))
      const previous = parseAbilityDailyUsageLedger(
        work.current.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
      )
      const identity = {
        ownerId: `sheet:${placement.sheetKind}:${placement.sheetSlug}`,
        abilityInstanceId: baseInstance ? `base:${canonicalId}` : ability.instanceId,
        canonicalId,
        clauseId: 'base',
      }
      const existingByOperation = previous.entries.find(entry => entry.operationIds.includes(selection.operationId))
      const existing = previous.entries.find(entry => abilityUsageEntryKey(entry) === abilityUsageEntryKey(identity))
      if (existingByOperation && existingByOperation !== existing) {
        fail('state-change-conflict', `${canonicalId} response operation already paid another daily resource.`)
      }
      if (!existingByOperation && (existing?.spent ?? 0) >= 1) {
        fail('state-change-conflict', `${canonicalId} has no Daily uses remaining.`)
      }
      const nextEntry: AbilityUsageEntry = existingByOperation
        ? existingByOperation
        : {
            ...identity, limit: 1, spent: 1,
            operationIds: [...(existing?.operationIds ?? []), selection.operationId],
          }
      work.current = {
        ...work.current,
        abilityUsage: parseAbilityDailyUsageLedger({
          schemaVersion: 1,
          dayKey: previous.dayKey ?? 'campaign-day:initial',
          entries: existing
            ? previous.entries.map(entry => entry === existing ? nextEntry : entry)
            : [...previous.entries, nextEntry],
        }),
      }
      dailySheets.set(key, work)
      continue
    }

    const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
    const sceneId = encounter.history.sceneId
      ?? fail('state-change-conflict', `${canonicalId} requires an active scene usage period.`)
    const previous = parseAbilitySceneUsageLedger(encounter.abilityUsage)
    if (previous.sceneId !== null && previous.sceneId !== sceneId) {
      fail('state-change-conflict', `${canonicalId} usage ledger belongs to another scene.`)
    }
    const identity = { ownerId, abilityInstanceId: ability.instanceId, canonicalId, clauseId: 'base' }
    const existingByOperation = previous.entries.find(entry => entry.operationIds.includes(selection.operationId))
    const existing = previous.entries.find(entry => abilityUsageEntryKey(entry) === abilityUsageEntryKey(identity))
    if (existingByOperation && existingByOperation !== existing) {
      fail('state-change-conflict', `${canonicalId} response operation already paid another resource.`)
    }
    const limit = ['Bodyguard', 'Dancer', 'Dragon’s Maw', 'Drown Out'].includes(canonicalId)
      ? 2
      : 1
    if (!existingByOperation && (existing?.spent ?? 0) >= limit) {
      fail('state-change-conflict', `${canonicalId} has no Scene uses remaining.`)
    }
    const nextEntry: AbilityUsageEntry = existingByOperation
      ? existingByOperation
      : {
          ...identity, limit, spent: (existing?.spent ?? 0) + 1,
          operationIds: [...(existing?.operationIds ?? []), selection.operationId],
        }
    map = {
      ...map,
      encounterState: parseEncounterState({
        ...encounter,
        abilityUsage: {
          schemaVersion: 1, sceneId,
          entries: existing
            ? previous.entries.map(entry => entry === existing ? nextEntry : entry)
            : [...previous.entries, nextEntry],
        },
      }),
    }
  }
  const sheetStateChanges = createMoveStateChangePlan([...dailySheets.values()].map(work => {
    const current = {
      ...deepCloneJson(work.current),
      revision: nextRevision(normalizeRevision(work.previous.revision)),
    }
    return {
      kind: 'sheet-state' as const,
      scope: {
        kind: 'sheet' as const,
        sheetKind: work.placement.sheetKind,
        sheetSlug: work.placement.sheetSlug,
      },
      expectedRevision: normalizeRevision(work.previous.revision),
      sourceOperationId: work.sourceOperationId,
      reasonCode: 'ability-triggered-daily-frequency-spent',
      previous: deepCloneJson(work.previous),
      current,
      changedFields: ['abilityUsage'] as const,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }
  }))
  return Object.freeze({ map, sheetStateChanges })
}

const consumeAa060MoveMarks = (input: {
  readonly map: TabletopMap
  readonly actorPlacementId: string
  readonly moveName: string
  readonly operationId: string
  readonly additionalStateIds?: readonly string[]
}): TabletopMap => {
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  let ownedState = encounter.abilityOwnedState ?? createEmptyAbilityOwnedState()
  const expectedMarkIds = new Set([
    aa060MoveMarkId('Accelerate', input.moveName),
    aa060MoveMarkId('Aerilate', input.moveName),
    aa060MoveMarkId('Ambush', input.moveName),
    aa060MoveMarkId('Anchored', input.moveName),
  ])
  const additionalStateIds = new Set(input.additionalStateIds ?? [])
  const consumed = ownedState.entries.filter(entry => (
    additionalStateIds.has(entry.stateId)
    || (
      entry.ownerPlacementId === input.actorPlacementId
      && entry.payload.kind === 'mark'
      && expectedMarkIds.has(entry.payload.markId)
    )
  ))
  for (const [index, entry] of consumed.entries()) {
    ownedState = reduceAbilityOwnedStateCommand(ownedState, {
      operationId: `${input.operationId}:ability-mark:${index}`,
      kind: 'remove', stateId: entry.stateId, expectedVersion: entry.version,
    }).state
  }
  return consumed.length === 0 ? input.map : {
    ...input.map,
    encounterState: parseEncounterState({ ...encounter, abilityOwnedState: ownedState }),
  }
}

/** Reduce native map operations and compose one atomic immediate state plan. */
export const planNativeV2MoveState = (options: {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly resolution: AuthoritativeMoveResolution
  readonly plannedAt: number
  readonly operationId?: string
  /** Stable declaration/pending identity retained by history-backed mechanics. */
  readonly resolutionId?: string
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
    resolutionId: options.resolutionId,
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
  const mapAfterSideDamageResistance = consumeSideDamageResistance({
    map: mapAfterHelpingHand,
    resolution: options.resolution.sideDamageResistance,
  }).map
  const mapAfterAbilityMarkConsumption = consumeAa060MoveMarks({
    map: mapAfterSideDamageResistance,
    actorPlacementId: options.resolution.actorPlacementId,
    moveName: options.resolution.canonicalMoveName,
    operationId: originOperationId,
    additionalStateIds: [
      ...aa061BatteryStateIdsForMove(context, options.resolution.script),
      ...aa061AquaBulletStateIdsForMove(context, options.resolution.canonicalMoveName),
      ...aa062BoneLordReadyStateIds(context, options.resolution.canonicalMoveName),
    ],
  })
  const triggeredAbilityPayments = applyTriggeredAbilityPayments({
    map: mapAfterAbilityMarkConsumption,
    context,
    // Nested child events are ancestry-projected into the root trace exactly once.
    traces: [native.trace],
    resolutionId: context.resolutionId ?? originOperationId,
  })
  const mapAfterDelayedReactionDebts = applyAa067DelayedReactionDebts({
    map: triggeredAbilityPayments.map,
    context,
    trace: native.trace,
    operationId: originOperationId,
  })
  const mapAfterDeadlyPoisonTriggers = recordAa066DeadlyPoisonTriggers({
    map: mapAfterDelayedReactionDebts,
    context,
    coreStateChanges: native.coreStateChanges,
    operations: native.operations,
    childExecutions: native.childExecutions,
    operationId: originOperationId,
  })
  const mapAfterTransformationCleanup = cleanupEncounterTransformationsForKnockouts({
    map: mapAfterDeadlyPoisonTriggers,
    placementIds: native.faintedPlacementIds,
  }).map
  const mapAfterYawnCleanup = cleanupYawnEffectsForKnockouts({
    map: mapAfterTransformationCleanup,
    placementIds: native.faintedPlacementIds,
  }).map
  const mapAfterKnockoutCleanup = cleanupVortexEffectsForKnockouts({
    map: mapAfterYawnCleanup,
    placementIds: native.faintedPlacementIds,
  }).map
  const baseItemPlan = planMoveItemMutations({
    map: mapAfterKnockoutCleanup,
    pokemonSheets: options.pokemonSheets,
    trainerSheets: options.trainerSheets,
    groupInventories: options.itemResources?.groupInventories ?? new Map(),
    operations: native.itemEffects.mutations,
    consumedItems: options.itemResources?.consumedItems ?? [],
    originOperationId,
    plannedAt: options.plannedAt,
  })
  const cudChewHistory = recordAa065CudChewConsumptions({
    map: baseItemPlan.nextMap,
    context,
    consumedItems: baseItemPlan.consumedItems,
    itemStateChanges: baseItemPlan.stateChanges,
    operationId: originOperationId,
  })
  const itemPlan = {
    ...baseItemPlan,
    nextMap: cudChewHistory.map,
    stateChanges: cudChewHistory.itemStateChanges,
  }
  const itemTrace = applyMoveItemEffectResultsToTrace({
    trace: native.trace,
    interpretation: native.itemEffects,
    mutationResults: itemPlan.operationResults,
  })
  const mapAfterSpatialMovement = applyNativeSpatialMovements(
    cudChewHistory.map,
    native.spatialMovements,
  )
  const mapOperations = native.operations.filter(isMoveMapOperationEmission)
  const contextForOperation = createMoveSpecOperationContextResolver({
    root: context,
    children: native.childExecutions,
  })
  const effectiveRootFrequency = aa067DiamondDefenseMoveFrequency({
    context,
    script: { moveName: options.resolution.canonicalMoveName },
    frequency: options.resolution.frequency,
  })
  const usageResources = mapOperations.flatMap((emission) => {
    const { operation } = emission
    if (operation.kind !== 'usage') return []
    const responseOwnerPlacementId = operation.recipients.kind === 'response-owner'
      ? emission.recipientIds.length === 1
        ? emission.recipientIds[0]!
        : fail(
            'state-change-conflict',
            `Reaction usage operation ${operation.id} must resolve exactly one response owner.`,
          )
      : null
    if (operation.payload.resource) {
      return [{
        resourceId: operation.payload.resourceId,
        placementId: responseOwnerPlacementId
          ?? contextForOperation(operation).actor.placement.id,
        move: {
          moveName: operation.payload.resource.moveName,
          moveKey: operation.payload.resource.moveKey,
          frequency: operation.payload.resource.frequency,
        },
      }]
    }
    if (!emission.childResolutionId) {
      return [{
        resourceId: operation.payload.resourceId,
        placementId: options.resolution.actorPlacementId,
        move: {
          moveName: options.resolution.canonicalMoveName,
          moveKey: options.resolution.moveKey,
          frequency: effectiveRootFrequency,
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
    const parentOperation = native.operations.find(emitted => (
      emitted.operation.id === child.parentOperationId
    ))?.operation
    const abilityGrantedUse = parentOperation?.id.startsWith('ability.dancer.copy.') === true
      || parentOperation?.id.startsWith('ability.danger-syrup.sweet-scent.') === true
      || parentOperation?.id.startsWith('ability.combo-striker.struggle.') === true
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
        frequency: abilityGrantedUse
          ? 'At-Will'
          : aa067DiamondDefenseMoveFrequency({
              context: contextForOperation(operation),
              script: { moveName: child.canonicalId },
              frequency: move.frequency ?? null,
            }),
      },
    }]
  })
  const mapReduction = reduceMoveMapOperations({
    context,
    initialMap: mapAfterSpatialMovement,
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
    frequency: effectiveRootFrequency,
    logLines: options.resolution.transaction.logLines,
    trace: itemTrace,
    maxLogEntries: options.maxMoveLogEntries,
  })
  const rootUsageOperationId = mapOperations.find(emission => (
    emission.operation.kind === 'usage'
    && emission.operation.payload.resource === undefined
    && !emission.childResolutionId
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
  const switchedBaseMap = options.resolution.switchTransition
    ? planAuthoritativeMoveSwitch({
        map: placementTransitionMap,
        transition: options.resolution.switchTransition,
      }).nextMap
    : placementTransitionMap
  const switchedMap = options.resolution.switchTransition?.kind === 'recall-and-send-out'
    ? (() => {
        const transition = options.resolution.switchTransition
        const readPokemonSheet = (slug: string): CharacterSheet | null => options.pokemonSheets.get(slug) ?? null
        const withBallFetch = applyAa061BallFetchSendOutTriggers({
          mapBefore: placementTransitionMap,
          mapAfter: switchedBaseMap,
          releasedPlacementId: transition.sentOutPlacement.id,
          operationId: transition.operationId,
          readPokemonSheet,
        })
        return applyAa065CuriousMedicineSendOutTrigger({
          mapAfter: withBallFetch,
          releasedPlacementId: transition.sentOutPlacement.id,
          operationId: transition.operationId,
          readPokemonSheet,
        })
      })()
    : switchedBaseMap
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
    ...triggeredAbilityPayments.sheetStateChanges.changes,
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
    triggeredAbilityPlan: triggeredAbilityPayments.sheetStateChanges,
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
