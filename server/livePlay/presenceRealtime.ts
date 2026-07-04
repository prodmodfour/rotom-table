import {
  LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
  parseLivePlayPresenceRealtimeEventDraft,
  parseLivePlayPresenceSnapshot,
  type LivePlayPresenceRealtimeEventDraft,
  type LivePlayPresenceSnapshot,
} from '#shared/livePlayPresence'
import {
  publishTransientRealtime,
  type TransientRealtimePublicationInput,
} from '../utils/realtime'

export type LivePlayPresenceRealtimePublisher = (publication: TransientRealtimePublicationInput) => void

const firstPresenceRealtimeIssueMessage = (issues: readonly { readonly message: string }[]): string => (
  issues[0]?.message ?? 'Presence realtime event failed shared live-play presence validation.'
)

export const buildLivePlayPresenceRealtimeEventDraft = (
  snapshot: LivePlayPresenceSnapshot,
): LivePlayPresenceRealtimeEventDraft => {
  const parsedSnapshot = parseLivePlayPresenceSnapshot(snapshot)
  if (!parsedSnapshot.valid) throw new Error(firstPresenceRealtimeIssueMessage(parsedSnapshot.issues))

  const draft = {
    channel: `map:${parsedSnapshot.payload.mapSlug}`,
    type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
    mapSlug: parsedSnapshot.payload.mapSlug,
    data: parsedSnapshot.payload,
  }
  const parsedDraft = parseLivePlayPresenceRealtimeEventDraft(draft)
  if (!parsedDraft.valid) throw new Error(firstPresenceRealtimeIssueMessage(parsedDraft.issues))
  return parsedDraft.payload
}

export const livePlayPresenceTransientPublication = (
  snapshot: LivePlayPresenceSnapshot,
): TransientRealtimePublicationInput => {
  const event = buildLivePlayPresenceRealtimeEventDraft(snapshot)
  return {
    event,
    access: { kind: 'map-access', mapSlug: event.mapSlug },
  }
}

export const publishLivePlayPresenceSnapshotRealtime = (
  snapshot: LivePlayPresenceSnapshot,
  publish: LivePlayPresenceRealtimePublisher = publishTransientRealtime,
): void => {
  publish(livePlayPresenceTransientPublication(snapshot))
}
