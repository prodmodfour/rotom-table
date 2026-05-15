import type { PtuMove } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export const ALL_MOVE_TYPES_OPTION = 'All'

export interface MoveFilterOptions {
  searchTerm?: string
  type?: string
}

export const buildMoveTypeOptions = (sourceMoves: readonly PtuMove[]): string[] => {
  const set = new Set<string>()
  for (const move of sourceMoves) if (move.type) set.add(move.type)
  return [ALL_MOVE_TYPES_OPTION, ...Array.from(set).sort()]
}

export const moveMatchesSearch = (move: PtuMove, normalizedQuery: string): boolean => {
  const haystacks = [
    move.name,
    move.type ?? '',
    move.frequency ?? '',
    move.damage_class ?? '',
    move.range ?? '',
    move.effect ?? '',
    move.special ?? '',
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterMovesForIndex = (
  sourceMoves: readonly PtuMove[],
  options: MoveFilterOptions,
): PtuMove[] => {
  const selectedType = options.type ?? ALL_MOVE_TYPES_OPTION
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  return sourceMoves.filter((move) => {
    if (selectedType !== ALL_MOVE_TYPES_OPTION && move.type !== selectedType) return false
    return moveMatchesSearch(move, query)
  })
}
