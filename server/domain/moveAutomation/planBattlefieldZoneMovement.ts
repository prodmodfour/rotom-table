import { normalizeRevision } from '#shared/sessionRevisions'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveHazardEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  computePokemonHealingVitals,
  computeTrainerHealingVitals,
} from '~/utils/sheets/healing'
import {
  materializeBattlefieldZoneEntryLifecycle,
  type BattlefieldZoneEntryDecision,
} from './battlefieldZoneEntry'
import type { BattlefieldZoneEntryDefinitionRegistry } from './battlefieldZoneDefinitions'
import {
  buildAuthoritativeMoveRulesContext,
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveSheetRead,
} from './context'
import type {
  CreateAuthoritativeMovementLifecycleEventsInput,
  AuthoritativeMovementLifecycleRun,
  MovementLifecycleCursor,
} from './movementLifecycle'
import { runAuthoritativeMovementLifecycle } from './movementLifecycle'
import {
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveStateChange,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
import {
  reduceMoveCoreTokenOperationState,
} from './reducers/coreTokenEffects'
import type {
  MoveCoreTokenEffectOperationResult,
  MoveResolvedCoreTokenEffectOperation,
} from './reducers/coreTokenEffectTypes'
import { createStandardMoveCoreTokenEffectImmunityQueries } from './reducers/immunities'
import { reduceMoveHazardZones } from './reducers/mapHazardEffects'
import { queryBattlefieldZones } from './battlefieldZones'
import { aa067StealthRockDamageProfile } from '../abilityAutomation/mechanics/aa067StaticIntegration'
import { reconcileAa075IceFaceTemporaryHpOwnershipAfterMove } from '../abilityAutomation/mechanics/aa075TemporaryHpIntegration'
import { nativeSheetWritesFromStateChanges } from './planNativeV2MoveState'
import type { AuthoritativeMoveSheetWritePlan } from '../planAuthoritativeMoveState'

export type BattlefieldZoneMovementPlanningErrorCode =
  | 'subject-state-unavailable'
  | 'unexpected-interrupt'
  | 'unsupported-operation'
  | 'zone-removal-unavailable'
  | 'state-plan-conflict'

export class BattlefieldZoneMovementPlanningError extends Error {
  readonly code: BattlefieldZoneMovementPlanningErrorCode

  constructor(code: BattlefieldZoneMovementPlanningErrorCode, message: string) {
    super(message)
    this.name = 'BattlefieldZoneMovementPlanningError'
    this.code = code
  }
}

type ZoneCoreOperation =
  | MoveDirectHpEffectOperation
  | MoveConditionEffectOperation
  | MoveCombatStageEffectOperation

export interface BattlefieldZoneHazardOperationResult {
  readonly operationId: string
  readonly outcome: 'applied' | 'no-op'
  readonly details: ReturnType<typeof reduceMoveHazardZones>['details']
}

export interface PlannedBattlefieldZoneMovement {
  readonly lifecycle: AuthoritativeMovementLifecycleRun
  readonly decisions: readonly BattlefieldZoneEntryDecision[]
  readonly operations: readonly (
    | ZoneCoreOperation
    | MoveHazardEffectOperation
  )[]
  readonly coreOperationResults: readonly MoveCoreTokenEffectOperationResult[]
  readonly hazardOperationResults: readonly BattlefieldZoneHazardOperationResult[]
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  /** Zone mechanics only; the caller still owns the placement transition. */
  readonly nextMap: TabletopMap
  readonly stateChanges: MoveStateChangePlan
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
}

export interface PlanBattlefieldZoneMovementInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly movement: CreateAuthoritativeMovementLifecycleEventsInput
  readonly time: number
  readonly registry?: BattlefieldZoneEntryDefinitionRegistry
  /** Resume cursor for a prefix already committed before a durable interrupt. */
  readonly cursor?: MovementLifecycleCursor
}

const fail = (
  code: BattlefieldZoneMovementPlanningErrorCode,
  message: string,
): never => {
  throw new BattlefieldZoneMovementPlanningError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const coreOperation = (
  operation: PlannedBattlefieldZoneMovement['operations'][number],
): operation is ZoneCoreOperation => operation.kind === 'direct-hp'
  || operation.kind === 'condition'
  || operation.kind === 'combat-stage'

const hazardOperation = (
  operation: PlannedBattlefieldZoneMovement['operations'][number],
): operation is MoveHazardEffectOperation => operation.kind === 'hazard'

const withoutPlanIdentity = (change: MoveStateChange): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return {
    ...deepCloneJson(input),
    previous: deepCloneJson(input.previous),
    current: deepCloneJson(input.current),
  } as MoveStateChangeInput
}

const applyCoreMapChanges = (input: {
  readonly map: TabletopMap
  readonly changes: readonly MoveStateChange[]
}): { readonly map: TabletopMap; readonly encounterState: EncounterState } => {
  const map = deepCloneJson(input.map)
  let encounterState = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  for (const change of input.changes) {
    if (change.kind === 'encounter-state') {
      encounterState = parseEncounterState(change.current)
      map.encounterState = deepCloneJson(encounterState)
    }
    else if (change.kind === 'map-temporary-hit-points') {
      if (change.current === undefined) delete map.temporaryHitPoints
      else map.temporaryHitPoints = deepCloneJson(change.current)
    }
    else if (change.kind !== 'sheet-state') {
      return fail(
        'state-plan-conflict',
        `Zone entry core mechanics emitted unexpected ${change.kind}.`,
      )
    }
  }
  return { map, encounterState }
}

const combinedStatePlan = (input: {
  readonly map: TabletopMap
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly coreChanges: readonly MoveStateChange[]
  readonly operations: readonly PlannedBattlefieldZoneMovement['operations'][number][]
}): MoveStateChangePlan => {
  const changes = input.coreChanges
    .filter(change => change.kind !== 'encounter-state')
    .map(withoutPlanIdentity)
  if (!sameJsonValue(input.previousEncounterState, input.currentEncounterState)) {
    const sourceIds = [...new Set(input.operations.map(operation => operation.id))]
    changes.push({
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.map.slug },
      expectedRevision: normalizeRevision(input.map.revision),
      sourceOperationId: sourceIds.length === 1 ? sourceIds[0]! : null,
      reasonCode: sourceIds.length === 1
        ? input.operations[0]!.reasonCode
        : 'battlefield-zone-movement-entry',
      previous: deepCloneJson(input.previousEncounterState),
      current: deepCloneJson(input.currentEncounterState),
      compensation: unavailableMoveStateCompensation(
        'accepted-zone-entry-may-be-observed',
        'externally-observed',
      ),
    })
  }
  try {
    return createMoveStateChangePlan(changes)
  }
  catch (error) {
    return fail(
      'state-plan-conflict',
      `Zone entry state changes conflict: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Plan all registered entry hooks for one authoritative path. The result keeps
 * placement movement separate while returning the exact map/sheet plan that a
 * command boundary can commit atomically with that placement transition.
 */
export const planBattlefieldZoneMovement = (
  input: PlanBattlefieldZoneMovementInput,
): PlannedBattlefieldZoneMovement => {
  const initialContext = buildAuthoritativeMoveRulesContext({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: input.movement.movement.placementId,
      moveName: 'Battlefield Zone Entry',
      selection: { kind: 'self' },
    },
    candidatePlacementIds: [input.movement.movement.placementId],
    selectedPlacementIds: [input.movement.movement.placementId],
    random: () => 0.5,
    time: input.time,
  })
  const targetState = initialContext.queries.targetStates.resolve(
    input.movement.movement.placementId,
  ) ?? fail(
    'subject-state-unavailable',
    `Zone entry placement ${input.movement.movement.placementId} has no authoritative target state.`,
  )
  const materialized = materializeBattlefieldZoneEntryLifecycle({
    map: input.map,
    movement: input.movement,
    subject: {
      placementId: initialContext.actor.placement.id,
      sideId: initialContext.actor.placement.sideId ?? null,
      grounding: targetState.grounding,
      typeIds: targetState.typeIds,
      ignoreHazards: initialContext.queries.abilities.has(
        initialContext.actor.placement.id,
        'Infiltrator',
      ),
    },
    ...(input.registry ? { registry: input.registry } : {}),
  })
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const lifecycle = runAuthoritativeMovementLifecycle({
    ...input.movement,
    state: previousEncounterState,
    handlers: [materialized.handler],
    ...(input.cursor ? { cursor: input.cursor } : {}),
  })
  if (lifecycle.status !== 'completed') {
    return fail(
      'unexpected-interrupt',
      'Battlefield zone entry handlers cannot open movement reaction windows.',
    )
  }

  const zoneIdByOperationId = new Map(materialized.decisions.flatMap(decision => (
    decision.operationIds.map(operationId => [operationId, decision.zoneId] as const)
  )))
  const zonesById = new Map(queryBattlefieldZones(input.map, { kind: 'all' }).map(zone => [zone.id, zone]))
  const operations: Array<ZoneCoreOperation | MoveHazardEffectOperation> = []
  for (const rawOperation of lifecycle.operations) {
    let operation = rawOperation
    if (operation.kind === 'direct-hp' && operation.reasonCode === 'zone.hazard.stealth-rock.tick') {
      const zone = zonesById.get(zoneIdByOperationId.get(operation.id) ?? '')
      const profile = aa067StealthRockDamageProfile({
        context: initialContext,
        sourcePlacementId: zone?.source.kind === 'operation' ? zone.source.placementId : null,
        defenderTypeIds: targetState.typeIds,
      })
      const vitals = initialContext.actor.sheet.kind === 'pokemon'
        ? computePokemonHealingVitals(initialContext.actor.sheet.sheet as CharacterSheet)
        : computeTrainerHealingVitals(initialContext.actor.sheet.sheet as TrainerSheet)
      const tick = Math.max(1, Math.floor(vitals.fullMaxHp / 10))
      operation = parseMoveEffectOperation({
        ...operation,
        reasonCode: `zone.hazard.stealth-rock.tick.${profile.type.toLowerCase()}`,
        payload: {
          ...operation.payload,
          calculation: {
            kind: 'fixed',
            value: profile.multiplier === 0 ? 0 : Math.max(1, Math.floor(tick * profile.multiplier)),
          },
        },
      }, `battlefieldZone.stealthRock.${profile.type}`)
    }
    if (coreOperation(operation as PlannedBattlefieldZoneMovement['operations'][number])) {
      operations.push(operation as ZoneCoreOperation)
    }
    else if (hazardOperation(operation as PlannedBattlefieldZoneMovement['operations'][number])) {
      operations.push(operation as MoveHazardEffectOperation)
    }
    else {
      return fail(
        'unsupported-operation',
        `Zone entry emitted unsupported operation ${operation.id} (${operation.kind}).`,
      )
    }
  }

  const lifecycleMap: TabletopMap = {
    ...deepCloneJson(input.map),
    encounterState: deepCloneJson(lifecycle.state),
  }
  const reductionContext = buildAuthoritativeMoveRulesContext({
    map: lifecycleMap,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: input.movement.movement.placementId,
      moveName: 'Battlefield Zone Entry',
      selection: { kind: 'self' },
    },
    candidatePlacementIds: [input.movement.movement.placementId],
    selectedPlacementIds: [input.movement.movement.placementId],
    random: () => 0.5,
    time: input.time,
  })
  const coreOperations = operations.filter(coreOperation)
  const core = reduceMoveCoreTokenOperationState({
    context: reductionContext,
    operations: coreOperations.map((operation): MoveResolvedCoreTokenEffectOperation => ({
      operation,
      recipientIds: [input.movement.movement.placementId],
    })),
    dynamicRecipients: {
      attackedTargetIds: [],
      hitTargetIds: [],
      missedTargetIds: [],
      damagedTargetIds: [],
      faintedTargetIds: [],
    },
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: null,
      context: reductionContext,
    }),
    recipientIdsForOperation: () => [input.movement.movement.placementId],
  })

  const coreApplied = applyCoreMapChanges({
    map: lifecycleMap,
    changes: core.stateChanges.changes,
  })
  let currentEncounterState = coreApplied.encounterState
  const hazardOperationResults: BattlefieldZoneHazardOperationResult[] = []
  for (const operation of operations.filter(hazardOperation)) {
    const reduced = reduceMoveHazardZones({
      context: reductionContext,
      previous: currentEncounterState,
      operation,
      recipientIds: [],
    })
    if (!reduced.changed) {
      return fail(
        'zone-removal-unavailable',
        `Zone entry removal ${operation.id} did not find its canonical encounter zone.`,
      )
    }
    currentEncounterState = reduced.current
    hazardOperationResults.push({
      operationId: operation.id,
      outcome: 'applied',
      details: reduced.details,
    })
  }

  const nextMap = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
    previousMap: input.map,
    nextMap: {
      ...coreApplied.map,
      encounterState: deepCloneJson(currentEncounterState),
    },
    operations: operations.map(operation => ({
      operation,
      recipientIds: core.operationResults.find(result => result.operationId === operation.id)
        ?.recipients.map(recipient => recipient.recipientId) ?? [],
    })),
  })
  currentEncounterState = parseEncounterState(
    nextMap.encounterState ?? createEmptyEncounterState(),
  )
  const stateChanges = combinedStatePlan({
    map: input.map,
    previousEncounterState,
    currentEncounterState,
    coreChanges: core.stateChanges.changes,
    operations,
  })
  const sheetReads = deduplicateAuthoritativeMoveSheetReads([
    ...initialContext.reads.snapshot(),
    ...core.sheetReads,
  ])
  const sheetWrites = nativeSheetWritesFromStateChanges(input.map, {
    actorPlacementId: input.movement.movement.placementId,
    selectedTargetIds: [input.movement.movement.placementId],
  }, stateChanges)

  return deepFreeze({
    lifecycle,
    decisions: materialized.decisions,
    operations,
    coreOperationResults: core.operationResults,
    hazardOperationResults,
    previousEncounterState,
    currentEncounterState,
    nextMap,
    stateChanges,
    sheetReads,
    sheetWrites,
  })
}
