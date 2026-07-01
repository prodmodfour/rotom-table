import type { ShopTableDocument } from '~/types/shop'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const redactShopRecordForPlayer = (
  document: Record<string, unknown>,
): Record<string, unknown> => {
  const redacted: Record<string, unknown> = { ...document }
  delete redacted.gmNotes
  delete redacted.purchaseLog

  const entries = document['entries']
  if (Array.isArray(entries)) {
    redacted['entries'] = entries.map((entry) => {
      if (!isRecord(entry)) return entry
      const redactedEntry = { ...entry }
      delete redactedEntry.gmNotes
      return redactedEntry
    })
  }

  return redacted
}

export const redactShopForPlayer = (shop: ShopTableDocument): ShopTableDocument => (
  redactShopRecordForPlayer(shop as unknown as Record<string, unknown>) as unknown as ShopTableDocument
)

export const redactUnknownShopRecordForPlayer = (value: unknown): unknown => (
  isRecord(value) ? redactShopRecordForPlayer(value) : value
)
