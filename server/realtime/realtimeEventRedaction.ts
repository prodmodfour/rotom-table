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

export const redactRealtimeEventForPrincipal = (
  event: unknown,
  principal: RealtimeDeliveryPrincipal,
): unknown => {
  if (principal.role !== 'player' || !isRecord(event)) return event

  const data = event.data
  if (!isRecord(data)) return event

  return redactedSheetRealtimeEvent(event, data)
    ?? redactedShopRealtimeEvent(event, data)
    ?? event
}
