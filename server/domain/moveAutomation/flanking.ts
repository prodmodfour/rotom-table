import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { MoveAutomationRelationshipResolver } from './relationships'

export const MOVE_AUTOMATION_FLANKING_LIMITS = Object.freeze({
  adjacentFoes: 64,
  searchNodes: 100_000,
})

export type MoveAutomationFlankingReasonCode =
  | 'target-flanked'
  | 'target-not-flanked'
  | 'target-flanking-state-unavailable'
  | 'target-flanking-search-limit'
  | 'target-cannot-be-flanked'

export interface MoveAutomationFlankingContribution {
  readonly placementId: string
  readonly adjacentSquares: number
}

export interface MoveAutomationFlankingResolution {
  readonly targetPlacementId: string
  readonly flanked: boolean
  readonly requiredAdjacentSquares: number | null
  readonly adjacentFoeIds: readonly string[]
  readonly qualifyingFoeIds: readonly string[]
  readonly contributions: readonly MoveAutomationFlankingContribution[]
  readonly reasonCode: MoveAutomationFlankingReasonCode
}

export interface MoveAutomationFlankingResolver {
  resolve(targetPlacementId: string): MoveAutomationFlankingResolution
}

export interface CreateMoveAutomationFlankingResolverInput {
  readonly placements: readonly SheetPlacement[]
  readonly tokens: readonly SpawnedPokemon[]
  readonly relationships: MoveAutomationRelationshipResolver
  readonly cannotBeFlankedPlacementIds?: ReadonlySet<string>
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}

const SIZE_REQUIREMENTS: Readonly<Record<string, number>> = Object.freeze({
  small: 2,
  medium: 2,
  large: 3,
  huge: 4,
  gigantic: 5,
})

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const normalizedSize = (token: SpawnedPokemon): string | null => {
  const value = token.creatureRules?.size ?? token.size
  if (typeof value !== 'string') return null
  const size = value.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(SIZE_REQUIREMENTS, size) ? size : null
}

const verticallyAdjacent = (left: SpawnedPokemon, right: SpawnedPokemon): boolean => {
  const leftTop = left.position.y + Math.max(1, left.clearance) - 1
  const rightTop = right.position.y + Math.max(1, right.clearance) - 1
  return left.position.y <= rightTop + 1 && right.position.y <= leftTop + 1
}

/** Number of one foe's occupied horizontal squares adjacent to the target footprint. */
const adjacentSquareContribution = (
  target: SpawnedPokemon,
  foe: SpawnedPokemon,
): number => {
  if (!verticallyAdjacent(target, foe)) return 0
  let count = 0
  for (let x = foe.position.x; x < foe.position.x + foe.base; x += 1) {
    for (let z = foe.position.z; z < foe.position.z + foe.base; z += 1) {
      const nearestTargetX = Math.max(
        target.position.x,
        Math.min(x, target.position.x + target.base - 1),
      )
      const nearestTargetZ = Math.max(
        target.position.z,
        Math.min(z, target.position.z + target.base - 1),
      )
      const separation = Math.max(
        Math.abs(x - nearestTargetX),
        Math.abs(z - nearestTargetZ),
      )
      if (separation === 1) count += 1
    }
  }
  return count
}

const adjacent = (left: SpawnedPokemon, right: SpawnedPokemon): boolean => (
  ptuGridDistanceBetweenFootprints(left, right) === 1
)

interface FlankingCandidate extends MoveAutomationFlankingContribution {
  readonly token: SpawnedPokemon
}

const qualifyingFlankers = (
  candidates: readonly FlankingCandidate[],
  requiredAdjacentSquares: number,
): { readonly ids: readonly string[]; readonly limitExceeded: boolean } => {
  let visited = 0
  const search = (
    start: number,
    selected: readonly FlankingCandidate[],
    contribution: number,
  ): readonly string[] | null => {
    visited += 1
    if (visited > MOVE_AUTOMATION_FLANKING_LIMITS.searchNodes) return null
    if (selected.length >= 2 && contribution >= requiredAdjacentSquares) {
      return selected.map(candidate => candidate.placementId)
    }
    for (let index = start; index < candidates.length; index += 1) {
      const candidate = candidates[index]!
      if (selected.some(other => adjacent(candidate.token, other.token))) continue
      const result = search(
        index + 1,
        [...selected, candidate],
        contribution + candidate.adjacentSquares,
      )
      if (result) return result
      if (visited > MOVE_AUTOMATION_FLANKING_LIMITS.searchNodes) return null
    }
    return null
  }
  const ids = search(0, [], 0)
  return {
    ids: ids ?? [],
    limitExceeded: visited > MOVE_AUTOMATION_FLANKING_LIMITS.searchNodes,
  }
}

/**
 * Resolve PTU flanking solely from authoritative footprints, explicit sides,
 * and effective mechanical size. Unknown allegiance fails closed.
 */
export const createMoveAutomationFlankingResolver = (
  input: CreateMoveAutomationFlankingResolverInput,
): MoveAutomationFlankingResolver => {
  const placementById = new Map(input.placements.map(placement => [placement.id, placement]))
  const tokenById = new Map(input.tokens.map(token => [token.id, token]))
  const cache = new Map<string, MoveAutomationFlankingResolution>()

  return Object.freeze({
    resolve: (targetPlacementId: string): MoveAutomationFlankingResolution => {
      const cached = cache.get(targetPlacementId)
      if (cached) return cached
      const targetPlacement = placementById.get(targetPlacementId)
      const target = tokenById.get(targetPlacementId)
      if (!targetPlacement || !target) {
        const unavailable = deepFreeze({
          targetPlacementId,
          flanked: false,
          requiredAdjacentSquares: null,
          adjacentFoeIds: [],
          qualifyingFoeIds: [],
          contributions: [],
          reasonCode: 'target-flanking-state-unavailable' as const,
        })
        cache.set(targetPlacementId, unavailable)
        return unavailable
      }

      if (input.cannotBeFlankedPlacementIds?.has(targetPlacementId)) {
        const prevented = deepFreeze({
          targetPlacementId,
          flanked: false,
          requiredAdjacentSquares: null,
          adjacentFoeIds: [],
          qualifyingFoeIds: [],
          contributions: [],
          reasonCode: 'target-cannot-be-flanked' as const,
        })
        cache.set(targetPlacementId, prevented)
        return prevented
      }

      // A negative result consults every placed token: a newly changed size,
      // ability projection, or allegiance can change the geometric conclusion.
      for (const placement of input.placements) input.recordSheetRead?.(placement)
      const size = normalizedSize(target)
      const requiredAdjacentSquares = size === null ? null : SIZE_REQUIREMENTS[size]!
      if (requiredAdjacentSquares === null) {
        const unavailable = deepFreeze({
          targetPlacementId,
          flanked: false,
          requiredAdjacentSquares,
          adjacentFoeIds: [],
          qualifyingFoeIds: [],
          contributions: [],
          reasonCode: 'target-flanking-state-unavailable' as const,
        })
        cache.set(targetPlacementId, unavailable)
        return unavailable
      }

      const candidates = input.placements.flatMap((placement): FlankingCandidate[] => {
        if (placement.id === targetPlacementId) return []
        if (input.relationships.resolve(placement.id, targetPlacementId).relationship !== 'enemy') {
          return []
        }
        const token = tokenById.get(placement.id)
        if (!token || !adjacent(target, token)) return []
        const adjacentSquares = adjacentSquareContribution(target, token)
        return adjacentSquares > 0
          ? [{ placementId: placement.id, adjacentSquares, token }]
          : []
      })
      if (candidates.length > MOVE_AUTOMATION_FLANKING_LIMITS.adjacentFoes) {
        const limited = deepFreeze({
          targetPlacementId,
          flanked: false,
          requiredAdjacentSquares,
          adjacentFoeIds: candidates.map(candidate => candidate.placementId),
          qualifyingFoeIds: [],
          contributions: candidates.map(({ placementId, adjacentSquares }) => ({
            placementId,
            adjacentSquares,
          })),
          reasonCode: 'target-flanking-search-limit' as const,
        })
        cache.set(targetPlacementId, limited)
        return limited
      }

      const qualifying = qualifyingFlankers(candidates, requiredAdjacentSquares)
      const resolution = deepFreeze({
        targetPlacementId,
        flanked: qualifying.ids.length >= 2,
        requiredAdjacentSquares,
        adjacentFoeIds: candidates.map(candidate => candidate.placementId),
        qualifyingFoeIds: qualifying.ids,
        contributions: candidates.map(({ placementId, adjacentSquares }) => ({
          placementId,
          adjacentSquares,
        })),
        reasonCode: qualifying.limitExceeded
          ? 'target-flanking-search-limit' as const
          : qualifying.ids.length >= 2
            ? 'target-flanked' as const
            : 'target-not-flanked' as const,
      })
      cache.set(targetPlacementId, resolution)
      return resolution
    },
  })
}
