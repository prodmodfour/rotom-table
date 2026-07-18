import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_LIMITS,
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventKind,
  type EncounterRoundEvent,
  type EncounterTurnEvent,
} from '#shared/moveAutomation/events'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { deepCloneJson } from '~/utils/serialization'
import {
  buildAuthoritativeMoveRulesContext,
  type AuthoritativeMoveSheetRead,
} from './context'
import {
  reduceEncounterLifecycle,
  type EncounterLifecycleReductionResult,
  type EncounterLifecycleTriggerHandler,
} from './reduceLifecycle'
import {
  materializeMapGlobalFieldZones,
  projectGlobalFieldZonesToMapEffects,
} from './fieldMapState'
import type { MoveStateChange } from './plan'
import {
  reduceMoveCoreTokenOperationState,
} from './reducers/coreTokenEffects'
import type {
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectOperationResult,
  MoveResolvedCoreTokenEffectOperation,
} from './reducers/coreTokenEffectTypes'
import { createStandardMoveCoreTokenEffectImmunityQueries } from './reducers/immunities'
import {
  createGrassyTerrainLifecycleHandler,
  terrainLifecycleRecipientIds,
} from './terrainLifecycle'
import {
  createWeatherLifecycleImmunityQueries,
  createWeatherResidualLifecycleHandler,
} from './weatherLifecycle'
import {
  VORTEX_REASON_CODES,
  createVortexLifecycleHandler,
  createVortexLifecycleImmunityQueries,
  isVortexEffect,
} from './vortex'
import { createYawnLifecycleHandler } from './yawn'
import {
  createAuthoritativeMoveRandom,
  type AuthoritativeMoveRandomSource,
} from './random'

export type InitiativeLifecyclePlanningErrorCode =
  | 'active-placement-missing'
  | 'active-placement-not-ordered'
  | 'turn-sequence-limit-exceeded'
  | 'unsupported-operation'
  | 'operation-source-missing'
  | 'operation-recipient-unavailable'
  | 'operation-sheet-unavailable'
  | 'unexpected-state-change'

export class InitiativeLifecyclePlanningError extends Error {
  readonly code: InitiativeLifecyclePlanningErrorCode

  constructor(code: InitiativeLifecyclePlanningErrorCode, message: string) {
    super(message)
    this.name = 'InitiativeLifecyclePlanningError'
    this.code = code
  }
}

export interface InitiativeLifecycleBoundaryState {
  readonly activeId: string | null
  readonly round: number
}

export interface EncounterLifecycleSheetWrite {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly previousSheet: CharacterSheet | TrainerSheet
  readonly nextSheet: CharacterSheet | TrainerSheet
  readonly placementIds: readonly string[]
  readonly changedFields: readonly ('hp' | 'combatStages' | 'conditions')[]
}

/** Backward-compatible initiative name for the shared lifecycle write shape. */
export type InitiativeLifecycleSheetWrite = EncounterLifecycleSheetWrite

export interface EncounterLifecyclePlan {
  readonly events: readonly EncounterEvent[]
  /** Primary authoritative boundary reduction, retained for focused callers. */
  readonly reduction: EncounterLifecycleReductionResult
  /** Primary reduction followed by any typed post-operation cleanup reductions. */
  readonly reductions: readonly EncounterLifecycleReductionResult[]
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly previousTemporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly currentTemporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly previousFieldEffects: Required<NonNullable<TabletopMap['fieldEffects']>>
  readonly currentFieldEffects: Required<NonNullable<TabletopMap['fieldEffects']>>
  readonly nextMap: TabletopMap
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly EncounterLifecycleSheetWrite[]
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
}

/** Backward-compatible initiative name for the shared lifecycle plan shape. */
export type InitiativeLifecyclePlan = EncounterLifecyclePlan

export interface EncounterLifecycleSheetSnapshots {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

export interface PlanEncounterLifecycleInput {
  readonly map: TabletopMap
  readonly events: readonly EncounterEvent[]
  readonly time: number
  /** Loaded only when a trigger actually emits a sheet-backed operation. */
  readonly loadSheets: () => EncounterLifecycleSheetSnapshots
  readonly handlers?: readonly EncounterLifecycleTriggerHandler[]
  /** Injected server entropy; clients cannot supply lifecycle rolls. */
  readonly random?: AuthoritativeMoveRandomSource
}

export interface PlanInitiativeLifecycleInput
  extends Omit<PlanEncounterLifecycleInput, 'events'> {
  readonly previous: InitiativeLifecycleBoundaryState
  readonly current: InitiativeLifecycleBoundaryState
  /** Compatibility order when both boundary sides use the same calculation. */
  readonly orderIds: readonly string[]
  readonly previousOrderIds?: readonly string[]
  readonly currentOrderIds?: readonly string[]
  readonly operationId: string
}

type LifecycleCoreOperation =
  | MoveDirectHpEffectOperation
  | MoveHealEffectOperation
  | MoveConditionEffectOperation
  | MoveCombatStageEffectOperation

const LIFECYCLE_CORE_OPERATION_KINDS = new Set<MoveEffectOperation['kind']>([
  'direct-hp',
  'heal',
  'condition',
  'combat-stage',
])

const EMPTY_DYNAMIC_RECIPIENTS: MoveCoreTokenDynamicRecipientSets = Object.freeze({
  attackedTargetIds: Object.freeze([]),
  hitTargetIds: Object.freeze([]),
  missedTargetIds: Object.freeze([]),
  damagedTargetIds: Object.freeze([]),
  faintedTargetIds: Object.freeze([]),
})

const fail = (
  code: InitiativeLifecyclePlanningErrorCode,
  message: string,
): never => {
  throw new InitiativeLifecyclePlanningError(code, message)
}

const placementById = (
  map: TabletopMap,
  placementId: string,
): SheetPlacement => map.placements.find(placement => placement.id === placementId)
  ?? fail(
    'active-placement-missing',
    `Initiative lifecycle placement ${placementId} was not found.`,
  )

const eventSourceOperationId = (operationId: string): string => (
  `initiative.${createHash('sha256').update(operationId).digest('hex').slice(0, 24)}`
)

const eventId = (
  sourceOperationId: string,
  ordinal: number,
  kind: EncounterEventKind,
): string => `${sourceOperationId}.${ordinal}.${kind}`

const turnSequence = (
  round: number,
  placementId: string,
  orderIds: readonly string[],
): number => {
  const index = orderIds.indexOf(placementId)
  if (index < 0) {
    return fail(
      'active-placement-not-ordered',
      `Initiative lifecycle placement ${placementId} is absent from authoritative order.`,
    )
  }
  const turn = ((round - 1) * orderIds.length) + index
  if (!Number.isSafeInteger(turn) || turn < 0 || turn > ENCOUNTER_EVENT_LIMITS.turn) {
    return fail(
      'turn-sequence-limit-exceeded',
      `Initiative lifecycle turn sequence ${turn} exceeds the encounter-event bound.`,
    )
  }
  return turn
}

const roundEvent = (input: {
  readonly kind: 'round-start' | 'round-end'
  readonly round: number
  readonly sourceOperationId: string
  readonly ordinal: number
}): EncounterRoundEvent => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: eventId(input.sourceOperationId, input.ordinal, input.kind),
  kind: input.kind,
  sourceOperationId: input.sourceOperationId,
  causalParentEventId: null,
  reasonCode: `initiative.${input.kind}`,
  round: input.round,
})

const turnEvent = (input: {
  readonly kind: 'turn-start' | 'turn-end'
  readonly round: number
  readonly placement: SheetPlacement
  readonly orderIds: readonly string[]
  readonly sourceOperationId: string
  readonly ordinal: number
}): EncounterTurnEvent => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: eventId(input.sourceOperationId, input.ordinal, input.kind),
  kind: input.kind,
  sourceOperationId: input.sourceOperationId,
  causalParentEventId: null,
  reasonCode: `initiative.${input.kind}`,
  round: input.round,
  turn: turnSequence(input.round, input.placement.id, input.orderIds),
  placementId: input.placement.id,
  sideId: input.placement.sideId ?? null,
})

/** Emit one exact forward initiative boundary batch in mechanical order. */
export const createInitiativeLifecycleEvents = (input: {
  readonly map: TabletopMap
  readonly previous: InitiativeLifecycleBoundaryState
  readonly current: InitiativeLifecycleBoundaryState
  readonly orderIds: readonly string[]
  readonly previousOrderIds?: readonly string[]
  readonly currentOrderIds?: readonly string[]
  readonly operationId: string
}): readonly EncounterEvent[] => {
  if (input.current.activeId === null) return Object.freeze([])

  const sourceOperationId = eventSourceOperationId(input.operationId)
  const events: EncounterEvent[] = []
  const append = (event: EncounterEvent): void => {
    events.push(event)
  }
  const nextOrdinal = (): number => events.length + 1

  if (input.previous.activeId !== null) {
    append(turnEvent({
      kind: 'turn-end',
      round: input.previous.round,
      placement: placementById(input.map, input.previous.activeId),
      orderIds: input.previousOrderIds ?? input.orderIds,
      sourceOperationId,
      ordinal: nextOrdinal(),
    }))
  }

  if (input.current.round > input.previous.round) {
    append(roundEvent({
      kind: 'round-end',
      round: input.previous.round,
      sourceOperationId,
      ordinal: nextOrdinal(),
    }))
    append(roundEvent({
      kind: 'round-start',
      round: input.current.round,
      sourceOperationId,
      ordinal: nextOrdinal(),
    }))
  }
  else if (input.previous.activeId === null) {
    append(roundEvent({
      kind: 'round-start',
      round: input.current.round,
      sourceOperationId,
      ordinal: nextOrdinal(),
    }))
  }

  append(turnEvent({
    kind: 'turn-start',
    round: input.current.round,
    placement: placementById(input.map, input.current.activeId),
    orderIds: input.currentOrderIds ?? input.orderIds,
    sourceOperationId,
    ordinal: nextOrdinal(),
  }))

  return parseEncounterEvents(events)
}

const sameCell = (
  left: SheetPlacement['position'],
  right: SheetPlacement['position'],
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const affectedPlacementIds = (
  map: TabletopMap,
  effect: EncounterState['effects'][number],
): readonly string[] => {
  const directIds = new Set(effect.affected.placementIds)
  const sideIds = new Set(effect.affected.sideIds)
  return map.placements.filter(placement => (
    directIds.has(placement.id)
    || (placement.sideId !== undefined && sideIds.has(placement.sideId))
    || effect.affected.cells.some(cell => sameCell(cell, placement.position))
  )).map(placement => placement.id)
}

const effectSources = (
  state: EncounterState,
  reduction: EncounterLifecycleReductionResult,
): ReadonlyMap<string, EncounterState['effects'][number]> => {
  const sources = new Map(state.effects.map(effect => [effect.id, effect]))
  for (const applied of reduction.transitions) {
    const { previous, current } = applied.transition
    if (previous) sources.set(previous.id, previous)
    if (current) sources.set(current.id, current)
  }
  return sources
}

const recipientsForOperation = (input: {
  readonly map: TabletopMap
  readonly reduction: EncounterLifecycleReductionResult
  readonly effects: ReadonlyMap<string, EncounterState['effects'][number]>
  readonly operation: MoveEffectOperation
}): readonly string[] => {
  const { operation } = input
  if (operation.recipients.kind === 'none') return []

  if (operation.source.kind === 'encounter-effect') {
    const effect = input.effects.get(operation.source.id)
      ?? fail(
        'operation-source-missing',
        `Lifecycle operation ${operation.id} references unavailable effect ${operation.source.id}.`,
      )
    if (
      operation.recipients.kind === 'actor'
      || operation.recipients.kind === 'source-placement'
    ) {
      return input.map.placements.some(placement => placement.id === effect.source.placementId)
        ? [effect.source.placementId]
        : []
    }
    return affectedPlacementIds(input.map, effect)
  }

  if (operation.source.kind === 'lifecycle-event') {
    const event = input.reduction.processedEvents.find(candidate => (
      candidate.eventId === operation.source.id
    )) ?? fail(
      'operation-source-missing',
      `Lifecycle operation ${operation.id} references unavailable event ${operation.source.id}.`,
    )
    if (event.kind === 'turn-start' || event.kind === 'turn-end') {
      return [event.placementId]
    }
    if (
      (
        event.kind === 'scene-start'
        || event.kind === 'scene-end'
        || event.kind === 'round-start'
        || event.kind === 'round-end'
      )
      && operation.recipients.kind === 'area-targets'
    ) {
      return input.map.placements.map(placement => placement.id)
    }
    return fail(
      'operation-recipient-unavailable',
      `Lifecycle operation ${operation.id} cannot resolve ${operation.recipients.kind} from ${event.kind}.`,
    )
  }

  return fail(
    'operation-source-missing',
    `Lifecycle operation ${operation.id} has unsupported source ${operation.source.kind}.`,
  )
}

const isLifecycleCoreOperation = (
  operation: MoveEffectOperation,
): operation is LifecycleCoreOperation => LIFECYCLE_CORE_OPERATION_KINDS.has(operation.kind)

const vortexKnockoutCleanupEvents = (input: {
  readonly reduction: EncounterLifecycleReductionResult
  readonly operationResults: readonly MoveCoreTokenEffectOperationResult[]
}): readonly EncounterEvent[] => {
  const operations = new Map(input.reduction.operations.map(operation => [operation.id, operation]))
  const sourceOperationByTarget = new Map<string, string>()
  for (const result of input.operationResults) {
    const operation = operations.get(result.operationId)
    if (
      !operation
      || operation.kind !== 'direct-hp'
      || operation.reasonCode !== VORTEX_REASON_CODES.tick
    ) continue
    for (const recipient of result.recipients) {
      if (
        recipient.previous.kind === 'hp'
        && recipient.current.kind === 'hp'
        && recipient.previous.currentHp > 0
        && recipient.current.currentHp <= 0
      ) sourceOperationByTarget.set(recipient.recipientId, operation.id)
    }
  }
  const cleanupEvents = input.reduction.state.effects.flatMap((effect) => {
    if (!isVortexEffect(effect)) return []
    const targetPlacementId = effect.affected.placementIds[0]!
    const sourceOperationId = sourceOperationByTarget.get(targetPlacementId)
    if (!sourceOperationId) return []
    const eventId = `event.vortex.ko.${createHash('sha256')
      .update(`${sourceOperationId}\u0000${effect.id}`)
      .digest('hex')
      .slice(0, 32)}`
    return [{
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId,
      kind: 'effect-removed' as const,
      sourceOperationId,
      causalParentEventId: null,
      reasonCode: VORTEX_REASON_CODES.targetKnockedOut,
      effectId: effect.id,
    }]
  })
  return parseEncounterEvents(cleanupEvents, 'vortexKnockoutCleanupEvents')
}

const sheetWriteFromChange = (input: {
  readonly map: TabletopMap
  readonly change: Extract<MoveStateChange, { readonly kind: 'sheet-state' }>
  readonly recipientIds: ReadonlySet<string>
}): InitiativeLifecycleSheetWrite => ({
  kind: input.change.scope.sheetKind,
  slug: input.change.scope.sheetSlug,
  expectedRevision: input.change.expectedRevision,
  revision: normalizeRevision(input.change.current.revision),
  previousSheet: deepCloneJson(input.change.previous),
  nextSheet: deepCloneJson(input.change.current),
  placementIds: input.map.placements.filter(placement => (
    input.recipientIds.has(placement.id)
    && placement.sheetKind === input.change.scope.sheetKind
    && placement.sheetSlug === input.change.scope.sheetSlug
  )).map(placement => placement.id),
  changedFields: [...input.change.changedFields].filter(
    (field): field is InitiativeLifecycleSheetWrite['changedFields'][number] => (
      field === 'hp' || field === 'combatStages' || field === 'conditions'
    ),
  ),
})

/** Plan effect expiry and currently reducible due token operations for one event batch. */
export const planEncounterLifecycle = (
  input: PlanEncounterLifecycleInput,
): EncounterLifecyclePlan => {
  const previousEncounterState = materializeMapGlobalFieldZones(input.map)
  const previousFieldEffects = cloneMapFieldEffects(input.map.fieldEffects)
  const lifecycleMap: TabletopMap = {
    ...deepCloneJson(input.map),
    encounterState: deepCloneJson(previousEncounterState),
  }
  const events = parseEncounterEvents(input.events)
  const weatherHandler = createWeatherResidualLifecycleHandler(lifecycleMap)
  const terrainHandler = createGrassyTerrainLifecycleHandler(lifecycleMap)
  // Registered handlers retain caller order. Built-in encounter effects run
  // next, followed by weather and terrain; field transitions remain event-local
  // and last.
  const handlers = [
    ...(input.handlers ?? []),
    createVortexLifecycleHandler(),
    createYawnLifecycleHandler(),
    ...(weatherHandler ? [weatherHandler] : []),
    ...(terrainHandler ? [terrainHandler] : []),
  ]
  const random = createAuthoritativeMoveRandom(input.random)
  const reduction = reduceEncounterLifecycle(
    previousEncounterState,
    events,
    handlers,
    random,
  )
  const effects = effectSources(previousEncounterState, reduction)
  const recipientsByOperationId = new Map<string, readonly string[]>()

  for (const operation of reduction.operations) {
    if (!isLifecycleCoreOperation(operation)) {
      return fail(
        'unsupported-operation',
        `Initiative lifecycle operation ${operation.id} of kind ${operation.kind} has no immediate reducer.`,
      )
    }
    recipientsByOperationId.set(operation.id, recipientsForOperation({
      map: lifecycleMap,
      reduction,
      effects,
      operation,
    }))
  }

  const operationRecipientIds = new Set(
    [...recipientsByOperationId.values()].flatMap(ids => [...ids]),
  )
  let nextMap: TabletopMap = {
    ...lifecycleMap,
    encounterState: deepCloneJson(reduction.state),
    fieldEffects: projectGlobalFieldZonesToMapEffects({
      previous: previousFieldEffects,
      state: reduction.state,
    }),
  }
  let sheetReads: readonly AuthoritativeMoveSheetRead[] = []
  let sheetWrites: readonly InitiativeLifecycleSheetWrite[] = []
  let operationResults: readonly MoveCoreTokenEffectOperationResult[] = []

  if (reduction.operations.length > 0 && operationRecipientIds.size > 0) {
    const { pokemonSheets, trainerSheets } = input.loadSheets()
    const actorId = lifecycleMap.placements.find(placement => (
      operationRecipientIds.has(placement.id)
      && (placement.sheetKind === 'pokemon'
        ? pokemonSheets.has(placement.sheetSlug)
        : trainerSheets.has(placement.sheetSlug))
    ))?.id ?? fail(
      'operation-sheet-unavailable',
      'Initiative lifecycle operations have no recipient with an authoritative backing sheet.',
    )
    const context = buildAuthoritativeMoveRulesContext({
      // Trigger operations resolve against the boundary snapshot. Encounter
      // cleanup is persisted afterward from `reduction.state`.
      map: lifecycleMap,
      pokemonSheets,
      trainerSheets,
      intent: {
        schemaVersion: 1,
        placementId: actorId,
        moveName: 'Initiative Lifecycle',
        selection: { kind: 'self' },
      },
      candidatePlacementIds: lifecycleMap.placements.map(placement => placement.id),
      selectedPlacementIds: [...operationRecipientIds],
      random: () => 0.5,
      time: input.time,
    })
    for (const operation of reduction.operations) {
      recipientsByOperationId.set(operation.id, terrainLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: recipientsByOperationId.get(operation.id) ?? [],
      }))
    }
    const emissions: MoveResolvedCoreTokenEffectOperation[] = reduction.operations.map(
      operation => ({
        operation: operation as LifecycleCoreOperation,
        recipientIds: [...(recipientsByOperationId.get(operation.id) ?? [])],
      }),
    )
    const standardImmunities = createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: null,
      context,
    })
    const core = reduceMoveCoreTokenOperationState({
      context,
      operations: emissions,
      dynamicRecipients: EMPTY_DYNAMIC_RECIPIENTS,
      immunities: createVortexLifecycleImmunityQueries({
        effects: [...effects.values()],
        fallback: createWeatherLifecycleImmunityQueries({
          context,
          fallback: standardImmunities,
        }),
      }),
      recipientIdsForOperation: operation => recipientsByOperationId.get(operation.id) ?? [],
    })
    sheetReads = core.sheetReads
    operationResults = core.operationResults
    const writes: InitiativeLifecycleSheetWrite[] = []
    for (const change of core.stateChanges.changes) {
      if (change.kind === 'map-temporary-hit-points') {
        if (change.current === undefined) delete nextMap.temporaryHitPoints
        else nextMap.temporaryHitPoints = deepCloneJson(change.current)
        continue
      }
      if (change.kind === 'sheet-state') {
        writes.push(sheetWriteFromChange({
          map: lifecycleMap,
          change,
          recipientIds: operationRecipientIds,
        }))
        continue
      }
      return fail(
        'unexpected-state-change',
        `Initiative lifecycle core reduction emitted unexpected ${change.kind}.`,
      )
    }
    sheetWrites = writes
  }

  const cleanupEvents = vortexKnockoutCleanupEvents({ reduction, operationResults })
  const cleanupReduction = cleanupEvents.length > 0
    ? reduceEncounterLifecycle(reduction.state, cleanupEvents, [], random)
    : null
  const reductions = cleanupReduction ? [reduction, cleanupReduction] : [reduction]
  const plannedEvents = cleanupReduction ? [...events, ...cleanupEvents] : events
  const currentEncounterState = cleanupReduction?.state ?? reduction.state
  if (cleanupReduction) nextMap.encounterState = deepCloneJson(currentEncounterState)
  const rollLedger = random.complete()

  return Object.freeze({
    events: plannedEvents,
    reduction,
    reductions,
    previousEncounterState,
    currentEncounterState,
    previousTemporaryHitPoints: deepCloneJson(input.map.temporaryHitPoints),
    currentTemporaryHitPoints: deepCloneJson(nextMap.temporaryHitPoints),
    previousFieldEffects,
    currentFieldEffects: cloneMapFieldEffects(nextMap.fieldEffects),
    nextMap,
    sheetReads: deepCloneJson(sheetReads),
    sheetWrites: deepCloneJson(sheetWrites),
    rollLedger: deepCloneJson(rollLedger),
  })
}

/** Plan one exact forward initiative boundary through the shared lifecycle planner. */
export const planInitiativeLifecycle = (
  input: PlanInitiativeLifecycleInput,
): InitiativeLifecyclePlan => planEncounterLifecycle({
  map: input.map,
  events: createInitiativeLifecycleEvents(input),
  time: input.time,
  loadSheets: input.loadSheets,
  handlers: input.handlers,
  random: input.random,
})
