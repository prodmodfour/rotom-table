import type { PtuItem } from '~/types/ptuReference'

export interface ItemCategoryCount {
  category: string
  count: number
}

export interface ItemSectionCount {
  section: string
  count: number
}

export interface ItemFilterOptions {
  searchTerm?: string
  category?: string | null
  section?: string | null
}

export const normalizeReferenceSearch = (value: string): string => value.trim().toLowerCase()

const sortedCounts = <TKey extends string>(
  counts: Map<string, number>,
  key: TKey,
  compare: (a: [string, number], b: [string, number]) => number,
): Array<Record<TKey, string> & { count: number }> => Array.from(counts.entries())
  .sort(compare)
  .map(([name, count]) => ({ [key]: name, count }) as Record<TKey, string> & { count: number })

export const buildItemCategoryCounts = (sourceItems: readonly PtuItem[]): ItemCategoryCount[] => {
  const counts = new Map<string, number>()
  for (const item of sourceItems) {
    for (const category of item.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }

  return sortedCounts(counts, 'category', (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export const buildItemSectionCounts = (sourceItems: readonly PtuItem[]): ItemSectionCount[] => {
  const counts = new Map<string, number>()
  for (const item of sourceItems) {
    for (const section of item.sections) {
      counts.set(section, (counts.get(section) ?? 0) + 1)
    }
  }

  return sortedCounts(counts, 'section', (a, b) => a[0].localeCompare(b[0]))
}

export const itemMatchesSearch = (item: PtuItem, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true
  const haystacks = [
    item.name,
    item.source,
    ...item.categories,
    ...item.sections,
    ...item.costs,
    ...item.effects,
    ...item.aliases,
    ...item.notes,
  ]
  return haystacks.some((value) => normalizeReferenceSearch(value).includes(normalizedQuery))
}

export const filterItemsForIndex = (
  sourceItems: readonly PtuItem[],
  options: ItemFilterOptions,
): PtuItem[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  return sourceItems.filter((item) => {
    if (options.category && !item.categories.includes(options.category)) return false
    if (options.section && !item.sections.includes(options.section)) return false
    return itemMatchesSearch(item, query)
  })
}
