import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SaveMapUseCaseError,
  saveMapUseCase,
} from '../../server/useCases/saveMap'
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
  id: 'profile_mapplayer' as PlayerProfileId,
  displayName: 'Map Player' as PlayerProfileDisplayName,
  linkedCharacters,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [{ x: 0, y: 0, z: 0, materialId: 'grass' }],
  hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1, layer: 1 }],
  fieldEffects: {
    weather: [{ kind: 'rainy', rounds: 3 }],
    terrains: [{ kind: 'electric', scope: 'field', rounds: 2 }],
    rooms: [],
  },
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
  lights: [{ id: 'torch', kind: 'point', position: { x: 1, y: 1, z: 1 }, intensity: 0.8 }],
  initiative: { activeId: 'unlinked-token', round: 4 },
  moveUsage: {
    byPlacementId: {
      'linked-token': {
        thunderbolt: {
          moveName: 'Thunderbolt',
          frequency: 'scene',
          uses: 1,
        },
      },
    },
  },
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
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => options.now ?? 1000),
  }

  return { deps, path, writes }
}

describe('save map use case', () => {
  it('preserves GM whole-map local-first saves', () => {
    const existing = baseMap({ playerVisible: false })
    const incoming = baseMap({
      name: 'GM Revised Arena',
      playerVisible: false,
      voxels: [{ x: 3, y: 0, z: 3, materialId: 'stone' }],
      hazards: [{ kind: 'fire', x: 4, y: 0, z: 4 }],
      fieldEffects: { weather: [{ kind: 'sunny', rounds: 5 }], terrains: [], rooms: [] },
      placements: [
        { ...existing.placements[0]!, position: { x: 3, y: 0, z: 3 }, facing: 'south-west' },
      ],
      initiative: { activeId: 'linked-token', round: 5 },
    })
    const { deps, path, writes } = createDeps(existing, { now: 1234 })

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: incoming,
      clientId: 'client-1',
    }, deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(path)
    expect(writes[0]?.map).toMatchObject({
      name: 'GM Revised Arena',
      playerVisible: false,
      voxels: [{ x: 3, y: 0, z: 3, materialId: 'stone' }],
      hazards: [{ kind: 'fire', x: 4, y: 0, z: 4 }],
      fieldEffects: { weather: [{ kind: 'sunny', rounds: 5 }], terrains: [], rooms: [] },
      initiative: { activeId: 'linked-token', round: 5 },
      updatedAt: 1234,
    })
    expect(writes[0]?.map.placements).toHaveLength(1)
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
  })

  it('merges only linked player token movement and facing from whole-map saves', () => {
    const existing = baseMap()
    const incoming = baseMap({
      name: 'Player tried to rename map',
      playerVisible: false,
      voxels: [{ x: 5, y: 0, z: 5, materialId: 'lava' }],
      hazards: [{ kind: 'fire', x: 5, y: 0, z: 5 }],
      fieldEffects: { weather: [{ kind: 'sandstorm', rounds: 9 }], terrains: [], rooms: [] },
      lights: [],
      initiative: { activeId: 'linked-token', round: 99 },
      placements: [
        {
          id: 'linked-token',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          position: { x: 99, y: -4, z: 3 },
          facing: 'south-west',
          turned: true,
        },
        {
          id: 'unlinked-token',
          sheetKind: 'trainer',
          sheetSlug: 'giovanni',
          position: { x: 0, y: 0, z: 0 },
          facing: 'south-east',
          turned: false,
        },
        {
          id: 'player-created-token',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          position: { x: 1, y: 0, z: 1 },
        },
      ],
      metadata: { owner: 'player' },
    })
    const { deps, writes } = createDeps(existing, { now: 2000 })

    const result = saveMapUseCase({
      role: 'player',
      slug: 'arena',
      map: incoming,
      clientId: 'client-1',
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)

    expect(writes).toHaveLength(1)
    const persisted = writes[0]!.map
    expect(persisted.name).toBe(existing.name)
    expect(persisted.playerVisible).toBe(true)
    expect(persisted.voxels).toEqual(existing.voxels)
    expect(persisted.hazards).toEqual(existing.hazards)
    expect(persisted.fieldEffects).toEqual(existing.fieldEffects)
    expect(persisted.lights).toEqual(existing.lights)
    expect(persisted.initiative).toEqual(existing.initiative)
    expect(persisted.moveUsage).toEqual(existing.moveUsage)
    expect(persisted.metadata).toEqual(existing.metadata)
    expect(persisted.placements).toHaveLength(2)
    expect(persisted.placements[0]).toMatchObject({
      id: 'linked-token',
      position: { x: 5, y: 0, z: 3 },
      facing: 'south-west',
      turned: false,
    })
    expect(persisted.placements[1]).toEqual(existing.placements[1])
    expect(persisted.updatedAt).toBe(2000)
    expect(result.map).toBe(persisted)
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
  })

  it('does not write when an unlinked player only attempts blocked map or token edits', () => {
    const existing = baseMap()
    const incoming = baseMap({
      voxels: [],
      hazards: [{ kind: 'fire', x: 0, y: 0, z: 0 }],
      fieldEffects: { weather: [{ kind: 'hail', rounds: 1 }], terrains: [], rooms: [] },
      initiative: { activeId: 'linked-token', round: 12 },
      placements: [
        {
          id: 'linked-token',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          position: { x: 4, y: 0, z: 4 },
          facing: 'north-east',
        },
        {
          id: 'unlinked-token',
          sheetKind: 'trainer',
          sheetSlug: 'giovanni',
          position: { x: 0, y: 0, z: 0 },
          facing: 'south-east',
        },
      ],
    })
    const { deps, writes } = createDeps(existing)

    const result = saveMapUseCase({
      role: 'player',
      slug: 'arena',
      map: incoming,
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'misty' }]),
    }, deps)

    expect(writes).toEqual([])
    expect(result.map).toBe(existing)
    expect(result.events).toEqual([])
  })

  it('rejects hidden maps for player saves before merging token edits', () => {
    const existing = baseMap({ playerVisible: false })
    const { deps, writes } = createDeps(existing)

    expect(() => saveMapUseCase({
      role: 'player',
      slug: 'arena',
      map: baseMap({ playerVisible: false }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)).toThrow(SaveMapUseCaseError)

    try {
      saveMapUseCase({
        role: 'player',
        slug: 'arena',
        map: baseMap({ playerVisible: false }),
        playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Map is not player visible',
      })
    }
    expect(writes).toEqual([])
  })
})
