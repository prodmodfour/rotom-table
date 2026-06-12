import type { RealtimeEvent } from '#shared/realtime'
import type { RetargetMapSheetPlacementsResult } from './mapStorage'
import { mapDocumentUpdatedRealtimeEvents } from './mapRealtimeEvents'

export const mapRetargetRealtimeEvents = (
  mapUpdates: readonly RetargetMapSheetPlacementsResult[],
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => mapUpdates.flatMap(({ map }) =>
  mapDocumentUpdatedRealtimeEvents(map, clientId),
)
