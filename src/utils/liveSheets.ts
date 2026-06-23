import type { RealtimeEvent } from '#shared/realtime'
import {
  DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY,
  createLiveSheetCacheController,
  type LiveSheetListPayload,
  type LiveSheetMaps,
} from '~/utils/liveSheetCache'

/**
 * Compatibility helper for callers that still need to reconcile a full runtime
 * list directly into maps. New code should keep and reuse a cache controller so
 * list requests can be tokenized before the HTTP request starts.
 */
export const replaceLiveSheetMaps = (
  maps: LiveSheetMaps,
  payload: LiveSheetListPayload,
): void => {
  const controller = createLiveSheetCacheController(maps)
  const token = controller.beginAuthoritativeLoad(DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY)
  const result = controller.adoptAuthoritativeSet(payload, token)
  if (result.status !== 'applied') throw new Error(result.message)
}

export const applyLiveSheetRealtimeEventToMaps = (
  maps: LiveSheetMaps,
  event: Pick<RealtimeEvent, 'type' | 'data'>,
): boolean => {
  const controller = createLiveSheetCacheController(maps)
  const result = controller.applyRealtimeEvent(event)
  return result.status === 'adopted' || result.status === 'deleted'
}
