import {
  LIVE_PLAY_COMMAND_TYPES,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES } from '#shared/realtime'
import { isSheetKind } from '#shared/sheets'
import { redactResolveMovePatchesForObserver } from '../utils/moveResultPrivacy'
import { redactSheetRecordForPlayer } from '../utils/sheetPrivacy'
import { redactShopRecordForPlayer, redactUnknownShopRecordForPlayer } from '../utils/shopPrivacy'
import type { RealtimeDeliveryPrincipal } from './realtimeEventAccessPolicy'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const redactedSheetRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
): unknown => {
  if (!isSheetKind(data.kind) || !isRecord(data.sheet)) return null
  return {
    ...event,
    data: {
      ...data,
      sheet: redactSheetRecordForPlayer(data.kind, data.sheet),
    },
  }
}

const redactedShopRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
): unknown => {
  if (typeof data.slug !== 'string' || !isRecord(data.document)) return null
  if (data.document.slug !== data.slug || !Array.isArray(data.document.entries)) return null

  return {
    ...event,
    data: {
      ...data,
      document: redactShopRecordForPlayer(data.document),
    },
  }
}

const redactedShopCheckoutResultRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
): unknown => {
  if (data.commandType !== LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT || !isRecord(data.result)) return null

  const result = { ...data.result }
  if (result.ok === true && isRecord(result.documents)) {
    const documents = { ...result.documents }
    if (isRecord(documents.shop)) documents.shop = redactShopRecordForPlayer(documents.shop)
    delete documents.groupInventories
    delete documents.trainerSheets
    result.documents = documents
  } else if (result.ok === false && isRecord(result.currentState)) {
    result.currentState = redactUnknownShopRecordForPlayer(result.currentState)
  }

  return {
    ...event,
    data: {
      ...data,
      result,
    },
  }
}

const redactedResolveMoveRealtimeEvent = (
  event: Record<string, unknown>,
): Record<string, unknown> => {
  if (
    event.type !== LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED
    || !Array.isArray(event.patches)
  ) {
    return event
  }

  return {
    ...event,
    patches: redactResolveMovePatchesForObserver(event.patches as LivePlayPatch[]),
  }
}

export const redactRealtimeEventForPrincipal = (
  event: unknown,
  principal: RealtimeDeliveryPrincipal,
): unknown => {
  if (principal.role !== 'player' || !isRecord(event)) return event

  const observerSafeEvent = redactedResolveMoveRealtimeEvent(event)
  const data = observerSafeEvent.data
  if (!isRecord(data)) return observerSafeEvent

  return redactedSheetRealtimeEvent(observerSafeEvent, data)
    ?? redactedShopRealtimeEvent(observerSafeEvent, data)
    ?? redactedShopCheckoutResultRealtimeEvent(observerSafeEvent, data)
    ?? observerSafeEvent
}
