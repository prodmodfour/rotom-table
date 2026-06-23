import { describe, expect, it, vi } from 'vitest'
import {
  DeleteMapUseCaseError,
  deleteMapUseCase,
  normalizeDeleteMapSlug,
} from '../../server/useCases/deleteMap'
import type { TabletopMap } from '~/types/map'

const mapDoc = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'old-map',
  name: 'Old Map',
  folder: 'old-folder',
  revision: 2,
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: false,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 20,
  ...overrides,
})

describe('delete map use case', () => {
  it('deletes the SQLite map document and emits compatible realtime events', () => {
    const deleted = { map: mapDoc() }
    const mapRepository = { deleteDocument: vi.fn(() => deleted) }

    const result = deleteMapUseCase({
      slug: 'old-map',
      clientId: 'client-1',
    }, { mapRepository })

    expect(mapRepository.deleteDocument).toHaveBeenCalledWith('old-map')
    expect(result).toEqual({
      ok: true,
      path: 'data/maps/old-folder/old-map.json',
      events: [
        {
          channel: 'map:old-map',
          type: 'deleted',
          clientId: 'client-1',
          data: { slug: 'old-map' },
        },
        {
          channel: 'maps',
          type: 'deleted',
          clientId: 'client-1',
          data: { slug: 'old-map' },
        },
      ],
    })
  })

  it('rejects invalid slugs and missing maps with compatible messages', () => {
    expect(() => normalizeDeleteMapSlug('Bad Slug')).toThrow(DeleteMapUseCaseError)
    expect(() => normalizeDeleteMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')

    const mapRepository = { deleteDocument: vi.fn(() => null) }
    try {
      deleteMapUseCase({ slug: 'old-map' }, { mapRepository })
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Map old-map.json not found',
      })
    }
  })
})
