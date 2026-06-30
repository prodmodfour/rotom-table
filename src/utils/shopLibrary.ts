import type { ShopTableDocument } from '~/types/shop'

export const formatShopEntryCount = (entryCount: number): string => {
  const safeCount = Number.isSafeInteger(entryCount) && entryCount > 0 ? entryCount : 0
  return `${safeCount} ${safeCount === 1 ? 'entry' : 'entries'}`
}

export const shopEntryCountLabel = (shop: Pick<ShopTableDocument, 'entries'>): string => (
  formatShopEntryCount(shop.entries.length)
)

const updatedAtDate = (updatedAt: number): Date | null => {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? null : date
}

export const shopUpdatedAtDateTime = (updatedAt: number): string => (
  updatedAtDate(updatedAt)?.toISOString() ?? ''
)

export const formatShopUpdatedAt = (updatedAt: number): string => {
  const dateTime = shopUpdatedAtDateTime(updatedAt)
  if (!dateTime) return 'Unknown update time'
  return dateTime.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}
