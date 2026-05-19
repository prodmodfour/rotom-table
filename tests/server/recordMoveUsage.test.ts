import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  RecordMoveUsageUseCaseError,
  recordMoveUsageUseCase,
} from '../../server/useCases/recordMoveUsage'
import { MAPS_ROOT } from '../../server/utils/mapPaths'
import type { TabletopMap } from '~/types/map'
import type { SheetKind } from '#shared/sheets'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-1',
      sheetKind: 'pokemon',
      sheetSlug: 'pika',
      position: { x: 1, y: 0, z: 1 },
    },
  ],
  lights: [],
  initiative: { activeId: 'token-1', round: 2 },
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

const createDeps = (options: {
  map?: TabletopMap
  sheet?: Record<string, unknown>
  canControlSheet?: (kind: SheetKind, slug: string) => boolean
  now?: number
} = {}) => {
  const mapPath = join(MAPS_ROOT, 'arena.json')
  const sheetPath = '/repo/data/sheets/pika.json'
  const mapWrites: Array<{ path: string; map: TabletopMap }> = []
  const sheetWrites: Array<{ path: string; sheet: Record<string, unknown> }> = []
  const map = options.map ?? baseMap()
  const sheet = options.sheet ?? { slug: 'pika', nickname: 'Pika', movelist: [] }

  const deps = {
    findMapPath: vi.fn((slug: string) => (slug === 'arena' ? mapPath : null)),
    readMap: vi.fn(() => map),
    writeMap: vi.fn((path: string, persistedMap: TabletopMap) => {
      mapWrites.push({ path, map: persistedMap })
    }),
    readSheet: vi.fn((_kind: SheetKind, slug: string) => (
      slug === 'pika' ? { path: sheetPath, sheet } : null
    )),
    writeSheet: vi.fn((path: string, persistedSheet: Record<string, unknown>) => {
      sheetWrites.push({ path, sheet: persistedSheet })
    }),
    canControlSheet: vi.fn(options.canControlSheet ?? (() => true)),
    now: vi.fn(() => options.now ?? 1000),
    relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
  }

  return { deps, mapPath, sheetPath, mapWrites, sheetWrites }
}

describe('record move usage use case', () => {
  it('records Scene usage on the map and emits map updates', () => {
    const { deps, mapPath, mapWrites, sheetWrites } = createDeps({
      sheet: {
        slug: 'pika',
        nickname: 'Pika',
        movelist: [{ name: 'Custom Scene Move', frequency: 'Scene x2' }],
      },
    })

    const result = recordMoveUsageUseCase({
      role: 'gm',
      slug: 'arena',
      placementId: 'token-1',
      moveName: 'Custom Scene Move',
      clientId: 'client-1',
    }, deps)

    expect(mapWrites).toHaveLength(1)
    expect(mapWrites[0]?.path).toBe(mapPath)
    expect(mapWrites[0]?.map.moveUsage).toEqual({
      byPlacementId: {
        'token-1': {
          'custom-scene-move': {
            moveName: 'Custom Scene Move',
            frequency: 'scene',
            uses: 1,
            lastUsedRound: 2,
            updatedAt: 1000,
          },
        },
      },
    })
    expect(sheetWrites).toEqual([])
    expect(result.usage).toMatchObject({
      tracking: 'map',
      frequencyKind: 'scene',
      uses: 1,
      maxUses: 2,
      remainingUses: 1,
      available: true,
    })
    expect(result.events.map((event) => event.channel)).toEqual(['map:arena', 'maps'])
  })

  it('records Daily usage on the sheet and emits sheet updates', () => {
    const { deps, sheetPath, mapWrites, sheetWrites } = createDeps({
      sheet: {
        slug: 'pika',
        nickname: 'Pika',
        folder: 'derived',
        movelist: [{ name: 'Custom Daily Move', frequency: 'Daily x2' }],
      },
    })

    const result = recordMoveUsageUseCase({
      role: 'gm',
      slug: 'arena',
      placementId: 'token-1',
      moveName: 'Custom Daily Move',
    }, deps)

    expect(mapWrites).toEqual([])
    expect(sheetWrites).toEqual([
      {
        path: sheetPath,
        sheet: {
          slug: 'pika',
          nickname: 'Pika',
          movelist: [{ name: 'Custom Daily Move', frequency: 'Daily x2' }],
          moveUsage: {
            daily: {
              'custom-daily-move': {
                moveName: 'Custom Daily Move',
                uses: 1,
                updatedAt: 1000,
              },
            },
          },
        },
      },
    ])
    expect(result.usage).toMatchObject({
      tracking: 'sheet',
      frequencyKind: 'daily',
      uses: 1,
      maxUses: 2,
      remainingUses: 1,
      available: true,
    })
    expect(result.events.map((event) => event.channel)).toEqual(['sheet:pokemon:pika', 'sheets'])
  })

  it('rejects EOT usage before the next available round', () => {
    const { deps, mapWrites, sheetWrites } = createDeps({
      map: baseMap({
        initiative: { activeId: 'token-1', round: 3 },
        moveUsage: {
          byPlacementId: {
            'token-1': {
              'custom-eot-move': {
                moveName: 'Custom EOT Move',
                frequency: 'eot',
                uses: 1,
                lastUsedRound: 2,
              },
            },
          },
        },
      }),
      sheet: {
        slug: 'pika',
        nickname: 'Pika',
        movelist: [{ name: 'Custom EOT Move', frequency: 'EOT' }],
      },
    })

    expect(() => recordMoveUsageUseCase({
      role: 'gm',
      slug: 'arena',
      placementId: 'token-1',
      moveName: 'Custom EOT Move',
    }, deps)).toThrow(RecordMoveUsageUseCaseError)

    try {
      recordMoveUsageUseCase({
        role: 'gm',
        slug: 'arena',
        placementId: 'token-1',
        moveName: 'Custom EOT Move',
      }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 409,
        message: 'Custom EOT Move is EOT and is not available until round 4',
      })
    }
    expect(mapWrites).toEqual([])
    expect(sheetWrites).toEqual([])
  })

  it('allows players to record usage only for accessible sheets on visible maps', () => {
    const { deps, mapWrites } = createDeps({
      sheet: {
        slug: 'pika',
        nickname: 'Pika',
        movelist: [{ name: 'Custom Scene Move', frequency: 'Scene' }],
      },
      canControlSheet: () => false,
    })

    expect(() => recordMoveUsageUseCase({
      role: 'player',
      slug: 'arena',
      placementId: 'token-1',
      moveName: 'Custom Scene Move',
    }, deps)).toThrow('Sheet is not marked as player accessible')
    expect(mapWrites).toEqual([])
  })

  it('does not write for untracked At-Will moves', () => {
    const { deps, mapWrites, sheetWrites } = createDeps({
      sheet: {
        slug: 'pika',
        nickname: 'Pika',
        movelist: [{ name: 'Custom At-Will Move', frequency: 'At-Will' }],
      },
    })

    const result = recordMoveUsageUseCase({
      role: 'gm',
      slug: 'arena',
      placementId: 'token-1',
      moveName: 'Custom At-Will Move',
    }, deps)

    expect(result.usage).toMatchObject({ tracking: 'none', frequencyKind: 'at-will', available: true })
    expect(result.events).toEqual([])
    expect(mapWrites).toEqual([])
    expect(sheetWrites).toEqual([])
  })
})
