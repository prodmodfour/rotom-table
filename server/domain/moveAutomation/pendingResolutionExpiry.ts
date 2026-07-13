import type {
  EncounterEvent,
  EncounterSceneEvent,
} from '#shared/moveAutomation/events'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'

export interface PendingResolutionGameEventExpiry {
  readonly status: 'expired'
  readonly reasonCode: 'pending-resolution.scene-ended'
  readonly sourceOperationId: string
  readonly eventId: string
  readonly eventKind: 'scene-end'
}

/**
 * Rules advance only from authoritative encounter events. A scene boundary is
 * the universal safe expiry for an unresolved move; elapsed wall-clock time is
 * deliberately absent from this policy.
 */
export const pendingResolutionGameEventExpiry = (
  resolution: PendingMoveResolution,
  events: readonly EncounterEvent[],
): PendingResolutionGameEventExpiry | null => {
  if (resolution.status !== 'pending') return null
  const event = events.find(
    (candidate): candidate is EncounterSceneEvent => candidate.kind === 'scene-end',
  )
  if (!event) return null
  return Object.freeze({
    status: 'expired',
    reasonCode: 'pending-resolution.scene-ended',
    sourceOperationId: event.sourceOperationId,
    eventId: event.eventId,
    eventKind: 'scene-end',
  })
}
