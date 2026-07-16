import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResponseOwner,
} from '#shared/moveAutomation/pendingResolution'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  attachAbilityFollowUpsToMovePlan,
  observeMovePlanResources,
  planPendingMoveResourceCosts,
  type AuthoritativeMoveStatePlan,
  type AuthoritativePendingMoveStatePlan,
  type PlanAuthoritativeMoveStateInput,
} from '../planAuthoritativeMoveState'
import {
  isAuthoritativePendingMoveResolution,
  type AuthoritativeMoveExecution,
} from '../resolveAuthoritativeMove'
import { buildAuthoritativeMoveMapChanges } from './mapChanges'
import { materializeMoveSpecSuspension } from './materializeSuspension'
import {
  applyNativeCoreMapChanges,
  planNativeV2MoveState,
} from './planNativeV2MoveState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
import type { MoveAutomationRuntimeRegistry } from './registry'

export interface PlanResumedMoveStateInput {
  readonly pendingResolution: PendingMoveResolution
  /** Durable cumulative pre-window plan used to recover pre-resolution policy state. */
  readonly declarationPlan: MoveStateChangePlan | null
  readonly responseOpId: string
  readonly responseWindowId: string
  readonly responseOptionId: string | null
  readonly chosenBy: PendingMoveResponseOwner
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly execution: AuthoritativeMoveExecution
  readonly plannedAt: number
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  readonly maxMoveLogEntries?: number
}

const previousEncounterState = (map: TabletopMap): EncounterState => parseEncounterState(
  map.encounterState ?? createEmptyEncounterState(),
)

const declarationPrerequisiteResources = (
  declarationPlan: MoveStateChangePlan | null,
) => {
  const encounterChange = declarationPlan?.changes.find(
    change => change.kind === 'encounter-state',
  )
  return encounterChange
    ? parseEncounterState(encounterChange.previous).turnResources
    : undefined
}

const withoutPlanIdentity = (
  change: MoveStateChangePlan['changes'][number],
): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  const clone = deepCloneJson(input) as MoveStateChangeInput
  return {
    ...clone,
    // Optional map slots use an own undefined value to represent absence;
    // JSON cloning drops those required state-plan keys.
    previous: deepCloneJson(input.previous),
    current: deepCloneJson(input.current),
  } as MoveStateChangeInput
}

const encounterPlan = (input: {
  readonly previousMap: TabletopMap
  readonly current: EncounterState
  readonly sourceOperationId: string
  readonly reasonCode: string
  readonly existing?: MoveStateChangePlan
}): MoveStateChangePlan<EncounterState> => {
  const existingEncounter = input.existing?.changes.find(
    change => change.kind === 'encounter-state',
  )
  return createMoveStateChangePlan<EncounterState>([
    ...(input.existing?.changes ?? [])
      .filter(change => change.kind !== 'encounter-state')
      .map(change => withoutPlanIdentity(change) as MoveStateChangeInput<EncounterState>),
    {
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.previousMap.slug },
      expectedRevision: normalizeRevision(input.previousMap.revision),
      sourceOperationId: input.sourceOperationId,
      reasonCode: input.reasonCode,
      previous: deepCloneJson(previousEncounterState(input.previousMap)),
      current: deepCloneJson(input.current),
      compensation: existingEncounter?.compensation.kind === 'unavailable'
        ? deepCloneJson(existingEncounter.compensation)
        : RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ])
}

const summaryWithout = (
  state: EncounterState,
  resolutionId: string,
): EncounterState => parseEncounterState({
  ...state,
  pendingResolutionSummaries: state.pendingResolutionSummaries.filter(
    summary => summary.resolutionId !== resolutionId,
  ),
})

const assertSummaryPresent = (
  state: EncounterState,
  resolutionId: string,
): void => {
  if (!state.pendingResolutionSummaries.some(summary => summary.resolutionId === resolutionId)) {
    throw new Error(`Pending resolution ${resolutionId} has no authoritative map summary.`)
  }
}

const planNextWindow = (
  input: PlanResumedMoveStateInput,
): AuthoritativePendingMoveStatePlan => {
  if (!isAuthoritativePendingMoveResolution(input.execution)) {
    throw new Error('A complete execution cannot be planned as another pending window.')
  }
  const previousRevision = normalizeRevision(input.map.revision)
  const revision = nextRevision(previousRevision)
  const currentState = previousEncounterState(input.map)
  assertSummaryPresent(currentState, input.pendingResolution.resolutionId)

  const planningInput: PlanAuthoritativeMoveStateInput = {
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: input.pendingResolution.actorPlacementId,
      moveName: input.pendingResolution.canonicalMoveId,
      selection: { kind: 'self' },
    },
    operationId: input.responseOpId,
    runtimeRegistry: input.runtimeRegistry,
  }
  const preWindowPlan = planPendingMoveResourceCosts({
    input: planningInput,
    execution: input.execution,
    existingPlan: input.execution.preWindowPlan,
    resolutionId: input.pendingResolution.resolutionId,
    minimumPhaseExclusive: input.pendingResolution.phase,
    prerequisiteResources: declarationPrerequisiteResources(input.declarationPlan),
  })
  const materialized = materializeMoveSpecSuspension({
    resolutionId: input.pendingResolution.resolutionId,
    originOpId: input.pendingResolution.originOpId,
    definition: input.execution.runtime.definition,
    originMapSlug: input.map.slug,
    originMapRevision: previousRevision,
    authoritativeMap: input.map,
    actorPlacementId: input.pendingResolution.actorPlacementId,
    suspendedAt: input.plannedAt,
    authoritativeSheetReads: input.execution.sheetReads,
    execution: input.execution.execution,
    continuationMapRevision: revision,
    preWindowPlan,
  })
  const pendingResolution = parsePendingMoveResolution({
    ...materialized.pendingResolution,
    chosenOptions: [
      ...input.pendingResolution.chosenOptions,
      {
        windowId: input.responseWindowId,
        responseOpId: input.responseOpId,
        optionId: input.responseOptionId,
        chosenBy: input.chosenBy,
        chosenAt: input.plannedAt,
      },
    ],
    createdAt: input.pendingResolution.createdAt,
    updatedAt: input.plannedAt,
    publicSummary: {
      ...materialized.publicSummary,
      createdAt: input.pendingResolution.createdAt,
      updatedAt: input.plannedAt,
    },
  })
  const mapAfterPreWindowPlan = applyNativeCoreMapChanges(input.map, preWindowPlan)
  const stateAfterPreWindowPlan = previousEncounterState(mapAfterPreWindowPlan)
  const nextEncounterState = parseEncounterState({
    ...stateAfterPreWindowPlan,
    pendingResolutionSummaries: [
      ...currentState.pendingResolutionSummaries.filter(
        summary => summary.resolutionId !== pendingResolution.resolutionId,
      ),
      pendingResolution.publicSummary,
    ],
  })
  const nextMap = deepCloneJson({
    ...mapAfterPreWindowPlan,
    encounterState: nextEncounterState,
    revision,
    updatedAt: input.plannedAt,
  })
  const stateChanges = encounterPlan({
    previousMap: input.map,
    current: nextEncounterState,
    sourceOperationId: input.responseOpId,
    reasonCode: 'move-resolution-response-recorded',
    existing: preWindowPlan,
  })

  return {
    kind: 'pending',
    previousMap: deepCloneJson(input.map),
    nextMap,
    previousRevision,
    revision,
    execution: input.execution,
    suspension: Object.freeze({
      ...materialized,
      pendingResolution,
      publicSummary: pendingResolution.publicSummary,
    }),
    sheetReads: deepCloneJson(input.execution.sheetReads),
    sheetWrites: [],
    mapChanges: buildAuthoritativeMoveMapChanges(input.map, nextMap),
    stateChanges,
  }
}

const planCompletion = (
  input: PlanResumedMoveStateInput,
): AuthoritativeMoveStatePlan => {
  if (isAuthoritativePendingMoveResolution(input.execution)) {
    throw new Error('A pending execution cannot be planned as complete.')
  }
  const currentState = previousEncounterState(input.map)
  assertSummaryPresent(currentState, input.pendingResolution.resolutionId)
  const native = planNativeV2MoveState({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    resolution: input.execution,
    plannedAt: input.plannedAt,
    operationId: input.responseOpId,
    maxMoveLogEntries: input.maxMoveLogEntries,
    runtimeRegistry: input.runtimeRegistry,
    existingSheetReads: input.execution.sheetReads,
  })
  const planningInput: PlanAuthoritativeMoveStateInput = {
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: input.pendingResolution.actorPlacementId,
      moveName: input.pendingResolution.canonicalMoveId,
      selection: { kind: 'self' },
    },
    operationId: input.responseOpId,
    runtimeRegistry: input.runtimeRegistry,
  }
  const observed = observeMovePlanResources({
    planningInput,
    resolution: input.execution,
    nextMap: native.nextMap,
    previousRevision: normalizeRevision(input.map.revision),
    stateChanges: native.stateChanges,
    resolutionId: input.pendingResolution.resolutionId,
    minimumCostPhaseExclusive: input.pendingResolution.phase,
    // A suspended native definition must explicitly review every phased cost;
    // legacy fallback must not appear only after a person has already waited.
    allowLegacyCostFallback: false,
    prerequisiteResources: declarationPrerequisiteResources(input.declarationPlan),
  })
  const completedEncounterState = summaryWithout(
    previousEncounterState(observed.nextMap),
    input.pendingResolution.resolutionId,
  )
  const nextMap = deepCloneJson({
    ...observed.nextMap,
    encounterState: completedEncounterState,
  })
  const stateChanges = encounterPlan({
    previousMap: input.map,
    current: completedEncounterState,
    sourceOperationId: input.responseOpId,
    reasonCode: 'move-resolution-committed',
    existing: observed.stateChanges,
  })

  const plan: AuthoritativeMoveStatePlan = {
    previousMap: deepCloneJson(input.map),
    nextMap,
    previousRevision: normalizeRevision(input.map.revision),
    revision: native.revision,
    resolution: deepCloneJson({
      ...input.execution,
      sheetReads: native.sheetReads,
      auditTrace: native.auditTrace,
    }),
    previousUsage: deepCloneJson(native.previousUsage),
    usage: deepCloneJson(native.usage),
    sheetReads: deepCloneJson(native.sheetReads),
    sheetWrites: deepCloneJson(native.sheetWrites),
    mapChanges: buildAuthoritativeMoveMapChanges(input.map, nextMap),
    stateChanges,
  }
  return attachAbilityFollowUpsToMovePlan({
    plan,
    sourceMap: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    causalOpId: input.responseOpId,
    createdAt: input.plannedAt,
  })
}

export const planResumedMoveState = (
  input: PlanResumedMoveStateInput,
): AuthoritativeMoveStatePlan | AuthoritativePendingMoveStatePlan => (
  isAuthoritativePendingMoveResolution(input.execution)
    ? planNextWindow(input)
    : planCompletion(input)
)
