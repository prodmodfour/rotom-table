import { isSheetKind } from '#shared/sheets'
import { redactSheetRecordForPlayer } from '../utils/sheetPrivacy'
import type { RealtimeDeliveryPrincipal } from './realtimeEventAccessPolicy'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const redactRealtimeEventForPrincipal = (
  event: unknown,
  principal: RealtimeDeliveryPrincipal,
): unknown => {
  if (principal.role !== 'player' || !isRecord(event)) return event

  const data = event.data
  if (!isRecord(data) || !isSheetKind(data.kind) || !isRecord(data.sheet)) return event

  return {
    ...event,
    data: {
      ...data,
      sheet: redactSheetRecordForPlayer(data.kind, data.sheet),
    },
  }
}
