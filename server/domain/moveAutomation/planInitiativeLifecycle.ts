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
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { placementToSpawned } from '~/utils/placement'
import { computeTickValue } from '~/utils/ptuHp'
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
import { createEmptyAbilityOwnedState } from '#shared/abilityAutomation/ownedState'
import { reduceAbilityOwnedStateLifecycle } from '../abilityAutomation/ownedState'
import { reduceAbilityEffectLifecycleEncounter, type AbilityEffectLifecycleEvent } from '../abilityAutomation/effectLifecycle'
import { createEmptyAbilityEntityState } from '#shared/abilityAutomation/entities'
import { recoverAbilityEntities, reduceAbilityEntityCommand, reduceAbilityEntityLifecycle } from '../abilityAutomation/entities'
import { registeredAbilityAutomationRuntimeFor } from '../abilityAutomation/registry'
import { projectAuthoritativeEffectiveAbilities } from '../abilityAutomation/effectiveAbilities'
import { resolveSheetAbilityInstances } from '../abilityAutomation/instanceParameters'
import { aa060AnchoredEntityCreateCommand } from '../abilityAutomation/mechanics/aa060Activated'
import {
  aa065CorrosiveToxinsLifecycleRecipientIds,
  advanceAa065CorrosiveToxinsResidualCounters,
  createAa065CorrosiveToxinsLifecycleHandler,
} from '../abilityAutomation/mechanics/aa065ConditionLifecycle'
import {
  aa066DeepSleepLifecycleRecipientIds,
  createAa066DeepSleepLifecycleHandler,
} from '../abilityAutomation/mechanics/aa066LifecycleIntegration'
import {
  aa067LifecycleRecipientIds,
  createAa067LifecycleHandler,
} from '../abilityAutomation/mechanics/aa067LifecycleIntegration'
import { createMoveAutomationWeatherResolver } from './weather'
import {
  aa068DrySkinLifecycleRecipientIds,
  createAa068DrySkinLifecycleHandler,
} from '../abilityAutomation/mechanics/aa068LifecycleIntegration'
import {
  aa075IceFaceLifecycleRecipientIds,
  applyAa075IceFaceLifecycleTemporaryHpOwnership,
  createAa075IceFaceLifecycleHandler,
} from '../abilityAutomation/mechanics/aa075LifecycleIntegration'
import { reconcileAa075IceFaceTemporaryHpOwnershipAfterMove } from '../abilityAutomation/mechanics/aa075TemporaryHpIntegration'
import { createAa078LeechSeedLifecycleHandler } from '../abilityAutomation/mechanics/aa078LifecycleIntegration'
import {
  aa079MagmaArmorGrappleLifecycleEntries,
  createAa079MagmaArmorGrappleLifecycleHandler,
} from '../abilityAutomation/mechanics/aa079LifecycleIntegration'
import { effectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'
import {
  aa080MoodyLifecycleRecipientIds,
  createAa080MoodyLifecycleHandler,
  reconcileAa080MiniNoseTether,
} from '../abilityAutomation/mechanics/aa080LifecycleIntegration'

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

const reconcileAnchoredEntities = (input: {
  readonly state: EncounterState
  readonly map: TabletopMap
  readonly events: readonly EncounterEvent[]
  readonly loadSheets: () => EncounterLifecycleSheetSnapshots
}): EncounterState => {
  if (!registeredAbilityAutomationRuntimeFor('Anchored')) return input.state
  const snapshots = input.loadSheets()
  const activeByPlacement = new Map<string, ReturnType<typeof projectAuthoritativeEffectiveAbilities>>()
  for (const placement of input.map.placements) {
    const sheet = placement.sheetKind === 'pokemon'
      ? snapshots.pokemonSheets.get(placement.sheetSlug)
      : snapshots.trainerSheets.get(placement.sheetSlug)
    const projected = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(sheet?.abilities),
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
      effects: input.state.effects,
      transformationSnapshots: input.state.abilityTransformations,
    })
    activeByPlacement.set(placement.id, projected)
  }
  let encounter = recoverAbilityEntities({
    encounter: input.state,
    presentPlacementIds: input.map.placements.map(placement => placement.id),
    activeAbilityInstanceIdsByPlacement: new Map([...activeByPlacement].map(([placementId, abilities]) => [
      placementId,
      abilities.filter(ability => ability.effective).map(ability => ability.instanceId),
    ])),
  })
  let entityState = encounter.abilityEntities ?? createEmptyAbilityEntityState()
  const eventId = input.events.at(-1)?.eventId ?? 'event.ability-anchor-recovery'
  for (const placement of input.map.placements) {
    const anchored = (activeByPlacement.get(placement.id) ?? []).filter(ability => (
      ability.effective && ability.canonicalId === 'Anchored'
    ))
    for (const ability of anchored) {
      const entityId = `${ability.instanceId}:anchor`
      if (entityState.entries.some(entity => entity.entityId === entityId)) continue
      const operationHash = createHash('sha256')
        .update(`${eventId}\u0000${placement.id}\u0000${ability.instanceId}`)
        .digest('hex').slice(0, 24)
      entityState = reduceAbilityEntityCommand(entityState, aa060AnchoredEntityCreateCommand({
        placement,
        abilityInstanceId: ability.instanceId,
        operationId: `ability-anchor-setup.${operationHash}`,
      })).state
    }
  }
  encounter = parseEncounterState({ ...encounter, abilityEntities: entityState })
  return encounter
}

const effectiveAbilityPlacementIds = (input: {
  readonly map: TabletopMap
  readonly state: EncounterState
  readonly snapshots: EncounterLifecycleSheetSnapshots
  readonly canonicalId: string
}): readonly string[] => {
  const runtime = registeredAbilityAutomationRuntimeFor(input.canonicalId)
  if (!runtime) return Object.freeze([])
  return Object.freeze(input.map.placements.flatMap(placement => {
    const sheet = placement.sheetKind === 'pokemon'
      ? input.snapshots.pokemonSheets.get(placement.sheetSlug)
      : input.snapshots.trainerSheets.get(placement.sheetSlug)
    if (!sheet) return []
    const effective = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(sheet.abilities),
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
      effects: input.state.effects,
      transformationSnapshots: input.state.abilityTransformations,
    }).some(ability => ability.effective
      && ability.canonicalId === input.canonicalId
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
    return effective ? [placement.id] : []
  }))
}

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
  let loadedSheets: EncounterLifecycleSheetSnapshots | null = null
  const loadSheets = (): EncounterLifecycleSheetSnapshots => (
    loadedSheets ??= input.loadSheets()
  )
  const deepSleepPlacementIds = events.some(event => event.kind === 'turn-end')
    ? effectiveAbilityPlacementIds({
        map: lifecycleMap,
        state: previousEncounterState,
        snapshots: loadSheets(),
        canonicalId: 'Deep Sleep',
      })
    : Object.freeze([])
  const activeWeather = createMoveAutomationWeatherResolver(lifecycleMap).active()
  const rainy = activeWeather.some(weather => weather.kind === 'rainy')
  const desertWeatherPlacementIds = rainy && events.some(event => event.kind === 'turn-end')
    ? effectiveAbilityPlacementIds({
        map: lifecycleMap,
        state: previousEncounterState,
        snapshots: loadSheets(),
        canonicalId: 'Desert Weather',
      })
    : Object.freeze([])
  const drySkinWeather = activeWeather
    .some(weather => weather.kind === 'sunny' || weather.kind === 'rainy')
  const drySkinPlacementIds = drySkinWeather && events.some(event => event.kind === 'turn-end')
    ? effectiveAbilityPlacementIds({
        map: lifecycleMap,
        state: previousEncounterState,
        snapshots: loadSheets(),
        canonicalId: 'Dry Skin',
      })
    : Object.freeze([])
  const iceFacePlacementIds = events.some(event => event.kind === 'round-start' && event.round === 1)
    ? effectiveAbilityPlacementIds({
        map: lifecycleMap,
        state: previousEncounterState,
        snapshots: loadSheets(),
        canonicalId: 'Ice Face',
      })
    : Object.freeze([])
  const iceFaceTemporaryHp = new Map(iceFacePlacementIds.flatMap((placementId) => {
    const placement = lifecycleMap.placements.find(candidate => candidate.id === placementId)
    if (!placement) return []
    const snapshots = loadSheets()
    const token = placementToSpawned(placement, {
      pokemon: new Map(snapshots.pokemonSheets),
      trainer: new Map(snapshots.trainerSheets),
    }, lifecycleMap)
    return token ? [[placementId, computeTickValue(token.fullMaxHp ?? token.maxHp) * 2] as const] : []
  }))
  const leechSeedTurnStart = events.some(event => event.kind === 'turn-start')
    && previousEncounterState.effects.some(effect => effect.tags.includes('leech-seed'))
  const liquidOozePlacementIds = leechSeedTurnStart
    ? effectiveAbilityPlacementIds({
        map: lifecycleMap,
        state: previousEncounterState,
        snapshots: loadSheets(),
        canonicalId: 'Liquid Ooze',
      })
    : Object.freeze([])
  const liquidOozeTickByPlacementId = new Map(liquidOozePlacementIds.flatMap((placementId) => {
    const placement = lifecycleMap.placements.find(candidate => candidate.id === placementId)
    if (!placement) return []
    const snapshots = loadSheets()
    const token = placementToSpawned(placement, {
      pokemon: new Map(snapshots.pokemonSheets),
      trainer: new Map(snapshots.trainerSheets),
    }, lifecycleMap)
    return token ? [[placementId, computeTickValue(token.fullMaxHp ?? token.maxHp)] as const] : []
  }))
  const moodyPlacementIds = events.some(event => event.kind === 'turn-end')
    ? effectiveAbilityPlacementIds({
        map: lifecycleMap,
        state: previousEncounterState,
        snapshots: loadSheets(),
        canonicalId: 'Moody',
      })
    : Object.freeze([])
  const magmaArmorGrappleTurnEnd = events.some(event => event.kind === 'turn-end')
    && previousEncounterState.effects.some(effect => effect.tags.includes('aa079.magma-armor-grapple'))
  const magmaArmorGrappleEntries = magmaArmorGrappleTurnEnd
    ? (() => {
        const snapshots = loadSheets()
        const sheetLookup = {
          pokemon: new Map(snapshots.pokemonSheets),
          trainer: new Map(snapshots.trainerSheets),
        }
        const tokens = lifecycleMap.placements.flatMap(placement => {
          const token = placementToSpawned(placement, sheetLookup, lifecycleMap)
          return token ? [token] : []
        })
        const effectiveIds = new Map(lifecycleMap.placements.map(placement => {
          const sheet = placement.sheetKind === 'pokemon'
            ? snapshots.pokemonSheets.get(placement.sheetSlug)
            : snapshots.trainerSheets.get(placement.sheetSlug)
          return [placement.id, sheet ? effectiveRuntimeAbilityIds({
            map: lifecycleMap,
            placement,
            sheet,
          }) : []] as const
        }))
        return aa079MagmaArmorGrappleLifecycleEntries({
          map: lifecycleMap,
          tokens,
          effectiveAbilityIds: placementId => effectiveIds.get(placementId) ?? [],
        })
      })()
    : Object.freeze([])
  const hasDelayedReactionDebt = previousEncounterState.effects.some(effect => (
    effect.kind === 'capability' && effect.payload.capabilityId === 'aa067.delayed-reaction.hp-loss'
  ))
  const aa067Handler = desertWeatherPlacementIds.length > 0 || hasDelayedReactionDebt
    ? createAa067LifecycleHandler({
        effects: previousEncounterState.effects,
        rainyDesertWeatherPlacementIds: desertWeatherPlacementIds,
      })
    : null
  const weatherHandler = createWeatherResidualLifecycleHandler(lifecycleMap)
  const terrainHandler = createGrassyTerrainLifecycleHandler(lifecycleMap)
  const corrosiveToxinsHandler = createAa065CorrosiveToxinsLifecycleHandler(lifecycleMap)
  // Registered handlers retain caller order. Built-in encounter effects run
  // next, followed by weather and terrain; field transitions remain event-local
  // and last.
  const handlers = [
    ...(input.handlers ?? []),
    ...(leechSeedTurnStart
      ? [createAa078LeechSeedLifecycleHandler({ liquidOozeTickByPlacementId })]
      : []),
    createVortexLifecycleHandler(),
    createYawnLifecycleHandler(),
    ...(deepSleepPlacementIds.length > 0
      ? [createAa066DeepSleepLifecycleHandler(deepSleepPlacementIds)]
      : []),
    ...(aa067Handler ? [aa067Handler] : []),
    ...(drySkinPlacementIds.length > 0
      ? [createAa068DrySkinLifecycleHandler({ map: lifecycleMap, drySkinPlacementIds })]
      : []),
    ...(iceFaceTemporaryHp.size > 0
      ? [createAa075IceFaceLifecycleHandler({ temporaryHpByPlacementId: iceFaceTemporaryHp })]
      : []),
    ...(magmaArmorGrappleEntries.length > 0
      ? [createAa079MagmaArmorGrappleLifecycleHandler({ entries: magmaArmorGrappleEntries })]
      : []),
    ...(moodyPlacementIds.length > 0
      ? [createAa080MoodyLifecycleHandler(moodyPlacementIds)]
      : []),
    ...(corrosiveToxinsHandler ? [corrosiveToxinsHandler] : []),
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
    const { pokemonSheets, trainerSheets } = loadSheets()
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
      const conditionRecipients = aa065CorrosiveToxinsLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: recipientsByOperationId.get(operation.id) ?? [],
      })
      const abilityRecipients = aa066DeepSleepLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: conditionRecipients,
      })
      const aa067Recipients = aa067LifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: abilityRecipients,
      })
      const aa068Recipients = aa068DrySkinLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: aa067Recipients,
      })
      const aa075Recipients = aa075IceFaceLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: aa068Recipients,
      })
      const aa080Recipients = aa080MoodyLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: aa075Recipients,
      })
      recipientsByOperationId.set(operation.id, terrainLifecycleRecipientIds({
        context,
        operation,
        candidateRecipientIds: aa080Recipients,
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
        hasEffectiveAbility: (placementId, canonicalId) => context.queries.abilities.has(
          placementId,
          canonicalId,
        ),
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
  let currentEncounterState = cleanupReduction?.state ?? reduction.state
  for (const event of plannedEvents) {
    let abilityEvent: AbilityEffectLifecycleEvent | null = null
    if (event.kind === 'turn-start' || event.kind === 'turn-end') {
      abilityEvent = { kind: 'turn-boundary', placementId: event.placementId, boundary: event.kind === 'turn-start' ? 'start' : 'end' }
    }
    else if (event.kind === 'round-start' || event.kind === 'round-end') {
      abilityEvent = { kind: 'round-boundary', boundary: event.kind === 'round-start' ? 'start' : 'end' }
    }
    else if (event.kind === 'scene-end') abilityEvent = { kind: 'scene-end' }
    if (!abilityEvent) continue
    const owned = reduceAbilityOwnedStateLifecycle(
      currentEncounterState.abilityOwnedState ?? createEmptyAbilityOwnedState(),
      abilityEvent,
    )
    const entities = reduceAbilityEntityLifecycle(
      currentEncounterState.abilityEntities ?? createEmptyAbilityEntityState(),
      abilityEvent,
    )
    currentEncounterState = reduceAbilityEffectLifecycleEncounter({
      ...currentEncounterState,
      abilityOwnedState: owned,
      abilityEntities: entities,
    }, abilityEvent).encounter
  }
  currentEncounterState = applyAa075IceFaceLifecycleTemporaryHpOwnership({
    map: nextMap,
    state: currentEncounterState,
    operations: reduction.operations,
    results: operationResults,
  })
  currentEncounterState = advanceAa065CorrosiveToxinsResidualCounters({
    state: currentEncounterState,
    operations: reduction.operations,
    results: operationResults,
  })
  currentEncounterState = reconcileAnchoredEntities({
    state: currentEncounterState,
    map: nextMap,
    events: plannedEvents,
    loadSheets,
  })
  const miniNoseTurnStarts = new Map(plannedEvents.flatMap(event => (
    event.kind === 'turn-start' ? [[event.placementId, event.eventId] as const] : []
  )))
  if (miniNoseTurnStarts.size > 0) {
    const snapshots = loadSheets()
    const activeMiniNoseOwners = new Set(effectiveAbilityPlacementIds({
      map: nextMap,
      state: currentEncounterState,
      snapshots,
      canonicalId: 'Mini-Noses',
    }))
    const lookup = {
      pokemon: new Map(snapshots.pokemonSheets),
      trainer: new Map(snapshots.trainerSheets),
    }
    const lifecycleTokens = nextMap.placements.flatMap(placement => {
      const token = placementToSpawned(placement, lookup, nextMap)
      return token ? [token] : []
    })
    currentEncounterState = reconcileAa080MiniNoseTether({
      state: currentEncounterState,
      eventIdsByOwner: new Map([...miniNoseTurnStarts].filter(([ownerId]) => activeMiniNoseOwners.has(ownerId))),
      owners: new Map(lifecycleTokens.map(token => [token.id, token])),
      dimensions: nextMap.dimensions,
      tokens: lifecycleTokens,
    })
  }
  nextMap.encounterState = deepCloneJson(currentEncounterState)
  nextMap = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
    previousMap: input.map,
    nextMap,
    operations: reduction.operations.map(operation => ({
      operation,
      recipientIds: operationResults.find(result => result.operationId === operation.id)
        ?.recipients.map(recipient => recipient.recipientId) ?? [],
    })),
  })
  currentEncounterState = parseEncounterState(nextMap.encounterState)
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
