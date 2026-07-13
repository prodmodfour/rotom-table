import type { MovementCapabilityKey, MovementCapabilitySpeeds } from '~/types/movement'
import type { GridAnchor, GridDimensions } from '~/types/pokemon'
import { getClearanceValue, type PositionedGridFootprint } from '~/utils/gridGeometry'
import type { MovementPathResult } from '~/utils/mapMovementPathfinding'
import { normalizeMovementCapabilitySpeed } from '~/utils/movementCapabilities'

export const MOVEMENT_PATH_CACHE_KEY_VERSION = 'movement-path:v1'

const MOVEMENT_PATH_CACHE_CAPABILITY_ORDER: readonly MovementCapabilityKey[] = [
  'overland',
  'sky',
  'swim',
  'levitate',
  'burrow',
  'teleporter',
]

export type MovementPathRevision = string | number | null | undefined
export type MovementPathCacheKey = string

export const DEFAULT_MOVEMENT_PATH_CACHE_MAX_ENTRIES = 128

export interface MovementPathCacheSelectedToken {
  id: string
  base: number
  clearance?: number
  movementCapabilities?: MovementCapabilitySpeeds | null
}

export interface MovementPathCacheKeyOptions {
  selectedToken: MovementPathCacheSelectedToken | null | undefined
  start: GridAnchor | null | undefined
  goal: GridAnchor | null | undefined
  dimensions: GridDimensions
  groundLevelY: number
  terrainRevision: MovementPathRevision
  placementRevision: MovementPathRevision
}

export type MovementPathPlacementFootprint = Pick<
  PositionedGridFootprint,
  'id' | 'position' | 'base' | 'clearance'
>

export interface MapMovementPathCacheResolveResult {
  key: MovementPathCacheKey | null
  hit: boolean
  result: MovementPathResult
}

export interface MapMovementPathCache {
  get: (key: MovementPathCacheKey | null | undefined) => MovementPathResult | null
  set: (key: MovementPathCacheKey | null | undefined, result: MovementPathResult) => void
  getOrCompute: (
    key: MovementPathCacheKey | null | undefined,
    compute: () => MovementPathResult,
  ) => MapMovementPathCacheResolveResult
  clear: () => void
  snapshot: () => {
    size: number
    maxEntries: number
    keys: MovementPathCacheKey[]
  }
}

export interface MapMovementPathCacheOptions {
  maxEntries?: number
}

const numberCachePart = (value: number): string => Object.is(value, -0) ? '0' : String(value)

const anchorCacheParts = (anchor: GridAnchor): readonly string[] => [
  numberCachePart(anchor.x),
  numberCachePart(anchor.y),
  numberCachePart(anchor.z),
]

const dimensionsCacheParts = (dimensions: GridDimensions): readonly string[] => [
  numberCachePart(dimensions.x),
  numberCachePart(dimensions.y),
  numberCachePart(dimensions.z),
]

export const movementPathRevisionCachePart = (revision: MovementPathRevision): string => {
  if (revision == null) return 'none'
  return `${typeof revision}:${String(revision)}`
}

export const movementPathCapabilitiesCachePart = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
): readonly string[] => MOVEMENT_PATH_CACHE_CAPABILITY_ORDER.flatMap((key) => {
  const speed = normalizeMovementCapabilitySpeed(capabilities?.[key])
  return speed == null ? [] : [`${key}:${speed}`]
})

export const movementPathSelectedTokenCacheParts = (
  selectedToken: MovementPathCacheSelectedToken,
): readonly unknown[] => [
  selectedToken.id,
  numberCachePart(selectedToken.base),
  numberCachePart(getClearanceValue(selectedToken)),
  movementPathCapabilitiesCachePart(selectedToken.movementCapabilities),
]

const movementPathPlacementCacheParts = (
  pokemon: MovementPathPlacementFootprint,
): readonly string[] => [
  pokemon.id ?? '',
  ...anchorCacheParts(pokemon.position),
  numberCachePart(pokemon.base),
  numberCachePart(getClearanceValue(pokemon)),
]

export const movementPathPlacementRevision = (
  pokemons: readonly MovementPathPlacementFootprint[],
): string => {
  const placementParts = pokemons.map(movementPathPlacementCacheParts)
  placementParts.sort((left, right) => left.join('\u001e').localeCompare(right.join('\u001e')))
  return JSON.stringify(placementParts)
}

export const movementPathCacheKey = ({
  selectedToken,
  start,
  goal,
  dimensions,
  groundLevelY,
  terrainRevision,
  placementRevision,
}: MovementPathCacheKeyOptions): MovementPathCacheKey | null => {
  if (!selectedToken || !start || !goal) return null

  return JSON.stringify([
    MOVEMENT_PATH_CACHE_KEY_VERSION,
    movementPathSelectedTokenCacheParts(selectedToken),
    anchorCacheParts(start),
    anchorCacheParts(goal),
    dimensionsCacheParts(dimensions),
    numberCachePart(groundLevelY),
    movementPathRevisionCachePart(terrainRevision),
    movementPathRevisionCachePart(placementRevision),
  ])
}

const clonePathAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

export const cloneMovementPathResult = (result: MovementPathResult): MovementPathResult => ({
  ...result,
  path: result.path?.map(clonePathAnchor) ?? null,
  steps: result.steps.map(step => ({
    ...step,
    from: clonePathAnchor(step.from),
    to: clonePathAnchor(step.to),
    capabilityKeys: [...step.capabilityKeys],
    terrain: {
      ...step.terrain,
      requirements: [...step.terrain.requirements],
    },
  })),
  capabilityKeys: [...result.capabilityKeys],
  capabilityLabels: [...result.capabilityLabels],
})

const normalizeMovementPathCacheMaxEntries = (maxEntries: number | undefined): number => {
  if (maxEntries == null || !Number.isFinite(maxEntries)) {
    return DEFAULT_MOVEMENT_PATH_CACHE_MAX_ENTRIES
  }
  return Math.max(1, Math.floor(maxEntries))
}

export const createMapMovementPathCache = (
  options: MapMovementPathCacheOptions = {},
): MapMovementPathCache => {
  const maxEntries = normalizeMovementPathCacheMaxEntries(options.maxEntries)
  const entries = new Map<MovementPathCacheKey, MovementPathResult>()

  const touch = (key: MovementPathCacheKey, result: MovementPathResult) => {
    entries.delete(key)
    entries.set(key, result)
  }

  const remember = (key: MovementPathCacheKey, result: MovementPathResult) => {
    touch(key, cloneMovementPathResult(result))
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
  }

  const read = (key: MovementPathCacheKey): MovementPathResult | null => {
    const result = entries.get(key)
    if (!result) return null
    touch(key, result)
    return cloneMovementPathResult(result)
  }

  return {
    get: (key) => key == null ? null : read(key),
    set: (key, result) => {
      if (key == null) return
      remember(key, result)
    },
    getOrCompute: (key, compute) => {
      if (key != null) {
        const cached = read(key)
        if (cached) {
          return {
            key,
            hit: true,
            result: cached,
          }
        }
      }

      const result = compute()
      if (key != null) remember(key, result)
      return {
        key: key ?? null,
        hit: false,
        result,
      }
    },
    clear: () => entries.clear(),
    snapshot: () => ({
      size: entries.size,
      maxEntries,
      keys: Array.from(entries.keys()),
    }),
  }
}
