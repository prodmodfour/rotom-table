import type { PtuEdge } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface EdgeFilterOptions {
  searchTerm?: string
}

export const edgeMatchesSearch = (edge: PtuEdge, normalizedQuery: string): boolean => {
  const haystacks = [
    edge.name,
    edge.prerequisites ?? '',
    edge.effect ?? '',
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterEdgesForIndex = (
  edges: readonly PtuEdge[],
  options: EdgeFilterOptions,
): PtuEdge[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  if (!query) return [...edges]
  return edges.filter((edge) => edgeMatchesSearch(edge, query))
}
