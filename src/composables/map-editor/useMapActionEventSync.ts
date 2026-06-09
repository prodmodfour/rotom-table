import {
  MAP_ACTION_EVENT_SCHEMA_VERSION,
  MAP_ACTION_REALTIME_EVENT_TYPE,
  isMapActionEventEnvelope,
  type MapActionEventBase,
  type MapActionEventEnvelope,
  type MapActionEventKind,
  type MapActionEventPayloadByKind,
} from '#shared/mapActionEvents'
import { isRealtimeEcho, mapChannel } from '#shared/realtime'
import { useApiClient } from '~/composables/useApiClient'
import { useRealtimeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
import type { MoveAutomationFeedbackState } from '~/types/moveAutomation'
import type { PokeballCaptureAttemptResult } from '~/utils/pokeballCapture'

type MaybeRef<T> = T | { readonly value: T }
type MaybePromise<T> = T | Promise<T>

type MapActionEventOfKind<Kind extends MapActionEventKind> = Extract<MapActionEventEnvelope, { kind: Kind }>

type MapActionEventHandler<Kind extends MapActionEventKind> = (
  event: MapActionEventOfKind<Kind>,
) => MaybePromise<void>

export interface UseMapActionEventSyncHandlers {
  readonly onActionSplash?: MapActionEventHandler<'action-splash'>
  readonly onMoveAnimations?: MapActionEventHandler<'move-animations'>
  readonly onMoveFeedback?: MapActionEventHandler<'move-feedback'>
  readonly onPokeballFeedback?: MapActionEventHandler<'pokeball-feedback'>
  readonly onPokeballResult?: MapActionEventHandler<'pokeball-result'>
}

export interface PublishMapActionEventOptions<Kind extends MapActionEventKind> {
  readonly actorPlacementId: string
  readonly payload: MapActionEventPayloadByKind[Kind]
  readonly eventId?: string
  readonly createdAt?: number
}

export interface UseMapActionEventSyncOptions {
  readonly slug: MaybeRef<string>
  readonly profileId?: MaybeRef<string | null | undefined>
  readonly handlers?: UseMapActionEventSyncHandlers
  readonly clientId?: string
  readonly nowMs?: () => number
  readonly wallClockNow?: () => number
  readonly seenEventLimit?: number
}

const DEFAULT_SEEN_EVENT_LIMIT = 500

const resolveMaybeRef = <T>(value: MaybeRef<T>): T => (
  typeof value === 'object' && value !== null && 'value' in value
    ? value.value
    : value
)

const defaultAnimationNowMs = (): number => {
  const performanceNow = globalThis.performance?.now
  if (typeof performanceNow === 'function') return performanceNow.call(globalThis.performance)
  return Date.now()
}

const safeFiniteNumber = (value: number, fallback = 0): number => (
  Number.isFinite(value) ? value : fallback
)

const safeAnimationNowMs = (nowMs: () => number): number => safeFiniteNumber(nowMs())

const sanitizeEventIdPart = (value: string): string => (
  value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'client'
)

/**
 * Rebase a remote batch of sender-clock move VFX timestamps onto the receiver's
 * animation clock. The original events are left untouched and only relative
 * offsets within the batch are preserved; gameplay state is never changed here.
 */
export const rebaseMoveAnimationEventsForReceiver = (
  events: readonly MoveAnimationEvent[],
  receiverNowMs: number,
): readonly MoveAnimationEvent[] => {
  if (events.length === 0) return events

  const baseCreatedAtMs = Math.min(...events.map((event) => event.createdAtMs))
  const safeReceiverNowMs = safeFiniteNumber(receiverNowMs)

  return events.map((event) => ({
    ...event,
    createdAtMs: safeReceiverNowMs + (event.createdAtMs - baseCreatedAtMs),
  }))
}

const rebaseIncomingMapActionEvent = (
  event: MapActionEventEnvelope,
  receiverNowMs: number,
): MapActionEventEnvelope => {
  if (event.kind !== 'move-animations') return event

  return {
    ...event,
    payload: {
      ...event.payload,
      events: rebaseMoveAnimationEventsForReceiver(event.payload.events, receiverNowMs),
    },
  }
}

const warnHandlerFailure = (stage: string, error: unknown) => {
  console.warn(`[useMapActionEventSync] ${stage} failed`, error)
}

const dispatchHandler = <Kind extends MapActionEventKind>(
  handler: MapActionEventHandler<Kind> | undefined,
  event: MapActionEventOfKind<Kind>,
) => {
  if (!handler) return

  try {
    void Promise.resolve(handler(event)).catch((error) => {
      warnHandlerFailure(`${event.kind} handler`, error)
    })
  } catch (error) {
    warnHandlerFailure(`${event.kind} handler`, error)
  }
}

export const useMapActionEventSync = (options: UseMapActionEventSyncOptions) => {
  const { postJson } = useApiClient()
  const sourceClientId = options.clientId ?? getClientId()
  const nowMs = options.nowMs ?? defaultAnimationNowMs
  const wallClockNow = options.wallClockNow ?? Date.now
  const seenEventLimit = Math.max(1, Math.floor(options.seenEventLimit ?? DEFAULT_SEEN_EVENT_LIMIT))
  const seenEventIds = new Set<string>()
  const seenEventOrder: string[] = []
  let eventSequence = 0

  const rememberEventId = (id: string): boolean => {
    if (seenEventIds.has(id)) return false

    seenEventIds.add(id)
    seenEventOrder.push(id)
    while (seenEventOrder.length > seenEventLimit) {
      const dropped = seenEventOrder.shift()
      if (dropped) seenEventIds.delete(dropped)
    }
    return true
  }

  const nextEventId = (kind: MapActionEventKind, createdAt: number): string => {
    eventSequence += 1
    return `mae-${kind}-${sanitizeEventIdPart(sourceClientId)}-${Math.round(createdAt).toString(36)}-${eventSequence.toString(36)}`
  }

  const dispatchIncomingEvent = (event: MapActionEventEnvelope) => {
    const replayEvent = event.kind === 'move-animations'
      ? rebaseIncomingMapActionEvent(event, safeAnimationNowMs(nowMs))
      : event

    switch (replayEvent.kind) {
      case 'action-splash':
        dispatchHandler(options.handlers?.onActionSplash, replayEvent)
        break
      case 'move-animations':
        dispatchHandler(options.handlers?.onMoveAnimations, replayEvent)
        break
      case 'move-feedback':
        dispatchHandler(options.handlers?.onMoveFeedback, replayEvent)
        break
      case 'pokeball-feedback':
        dispatchHandler(options.handlers?.onPokeballFeedback, replayEvent)
        break
      case 'pokeball-result':
        dispatchHandler(options.handlers?.onPokeballResult, replayEvent)
        break
      default:
        break
    }
  }

  useRealtimeChannel(mapChannel(resolveMaybeRef(options.slug)), (event: RealtimeEvent) => {
    if (event.type !== MAP_ACTION_REALTIME_EVENT_TYPE) return
    if (isRealtimeEcho(event, sourceClientId)) return
    if (!isMapActionEventEnvelope(event.data)) return
    if (!rememberEventId(event.data.id)) return

    dispatchIncomingEvent(event.data)
  })

  const publishMapActionEvent = async <Kind extends MapActionEventKind>(
    kind: Kind,
    publishOptions: PublishMapActionEventOptions<Kind>,
  ): Promise<MapActionEventOfKind<Kind>> => {
    const createdAt = publishOptions.createdAt ?? wallClockNow()
    const event = {
      schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
      id: publishOptions.eventId ?? nextEventId(kind, createdAt),
      kind,
      actorPlacementId: publishOptions.actorPlacementId,
      sourceClientId,
      createdAt,
      payload: publishOptions.payload,
    } satisfies MapActionEventBase<Kind, MapActionEventPayloadByKind[Kind]>

    await postJson(MAP_API_PATHS.actionEvent, {
      slug: resolveMaybeRef(options.slug),
      event,
      profileId: options.profileId === undefined ? undefined : resolveMaybeRef(options.profileId),
    })
    rememberEventId(event.id)

    return event as unknown as MapActionEventOfKind<Kind>
  }

  const publishActionSplash = (
    options: PublishMapActionEventOptions<'action-splash'>,
  ): Promise<MapActionEventOfKind<'action-splash'>> => publishMapActionEvent('action-splash', options)

  const publishMoveAnimations = (
    options: Omit<PublishMapActionEventOptions<'move-animations'>, 'payload'> & {
      readonly events: readonly MoveAnimationEvent[]
    },
  ): Promise<MapActionEventOfKind<'move-animations'>> => publishMapActionEvent('move-animations', {
    actorPlacementId: options.actorPlacementId,
    eventId: options.eventId,
    createdAt: options.createdAt,
    payload: { events: options.events },
  })

  const publishMoveFeedback = (
    options: Omit<PublishMapActionEventOptions<'move-feedback'>, 'payload'> & {
      readonly feedback: MoveAutomationFeedbackState
    },
  ): Promise<MapActionEventOfKind<'move-feedback'>> => publishMapActionEvent('move-feedback', {
    actorPlacementId: options.actorPlacementId,
    eventId: options.eventId,
    createdAt: options.createdAt,
    payload: { feedback: options.feedback },
  })

  const publishPokeballFeedback = (
    options: Omit<PublishMapActionEventOptions<'pokeball-feedback'>, 'payload'> & {
      readonly feedback: MoveAutomationFeedbackState
    },
  ): Promise<MapActionEventOfKind<'pokeball-feedback'>> => publishMapActionEvent('pokeball-feedback', {
    actorPlacementId: options.actorPlacementId,
    eventId: options.eventId,
    createdAt: options.createdAt,
    payload: { feedback: options.feedback },
  })

  const publishPokeballResult = (
    options: Omit<PublishMapActionEventOptions<'pokeball-result'>, 'payload'> & {
      readonly result: PokeballCaptureAttemptResult | null
      readonly error?: string | null
    },
  ): Promise<MapActionEventOfKind<'pokeball-result'>> => publishMapActionEvent('pokeball-result', {
    actorPlacementId: options.actorPlacementId,
    eventId: options.eventId,
    createdAt: options.createdAt,
    payload: { result: options.result, error: options.error },
  })

  return {
    clientId: sourceClientId,
    publishMapActionEvent,
    publishActionSplash,
    publishMoveAnimations,
    publishMoveFeedback,
    publishPokeballFeedback,
    publishPokeballResult,
  }
}
