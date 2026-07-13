import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_LIMITS,
  parseEncounterEvent,
  type EncounterEvent,
} from '#shared/moveAutomation/events'
import type {
  EncounterTurnResourceDirectory,
} from '#shared/moveAutomation/encounterResources'
import {
  assertMovePlanStableId,
  cancelInterruptibleMovePlan,
  deepFreezeInterruptibleMovePlan,
  type InterruptibleMovePlan,
  type InterruptibleMovePlanAuthority,
} from './interruptibleMovePlan'
import {
  clearEncounterSetupExecuteState,
  setEncounterSetupExecuteState,
} from './reduceEncounterResources'
import {
  moveSetupReactionDefinition,
  type MoveRoundSetupReactionDefinition,
} from './setupReactionDefinitions'
import { stableJsonStringify } from './stableJson'

export const MOVE_ROUND_SETUP_LIMITS = Object.freeze({
  processedEvents: ENCOUNTER_EVENT_LIMITS.events,
  maximumHitPoints: ENCOUNTER_EVENT_LIMITS.amount,
})

export interface MoveRoundSetupEventEvidence {
  readonly eventId: string
  readonly fingerprint: string
}

export interface MoveRoundSetupState {
  readonly setupId: string
  readonly definitionId: string
  readonly canonicalMoveId: MoveRoundSetupReactionDefinition['canonicalId']
  readonly actorPlacementId: string
  readonly actorMaximumHitPoints: number
  readonly declaredRound: number
  readonly declaredTurn: number | null
  readonly status:
    | 'setting-up'
    | 'ready-to-execute'
    | 'cancelled'
    | 'executed'
  /** No move mechanics or frequency spend commits while this plan is setting up. */
  readonly pendingPlan: InterruptibleMovePlan
  readonly cancellationReasonCode: string | null
  readonly processedEvents: readonly MoveRoundSetupEventEvidence[]
}

export type MoveRoundSetupErrorCode =
  | 'invalid-setup'
  | 'invalid-event'
  | 'event-identity-conflict'
  | 'event-limit-exceeded'
  | 'setup-not-ready'

export class MoveRoundSetupError extends Error {
  readonly code: MoveRoundSetupErrorCode

  constructor(code: MoveRoundSetupErrorCode, message: string) {
    super(message)
    this.name = 'MoveRoundSetupError'
    this.code = code
  }
}

const fail = (code: MoveRoundSetupErrorCode, message: string): never => {
  throw new MoveRoundSetupError(code, message)
}

const eventFingerprint = (event: EncounterEvent): string => createHash('sha256')
  .update(stableJsonStringify(event))
  .digest('hex')

const derivedStableId = (prefix: string, ...parts: readonly string[]): string => {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)
  return `${prefix}.${digest}`
}

const assertRound = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > ENCOUNTER_EVENT_LIMITS.round) {
    return fail('invalid-setup', 'Declared setup round must be a bounded positive integer.')
  }
  return value
}

const assertTurn = (value: number | null): number | null => {
  if (
    value !== null
    && (!Number.isSafeInteger(value) || value < 0 || value > ENCOUNTER_EVENT_LIMITS.turn)
  ) {
    return fail('invalid-setup', 'Declared setup turn must be null or a bounded integer.')
  }
  return value
}

const assertMaximumHitPoints = (value: number): number => {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MOVE_ROUND_SETUP_LIMITS.maximumHitPoints
  ) {
    return fail('invalid-setup', 'Setup maximum HP must be a bounded positive integer.')
  }
  return value
}

export const createMoveRoundSetupState = (input: {
  readonly setupId: string
  readonly canonicalMoveId: MoveRoundSetupReactionDefinition['canonicalId']
  readonly actorPlacementId: string
  readonly actorMaximumHitPoints: number
  readonly declaredRound: number
  readonly declaredTurn: number | null
  readonly pendingPlan: InterruptibleMovePlan
}): MoveRoundSetupState => {
  const definition = moveSetupReactionDefinition(input.canonicalMoveId)
  if (definition.family !== 'round-setup') {
    return fail('invalid-setup', `${input.canonicalMoveId} is not a round setup definition.`)
  }
  if (
    input.pendingPlan.canonicalMoveId !== input.canonicalMoveId
    || input.pendingPlan.actorPlacementId !== input.actorPlacementId
    || input.pendingPlan.status !== 'pending'
  ) {
    return fail(
      'invalid-setup',
      'Round setup identity must match one still-pending deferred move plan.',
    )
  }
  if (input.pendingPlan.operations.length === 0) {
    return fail('invalid-setup', 'Round setup must defer at least one mechanics operation.')
  }
  return deepFreezeInterruptibleMovePlan({
    setupId: assertMovePlanStableId(input.setupId, 'Round setup ID'),
    definitionId: definition.definitionId,
    canonicalMoveId: definition.canonicalId,
    actorPlacementId: input.actorPlacementId,
    actorMaximumHitPoints: assertMaximumHitPoints(input.actorMaximumHitPoints),
    declaredRound: assertRound(input.declaredRound),
    declaredTurn: assertTurn(input.declaredTurn),
    status: 'setting-up' as const,
    pendingPlan: input.pendingPlan,
    cancellationReasonCode: null,
    processedEvents: [],
  })
}

const sourceLeaves = (state: MoveRoundSetupState, event: EncounterEvent): boolean => (
  event.kind === 'scene-end'
  || (event.kind === 'move-ko' && event.targetPlacementId === state.actorPlacementId)
  || (event.kind === 'recall' && event.placementId === state.actorPlacementId)
  || (event.kind === 'switch' && event.recalledPlacementId === state.actorPlacementId)
)

const focusPunchThresholdReached = (
  state: MoveRoundSetupState,
  event: EncounterEvent,
): boolean => {
  if (
    state.canonicalMoveId !== 'Focus Punch'
    || event.kind !== 'move-damaged'
    || event.targetPlacementId !== state.actorPlacementId
  ) return false
  const effectiveHitPointLoss = event.damage.hitPointLoss + event.damage.temporaryHitPointLoss
  const threshold = Math.ceil(state.actorMaximumHitPoints * 25 / 100)
  return effectiveHitPointLoss >= threshold
}

const cancellationReason = (
  state: MoveRoundSetupState,
  event: EncounterEvent,
): string | null => {
  if (focusPunchThresholdReached(state, event)) {
    return 'focus-punch.cancelled-by-quarter-max-hp-hit'
  }
  if (sourceLeaves(state, event)) return `${state.definitionId}.cancelled-source-left`
  return null
}

const appendEvidence = (
  state: MoveRoundSetupState,
  event: EncounterEvent,
): readonly MoveRoundSetupEventEvidence[] => {
  if (state.processedEvents.length >= MOVE_ROUND_SETUP_LIMITS.processedEvents) {
    return fail('event-limit-exceeded', 'Round setup processed-event bound was exceeded.')
  }
  return [
    ...state.processedEvents,
    Object.freeze({ eventId: event.eventId, fingerprint: eventFingerprint(event) }),
  ]
}

export type ReduceMoveRoundSetupEventResult =
  | {
      readonly status: 'cancelled' | 'ready' | 'observed'
      readonly state: MoveRoundSetupState
    }
  | {
      readonly status: 'duplicate' | 'terminal'
      readonly state: MoveRoundSetupState
    }

/**
 * Reduce one strict lifecycle fact into a delayed round setup. Focus Punch
 * cancellation drops the still-deferred mechanics and usage; it never applies
 * an inverse operation to accepted state.
 */
export const reduceMoveRoundSetupEvent = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly state: MoveRoundSetupState
  readonly event: EncounterEvent
}): ReduceMoveRoundSetupEventResult => {
  const event = parseEncounterEvent(input.event, 'roundSetup.event')
  const fingerprint = eventFingerprint(event)
  const existing = input.state.processedEvents.find(entry => entry.eventId === event.eventId)
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return fail(
        'event-identity-conflict',
        `Round setup event ${event.eventId} changed on replay.`,
      )
    }
    return Object.freeze({ status: 'duplicate', state: input.state })
  }
  if (input.state.status !== 'setting-up') {
    return Object.freeze({ status: 'terminal', state: input.state })
  }

  const processedEvents = appendEvidence(input.state, event)
  const reasonCode = cancellationReason(input.state, event)
  if (reasonCode) {
    const cancellation = cancelInterruptibleMovePlan({
      authority: input.authority,
      plan: input.state.pendingPlan,
      applicationId: derivedStableId('setup-cancel', input.state.setupId, event.eventId),
      cancellationKind: input.state.canonicalMoveId === 'Focus Punch'
        ? 'setup-threshold'
        : 'setup-source-left',
      reasonCode,
      canceller: { kind: 'lifecycle-event', id: event.eventId },
      retainTriggeringUsage: false,
    })
    return Object.freeze({
      status: 'cancelled',
      state: deepFreezeInterruptibleMovePlan({
        ...input.state,
        status: 'cancelled' as const,
        pendingPlan: cancellation.plan,
        cancellationReasonCode: reasonCode,
        processedEvents,
      }),
    })
  }

  if (event.kind === 'round-end' && event.round === input.state.declaredRound) {
    return Object.freeze({
      status: 'ready',
      state: deepFreezeInterruptibleMovePlan({
        ...input.state,
        status: 'ready-to-execute' as const,
        processedEvents,
      }),
    })
  }

  return Object.freeze({
    status: 'observed',
    state: deepFreezeInterruptibleMovePlan({ ...input.state, processedEvents }),
  })
}

export type ExecuteMoveRoundSetupResult =
  | {
      readonly status: 'executed'
      readonly state: MoveRoundSetupState
      readonly plan: InterruptibleMovePlan
    }
  | {
      readonly status: 'duplicate'
      readonly state: MoveRoundSetupState
      readonly plan: InterruptibleMovePlan
    }

/** Mark the ready plan executed; persistence still owns the atomic final commit. */
export const executeMoveRoundSetup = (
  state: MoveRoundSetupState,
): ExecuteMoveRoundSetupResult => {
  if (state.status === 'executed') {
    return Object.freeze({ status: 'duplicate', state, plan: state.pendingPlan })
  }
  if (state.status !== 'ready-to-execute') {
    return fail('setup-not-ready', `Round setup ${state.setupId} is not ready to execute.`)
  }
  const next = deepFreezeInterruptibleMovePlan({ ...state, status: 'executed' as const })
  return Object.freeze({ status: 'executed', state: next, plan: next.pendingPlan })
}

/** Project only the bounded setup marker into encounter resources. */
export const synchronizeMoveRoundSetupResources = (
  resources: EncounterTurnResourceDirectory,
  state: MoveRoundSetupState,
): EncounterTurnResourceDirectory => {
  if (state.status === 'cancelled' || state.status === 'executed') {
    return clearEncounterSetupExecuteState(resources, state.actorPlacementId)
  }
  return setEncounterSetupExecuteState(resources, {
    placementId: state.actorPlacementId,
    canonicalMoveId: state.canonicalMoveId,
    resolutionId: state.pendingPlan.resolutionId,
    sourceOperationId: state.setupId,
    status: state.status,
    round: state.declaredRound,
    turn: state.declaredTurn,
    resetOn: ['scene-end', 'recall', 'knockout'],
  })
}
