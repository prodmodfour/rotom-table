import { describe, expect, it, vi } from 'vitest'
import {
  RenameMapUseCaseError,
  normalizeRenameMapName,
  normalizeRenameMapSlug,
  renameMapUseCase,
} from '../../server/useCases/renameMap'
import type { TabletopMap } from '~/types/map'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 3,
  slug: 'old-map',
  name: 'Old Map',
  folder: 'folder',
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

describe('rename map use case', () => {
  it('updates the display name in place when the slug does not change', () => {
    const map = makeMap({ name: 'Old Map', revision: 2 })
    const mapRepository = { rename: vi.fn(() => ({ oldSlug: 'old-map', newSlug: 'old-map', renamed: false, changed: true, map })) }

    const result = renameMapUseCase({ slug: 'old-map', name: ' Old Map ', clientId: 'client-1' }, { mapRepository })

    expect(mapRepository.rename).toHaveBeenCalledWith({ slug: 'old-map', name: 'Old Map', now: expect.any(Number) })
    expect(result).toMatchObject({ ok: true, slug: 'old-map', name: 'Old Map', path: 'data/maps/folder/old-map.json' })
    expect(result.events).toEqual([
      {
        channel: 'map:old-map',
        type: 'updated',
        revision: 2,
        clientId: 'client-1',
        data: result.map,
      },
      {
        channel: 'maps',
        type: 'updated',
        revision: 2,
        clientId: 'client-1',
        data: {
          slug: 'old-map',
          name: 'Old Map',
          folder: 'folder',
          dimensions: { x: 10, y: 5, z: 8 },
          placementCount: 0,
          playerVisible: false,
          schemaVersion: 2,
          revision: 2,
          updatedAt: 999,
        },
      },
    ])
  })

  it('renames the row, updates the slug, and emits old/new map events when the slug changes', () => {
    const map = makeMap({ slug: 'sky-atrium', name: 'Sky Atrium' })
    const mapRepository = { rename: vi.fn(() => ({ oldSlug: 'old-map', newSlug: 'sky-atrium', renamed: true, changed: true, map })) }

    const result = renameMapUseCase({ slug: 'old-map', name: 'Sky Atrium' }, { mapRepository, now: () => 999 })

    expect(mapRepository.rename).toHaveBeenCalledWith({ slug: 'old-map', name: 'Sky Atrium', now: 999 })
    expect(result.slug).toBe('sky-atrium')
    expect(result.path).toBe('data/maps/folder/sky-atrium.json')
    expect(result.events).toEqual([
      {
        channel: 'map:old-map',
        type: 'renamed',
        revision: 3,
        clientId: undefined,
        data: { oldSlug: 'old-map', newSlug: 'sky-atrium', map: result.map },
      },
      {
        channel: 'map:sky-atrium',
        type: 'updated',
        revision: 3,
        clientId: undefined,
        data: result.map,
      },
      {
        channel: 'maps',
        type: 'renamed',
        revision: 3,
        clientId: undefined,
        data: {
          oldSlug: 'old-map',
          summary: {
            slug: 'sky-atrium',
            name: 'Sky Atrium',
            folder: 'folder',
            dimensions: { x: 10, y: 5, z: 8 },
            placementCount: 0,
            playerVisible: false,
            schemaVersion: 2,
            revision: 3,
            updatedAt: 999,
          },
        },
      },
    ])
  })

  it('returns no events when the repository reports no semantic change', () => {
    const map = makeMap()
    const mapRepository = { rename: vi.fn(() => ({ oldSlug: 'old-map', newSlug: 'old-map', renamed: false, changed: false, map })) }

    const result = renameMapUseCase({ slug: 'old-map', name: 'Old Map' }, { mapRepository })

    expect(result.events).toEqual([])
  })

  it('rejects invalid input and repository failures with compatible status messages', () => {
    expect(() => normalizeRenameMapSlug('Bad Slug')).toThrow(RenameMapUseCaseError)
    expect(() => normalizeRenameMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeRenameMapName('  ')).toThrow('name is required')
    expect(() => normalizeRenameMapName('x'.repeat(81))).toThrow('name too long (max 80 chars)')

    const missingRepository = { rename: vi.fn(() => null) }
    try {
      renameMapUseCase({ slug: 'old-map', name: 'Name' }, { mapRepository: missingRepository })
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RenameMapUseCaseError)
      expect(err).toMatchObject({ statusCode: 404, message: 'Map old-map.json not found' })
    }

    const conflictRepository = { rename: vi.fn(() => {
      throw new Error('UNIQUE constraint failed: maps.slug')
    }) }
    try {
      renameMapUseCase({ slug: 'old-map', name: 'Sky Atrium' }, { mapRepository: conflictRepository })
      throw new Error('expected conflicting map path to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RenameMapUseCaseError)
      expect(err).toMatchObject({ statusCode: 409, message: 'UNIQUE constraint failed: maps.slug' })
    }
  })
})
