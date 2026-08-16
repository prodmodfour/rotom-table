import {
  ENCOUNTER_EFFECT_LIMITS,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  ENCOUNTER_EVENT_LIMITS,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventKind,
} from '#shared/moveAutomation/events'
import {
  MOVE_EFFECT_OPERATION_LIMITS,
  parseMoveEffectOperations,
  type MoveEffectOperation,
  type MoveEffectOperationKind,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { MoveAutomationRandomRoller } from '#shared/moveAutomation/random'
import { MOVE_RESOLUTION_TRACE_LIMITS } from '#shared/moveAutomation/trace'
import {
  applyEncounterEffectLifecycleEvent,
  type EncounterEffectLifecycleEvent,
  type EncounterEffectLifecycleTransition,
  type EncounterEffectLifecycleTransitionKind,
} from './effectLifecycle'
import {
  advanceEncounterGlobalFields,
  type GlobalFieldLifecycleEvent,
  type GlobalFieldTransition,
  type GlobalFieldTransitionKind,
} from './fieldLifecycle'
import { reduceEncounterHistoryEvent } from './reduceEncounterHistory'
import { reduceEncounterResourceEvent } from './reduceEncounterResources'
import { transformationEffectIdsEndedByEvent } from './transformationLifecycle'

/**
 * Hard ceilings for one pure lifecycle reduction.
 *
 * Initial event batches retain the shared wire-contract bound. Triggered child
 * events receive a separate aggregate allowance, and every child consumes one
 * explicit recursion level. Operations and trace entries reuse the existing
 * MoveSpec/audit ceilings so lifecycle work cannot bypass engine budgets.
 */
export const ENCOUNTER_LIFECYCLE_LIMITS = Object.freeze({
  handlers: 64,
  triggersPerHandlerEvent: 64,
  triggers: ENCOUNTER_EVENT_LIMITS.events,
  emittedEvents: ENCOUNTER_EVENT_LIMITS.events,
  recursionDepth: 16,
  operations: MOVE_EFFECT_OPERATION_LIMITS.operations,
  traceEntries: MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
})

export interface EncounterLifecycleReductionCounters {
  readonly initialEventCount: number
  readonly processedEventCount: number
  readonly emittedEventCount: number
  readonly triggerCount: number
  readonly operationCount: number
  readonly effectTransitionCount: number
  readonly fieldTransitionCount: number
  /** Root events are depth zero. */
  readonly maximumDepth: number
}

export interface EncounterLifecycleTriggerContext {
  /** Canonical immutable state after earlier ordered work for this event. */
  readonly state: EncounterState
  /** Effects present immediately before this event began reducing. */
  readonly effectsAtEventStart: readonly EncounterEffect[]
  readonly event: EncounterEvent
  readonly depth: number
  readonly eventSequence: number
  /** Explicit server-owned randomness; every draw must enter its caller-owned ledger. */
  readonly random: MoveAutomationRandomRoller
  /** Direct and trigger-consumption transitions already applied for this event. */
  readonly transitions: readonly EncounterEffectLifecycleTransition[]
}

/**
 * One registered, server-owned trigger result.
 *
 * `effectId` identifies the exact active effect whose trigger/charge policy is
 * consumed. Null is reserved for event-level rules that are not owned by an
 * effect instance. Operations and child events are still strictly parsed by
 * their shared contracts before they enter the result queue.
 */
export interface EncounterLifecycleTrigger {
  readonly effectId: string | null
  readonly reasonCode: string
  readonly operations: readonly MoveEffectOperation[]
  readonly emittedEvents: readonly EncounterEvent[]
}

/**
 * Ordered trigger handlers are a server-only rules seam. Implementations must
 * be pure: the reducer supplies frozen context and validates all returned data.
 * Handler array order, then result array order, is mechanically significant.
 */
export interface EncounterLifecycleTriggerHandler {
  readonly id: string
  readonly resolve: (
    context: EncounterLifecycleTriggerContext,
  ) => readonly EncounterLifecycleTrigger[]
}

interface EncounterLifecycleTraceEntryBase<Kind extends string> {
  readonly sequence: number
  readonly kind: Kind
  readonly eventId: string
  readonly depth: number
  readonly reasonCode: string
}

export interface EncounterLifecycleEventTraceEntry
  extends EncounterLifecycleTraceEntryBase<'event'> {
  readonly eventKind: EncounterEventKind
}

export interface EncounterLifecycleEffectTransitionTraceEntry
  extends EncounterLifecycleTraceEntryBase<'effect-transition'> {
  readonly effectId: string
  readonly transitionKind: EncounterEffectLifecycleTransitionKind
}

export interface EncounterLifecycleFieldTransitionTraceEntry
  extends EncounterLifecycleTraceEntryBase<'field-transition'> {
  readonly zoneId: string
  readonly transitionKind: GlobalFieldTransitionKind
}

export interface EncounterLifecycleTriggerTraceEntry
  extends EncounterLifecycleTraceEntryBase<'trigger'> {
  readonly handlerId: string
  readonly effectId: string | null
}

export interface EncounterLifecycleOperationTraceEntry
  extends EncounterLifecycleTraceEntryBase<'operation-enqueued'> {
  readonly handlerId: string
  readonly operationId: string
  readonly operationKind: MoveEffectOperationKind
}

export interface EncounterLifecycleEmittedEventTraceEntry
  extends EncounterLifecycleTraceEntryBase<'event-emitted'> {
  readonly handlerId: string
  readonly emittedEventId: string
  readonly emittedEventKind: EncounterEventKind
}

export type EncounterLifecycleTraceEntry =
  | EncounterLifecycleEventTraceEntry
  | EncounterLifecycleEffectTransitionTraceEntry
  | EncounterLifecycleFieldTransitionTraceEntry
  | EncounterLifecycleTriggerTraceEntry
  | EncounterLifecycleOperationTraceEntry
  | EncounterLifecycleEmittedEventTraceEntry

export interface EncounterLifecycleAppliedTransition {
  readonly sequence: number
  readonly eventId: string
  readonly eventKind: EncounterEventKind
  readonly depth: number
  readonly transition: EncounterEffectLifecycleTransition
}

export interface EncounterLifecycleAppliedFieldTransition {
  readonly sequence: number
  readonly eventId: string
  readonly eventKind: EncounterEventKind
  readonly depth: number
  readonly transition: GlobalFieldTransition
}

/**
 * A typed reaction request enqueued by one lifecycle fact. Movement-path
 * orchestration uses this explicit signal to suspend before later path facts;
 * the reducer itself remains repository-free and never opens a window.
 */
export interface EncounterLifecyclePendingInterrupt {
  readonly eventId: string
  readonly eventKind: EncounterEventKind
  readonly operation: MoveReactionRequestEffectOperation
}

export interface EncounterLifecycleReductionResult {
  readonly state: EncounterState
  /** True only when the final encounter state differs from the input state. */
  readonly changed: boolean
  /** Root and recursively emitted events in exact reduction order. */
  readonly processedEvents: readonly EncounterEvent[]
  /** Trigger-emitted events only, in exact emission order. */
  readonly emittedEvents: readonly EncounterEvent[]
  /** Typed mechanics work for the caller's planner, in exact enqueue order. */
  readonly operations: readonly MoveEffectOperation[]
  /** Typed suspension signals, in the same order as their operations. */
  readonly pendingInterrupts: readonly EncounterLifecyclePendingInterrupt[]
  readonly transitions: readonly EncounterLifecycleAppliedTransition[]
  readonly fieldTransitions: readonly EncounterLifecycleAppliedFieldTransition[]
  readonly trace: readonly EncounterLifecycleTraceEntry[]
  readonly counters: EncounterLifecycleReductionCounters
}

export type EncounterLifecycleReductionErrorCode =
  | 'invalid-handler'
  | 'duplicate-handler-id'
  | 'invalid-trigger'
  | 'unknown-trigger-effect'
  | 'suppressed-trigger-effect'
  | 'invalid-operation-source'
  | 'duplicate-operation-id'
  | 'duplicate-event-id'
  | 'invalid-emitted-event-causality'
  | 'handler-limit-exceeded'
  | 'trigger-limit-exceeded'
  | 'operation-limit-exceeded'
  | 'emitted-event-limit-exceeded'
  | 'recursion-limit-exceeded'
  | 'trace-limit-exceeded'

export class EncounterLifecycleReductionError extends Error {
  readonly code: EncounterLifecycleReductionErrorCode

  constructor(code: EncounterLifecycleReductionErrorCode, message: string) {
    super(message)
    this.name = 'EncounterLifecycleReductionError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>
type TraceEntryInput = EncounterLifecycleTraceEntry extends infer Entry
  ? Entry extends EncounterLifecycleTraceEntry
    ? Omit<Entry, 'sequence'>
    : never
  : never

type MutableCounters = {
  -readonly [Key in keyof EncounterLifecycleReductionCounters]: EncounterLifecycleReductionCounters[Key]
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const TRIGGER_FIELDS = ['effectId', 'reasonCode', 'operations', 'emittedEvents'] as const

const NO_LIFECYCLE_RANDOM: MoveAutomationRandomRoller = Object.freeze({
  roll: (): never => fail(
    'invalid-trigger',
    'A lifecycle handler requested randomness without an explicit authoritative roller.',
  ),
  rollTable: (): never => fail(
    'invalid-trigger',
    'A lifecycle handler requested randomness without an explicit authoritative roller.',
  ),
})

function fail(
  code: EncounterLifecycleReductionErrorCode,
  message: string,
): never {
  throw new EncounterLifecycleReductionError(code, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

function assertStableId(
  value: unknown,
  label: string,
  code: EncounterLifecycleReductionErrorCode,
): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_EFFECT_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !STABLE_ID_PATTERN.test(value)
  ) {
    fail(code, `${label} must be a lowercase bounded stable identifier.`)
  }
}

const assertExactTriggerFields = (trigger: UnknownRecord, label: string): void => {
  const expected = new Set<string>(TRIGGER_FIELDS)
  const missing = TRIGGER_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(trigger, field))
  const unknown = Object.keys(trigger).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  const detail = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail('invalid-trigger', `${label} must contain exactly the supported fields (${detail}).`)
}

const validateHandlers = (
  value: readonly EncounterLifecycleTriggerHandler[],
): readonly EncounterLifecycleTriggerHandler[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-handler', 'Lifecycle trigger handlers must be an array.')
  }
  if (value.length > ENCOUNTER_LIFECYCLE_LIMITS.handlers) {
    fail(
      'handler-limit-exceeded',
      `Lifecycle reduction supports at most ${ENCOUNTER_LIFECYCLE_LIMITS.handlers} trigger handlers.`,
    )
  }

  const ids = new Set<string>()
  for (const [index, handler] of value.entries()) {
    if (!isPlainRecord(handler)) {
      fail('invalid-handler', `Lifecycle trigger handler ${index} must be a plain object.`)
    }
    assertStableId(handler.id, `Lifecycle trigger handler ${index} id`, 'invalid-handler')
    if (typeof handler.resolve !== 'function') {
      fail('invalid-handler', `Lifecycle trigger handler ${handler.id} must define resolve().`)
    }
    if (ids.has(handler.id)) {
      fail('duplicate-handler-id', `Lifecycle trigger handler ${handler.id} is duplicated.`)
    }
    ids.add(handler.id)
  }
  return [...value]
}

const parseTrigger = (
  value: unknown,
  handlerId: string,
  triggerIndex: number,
): EncounterLifecycleTrigger => {
  const label = `Lifecycle trigger ${handlerId}[${triggerIndex}]`
  if (!isPlainRecord(value)) {
    return fail('invalid-trigger', `${label} must be a plain object.`)
  }
  assertExactTriggerFields(value, label)
  if (value.effectId !== null) {
    assertStableId(value.effectId, `${label} effectId`, 'invalid-trigger')
  }
  assertStableId(value.reasonCode, `${label} reasonCode`, 'invalid-trigger')

  let operations: readonly MoveEffectOperation[]
  let emittedEvents: readonly EncounterEvent[]
  try {
    operations = parseMoveEffectOperations(value.operations, `${label}.operations`)
    emittedEvents = parseEncounterEvents(value.emittedEvents, `${label}.emittedEvents`)
  }
  catch (error) {
    return fail(
      'invalid-trigger',
      `${label} returned invalid typed work: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return deepFreeze({
    effectId: value.effectId as string | null,
    reasonCode: value.reasonCode as string,
    operations,
    emittedEvents,
  })
}

const lifecycleEventBeforeTriggers = (
  event: EncounterEvent,
): EncounterEffectLifecycleEvent | null => {
  if (event.kind === 'effect-added') {
    return { kind: 'effect-applied', effect: event.effect }
  }
  if (event.kind === 'effect-removed') {
    return { kind: 'effect-removed', effectId: event.effectId }
  }
  return null
}

const lifecycleEventAfterTriggers = (
  event: EncounterEvent,
): EncounterEffectLifecycleEvent | null => {
  if (event.kind === 'turn-start' || event.kind === 'turn-end') {
    return {
      kind: event.kind,
      placementId: event.placementId,
      ...(event.sideId === null ? {} : { sideId: event.sideId }),
    }
  }
  if (event.kind === 'round-start' || event.kind === 'round-end') {
    return { kind: event.kind }
  }
  if (event.kind === 'scene-end') return { kind: 'scene-end' }
  if (event.kind === 'encounter-end') return { kind: 'encounter-end' }
  if (event.kind === 'campaign-time-advanced') {
    return {
      kind: 'campaign-time-advanced',
      previousCampaignMinute: event.previousCampaignMinute,
      campaignMinute: event.campaignMinute,
      clockRevision: event.clockRevision,
    }
  }
  return null
}

const globalFieldEventAfterTriggers = (
  event: EncounterEvent,
): GlobalFieldLifecycleEvent | null => {
  if (event.kind === 'round-start' || event.kind === 'round-end') {
    return { kind: event.kind }
  }
  if (event.kind === 'scene-end') return { kind: 'scene-end' }
  return null
}

const operationHasAuthoritativeTriggerSource = (
  operation: MoveEffectOperation,
  eventId: string,
  effectId: string | null,
): boolean => (
  (operation.source.kind === 'lifecycle-event' && operation.source.id === eventId)
  || (
    effectId !== null
    && operation.source.kind === 'encounter-effect'
    && operation.source.id === effectId
  )
)

/**
 * Reduce one bounded, ordered batch of authoritative encounter facts.
 *
 * Effect additions/removals apply before trigger handlers. Turn, round, and
 * scene expiry applies after handlers, so an effect active at a boundary can
 * enqueue its final typed work and consume its charge before duration cleanup.
 * Trigger-emitted child events reduce depth-first after their parent has fully
 * reduced; roots retain caller order. No repository, clock, RNG, or mutable
 * ambient state is consulted.
 */
export const reduceEncounterLifecycle = (
  stateValue: EncounterState,
  eventValues: readonly EncounterEvent[],
  handlersValue: readonly EncounterLifecycleTriggerHandler[] = [],
  random: MoveAutomationRandomRoller = NO_LIFECYCLE_RANDOM,
): EncounterLifecycleReductionResult => {
  const initialState = deepFreeze(parseEncounterState(stateValue))
  const initialStateJson = JSON.stringify(initialState)
  const initialEvents = parseEncounterEvents(eventValues)
  const handlers = validateHandlers(handlersValue)

  let state = initialState
  const processedEvents: EncounterEvent[] = []
  const emittedEvents: EncounterEvent[] = []
  const operations: MoveEffectOperation[] = []
  const pendingInterrupts: EncounterLifecyclePendingInterrupt[] = []
  const transitions: EncounterLifecycleAppliedTransition[] = []
  const fieldTransitions: EncounterLifecycleAppliedFieldTransition[] = []
  const trace: EncounterLifecycleTraceEntry[] = []
  const operationIds = new Set<string>()
  const knownEventIds = new Set(initialEvents.map(event => event.eventId))
  const counters: MutableCounters = {
    initialEventCount: initialEvents.length,
    processedEventCount: 0,
    emittedEventCount: 0,
    triggerCount: 0,
    operationCount: 0,
    effectTransitionCount: 0,
    fieldTransitionCount: 0,
    maximumDepth: 0,
  }

  const appendTrace = (entry: TraceEntryInput): void => {
    if (trace.length >= ENCOUNTER_LIFECYCLE_LIMITS.traceEntries) {
      fail(
        'trace-limit-exceeded',
        `Lifecycle trace cannot exceed ${ENCOUNTER_LIFECYCLE_LIMITS.traceEntries} entries.`,
      )
    }
    trace.push(deepFreeze({
      ...entry,
      sequence: trace.length + 1,
    }) as EncounterLifecycleTraceEntry)
  }

  const setEffects = (effects: readonly EncounterEffect[]): void => {
    state = deepFreeze(parseEncounterState({ ...state, effects }))
  }

  const setZones = (zones: EncounterState['zones']): void => {
    state = deepFreeze(parseEncounterState({ ...state, zones }))
  }

  const applyIndexedStateEvent = (event: EncounterEvent): void => {
    const history = reduceEncounterHistoryEvent(state.history, event)
    const turnResources = reduceEncounterResourceEvent(state.turnResources, event)
    state = deepFreeze(parseEncounterState({ ...state, history, turnResources }))
  }

  const applyEffectEvent = (
    event: EncounterEvent,
    depth: number,
    effectEvent: EncounterEffectLifecycleEvent,
    eventTransitions: EncounterEffectLifecycleTransition[],
  ): void => {
    const result = applyEncounterEffectLifecycleEvent(
      { effects: state.effects },
      effectEvent,
    )
    if (result.changed) setEffects(result.effects)

    for (const effectTransition of result.transitions) {
      const applied = deepFreeze({
        sequence: transitions.length + 1,
        eventId: event.eventId,
        eventKind: event.kind,
        depth,
        transition: effectTransition,
      })
      transitions.push(applied)
      eventTransitions.push(effectTransition)
      counters.effectTransitionCount += 1
      appendTrace({
        kind: 'effect-transition',
        eventId: event.eventId,
        depth,
        reasonCode: effectTransition.reasonCode,
        effectId: effectTransition.effectId,
        transitionKind: effectTransition.kind,
      })
    }
  }

  const processEvent = (event: EncounterEvent, depth: number): void => {
    if (depth > ENCOUNTER_LIFECYCLE_LIMITS.recursionDepth) {
      fail(
        'recursion-limit-exceeded',
        `Lifecycle event ${event.eventId} exceeds recursion depth ${ENCOUNTER_LIFECYCLE_LIMITS.recursionDepth}.`,
      )
    }

    const effectsAtEventStart = state.effects
    const eventTransitions: EncounterEffectLifecycleTransition[] = []
    const childEvents: EncounterEvent[] = []
    processedEvents.push(event)
    counters.processedEventCount += 1
    counters.maximumDepth = Math.max(counters.maximumDepth, depth)
    appendTrace({
      kind: 'event',
      eventId: event.eventId,
      depth,
      reasonCode: event.reasonCode,
      eventKind: event.kind,
    })

    const beforeTriggerEvent = lifecycleEventBeforeTriggers(event)
    if (beforeTriggerEvent) {
      applyEffectEvent(event, depth, beforeTriggerEvent, eventTransitions)
    }
    // Scene/encounter-end handlers query outgoing history/resources before both clear.
    // Every other fact updates its structured indexes before handlers observe it.
    if (event.kind !== 'scene-end' && event.kind !== 'encounter-end') applyIndexedStateEvent(event)

    for (const effectId of transformationEffectIdsEndedByEvent({
      effects: state.effects,
      event,
    })) {
      applyEffectEvent(
        event,
        depth,
        { kind: 'effect-removed', effectId },
        eventTransitions,
      )
    }

    for (const handler of handlers) {
      const context = deepFreeze({
        state,
        effectsAtEventStart,
        event,
        depth,
        eventSequence: processedEvents.length,
        random,
        transitions: [...eventTransitions],
      }) satisfies EncounterLifecycleTriggerContext
      const rawTriggers = handler.resolve(context)
      if (!Array.isArray(rawTriggers)) {
        fail('invalid-trigger', `Lifecycle trigger handler ${handler.id} must return an array.`)
      }
      if (rawTriggers.length > ENCOUNTER_LIFECYCLE_LIMITS.triggersPerHandlerEvent) {
        fail(
          'trigger-limit-exceeded',
          `Lifecycle trigger handler ${handler.id} returned more than ${ENCOUNTER_LIFECYCLE_LIMITS.triggersPerHandlerEvent} triggers for ${event.eventId}.`,
        )
      }

      for (const [triggerIndex, rawTrigger] of rawTriggers.entries()) {
        if (counters.triggerCount >= ENCOUNTER_LIFECYCLE_LIMITS.triggers) {
          fail(
            'trigger-limit-exceeded',
            `Lifecycle reduction cannot exceed ${ENCOUNTER_LIFECYCLE_LIMITS.triggers} triggers.`,
          )
        }
        const trigger = parseTrigger(rawTrigger, handler.id, triggerIndex)
        counters.triggerCount += 1
        appendTrace({
          kind: 'trigger',
          eventId: event.eventId,
          depth,
          reasonCode: trigger.reasonCode,
          handlerId: handler.id,
          effectId: trigger.effectId,
        })

        if (trigger.effectId !== null) {
          const effect = state.effects.find(candidate => candidate.id === trigger.effectId)
          if (!effect) {
            fail(
              'unknown-trigger-effect',
              `Lifecycle trigger ${handler.id}[${triggerIndex}] references inactive effect ${trigger.effectId}.`,
            )
          }
          if (effect.suppression.sources.length > 0) {
            fail(
              'suppressed-trigger-effect',
              `Lifecycle trigger ${handler.id}[${triggerIndex}] cannot trigger suppressed effect ${trigger.effectId}.`,
            )
          }
          applyEffectEvent(
            event,
            depth,
            { kind: 'effect-triggered', effectId: trigger.effectId },
            eventTransitions,
          )
        }

        if (operations.length + trigger.operations.length > ENCOUNTER_LIFECYCLE_LIMITS.operations) {
          fail(
            'operation-limit-exceeded',
            `Lifecycle reduction cannot enqueue more than ${ENCOUNTER_LIFECYCLE_LIMITS.operations} operations.`,
          )
        }
        for (const operation of trigger.operations) {
          if (!operationHasAuthoritativeTriggerSource(operation, event.eventId, trigger.effectId)) {
            fail(
              'invalid-operation-source',
              `Lifecycle operation ${operation.id} must name event ${event.eventId} or triggered effect ${String(trigger.effectId)} as its source.`,
            )
          }
          if (operationIds.has(operation.id)) {
            fail(
              'duplicate-operation-id',
              `Lifecycle operation ${operation.id} is enqueued more than once.`,
            )
          }
          operationIds.add(operation.id)
          operations.push(operation)
          if (operation.kind === 'reaction-request') {
            pendingInterrupts.push(deepFreeze({
              eventId: event.eventId,
              eventKind: event.kind,
              operation,
            }))
          }
          counters.operationCount += 1
          appendTrace({
            kind: 'operation-enqueued',
            eventId: event.eventId,
            depth,
            reasonCode: operation.reasonCode,
            handlerId: handler.id,
            operationId: operation.id,
            operationKind: operation.kind,
          })
        }

        if (
          emittedEvents.length + trigger.emittedEvents.length
          > ENCOUNTER_LIFECYCLE_LIMITS.emittedEvents
        ) {
          fail(
            'emitted-event-limit-exceeded',
            `Lifecycle reduction cannot emit more than ${ENCOUNTER_LIFECYCLE_LIMITS.emittedEvents} child events.`,
          )
        }
        if (
          trigger.emittedEvents.length > 0
          && depth >= ENCOUNTER_LIFECYCLE_LIMITS.recursionDepth
        ) {
          fail(
            'recursion-limit-exceeded',
            `Lifecycle event ${event.eventId} cannot emit children beyond depth ${ENCOUNTER_LIFECYCLE_LIMITS.recursionDepth}.`,
          )
        }
        for (const emittedEvent of trigger.emittedEvents) {
          if (emittedEvent.causalParentEventId !== event.eventId) {
            fail(
              'invalid-emitted-event-causality',
              `Emitted event ${emittedEvent.eventId} must name ${event.eventId} as its causal parent.`,
            )
          }
          if (knownEventIds.has(emittedEvent.eventId)) {
            fail(
              'duplicate-event-id',
              `Lifecycle event ${emittedEvent.eventId} is already present in this reduction.`,
            )
          }
          knownEventIds.add(emittedEvent.eventId)
          emittedEvents.push(emittedEvent)
          childEvents.push(emittedEvent)
          counters.emittedEventCount += 1
          appendTrace({
            kind: 'event-emitted',
            eventId: event.eventId,
            depth,
            reasonCode: emittedEvent.reasonCode,
            handlerId: handler.id,
            emittedEventId: emittedEvent.eventId,
            emittedEventKind: emittedEvent.kind,
          })
        }
      }
    }

    const afterTriggerEvent = lifecycleEventAfterTriggers(event)
    if (afterTriggerEvent) {
      applyEffectEvent(event, depth, afterTriggerEvent, eventTransitions)
    }
    const fieldEvent = globalFieldEventAfterTriggers(event)
    if (fieldEvent) {
      const result = advanceEncounterGlobalFields({ zones: state.zones, event: fieldEvent })
      if (result.changed) setZones(result.zones)
      for (const fieldTransition of result.transitions) {
        fieldTransitions.push(deepFreeze({
          sequence: fieldTransitions.length + 1,
          eventId: event.eventId,
          eventKind: event.kind,
          depth,
          transition: fieldTransition,
        }))
        counters.fieldTransitionCount += 1
        appendTrace({
          kind: 'field-transition',
          eventId: event.eventId,
          depth,
          reasonCode: fieldTransition.reasonCode,
          zoneId: fieldTransition.zoneId,
          transitionKind: fieldTransition.kind,
        })
      }
    }
    if (event.kind === 'scene-end' || event.kind === 'encounter-end') applyIndexedStateEvent(event)

    for (const childEvent of childEvents) processEvent(childEvent, depth + 1)
  }

  for (const event of initialEvents) processEvent(event, 0)

  return deepFreeze({
    state,
    changed: JSON.stringify(state) !== initialStateJson,
    processedEvents,
    emittedEvents,
    operations,
    pendingInterrupts,
    transitions,
    fieldTransitions,
    trace,
    counters,
  })
}
