import type { PtuItem } from '~/types/ptuReference'

const HELD_ITEM_TAXONOMY = new Set(['held item', 'held items'])

const normalizeItemTaxonomy = (value: string): string => value.trim().toLowerCase()

export const ptuItemIsHeldItem = (item: PtuItem): boolean => (
  [...item.categories, ...item.sections].some((label) => HELD_ITEM_TAXONOMY.has(normalizeItemTaxonomy(label)))
)

export const comparePtuItemsForHeldItemSelect = (a: PtuItem, b: PtuItem): number => {
  const aRank = ptuItemIsHeldItem(a) ? 0 : 1
  const bRank = ptuItemIsHeldItem(b) ? 0 : 1
  if (aRank !== bRank) return aRank - bRank
  return a.name.localeCompare(b.name)
}

export const sortPtuItemsForHeldItemSelect = (sourceItems: readonly PtuItem[]): PtuItem[] => (
  [...sourceItems].sort(comparePtuItemsForHeldItemSelect)
)

export const ptuItemOptionDetail = (item: PtuItem): string => [
  ...item.categories.slice(0, 2),
  item.costs[0],
].filter(Boolean).join(' · ')
