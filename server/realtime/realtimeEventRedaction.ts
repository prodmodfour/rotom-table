import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { isSheetKind } from '#shared/sheets'
import { redactSheetRecordForPlayer } from '../utils/sheetPrivacy'
import type { RealtimeDeliveryPrincipal } from './realtimeEventAccessPolicy'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const redactShopDocumentForPlayer = (document: Record<string, unknown>): Record<string, unknown> => {
  const redacted = { ...document }
  delete redacted.gmNotes

  if (Array.isArray(document.entries)) {
    redacted.entries = document.entries.map((entry) => {
      if (!isRecord(entry)) return entry
      const redactedEntry = { ...entry }
      delete redactedEntry.gmNotes
      return redactedEntry
    })
  }

  return redacted
}

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
      document: redactShopDocumentForPlayer(data.document),
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
    if (isRecord(documents.shop)) documents.shop = redactShopDocumentForPlayer(documents.shop)
    delete documents.groupInventories
    delete documents.trainerSheets
    result.documents = documents
  } else if (result.ok === false && isRecord(result.currentState)) {
    result.currentState = redactShopDocumentForPlayer(result.currentState)
  }

  return {
    ...event,
    data: {
      ...data,
      result,
    },
  }
}

export const redactRealtimeEventForPrincipal = (
  event: unknown,
  principal: RealtimeDeliveryPrincipal,
): unknown => {
  if (principal.role !== 'player' || !isRecord(event)) return event

  const data = event.data
  if (!isRecord(data)) return event

  return redactedSheetRealtimeEvent(event, data)
    ?? redactedShopRealtimeEvent(event, data)
    ?? redactedShopCheckoutResultRealtimeEvent(event, data)
    ?? event
}
