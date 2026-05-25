import { describe, expect, it } from 'vitest'
import {
  MOVEMENT_PATH_CACHE_KEY_VERSION,
  movementPathCacheKey,
  movementPathCapabilitiesCachePart,
  movementPathRevisionCachePart,
  type MovementPathCacheKeyOptions,
  type MovementPathCacheSelectedToken,
} from '~/utils/mapMovementPathCache'

const selectedToken = (
  overrides: Partial<MovementPathCacheSelectedToken> = {},
): MovementPathCacheSelectedToken => ({
  id: 'token-a',
  base: 1,
  clearance: 1,
  movementCapabilities: { overland: 6 },
  ...overrides,
})

const cacheOptions = (
  overrides: Partial<MovementPathCacheKeyOptions> = {},
): MovementPathCacheKeyOptions => ({
  selectedToken: selectedToken(),
  start: { x: 0, y: 0, z: 0 },
  goal: { x: 2, y: 0, z: 2 },
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  terrainRevision: 'terrain-revision-a',
  placementRevision: 'placement-revision-a',
  ...overrides,
})

describe('movement path cache keys', () => {
  it('builds stable keys for equivalent pathfinding inputs', () => {
    const first = movementPathCacheKey(cacheOptions({
      selectedToken: selectedToken({ movementCapabilities: { sky: 4, overland: 6 } }),
    }))
    const second = movementPathCacheKey(cacheOptions({
      selectedToken: selectedToken({ movementCapabilities: { overland: 6, sky: 4 } }),
      start: { x: 0, y: 0, z: 0 },
      goal: { x: 2, y: 0, z: 2 },
      dimensions: { x: 8, y: 4, z: 8 },
    }))

    expect(first).toBe(second)
    expect(first).toContain(MOVEMENT_PATH_CACHE_KEY_VERSION)
  })

  it('changes when pathfinding-relevant cache inputs change', () => {
    const baseKey = movementPathCacheKey(cacheOptions())
    const changes: Partial<MovementPathCacheKeyOptions>[] = [
      { selectedToken: selectedToken({ id: 'token-b' }) },
      { selectedToken: selectedToken({ base: 2 }) },
      { selectedToken: selectedToken({ clearance: 2 }) },
      { selectedToken: selectedToken({ movementCapabilities: { overland: 7 } }) },
      { start: { x: 1, y: 0, z: 0 } },
      { goal: { x: 2, y: 1, z: 2 } },
      { dimensions: { x: 9, y: 4, z: 8 } },
      { groundLevelY: 1 },
      { terrainRevision: 'terrain-revision-b' },
      { placementRevision: 'placement-revision-b' },
    ]

    for (const change of changes) {
      expect(movementPathCacheKey(cacheOptions(change))).not.toBe(baseKey)
    }
  })

  it('normalizes movement capabilities in pathfinder order', () => {
    expect(movementPathCapabilitiesCachePart({ sky: 4, overland: 6, swim: 0 })).toEqual([
      'overland:6',
      'sky:4',
      'swim:0',
    ])
    expect(movementPathCapabilitiesCachePart({ overland: 6.8, swim: -2, sky: Number.NaN })).toEqual([
      'overland:6',
      'swim:0',
    ])
  })

  it('distinguishes revision values while treating absent revisions consistently', () => {
    expect(movementPathRevisionCachePart(null)).toBe('none')
    expect(movementPathRevisionCachePart(undefined)).toBe('none')
    expect(movementPathRevisionCachePart('1')).toBe('string:1')
    expect(movementPathRevisionCachePart(1)).toBe('number:1')

    expect(movementPathCacheKey(cacheOptions({ terrainRevision: '1' })))
      .not.toBe(movementPathCacheKey(cacheOptions({ terrainRevision: 1 })))
  })

  it('does not create cache keys when selected token or endpoints are missing', () => {
    expect(movementPathCacheKey(cacheOptions({ selectedToken: null }))).toBeNull()
    expect(movementPathCacheKey(cacheOptions({ start: null }))).toBeNull()
    expect(movementPathCacheKey(cacheOptions({ goal: null }))).toBeNull()
  })
})
