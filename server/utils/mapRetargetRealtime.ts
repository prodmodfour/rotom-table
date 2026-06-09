import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { summarizeMap } from './mapSummaries'
import type { RetargetMapSheetPlacementsResult } from './mapStorage'

export const mapRetargetRealtimeEvents = (
  mapUpdates: readonly RetargetMapSheetPlacementsResult[],
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => mapUpdates.flatMap(({ map }) => [
  {
    channel: mapChannel(map.slug),
    type: 'updated',
    clientId,
    data: map,
  },
  {
    channel: mapsChannel,
    type: 'updated',
    clientId,
    data: summarizeMap(map),
  },
])
