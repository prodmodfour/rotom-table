import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_LIMITS,
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventMovementMode,
  type EncounterMovementIdentity,
} from '#shared/moveAutomation/events'
import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import {
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { GridAnchor } from '~/types/map'
import type { AuthoritativeMovementTriggeringStep } from '../movement/resolveMovement'
import {
  reduceEncounterLifecycle,
  type EncounterLifecyclePendingInterrupt,
  type EncounterLifecycleReductionResult,
  type EncounterLifecycleTriggerHandler,
} from './reduceLifecycle'

/** Durable, server-only cursor version for one interruptible movement path. */
export const MOVEMENT_LIFECYCLE_CURSOR_SCHEMA_VERSION = 1 as const

export const MOVEMENT_LIFECYCLE_LIMITS = Object.freeze({
  /** One path cannot bypass the bounded encounter-event batch budget. */
  events: ENCOUNTER_EVENT_LIMITS.events,
})

export interface AuthoritativeMovementLifecyclePath {
  readonly placementId: string
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
}

export interface CreateAuthoritativeMovementLifecycleEventsInput {
  readonly movement: AuthoritativeMovementLifecyclePath
  readonly movementId: string
  readonly sourceOperationId: string
  readonly mode: EncounterEventMovementMode
  /** Optional durable event immediately preceding this path. */
  readonly causalParentEventId?: string | null
}

export interface MovementLifecycleCursor {
  readonly schemaVersion: typeof MOVEMENT_LIFECYCLE_CURSOR_SCHEMA_VERSION
  readonly movementId: string
  readonly pathHash: string
  /** Zero-based index of the next path event. */
  readonly nextEventIndex: number
}

export type MovementLifecycleRunAction = 'continue' | 'cancel'

export interface RunAuthoritativeMovementLifecycleInput
  extends CreateAuthoritativeMovementLifecycleEventsInput {
  readonly state: EncounterState
  readonly handlers?: readonly EncounterLifecycleTriggerHandler[]
  readonly cursor?: MovementLifecycleCursor | null
  /** Cancel discards all unprocessed path facts at the last committed step. */
  readonly action?: MovementLifecycleRunAction
}

interface MovementLifecycleRunResultBase<Status extends string> {
  readonly status: Status
  readonly state: EncounterState
  /** Root path facts processed by this invocation only. */
  readonly processedPathEvents: readonly EncounterEvent[]
  readonly reductions: readonly EncounterLifecycleReductionResult[]
  /** Typed operations enqueued by this invocation only. */
  readonly operations: readonly MoveEffectOperation[]
  readonly cursor: MovementLifecycleCursor
  readonly currentPosition: GridAnchor
  readonly completedStepCount: number
  readonly remainingStepCount: number
  readonly remainingEventCount: number
}

export interface CompletedMovementLifecycleRun
  extends MovementLifecycleRunResultBase<'completed'> {
  readonly pendingInterrupts: readonly []
}

export interface PendingMovementLifecycleRun
  extends MovementLifecycleRunResultBase<'pending-interrupt'> {
  readonly pendingInterrupts: readonly EncounterLifecyclePendingInterrupt[]
}

export interface CancelledMovementLifecycleRun
  extends MovementLifecycleRunResultBase<'cancelled'> {
  readonly pendingInterrupts: readonly []
}

export type AuthoritativeMovementLifecycleRun =
  | CompletedMovementLifecycleRun
  | PendingMovementLifecycleRun
  | CancelledMovementLifecycleRun

export type MovementLifecycleErrorCode =
  | 'invalid-path'
  | 'event-limit-exceeded'
  | 'invalid-cursor'
  | 'cursor-path-mismatch'
  | 'invalid-run-action'
  | 'invalid-interrupt'
  | 'duplicate-operation-id'

export class MovementLifecycleError extends Error {
  readonly code: MovementLifecycleErrorCode

  constructor(code: MovementLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'MovementLifecycleError'
    this.code = code
  }
}

const fail = (code: MovementLifecycleErrorCode, message: string): never => {
  throw new MovementLifecycleError(code, message)
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const EVENT_MODE_SET = new Set<EncounterEventMovementMode>([
  'voluntary',
  'forced',
  'teleport',
  'swap',
])

const validStableId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= ENCOUNTER_EVENT_LIMITS.identifierChars
  && value.trim() === value
  && !CONTROL_CHARACTER_PATTERN.test(value)
  && STABLE_ID_PATTERN.test(value)
)

const assertEventIdentity = (
  input: CreateAuthoritativeMovementLifecycleEventsInput,
): void => {
  if (!validStableId(input.movementId) || !validStableId(input.sourceOperationId)) {
    fail('invalid-path', 'Movement and source operation IDs must be bounded stable IDs.')
  }
  if (
    input.causalParentEventId !== undefined
    && input.causalParentEventId !== null
    && !validStableId(input.causalParentEventId)
  ) {
    fail('invalid-path', 'Movement causal parent must be null or a bounded stable event ID.')
  }
  if (
    typeof input.movement.placementId !== 'string'
    || input.movement.placementId.length === 0
    || input.movement.placementId.length > ENCOUNTER_EVENT_LIMITS.identifierChars
    || input.movement.placementId.trim() !== input.movement.placementId
    || CONTROL_CHARACTER_PATTERN.test(input.movement.placementId)
  ) {
    fail('invalid-path', 'Movement placement ID must be bounded non-empty text.')
  }
  if (!EVENT_MODE_SET.has(input.mode)) {
    fail('invalid-path', 'Movement lifecycle mode is unsupported.')
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const sameAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const validAnchor = (value: GridAnchor): boolean => (
  Number.isSafeInteger(value.x)
  && Number.isSafeInteger(value.y)
  && Number.isSafeInteger(value.z)
  && value.x >= 0
  && value.y >= 0
  && value.z >= 0
  && value.x <= ENCOUNTER_EVENT_LIMITS.coordinate
  && value.y <= ENCOUNTER_EVENT_LIMITS.coordinate
  && value.z <= ENCOUNTER_EVENT_LIMITS.coordinate
)

const stablePathData = (input: CreateAuthoritativeMovementLifecycleEventsInput) => ({
  movementId: input.movementId,
  sourceOperationId: input.sourceOperationId,
  mode: input.mode,
  causalParentEventId: input.causalParentEventId ?? null,
  placementId: input.movement.placementId,
  origin: cloneAnchor(input.movement.origin),
  destination: cloneAnchor(input.movement.destination),
  steps: input.movement.triggeringSteps.map(step => ({
    index: step.index,
    from: cloneAnchor(step.from),
    to: cloneAnchor(step.to),
    cost: step.cost,
    cumulativeCost: step.cumulativeCost,
    diagonal: step.diagonal,
    slowCostApplied: step.slowCostApplied,
    capabilities: step.capabilities.map(capability => ({ ...capability })),
    terrain: {
      requirements: [...step.terrain.requirements],
      slow: step.terrain.slow,
      air: step.terrain.air,
      airHeight: step.terrain.airHeight,
      hoverable: step.terrain.hoverable,
    },
    leftAdjacentPlacementIds: [...step.leftAdjacentPlacementIds],
    leftCells: step.leftCells.map(cloneAnchor),
    enteredCells: step.enteredCells.map(cloneAnchor),
    finalDestination: step.finalDestination,
  })),
})

/** Fingerprint every server-derived path fact retained by an interrupt cursor. */
export const authoritativeMovementLifecyclePathHash = (
  input: CreateAuthoritativeMovementLifecycleEventsInput,
): string => createHash('sha256')
  .update(JSON.stringify(stablePathData(input)))
  .digest('hex')

const assertUniqueAnchors = (
  cells: readonly GridAnchor[],
  label: string,
): void => {
  if (!Array.isArray(cells)) return fail('invalid-path', `${label} must be an array.`)
  const seen = new Set<string>()
  for (const [index, cell] of cells.entries()) {
    if (!validAnchor(cell)) return fail('invalid-path', `${label}[${index}] is not a bounded grid cell.`)
    const key = `${cell.x},${cell.y},${cell.z}`
    if (seen.has(key)) return fail('invalid-path', `${label} duplicates cell ${key}.`)
    seen.add(key)
  }
}

const assertPath = (movement: AuthoritativeMovementLifecyclePath): void => {
  if (!Array.isArray(movement.triggeringSteps)) {
    return fail('invalid-path', 'Movement triggering steps must be an array.')
  }
  if (!validAnchor(movement.origin) || !validAnchor(movement.destination)) {
    return fail('invalid-path', 'Movement origin and destination must be bounded grid cells.')
  }
  if (movement.triggeringSteps.length > ENCOUNTER_EVENT_LIMITS.movementStep) {
    return fail(
      'invalid-path',
      `Movement path cannot exceed ${ENCOUNTER_EVENT_LIMITS.movementStep} steps.`,
    )
  }
  if (movement.triggeringSteps.length === 0) {
    if (!sameAnchor(movement.origin, movement.destination)) {
      fail('invalid-path', 'A path without triggering steps must retain its origin.')
    }
    return
  }

  let expectedFrom = movement.origin
  for (const [offset, step] of movement.triggeringSteps.entries()) {
    const expectedIndex = offset + 1
    if (step.index !== expectedIndex) {
      fail('invalid-path', `Movement step ${offset} must have one-based index ${expectedIndex}.`)
    }
    if (!validAnchor(step.from) || !validAnchor(step.to) || sameAnchor(step.from, step.to)) {
      fail('invalid-path', `Movement step ${expectedIndex} must change between bounded cells.`)
    }
    if (!sameAnchor(step.from, expectedFrom)) {
      fail('invalid-path', `Movement step ${expectedIndex} is not continuous with the prior step.`)
    }
    const finalDestination = expectedIndex === movement.triggeringSteps.length
    if (step.finalDestination !== finalDestination) {
      fail(
        'invalid-path',
        `Movement step ${expectedIndex} finalDestination must be ${String(finalDestination)}.`,
      )
    }
    if (!Array.isArray(step.leftAdjacentPlacementIds)) {
      fail('invalid-path', `Movement step ${expectedIndex} adjacency identities must be an array.`)
    }
    const adjacentIds = new Set<string>()
    for (const adjacentPlacementId of step.leftAdjacentPlacementIds) {
      if (
        typeof adjacentPlacementId !== 'string'
        || adjacentPlacementId.length === 0
        || adjacentPlacementId.length > ENCOUNTER_EVENT_LIMITS.identifierChars
        || adjacentPlacementId.trim() !== adjacentPlacementId
        || adjacentPlacementId === movement.placementId
      ) {
        fail('invalid-path', `Movement step ${expectedIndex} has an invalid adjacent placement.`)
      }
      if (adjacentIds.has(adjacentPlacementId)) {
        fail(
          'invalid-path',
          `Movement step ${expectedIndex} duplicates adjacent placement ${adjacentPlacementId}.`,
        )
      }
      adjacentIds.add(adjacentPlacementId)
    }
    assertUniqueAnchors(step.leftCells, `Movement step ${expectedIndex} leftCells`)
    assertUniqueAnchors(step.enteredCells, `Movement step ${expectedIndex} enteredCells`)
    expectedFrom = step.to
  }

  if (!sameAnchor(expectedFrom, movement.destination)) {
    fail('invalid-path', 'The final movement step does not reach the authoritative destination.')
  }
}

const movementIdentity = (
  input: CreateAuthoritativeMovementLifecycleEventsInput,
  step: AuthoritativeMovementTriggeringStep,
): EncounterMovementIdentity => ({
  movementId: input.movementId,
  mode: input.mode,
  step: step.index,
  stepCount: input.movement.triggeringSteps.length,
})

const eventReason = (
  kind: 'leave-adjacency' | 'leave-cell' | 'enter-cell' | 'step-completed',
  finalDestination = false,
): string => finalDestination ? 'movement.final-destination' : `movement.${kind}`

/**
 * Materialize exact movement facts in mechanical order for every path step:
 * lost adjacency first, then vacated cells, entered cells, and the committed
 * step/final-destination marker. Event IDs and causal links are deterministic.
 */
export const createAuthoritativeMovementLifecycleEvents = (
  input: CreateAuthoritativeMovementLifecycleEventsInput,
): readonly EncounterEvent[] => {
  assertEventIdentity(input)
  assertPath(input.movement)
  const pathHash = authoritativeMovementLifecyclePathHash(input)
  const rawEvents: Record<string, unknown>[] = []
  let causalParentEventId = input.causalParentEventId ?? null

  const append = (
    event: Omit<Record<string, unknown>, 'schemaVersion' | 'eventId' | 'sourceOperationId' | 'causalParentEventId'>,
  ): void => {
    if (rawEvents.length >= MOVEMENT_LIFECYCLE_LIMITS.events) {
      fail(
        'event-limit-exceeded',
        `Movement path cannot emit more than ${MOVEMENT_LIFECYCLE_LIMITS.events} lifecycle events.`,
      )
    }
    const eventId = `movement.${pathHash.slice(0, 32)}.${rawEvents.length + 1}`
    rawEvents.push({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId,
      sourceOperationId: input.sourceOperationId,
      causalParentEventId,
      ...event,
    })
    causalParentEventId = eventId
  }

  for (const step of input.movement.triggeringSteps) {
    const movement = movementIdentity(input, step)
    for (const adjacentPlacementId of step.leftAdjacentPlacementIds) {
      append({
        kind: 'placement-leaving-adjacency',
        reasonCode: eventReason('leave-adjacency'),
        placementId: input.movement.placementId,
        adjacentPlacementId,
        movement,
        from: cloneAnchor(step.from),
        to: cloneAnchor(step.to),
      })
    }
    for (const cell of step.leftCells) {
      append({
        kind: 'placement-leaving',
        reasonCode: eventReason('leave-cell'),
        placementId: input.movement.placementId,
        movement,
        cell: cloneAnchor(cell),
      })
    }
    for (const cell of step.enteredCells) {
      append({
        kind: 'placement-entering',
        reasonCode: eventReason('enter-cell'),
        placementId: input.movement.placementId,
        movement,
        cell: cloneAnchor(cell),
      })
    }
    append({
      kind: 'placement-moving',
      reasonCode: eventReason('step-completed', step.finalDestination),
      placementId: input.movement.placementId,
      movement,
      from: cloneAnchor(step.from),
      to: cloneAnchor(step.to),
      finalDestination: step.finalDestination,
    })
  }

  return parseEncounterEvents(rawEvents, 'movementLifecycle.events')
}

const exactCursorFields = (
  value: MovementLifecycleCursor,
): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  return JSON.stringify(keys) === JSON.stringify([
    'movementId',
    'nextEventIndex',
    'pathHash',
    'schemaVersion',
  ])
}

const cursorFor = (
  input: CreateAuthoritativeMovementLifecycleEventsInput,
  nextEventIndex: number,
): MovementLifecycleCursor => deepFreeze({
  schemaVersion: MOVEMENT_LIFECYCLE_CURSOR_SCHEMA_VERSION,
  movementId: input.movementId,
  pathHash: authoritativeMovementLifecyclePathHash(input),
  nextEventIndex,
})

const parseCursor = (
  input: CreateAuthoritativeMovementLifecycleEventsInput,
  events: readonly EncounterEvent[],
  value: MovementLifecycleCursor | null | undefined,
): MovementLifecycleCursor => {
  if (value === undefined || value === null) return cursorFor(input, 0)
  if (
    !exactCursorFields(value)
    || value.schemaVersion !== MOVEMENT_LIFECYCLE_CURSOR_SCHEMA_VERSION
    || value.movementId !== input.movementId
    || !Number.isSafeInteger(value.nextEventIndex)
    || value.nextEventIndex < 0
    || value.nextEventIndex > events.length
  ) {
    return fail('invalid-cursor', 'Movement lifecycle cursor is malformed or out of range.')
  }
  if (value.pathHash !== authoritativeMovementLifecyclePathHash(input)) {
    return fail('cursor-path-mismatch', 'Movement lifecycle path changed before continuation.')
  }

  const validIndexes = new Set<number>([0, events.length])
  events.forEach((event, index) => {
    if (
      event.kind === 'placement-leaving-adjacency'
      || event.kind === 'placement-moving'
    ) {
      validIndexes.add(index + 1)
    }
  })
  if (!validIndexes.has(value.nextEventIndex)) {
    return fail('invalid-cursor', 'Movement lifecycle cursor does not identify an interrupt boundary.')
  }
  return deepFreeze({ ...value })
}

const progressBefore = (
  movement: AuthoritativeMovementLifecyclePath,
  events: readonly EncounterEvent[],
  nextEventIndex: number,
): { readonly position: GridAnchor; readonly completedStepCount: number } => {
  let position = cloneAnchor(movement.origin)
  let completedStepCount = 0
  for (const event of events.slice(0, nextEventIndex)) {
    if (event.kind !== 'placement-moving') continue
    position = cloneAnchor(event.to)
    completedStepCount = event.movement.step
  }
  return { position, completedStepCount }
}

const assertPendingMovementInterrupts = (
  interrupts: readonly EncounterLifecyclePendingInterrupt[],
  event: EncounterEvent,
): void => {
  if (interrupts.length === 0) return
  if (
    event.kind !== 'placement-leaving-adjacency'
    && event.kind !== 'placement-moving'
  ) {
    fail(
      'invalid-interrupt',
      `Lifecycle event ${event.eventId} cannot suspend a path outside a movement-step checkpoint.`,
    )
  }
  for (const interrupt of interrupts) {
    if (
      interrupt.operation.phase !== 'movement'
      || interrupt.operation.payload.timing !== 'movement-step'
    ) {
      fail(
        'invalid-interrupt',
        `Lifecycle operation ${interrupt.operation.id} is not a movement-step reaction request.`,
      )
    }
  }
}

const runResult = <Result extends AuthoritativeMovementLifecycleRun>(
  result: Result,
): Result => deepFreeze(result)

/**
 * Reduce one authoritative movement path until completion or the first typed
 * movement-step interrupt. Lost-adjacency checkpoints occur before the step;
 * placement-moving checkpoints occur after it. The returned cursor points
 * after the fact that opened the window, so continuation cannot trigger it twice.
 * Cancelling from that cursor drops the remaining path at the last committed
 * step without applying a compensating destination mutation.
 */
export const runAuthoritativeMovementLifecycle = (
  input: RunAuthoritativeMovementLifecycleInput,
): AuthoritativeMovementLifecycleRun => {
  const action = input.action ?? 'continue'
  if (action !== 'continue' && action !== 'cancel') {
    return fail('invalid-run-action', 'Movement lifecycle action must be continue or cancel.')
  }
  const events = createAuthoritativeMovementLifecycleEvents(input)
  const initialCursor = parseCursor(input, events, input.cursor)
  const initialProgress = progressBefore(
    input.movement,
    events,
    initialCursor.nextEventIndex,
  )
  const initialState = parseEncounterState(input.state)

  if (action === 'cancel') {
    return runResult({
      status: 'cancelled',
      state: initialState,
      processedPathEvents: [],
      reductions: [],
      operations: [],
      pendingInterrupts: [],
      cursor: initialCursor,
      currentPosition: initialProgress.position,
      completedStepCount: initialProgress.completedStepCount,
      remainingStepCount: input.movement.triggeringSteps.length - initialProgress.completedStepCount,
      remainingEventCount: events.length - initialCursor.nextEventIndex,
    })
  }

  let state = initialState
  let position = initialProgress.position
  let completedStepCount = initialProgress.completedStepCount
  const processedPathEvents: EncounterEvent[] = []
  const reductions: EncounterLifecycleReductionResult[] = []
  const operations: MoveEffectOperation[] = []
  const operationIds = new Set<string>()

  const reducePathEvent = (event: EncounterEvent): EncounterLifecycleReductionResult => {
    const reduction = reduceEncounterLifecycle(
      state,
      [event],
      input.handlers ?? [],
    )
    for (const operation of reduction.operations) {
      if (operationIds.has(operation.id)) {
        fail(
          'duplicate-operation-id',
          `Movement lifecycle operation ${operation.id} was enqueued more than once.`,
        )
      }
      operationIds.add(operation.id)
      operations.push(operation)
    }
    state = reduction.state
    processedPathEvents.push(event)
    reductions.push(reduction)

    if (event.kind === 'placement-moving') {
      position = cloneAnchor(event.to)
      completedStepCount = event.movement.step
    }
    assertPendingMovementInterrupts(reduction.pendingInterrupts, event)
    return reduction
  }

  for (let index = initialCursor.nextEventIndex; index < events.length; index += 1) {
    const event = events[index]!
    const pendingInterrupts = [...reducePathEvent(event).pendingInterrupts]

    // Every lost-adjacency fact for one step is a single pre-step checkpoint.
    // Consume the complete deterministic group before suspending so multiple
    // eligible defenders share one window set and continuation cannot reopen
    // later adjacency facts from the same uncommitted step.
    if (event.kind === 'placement-leaving-adjacency') {
      while (index + 1 < events.length) {
        const nextEvent = events[index + 1]!
        if (
          nextEvent.kind !== 'placement-leaving-adjacency'
          || nextEvent.movement.movementId !== event.movement.movementId
          || nextEvent.movement.step !== event.movement.step
        ) break
        index += 1
        pendingInterrupts.push(...reducePathEvent(nextEvent).pendingInterrupts)
      }
    }

    if (pendingInterrupts.length > 0) {
      const cursor = cursorFor(input, index + 1)
      return runResult({
        status: 'pending-interrupt',
        state,
        processedPathEvents,
        reductions,
        operations,
        pendingInterrupts,
        cursor,
        currentPosition: position,
        completedStepCount,
        remainingStepCount: input.movement.triggeringSteps.length - completedStepCount,
        remainingEventCount: events.length - cursor.nextEventIndex,
      })
    }
  }

  const cursor = cursorFor(input, events.length)
  return runResult({
    status: 'completed',
    state,
    processedPathEvents,
    reductions,
    operations,
    pendingInterrupts: [],
    cursor,
    currentPosition: position,
    completedStepCount,
    remainingStepCount: 0,
    remainingEventCount: 0,
  })
}
