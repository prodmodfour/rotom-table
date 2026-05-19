import { describe, expect, it } from 'vitest'
import {
  normalizeMapDocument,
  normalizeMapGroundLevelY,
} from '../../server/utils/mapNormalization'

const validMap = () => ({
  schemaVersion: 2,
  slug: 'test-map',
  name: 'Test Map',
  folder: 'stale/persisted-folder',
  dimensions: { x: 6, y: 3, z: 5 },
  groundLevelY: 9,
  playerVisible: true,
  voxels: [
    {
      x: 1,
      y: 2,
      z: 3,
      materialId: 'mud',
      color: '#70503b',
      ghost: true,
      blocksMovement: true,
      blocksSight: false,
      tags: ['cover', 7, 'muddy'],
    },
  ],
  hazards: [
    { kind: 'toxic-spikes', x: 2, y: 0, z: 1, layer: 99, owner: ' Nidoran ' },
  ],
  fieldEffects: {
    weather: [{ kind: 'rainy', rounds: 2, source: 'Dance' }],
    terrains: [{ kind: 'grassy', rounds: 4 }],
    rooms: [{ kind: 'trick', rounds: 1, startsNextRound: true }],
  },
  placements: [{ id: 'token-1' }],
  lights: [{ id: 'light-1' }],
  initiative: { activeId: 'token-1', round: 2 },
  moveUsage: {
    byPlacementId: {
      'token-1': {
        Thunderbolt: { moveName: 'Thunderbolt', frequency: 'scene', uses: 1, lastUsedRound: 2, updatedAt: 10 },
        invalid: { moveName: '', frequency: 'daily', uses: 1 },
      },
    },
  },
  metadata: { note: 'kept' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
})

describe('map document normalization', () => {
  it('normalizes editor-safe map data and uses storage-derived folders', () => {
    const normalized = normalizeMapDocument(validMap(), {
      sourceLabel: 'data/maps/actual/test-map.json',
      folder: 'actual',
    })

    expect(normalized).toMatchObject({
      schemaVersion: 2,
      slug: 'test-map',
      name: 'Test Map',
      folder: 'actual',
      dimensions: { x: 6, y: 3, z: 5 },
      groundLevelY: 2,
      playerVisible: true,
      initiative: { activeId: 'token-1', round: 2 },
      moveUsage: {
        byPlacementId: {
          'token-1': {
            thunderbolt: { moveName: 'Thunderbolt', frequency: 'scene', uses: 1, lastUsedRound: 2, updatedAt: 10 },
          },
        },
      },
      metadata: { note: 'kept' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(normalized.voxels).toEqual([
      {
        x: 1,
        y: 2,
        z: 3,
        materialId: 'mud',
        color: '#70503b',
        ghost: true,
        blocksMovement: true,
        blocksSight: false,
        tags: ['cover', 'muddy'],
      },
    ])
    expect(normalized.hazards).toEqual([
      { kind: 'toxic-spikes', x: 2, y: 0, z: 1, layer: 2, owner: 'Nidoran' },
    ])
    const fieldEffects = normalized.fieldEffects!
    expect(fieldEffects.weather).toEqual([{ kind: 'rainy', rounds: 2, source: 'Dance' }])
    expect(fieldEffects.terrains).toEqual([{ kind: 'grassy', rounds: 4, scope: 'field' }])
    expect(fieldEffects.rooms).toEqual([{ kind: 'trick', rounds: 1, startsNextRound: true }])
    expect(normalized.placements).toEqual([{ id: 'token-1' }])
    expect(normalized.lights).toEqual([{ id: 'light-1' }])
  })

  it('falls back to safe defaults for optional collections and visibility', () => {
    const map = validMap()
    delete (map as Record<string, unknown>).fieldEffects
    delete (map as Record<string, unknown>).hazards
    delete (map as Record<string, unknown>).placements
    delete (map as Record<string, unknown>).lights
    delete (map as Record<string, unknown>).initiative
    delete (map as Record<string, unknown>).moveUsage
    map.playerVisible = false

    const normalized = normalizeMapDocument(map, { sourceLabel: 'fixture' })

    expect(normalized.folder).toBe('stale/persisted-folder')
    expect(normalized.playerVisible).toBe(false)
    expect(normalized.hazards).toEqual([])
    expect(normalized.placements).toEqual([])
    expect(normalized.lights).toEqual([])
    expect(normalized.initiative).toEqual({ activeId: null, round: 1 })
    expect(normalized.moveUsage).toBeUndefined()
    expect(normalized.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
  })

  it('reports validation errors with the supplied source label', () => {
    expect(() => normalizeMapDocument({ ...validMap(), schemaVersion: 1 }, { sourceLabel: 'bad.json' }))
      .toThrow('Map bad.json is invalid: schemaVersion must be 2')
    expect(() => normalizeMapDocument({ ...validMap(), slug: 'Bad Slug' }, { sourceLabel: 'bad.json' }))
      .toThrow('Map bad.json is invalid: slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeMapDocument({ ...validMap(), dimensions: { x: 1, y: 0, z: 1 } }, { sourceLabel: 'bad.json' }))
      .toThrow('Map bad.json is invalid: dimensions.y must be an integer 1..200')
    expect(() => normalizeMapDocument({ ...validMap(), voxels: [{ x: 0, y: 0, z: 0, materialId: '' }] }, { sourceLabel: 'bad.json' }))
      .toThrow('Map bad.json is invalid: voxels[0].materialId must be a non-empty string')
    expect(() => normalizeMapDocument({ ...validMap(), hazards: [{ kind: 'bad', x: 0, y: 0, z: 0 }] }, { sourceLabel: 'bad.json' }))
      .toThrow('Map bad.json is invalid: hazards[0] must be an object with integer x/y/z and valid kind')
  })

  it('clamps ground level values to the map height', () => {
    expect(normalizeMapGroundLevelY(undefined, 4)).toBe(0)
    expect(normalizeMapGroundLevelY(-3, 4)).toBe(0)
    expect(normalizeMapGroundLevelY(1.6, 4)).toBe(2)
    expect(normalizeMapGroundLevelY(99, 4)).toBe(3)
    expect(normalizeMapGroundLevelY(99, Number.NaN)).toBe(0)
  })
})
