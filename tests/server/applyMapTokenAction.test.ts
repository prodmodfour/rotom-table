import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MapTokenActionUseCaseError,
  moveMapTokenUseCase,
  spawnMapTokenUseCase,
  turnMapTokenUseCase,
} from '../../server/useCases/applyMapTokenAction'
import { MAPS_ROOT } from '../../server/utils/mapPaths'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_mapactor' as PlayerProfileId,
  displayName: 'Map Actor' as PlayerProfileDisplayName,
  linkedCharacters,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [{ x: 0, y: 0, z: 0, materialId: 'grass' }],
  hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1, layer: 1 }],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'linked-token',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'unlinked-token',
      sheetKind: 'trainer',
      sheetSlug: 'giovanni',
      position: { x: 2, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    },
  ],
  lights: [],
  initiative: { activeId: 'unlinked-token', round: 4 },
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const createDeps = (existing: TabletopMap = baseMap(), options: { now?: number } = {}) => {
  const path = join(MAPS_ROOT, 'arena.json')
  const writes: Array<{ path: string; map: TabletopMap }> = []
  const deps = {
    findMapPath: vi.fn((slug: string) => (slug === 'arena' ? path : null)),
    readMap: vi.fn(() => existing),
    writeMap: vi.fn((filePath: string, map: TabletopMap) => {
      writes.push({ path: filePath, map })
    }),
    readSheet: vi.fn((kind: string, slug: string) => ({
      sheet: kind === 'pokemon'
        ? { slug, nickname: 'Bolt', species: 'Pikachu' }
        : { slug, name: 'Boss' },
    })),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => options.now ?? 1000),
  }

  return { deps, path, writes }
}

describe('document-backed map token actions', () => {
  it('spawns a GM token through a focused map document write without rewriting from the client payload', () => {
    const existing = baseMap({ playerVisible: false })
    const { deps, path, writes } = createDeps(existing, { now: 1500 })

    const result = spawnMapTokenUseCase({
      role: 'gm',
      slug: 'arena',
      placement: {
        id: 'spawned-eevee',
        sheetKind: 'pokemon',
        sheetSlug: 'eevee',
        position: { x: 99, y: -1, z: 3 },
        facing: 'south-east',
        turned: false,
      },
      clientId: 'gm-client',
    }, deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(path)
    const persisted = writes[0]!.map
    expect(persisted.placements).toHaveLength(3)
    expect(persisted.placements[2]).toMatchObject({
      id: 'spawned-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 5, y: 0, z: 3 },
      facing: 'south-east',
      turned: false,
    })
    expect(persisted.voxels).toEqual(existing.voxels)
    expect(persisted.hazards).toEqual(existing.hazards)
    expect(persisted.revision).toBe(5)
    expect(persisted.updatedAt).toBe(1500)
    expect(result.map).toBe(persisted)
    expect(result.placement).toEqual(persisted.placements[2])
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
    expect(result.events[0]).toMatchObject({ type: 'updated', clientId: 'gm-client', data: persisted })
  })

  it('treats duplicate focused spawn retries for the same placement as already persisted', () => {
    const existing = baseMap()
    const placement = existing.placements[0]!
    const { deps, writes } = createDeps(existing)

    const result = spawnMapTokenUseCase({
      role: 'gm',
      slug: 'arena',
      placement,
      clientId: 'gm-client',
    }, deps)

    expect(writes).toEqual([])
    expect(result.map).toBe(existing)
    expect(result.placement).toBe(placement)
    expect(result.events).toEqual([])
  })

  it('rejects player token spawns without writing', () => {
    const { deps, writes } = createDeps(baseMap())

    expect(() => spawnMapTokenUseCase({
      role: 'player',
      slug: 'arena',
      placement: {
        id: 'player-spawn',
        sheetKind: 'pokemon',
        sheetSlug: 'eevee',
        position: { x: 3, y: 0, z: 3 },
      },
    }, deps)).toThrow(MapTokenActionUseCaseError)
    expect(writes).toEqual([])
  })

  it('moves a linked player token in the saved map document and publishes map updates', () => {
    const existing = baseMap()
    const { deps, path, writes } = createDeps(existing, { now: 2000 })

    const result = moveMapTokenUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'linked-token',
      position: { x: 99, y: -5, z: 0 },
      pathLength: 4,
      clientId: 'client-1',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(path)
    const persisted = writes[0]!.map
    expect(persisted.placements[0]).toMatchObject({
      id: 'linked-token',
      position: { x: 5, y: 0, z: 0 },
      facing: 'north-east',
      turned: false,
    })
    expect(persisted.placements[1]).toEqual(existing.placements[1])
    expect(persisted.voxels).toEqual(existing.voxels)
    expect(persisted.hazards).toEqual(existing.hazards)
    expect(persisted.initiative).toEqual(existing.initiative)
    expect(persisted.revision).toBe(5)
    expect(persisted.updatedAt).toBe(2000)
    expect(persisted.metadata?.movementLog).toMatchObject([
      {
        at: 2000,
        userId: 'linked-token',
        userName: 'Bolt',
        from: { x: 1, y: 0, z: 1 },
        to: { x: 5, y: 0, z: 0 },
        pathLength: 4,
      },
    ])
    expect(result.map).toBe(persisted)
    expect(result.placement).toEqual(persisted.placements[0])
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
    expect(result.events[0]).toMatchObject({ type: 'updated', clientId: 'client-1', data: persisted })
  })

  it('turns a linked player token without changing unrelated map state', () => {
    const existing = baseMap()
    const { deps, writes } = createDeps(existing, { now: 3000 })

    const result = turnMapTokenUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'linked-token',
      facing: 'north-west',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)

    expect(writes).toHaveLength(1)
    const persisted = writes[0]!.map
    expect(persisted.placements[0]).toMatchObject({
      id: 'linked-token',
      position: { x: 1, y: 0, z: 1 },
      facing: 'north-west',
      turned: true,
    })
    expect(persisted.placements[1]).toEqual(existing.placements[1])
    expect(persisted.revision).toBe(5)
    expect(persisted.metadata).toEqual(existing.metadata)
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
  })

  it('allows GMs to move tokens on hidden maps', () => {
    const existing = baseMap({ playerVisible: false })
    const { deps, writes } = createDeps(existing)

    moveMapTokenUseCase({
      role: 'gm',
      slug: 'arena',
      placementId: 'unlinked-token',
      position: { x: 4, y: 0, z: 4 },
      playerProfile: null,
    }, deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.map.placements[1]).toMatchObject({
      id: 'unlinked-token',
      position: { x: 4, y: 0, z: 4 },
    })
  })

  it('rejects unlinked player token actions without writing', () => {
    const { deps, writes } = createDeps(baseMap())

    expect(() => moveMapTokenUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'unlinked-token',
      position: { x: 0, y: 0, z: 0 },
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)).toThrow(MapTokenActionUseCaseError)

    try {
      turnMapTokenUseCase({
        role: 'player',
        slug: 'arena',
        placementId: 'unlinked-token',
        facing: 'south-east',
        playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Token is not linked to selected player profile',
      })
    }
    expect(writes).toEqual([])
  })

  it('rejects player token actions when no selected profile is available', () => {
    const { deps, writes } = createDeps(baseMap())

    expect(() => moveMapTokenUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'linked-token',
      position: { x: 3, y: 0, z: 3 },
      playerProfile: null,
    }, deps)).toThrow(MapTokenActionUseCaseError)

    try {
      moveMapTokenUseCase({
        role: 'player',
        slug: 'arena',
        placementId: 'linked-token',
        position: { x: 3, y: 0, z: 3 },
        playerProfile: null,
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Select a player profile to control linked map tokens',
      })
    }
    expect(writes).toEqual([])
  })

  it('does not write when an action leaves the saved token unchanged', () => {
    const existing = baseMap()
    const { deps, writes } = createDeps(existing)

    const result = moveMapTokenUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'linked-token',
      position: { x: 1, y: 0, z: 1 },
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)

    expect(writes).toEqual([])
    expect(result.map).toBe(existing)
    expect(result.placement).toBe(existing.placements[0])
    expect(result.events).toEqual([])
  })
})
