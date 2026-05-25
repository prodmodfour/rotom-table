import type { MovementCapabilityKey, MovementCapabilitySpeeds } from '~/types/movement'
import type { GridAnchor, GridDimensions } from '~/types/pokemon'
import { getClearanceValue } from '~/utils/gridGeometry'
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
