import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import {
  SaveMapUseCaseError,
  saveMapUseCase,
} from '../../server/useCases/saveMap'
import { MAPS_ROOT } from '../../server/utils/mapPaths'
import type { TabletopMap } from '~/types/map'

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

const setupEditMode = MAP_INTERACTION_MODES.SETUP_EDIT
const livePlayMode = MAP_INTERACTION_MODES.LIVE_PLAY

describe('save map use case', () => {
  it('preserves GM setup/edit whole-map document-backed saves', () => {
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
      interactionMode: setupEditMode,
    }, deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(path)
    expect(writes[0]?.map).toMatchObject({
      revision: 4,
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

  it('preserves an existing map revision when a setup/edit compatibility save omits it', () => {
    const existing = baseMap({ revision: 9 })
    const incoming = baseMap({ name: 'Legacy client save' })
    delete (incoming as unknown as Record<string, unknown>).revision
    const { deps, writes } = createDeps(existing, { now: 1500 })

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: incoming,
      interactionMode: setupEditMode,
    }, deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.map.revision).toBe(9)
    expect(result.map.revision).toBe(9)
  })

  it('rejects player whole-map saves without reading or merging the existing map', () => {
    const existing = baseMap()
    const incoming = baseMap({
      name: 'Player tried to rename map',
      placements: [
        { ...existing.placements[0]!, position: { x: 4, y: 0, z: 3 }, facing: 'south-west' },
      ],
    })
    const { deps, writes } = createDeps(existing, { now: 2000 })

    expect(() => saveMapUseCase({
      role: 'player',
      slug: 'arena',
      map: incoming,
      clientId: 'client-1',
      interactionMode: setupEditMode,
    }, deps)).toThrow(SaveMapUseCaseError)

    try {
      saveMapUseCase({
        role: 'player',
        slug: 'arena',
        map: incoming,
        clientId: 'client-1',
        interactionMode: setupEditMode,
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Player whole-map saves are not allowed; live play uses commands',
      })
    }
    expect(deps.findMapPath).not.toHaveBeenCalled()
    expect(deps.readMap).not.toHaveBeenCalled()
    expect(deps.writeMap).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('rejects live-play whole-map save requests for GMs', () => {
    const { deps, writes } = createDeps(baseMap())

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: baseMap({ name: 'Live overwrite' }),
      interactionMode: livePlayMode,
    }, deps)).toThrow(SaveMapUseCaseError)

    try {
      saveMapUseCase({
        role: 'gm',
        slug: 'arena',
        map: baseMap({ name: 'Live overwrite' }),
        interactionMode: livePlayMode,
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Whole-map saves are setup/edit-only; live play uses commands',
      })
    }
    expect(writes).toEqual([])
  })

  it('rejects mismatched slugs before writing', () => {
    const { deps, writes } = createDeps(baseMap())

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: baseMap({ slug: 'different-arena' }),
      interactionMode: setupEditMode,
    }, deps)).toThrow(SaveMapUseCaseError)

    expect(writes).toEqual([])
  })
})
