import { describe, expect, it } from 'vitest'
import {
  createMapMovementPathCache,
  DEFAULT_MOVEMENT_PATH_CACHE_MAX_ENTRIES,
  MOVEMENT_PATH_CACHE_KEY_VERSION,
  movementPathCacheKey,
  movementPathCapabilitiesCachePart,
  movementPathPlacementRevision,
  movementPathRevisionCachePart,
  type MovementPathCacheKeyOptions,
  type MovementPathCacheSelectedToken,
} from '~/utils/mapMovementPathCache'
import type { MovementPathResult } from '~/utils/mapMovementPathfinding'

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

const movementResult = (overrides: Partial<MovementPathResult> = {}): MovementPathResult => ({
  path: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }],
  distance: 1,
  movementLimit: 6,
  capabilityKeys: ['overland'],
  capabilityLabels: ['Overland'],
  capabilityLabel: 'Overland',
  legal: true,
  reason: 'legal',
  ...overrides,
})

describe('movement path cache', () => {
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

  it('builds placement revisions from pathfinding-relevant footprint state', () => {
    const first = movementPathPlacementRevision([
      { id: 'b', position: { x: 2, y: 0, z: 1 }, base: 1, clearance: 1 },
      { id: 'a', position: { x: 0, y: 0, z: 0 }, base: 1, clearance: 2 },
    ])
    const reordered = movementPathPlacementRevision([
      { id: 'a', position: { x: 0, y: 0, z: 0 }, base: 1, clearance: 2 },
      { id: 'b', position: { x: 2, y: 0, z: 1 }, base: 1, clearance: 1 },
    ])
    const moved = movementPathPlacementRevision([
      { id: 'a', position: { x: 1, y: 0, z: 0 }, base: 1, clearance: 2 },
      { id: 'b', position: { x: 2, y: 0, z: 1 }, base: 1, clearance: 1 },
    ])

    expect(reordered).toBe(first)
    expect(moved).not.toBe(first)
  })

  it('caches movement path results defensively by key', () => {
    const cache = createMapMovementPathCache({ maxEntries: 2 })
    const key = movementPathCacheKey(cacheOptions())!
    const compute = () => movementResult()

    const miss = cache.getOrCompute(key, compute)
    const hit = cache.getOrCompute(key, () => movementResult({ distance: 99 }))

    expect(miss.hit).toBe(false)
    expect(hit.hit).toBe(true)
    expect(hit.result.distance).toBe(1)

    hit.result.path?.push({ x: 9, y: 9, z: 9 })
    hit.result.capabilityLabels.push('Mutated')

    expect(cache.get(key)).toEqual(movementResult())
  })

  it('keeps revision-specific entries separate and reports misses for changed state', () => {
    const cache = createMapMovementPathCache()
    const terrainAKey = movementPathCacheKey(cacheOptions({ terrainRevision: 'terrain-a' }))!
    const terrainBKey = movementPathCacheKey(cacheOptions({ terrainRevision: 'terrain-b' }))!
    let terrainAComputes = 0
    let terrainBComputes = 0

    const firstA = cache.getOrCompute(terrainAKey, () => {
      terrainAComputes += 1
      return movementResult({ distance: 1 })
    })
    const firstB = cache.getOrCompute(terrainBKey, () => {
      terrainBComputes += 1
      return movementResult({ distance: 2 })
    })
    const secondA = cache.getOrCompute(terrainAKey, () => {
      terrainAComputes += 1
      return movementResult({ distance: 99 })
    })

    expect(firstA.hit).toBe(false)
    expect(firstB.hit).toBe(false)
    expect(secondA.hit).toBe(true)
    expect(secondA.result.distance).toBe(1)
    expect(terrainAComputes).toBe(1)
    expect(terrainBComputes).toBe(1)
  })

  it('does not cache pathfinding results when a cache key cannot be built', () => {
    const cache = createMapMovementPathCache()
    let computes = 0

    const first = cache.getOrCompute(null, () => {
      computes += 1
      return movementResult({ distance: 1 })
    })
    const second = cache.getOrCompute(undefined, () => {
      computes += 1
      return movementResult({ distance: 2 })
    })

    expect(first.key).toBeNull()
    expect(first.hit).toBe(false)
    expect(first.result.distance).toBe(1)
    expect(second.key).toBeNull()
    expect(second.hit).toBe(false)
    expect(second.result.distance).toBe(2)
    expect(computes).toBe(2)
    expect(cache.snapshot()).toEqual({
      size: 0,
      maxEntries: DEFAULT_MOVEMENT_PATH_CACHE_MAX_ENTRIES,
      keys: [],
    })
  })

  it('evicts least-recently-used path results after the bounded cache fills', () => {
    const cache = createMapMovementPathCache({ maxEntries: 2 })
    const keyA = movementPathCacheKey(cacheOptions({ goal: { x: 1, y: 0, z: 1 } }))!
    const keyB = movementPathCacheKey(cacheOptions({ goal: { x: 2, y: 0, z: 2 } }))!
    const keyC = movementPathCacheKey(cacheOptions({ goal: { x: 3, y: 0, z: 3 } }))!

    cache.set(keyA, movementResult({ distance: 1 }))
    cache.set(keyB, movementResult({ distance: 2 }))
    expect(cache.get(keyA)?.distance).toBe(1)

    cache.set(keyC, movementResult({ distance: 3 }))

    expect(cache.snapshot().keys).toEqual([keyA, keyC])
    expect(cache.get(keyB)).toBeNull()
    expect(cache.get(keyA)?.distance).toBe(1)
    expect(cache.get(keyC)?.distance).toBe(3)
  })

  it('protects cached paths from mutations of computed miss results', () => {
    const cache = createMapMovementPathCache()
    const key = movementPathCacheKey(cacheOptions())!
    const computed = movementResult()

    const miss = cache.getOrCompute(key, () => computed)
    miss.result.path?.push({ x: 9, y: 9, z: 9 })
    miss.result.capabilityKeys.push('sky')
    computed.capabilityLabels.push('Mutated')

    expect(cache.get(key)).toEqual(movementResult())
  })
})
