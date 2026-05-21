import type { PtuItem } from '~/types/ptuReference'

export const ptuItemOptionDetail = (item: PtuItem): string => [
  ...item.categories.slice(0, 2),
  item.costs[0],
].filter(Boolean).join(' · ')
