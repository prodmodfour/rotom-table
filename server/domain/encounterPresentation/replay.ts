import {
  ABILITY_AUTOMATION_REALTIME_EVENT_TYPE,
  parseAbilityAutomationAcceptedRealtimePayload,
} from '#shared/abilityAutomation/realtime'
import type { AcceptedEncounterPresentation } from '#shared/encounterPresentation'
import { parseAcceptedLivePlayRealtimeEvent } from '#shared/livePlayRealtimeEvents'
import { LIVE_PLAY_REALTIME_EVENT_TYPES } from '#shared/realtime'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'

/** Recover bounded, map-public accepted facts from the same durable rows used for realtime replay. */
export const acceptedEncounterPresentationsFromPersistedRealtimeEvents = (input: {
  readonly events: readonly PersistedRealtimeEvent[]
  readonly mapSlug: string
  readonly mapRevision: number
  readonly limit?: number
}): readonly AcceptedEncounterPresentation[] => {
  const byId = new Map<string, AcceptedEncounterPresentation>()
  for (const record of input.events) {
    const event = record.event
    let presentation: AcceptedEncounterPresentation | undefined
    if (event.type === LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED) {
      const parsed = parseAcceptedLivePlayRealtimeEvent(event)
      if (parsed.valid) presentation = parsed.event.presentation
    }
    else if (event.type === ABILITY_AUTOMATION_REALTIME_EVENT_TYPE) {
      const parsed = parseAbilityAutomationAcceptedRealtimePayload(event.data)
      if (parsed.valid) presentation = parsed.payload.presentation
    }
    if (!presentation
      || presentation.mapSlug !== input.mapSlug
      || presentation.revision > input.mapRevision) continue
    byId.set(presentation.presentationId, presentation)
  }
  return [...byId.values()]
    .sort((left, right) => (
      left.revision - right.revision
      || left.causal.depth - right.causal.depth
      || left.causal.sequence - right.causal.sequence
      || left.presentationId.localeCompare(right.presentationId)
    ))
    .slice(-(input.limit ?? 100))
}
