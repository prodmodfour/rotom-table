import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventKind,
  type EncounterSceneEvent,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MapSceneState, SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { clearMapSceneResources } from '~/utils/mapSceneCleanup'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { deepCloneJson } from '~/utils/serialization'
import {
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveSheetRead,
} from './context'
import {
  planEncounterLifecycle,
  type EncounterLifecyclePlan,
  type EncounterLifecycleSheetSnapshots,
  type EncounterLifecycleSheetWrite,
} from './planInitiativeLifecycle'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type {
  EncounterLifecycleReductionResult,
  EncounterLifecycleTriggerHandler,
} from './reduceLifecycle'
import { transitionAbilitySceneEncounterState } from '../abilityAutomation/timing'

export type SceneLifecyclePlanningErrorCode =
  | 'duplicate-event-id'
  | 'duplicate-operation-id'
  | 'conflicting-sheet-write'

export class SceneLifecyclePlanningError extends Error {
  readonly code: SceneLifecyclePlanningErrorCode

  constructor(code: SceneLifecyclePlanningErrorCode, message: string) {
    super(message)
    this.name = 'SceneLifecyclePlanningError'
    this.code = code
  }
}

export interface SceneLifecyclePlan {
  readonly events: readonly EncounterSceneEvent[]
  /** One reduction per boundary, ordered scene-end before scene-start. */
  readonly reductions: readonly EncounterLifecycleReductionResult[]
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly previousTemporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly currentTemporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly previousMoveUsage: TabletopMap['moveUsage']
  readonly currentMoveUsage: TabletopMap['moveUsage']
  readonly previousFieldEffects: Required<NonNullable<TabletopMap['fieldEffects']>>
  readonly currentFieldEffects: Required<NonNullable<TabletopMap['fieldEffects']>>
  readonly nextMap: TabletopMap
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly EncounterLifecycleSheetWrite[]
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
}

export interface PlanSceneLifecycleInput {
  readonly map: TabletopMap
  readonly previous: MapSceneState | null
  readonly current: MapSceneState | null
  readonly operationId: string
  readonly time: number
  /** Loaded lazily only when a scene trigger emits sheet-backed work. */
  readonly loadSheets: () => EncounterLifecycleSheetSnapshots
  readonly handlers?: readonly EncounterLifecycleTriggerHandler[]
}

const fail = (
  code: SceneLifecyclePlanningErrorCode,
  message: string,
): never => {
  throw new SceneLifecyclePlanningError(code, message)
}

const digest = (value: string): string => createHash('sha256')
  .update(value)
  .digest('hex')
  .slice(0, 24)

const sourceOperationId = (operationId: string): string => `scene.${digest(operationId)}`

/**
 * Current scene documents predate an explicit identity field. Their
 * server-authored start timestamp is therefore the stable, name-independent
 * identity anchor. The legacy fallback remains map-local and stable while the
 * one pre-timestamp scene is active.
 */
export const encounterSceneId = (
  mapSlug: string,
  scene: MapSceneState,
): string => `scene.${digest(`${mapSlug}:${scene.startedAt ?? 'legacy-active-scene'}`)}`

const sceneEvent = (input: {
  readonly kind: Extract<EncounterEventKind, 'scene-start' | 'scene-end'>
  readonly mapSlug: string
  readonly scene: MapSceneState
  readonly sourceOperationId: string
  readonly ordinal: number
}): EncounterSceneEvent => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: `${input.sourceOperationId}.${input.ordinal}.${input.kind}`,
  kind: input.kind,
  sourceOperationId: input.sourceOperationId,
  causalParentEventId: null,
  reasonCode: `scene.${input.kind}`,
  sceneId: encounterSceneId(input.mapSlug, input.scene),
})

/** Emit exact scene boundaries in mechanical order, including atomic replacement. */
export const createSceneLifecycleEvents = (input: {
  readonly mapSlug: string
  readonly previous: MapSceneState | null
  readonly current: MapSceneState | null
  readonly operationId: string
}): readonly EncounterSceneEvent[] => {
  const sourceId = sourceOperationId(input.operationId)
  const events: EncounterSceneEvent[] = []
  if (input.previous) {
    events.push(sceneEvent({
      kind: 'scene-end',
      mapSlug: input.mapSlug,
      scene: input.previous,
      sourceOperationId: sourceId,
      ordinal: events.length + 1,
    }))
  }
  if (input.current) {
    events.push(sceneEvent({
      kind: 'scene-start',
      mapSlug: input.mapSlug,
      scene: input.current,
      sourceOperationId: sourceId,
      ordinal: events.length + 1,
    }))
  }
  return parseEncounterEvents(events) as readonly EncounterSceneEvent[]
}

const resetSceneEncounterContainers = (state: EncounterState): EncounterState => parseEncounterState({
  ...state,
  counters: {},
  turnResources: {},
  pendingResolutionSummaries: [],
})

const mapAtSceneBoundary = (
  map: TabletopMap,
  current: MapSceneState | null,
  time: number,
): TabletopMap => {
  const resetEncounter = resetSceneEncounterContainers(parseEncounterState(
    map.encounterState ?? createEmptyEncounterState(),
  ))
  const boundaryMap: TabletopMap = {
    ...deepCloneJson(map),
    activeScene: current,
    encounterState: transitionAbilitySceneEncounterState(
      resetEncounter,
      current ? encounterSceneId(map.slug, current) : null,
    ),
    updatedAt: time,
  }
  const cleaned = clearMapSceneResources(boundaryMap)
  if (current === null) delete cleaned.activeScene
  return cleaned
}

const sheetKey = (write: Pick<EncounterLifecycleSheetWrite, 'kind' | 'slug'>): string => (
  `${write.kind}:${write.slug}`
)

const snapshotsWithWrites = (
  snapshots: EncounterLifecycleSheetSnapshots,
  writes: readonly EncounterLifecycleSheetWrite[],
): EncounterLifecycleSheetSnapshots => {
  const pokemonSheets = new Map(snapshots.pokemonSheets)
  const trainerSheets = new Map(snapshots.trainerSheets)
  for (const write of writes) {
    // Both scene phases are one physical transaction. Feed phase-one values to
    // phase two while retaining the original repository revision so the final
    // aggregate remains one CAS write rather than a fictitious intermediate commit.
    const sheet = {
      ...deepCloneJson(write.nextSheet),
      revision: write.expectedRevision,
    }
    if (write.kind === 'pokemon') pokemonSheets.set(write.slug, sheet as CharacterSheet)
    else trainerSheets.set(write.slug, sheet as TrainerSheet)
  }
  return { pokemonSheets, trainerSheets }
}

const mergeUnique = <Value extends string>(
  left: readonly Value[],
  right: readonly Value[],
): readonly Value[] => [...new Set([...left, ...right])]

const mergeSheetWrites = (
  phases: readonly EncounterLifecyclePlan[],
): readonly EncounterLifecycleSheetWrite[] => {
  const writes = new Map<string, EncounterLifecycleSheetWrite>()
  for (const phase of phases) {
    for (const write of phase.sheetWrites) {
      const key = sheetKey(write)
      const existing = writes.get(key)
      if (!existing) {
        writes.set(key, deepCloneJson(write))
        continue
      }
      if (
        existing.kind !== write.kind
        || existing.slug !== write.slug
        || existing.expectedRevision !== write.expectedRevision
      ) {
        fail(
          'conflicting-sheet-write',
          `Scene lifecycle phases observed conflicting revisions for ${write.kind} sheet ${write.slug}.`,
        )
      }
      writes.set(key, {
        ...write,
        previousSheet: existing.previousSheet,
        placementIds: mergeUnique(existing.placementIds, write.placementIds),
        changedFields: mergeUnique(existing.changedFields, write.changedFields),
      })
    }
  }
  return [...writes.values()].map(write => deepCloneJson(write))
}

const assertUniqueLifecycleIds = (
  phases: readonly EncounterLifecyclePlan[],
): void => {
  const eventIds = new Set<string>()
  const operationIds = new Set<string>()
  for (const phase of phases) {
    for (const reduction of phase.reductions) {
      for (const event of reduction.processedEvents) {
        if (eventIds.has(event.eventId)) {
          fail(
            'duplicate-event-id',
            `Scene lifecycle event ${event.eventId} was processed at more than one boundary.`,
          )
        }
        eventIds.add(event.eventId)
      }
      for (const operation of reduction.operations) {
        if (operationIds.has(operation.id)) {
          fail(
            'duplicate-operation-id',
            `Scene lifecycle operation ${operation.id} was emitted at more than one boundary.`,
          )
        }
        operationIds.add(operation.id)
      }
    }
  }
}

/**
 * Plan scene-end work, clear scene-local state, then plan scene-start work.
 * Replacement keeps both boundaries in one eventual SQLite transaction while
 * presenting each phase with the scene and temporary-HP snapshot it owns.
 */
export const planSceneLifecycle = (
  input: PlanSceneLifecycleInput,
): SceneLifecyclePlan => {
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const events = createSceneLifecycleEvents({
    mapSlug: input.map.slug,
    previous: input.previous,
    current: input.current,
    operationId: input.operationId,
  })
  let originalSnapshots: EncounterLifecycleSheetSnapshots | null = null
  const loadOriginalSnapshots = (): EncounterLifecycleSheetSnapshots => {
    originalSnapshots ??= input.loadSheets()
    return originalSnapshots
  }
  const phases: EncounterLifecyclePlan[] = []
  let workingMap = deepCloneJson(input.map)

  const endEvent = events.find(event => event.kind === 'scene-end')
  if (endEvent) {
    const phase = planEncounterLifecycle({
      map: workingMap,
      events: [endEvent],
      time: input.time,
      loadSheets: loadOriginalSnapshots,
      handlers: input.handlers,
    })
    phases.push(phase)
    workingMap = phase.nextMap
  }

  // The boundary itself clears old scene-local compatibility state after
  // scene-end triggers and before any scene-start trigger observes the map.
  workingMap = mapAtSceneBoundary(workingMap, input.current, input.time)

  const startEvent = events.find(event => event.kind === 'scene-start')
  if (startEvent) {
    const priorWrites = mergeSheetWrites(phases)
    const phase = planEncounterLifecycle({
      map: workingMap,
      events: [startEvent],
      time: input.time,
      loadSheets: () => snapshotsWithWrites(loadOriginalSnapshots(), priorWrites),
      handlers: input.handlers,
    })
    phases.push(phase)
    workingMap = phase.nextMap
  }

  assertUniqueLifecycleIds(phases)
  const sheetReads = deduplicateAuthoritativeMoveSheetReads(
    phases.flatMap(phase => [...phase.sheetReads]),
  )
  const sheetWrites = mergeSheetWrites(phases)
  const reductions = phases.flatMap(phase => [...phase.reductions])
  const rollLedger = phases.flatMap(phase => [...phase.rollLedger])
  const currentEncounterState = parseEncounterState(
    workingMap.encounterState ?? createEmptyEncounterState(),
  )

  return Object.freeze({
    events,
    reductions,
    previousEncounterState,
    currentEncounterState,
    previousTemporaryHitPoints: deepCloneJson(input.map.temporaryHitPoints),
    currentTemporaryHitPoints: deepCloneJson(workingMap.temporaryHitPoints),
    previousMoveUsage: deepCloneJson(input.map.moveUsage),
    currentMoveUsage: deepCloneJson(workingMap.moveUsage),
    previousFieldEffects: cloneMapFieldEffects(input.map.fieldEffects),
    currentFieldEffects: cloneMapFieldEffects(workingMap.fieldEffects),
    nextMap: workingMap,
    sheetReads: deepCloneJson(sheetReads),
    sheetWrites: deepCloneJson(sheetWrites),
    rollLedger: deepCloneJson(rollLedger),
  })
}
