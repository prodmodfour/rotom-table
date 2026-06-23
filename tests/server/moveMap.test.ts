import { describe, expect, it, vi } from 'vitest'
import {
  MoveMapUseCaseError,
  moveMapUseCase,
  normalizeMoveMapFolder,
  normalizeMoveMapSlug,
} from '../../server/useCases/moveMap'
import type { TabletopMap } from '~/types/map'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 3,
  slug: 'old-map',
  name: 'Old Map',
  folder: 'new-folder',
  dimensions: { x: 10, y: 5, z: 8 },
  groundLevelY: 0,
  playerVisible: false,
  placements: [],
  initiative: { activeId: null, round: 1 },
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  createdAt: 111,
  updatedAt: 999,
  ...overrides,
})

describe('move map use case', () => {
  it('moves a SQLite map document and emits compatible realtime events', () => {
    const map = makeMap()
    const mapRepository = { moveToFolder: vi.fn(() => ({ moved: true, map })) }

    const result = moveMapUseCase({
      slug: 'old-map',
      folder: '/new-folder/',
      clientId: 'client-1',
    }, {
      mapRepository,
      sanitizeFolder: (folder) => folder.replace(/^\/+|\/+$/g, ''),
      now: () => 999,
    })

    expect(mapRepository.moveToFolder).toHaveBeenCalledWith({ slug: 'old-map', folder: 'new-folder', now: 999 })
    expect(result).toMatchObject({ ok: true, moved: true, path: 'data/maps/new-folder/old-map.json' })
    expect(result.map).toBe(map)
    expect(result.events).toEqual([
      {
        channel: 'map:old-map',
        type: 'updated',
        revision: 3,
        clientId: 'client-1',
        data: result.map,
      },
      {
        channel: 'maps',
        type: 'moved',
        revision: 3,
        clientId: 'client-1',
        data: {
          slug: 'old-map',
          name: 'Old Map',
          folder: 'new-folder',
          dimensions: { x: 10, y: 5, z: 8 },
          placementCount: 0,
          playerVisible: false,
          schemaVersion: 2,
          revision: 3,
          updatedAt: 999,
        },
      },
    ])
  })

  it('keeps same-folder moves idempotent without publishing mutation events', () => {
    const map = makeMap({ revision: 2, folder: 'old-folder', updatedAt: 222 })
    const mapRepository = { moveToFolder: vi.fn(() => ({ moved: false, map })) }

    const result = moveMapUseCase({ slug: 'old-map', folder: 'old-folder' }, { mapRepository })

    expect(result).toMatchObject({ ok: true, moved: false, path: 'data/maps/old-folder/old-map.json', map })
    expect(result.events).toEqual([])
  })

  it('supports moving a map back to the root folder', () => {
    const map = makeMap({ folder: '' })
    const mapRepository = { moveToFolder: vi.fn(() => ({ moved: true, map })) }

    const result = moveMapUseCase({ slug: 'old-map', folder: '' }, { mapRepository })

    expect(mapRepository.moveToFolder).toHaveBeenCalledWith(expect.objectContaining({ folder: '' }))
    expect(result.path).toBe('data/maps/old-map.json')
  })

  it('rejects invalid input, missing maps, and repository conflicts', () => {
    expect(() => normalizeMoveMapSlug('Bad Slug')).toThrow(MoveMapUseCaseError)
    expect(() => normalizeMoveMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeMoveMapFolder('../bad', () => {
      throw new Error('Invalid folder path')
    })).toThrow('Invalid folder path')

    const missingRepository = { moveToFolder: vi.fn(() => null) }
    try {
      moveMapUseCase({ slug: 'old-map', folder: 'new-folder' }, { mapRepository: missingRepository })
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapUseCaseError)
      expect(err).toMatchObject({ statusCode: 404, message: 'Map old-map.json not found' })
    }

    const conflictRepository = { moveToFolder: vi.fn(() => {
      throw new Error('Destination folder already exists')
    }) }
    try {
      moveMapUseCase({ slug: 'old-map', folder: 'new-folder' }, { mapRepository: conflictRepository })
      throw new Error('expected conflicting destination to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapUseCaseError)
      expect(err).toMatchObject({ statusCode: 409, message: 'Destination folder already exists' })
    }
  })
})
