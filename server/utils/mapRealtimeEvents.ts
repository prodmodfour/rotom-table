import {
  LIVE_PLAY_REALTIME_EVENT_TYPES,
  mapChannel,
  mapsChannel,
  type LivePlayRealtimeEvent,
  type RealtimeEvent,
} from '#shared/realtime'
import {
  MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE,
  type MapInteractionMode,
  type MapInteractionModeRealtimePayload,
} from '#shared/mapInteractionMode'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { LivePlayCommandAccepted } from '#shared/livePlayCommands'
import type { TabletopMap } from '~/types/map'
import { summarizeMap } from './mapSummaries'

export type MapRealtimeEvent<TData = unknown> = Omit<RealtimeEvent<TData>, 'timestamp'>
export type LivePlayRealtimeEventDraft<TData = unknown> = Omit<LivePlayRealtimeEvent<TData>, 'timestamp'>

export const mapRevisionForRealtime = (map: Pick<TabletopMap, 'revision'>): number =>
  normalizeRevision(map.revision)

export const mapUpdatedRealtimeEvent = (
  map: TabletopMap,
  clientId: string | undefined,
): MapRealtimeEvent => ({
  channel: mapChannel(map.slug),
  type: 'updated',
  revision: mapRevisionForRealtime(map),
  clientId,
  data: map,
})

export const mapSummaryUpdatedRealtimeEvent = (
  map: TabletopMap,
  clientId: string | undefined,
): MapRealtimeEvent => ({
  channel: mapsChannel,
  type: 'updated',
  revision: mapRevisionForRealtime(map),
  clientId,
  data: summarizeMap(map),
})

export const mapDocumentUpdatedRealtimeEvents = (
  map: TabletopMap,
  clientId: string | undefined,
): MapRealtimeEvent[] => [
  mapUpdatedRealtimeEvent(map, clientId),
  mapSummaryUpdatedRealtimeEvent(map, clientId),
]

export const mapInteractionModeUpdatedRealtimeEvent = (
  slug: string,
  interactionMode: MapInteractionMode,
  updatedAt: number,
  clientId: string | undefined,
): MapRealtimeEvent<MapInteractionModeRealtimePayload> => ({
  channel: mapChannel(slug),
  type: MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE,
  clientId,
  data: { slug, interactionMode, updatedAt },
})

export const livePlayCommandAcceptedRealtimeEvent = (
  result: LivePlayCommandAccepted,
  clientId: string | undefined,
): LivePlayRealtimeEventDraft => ({
  channel: mapChannel(result.mapSlug),
  type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
  mapSlug: result.mapSlug,
  revision: result.revision,
  previousRevision: result.previousRevision,
  opId: result.opId,
  patches: [...result.patches],
  ...(result.presentation === undefined ? {} : { presentation: result.presentation }),
  ...(clientId === undefined ? {} : { clientId }),
})
