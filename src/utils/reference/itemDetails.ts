import type { PtuItem } from '~/types/ptuReference'

export interface RelatedItemOptions {
  limit?: number
}

export const relatedItemsByPrimaryCategory = (
  current: PtuItem | null | undefined,
  items: readonly PtuItem[],
  options: RelatedItemOptions = {},
): PtuItem[] => {
  const primaryCategory = current?.categories[0]
  if (!current || !primaryCategory) return []

  const limit = options.limit ?? 12
  return items
    .filter((entry) => entry.name !== current.name && entry.categories.includes(primaryCategory))
    .slice(0, limit)
}
