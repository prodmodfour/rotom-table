import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  normalizeMapDocument,
  normalizeMapGroundLevelY,
} from '../../server/utils/mapNormalization'

const validMap = () => ({
  schemaVersion: 2,
  revision: 12,
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
  shopInterfaces: [
    {
      id: 'counter-a',
      shopSlug: 'viridian-mart',
      label: ' Potion Counter ',
      position: { x: 1, y: 0, z: 2 },
      interactionRangeMeters: 4.5,
      playerVisible: true,
      entries: [{ itemName: 'Potion', price: 300, stock: 4 }],
    },
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
      revision: 12,
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
    expect(normalized.shopInterfaces).toEqual([
      {
        id: 'counter-a',
        shopSlug: 'viridian-mart',
        label: 'Potion Counter',
        position: { x: 1, y: 0, z: 2 },
        interactionRangeMeters: 4.5,
        playerVisible: true,
      },
    ])
    const fieldEffects = normalized.fieldEffects!
    expect(fieldEffects.weather).toEqual([{ kind: 'rainy', rounds: 2, source: 'Dance' }])
    expect(fieldEffects.terrains).toEqual([{ kind: 'grassy', rounds: 4, scope: 'field' }])
    expect(fieldEffects.rooms).toEqual([{ kind: 'trick', rounds: 1, startsNextRound: true }])
    expect(normalized.placements).toEqual([{ id: 'token-1' }])
    expect(normalized.lights).toEqual([{ id: 'light-1' }])
    expect(normalized.encounterState).toEqual(createEmptyEncounterState())
  })

  it('defaults missing legacy revisions to zero', () => {
    const map = validMap()
    delete (map as Record<string, unknown>).revision

    expect(normalizeMapDocument(map, { sourceLabel: 'legacy-map.json' }).revision).toBe(0)
  })

  it('falls back to safe defaults for optional collections and visibility', () => {
    const map = validMap()
    delete (map as Record<string, unknown>).fieldEffects
    delete (map as Record<string, unknown>).hazards
    delete (map as Record<string, unknown>).shopInterfaces
    delete (map as Record<string, unknown>).placements
    delete (map as Record<string, unknown>).lights
    delete (map as Record<string, unknown>).initiative
    delete (map as Record<string, unknown>).moveUsage
    map.playerVisible = false

    const normalized = normalizeMapDocument(map, { sourceLabel: 'fixture' })

    expect(normalized.folder).toBe('stale/persisted-folder')
    expect(normalized.playerVisible).toBe(false)
    expect(normalized.hazards).toEqual([])
    expect(normalized.shopInterfaces).toEqual([])
    expect(normalized.placements).toEqual([])
    expect(normalized.lights).toEqual([])
    expect(normalized.initiative).toEqual({ activeId: null, round: 1 })
    expect(normalized.moveUsage).toBeUndefined()
    expect(normalized.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
    expect(normalized.encounterState).toEqual(createEmptyEncounterState())
    expect(normalizeMapDocument({ ...validMap(), shopInterfaces: [] }, { sourceLabel: 'fixture' }).shopInterfaces).toEqual([])
  })

  it('canonicalizes supported encounter state without retaining input containers', () => {
    const encounterState = createEmptyEncounterState()

    const normalized = normalizeMapDocument({ ...validMap(), encounterState }, { sourceLabel: 'fixture' })

    expect(normalized.encounterState).toEqual(encounterState)
    expect(normalized.encounterState).not.toBe(encounterState)
    expect(normalized.encounterState?.effects).not.toBe(encounterState.effects)
    expect(normalized.encounterState?.counters).not.toBe(encounterState.counters)
  })

  it('preserves explicit placement sides while leaving legacy allegiance unknown', () => {
    const encounterState = {
      ...createEmptyEncounterState(),
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', color: '#33AA44', status: 'active' as const },
        villains: { id: 'villains', label: 'Villains', status: 'inactive' as const },
      },
    }
    const normalized = normalizeMapDocument({
      ...validMap(),
      encounterState,
      placements: [
        {
          id: 'gm-ally',
          sheetKind: 'trainer',
          sheetSlug: 'gm-ally',
          position: { x: 0, y: 0, z: 0 },
          sideId: 'heroes',
        },
        {
          id: 'player-opponent',
          sheetKind: 'pokemon',
          sheetSlug: 'player-opponent',
          position: { x: 1, y: 0, z: 0 },
          sideId: 'villains',
        },
        {
          id: 'legacy-unknown',
          sheetKind: 'pokemon',
          sheetSlug: 'legacy-unknown',
          position: { x: 2, y: 0, z: 0 },
        },
      ],
    }, { sourceLabel: 'sided-map.json' })

    expect(normalized.encounterState?.sides).toEqual({
      heroes: { id: 'heroes', label: 'Heroes', color: '#33aa44', status: 'active' },
      villains: { id: 'villains', label: 'Villains', status: 'inactive' },
    })
    expect(normalized.placements.map(({ id, sideId }) => [id, sideId])).toEqual([
      ['gm-ally', 'heroes'],
      ['player-opponent', 'villains'],
      ['legacy-unknown', undefined],
    ])
    expect(Object.prototype.hasOwnProperty.call(normalized.placements[2], 'sideId')).toBe(false)
  })

  it('rejects malformed and dangling placement side identities', () => {
    const encounterState = {
      ...createEmptyEncounterState(),
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' as const } },
    }
    const placement = {
      id: 'token-1',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 0, y: 0, z: 0 },
    }

    expect(() => normalizeMapDocument({
      ...validMap(),
      encounterState,
      placements: [{ ...placement, sideId: 'Team Heroes' }],
    }, { sourceLabel: 'malformed-side.json' }))
      .toThrow('Map malformed-side.json is invalid: placements[0].sideId must be a lowercase alphanumeric/hyphen encounter side ID')
    expect(() => normalizeMapDocument({
      ...validMap(),
      encounterState,
      placements: [{ ...placement, sideId: 'villains' }],
    }, { sourceLabel: 'dangling-side.json' }))
      .toThrow('Map dangling-side.json is invalid: placements[0].sideId references unknown encounter side villains')
  })

  it('rejects future encounter-state versions and malformed bounded containers', () => {
    const encounterState = createEmptyEncounterState()

    expect(() => normalizeMapDocument({
      ...validMap(),
      encounterState: { ...encounterState, schemaVersion: 2 },
    }, { sourceLabel: 'future-map.json' }))
      .toThrow('Map future-map.json is invalid: encounterState.schemaVersion: must be 1')
    expect(() => normalizeMapDocument({
      ...validMap(),
      encounterState: { ...encounterState, effects: [{}] },
    }, { sourceLabel: 'oversized-map.json' }))
      .toThrow('Map oversized-map.json is invalid: encounterState.effects: must contain at most 0 entries')
    expect(() => normalizeMapDocument({
      ...validMap(),
      encounterState: { ...encounterState, zones: {} },
    }, { sourceLabel: 'malformed-map.json' }))
      .toThrow('Map malformed-map.json is invalid: encounterState.zones: must be an array')
  })

  it('normalizes partial map shop interfaces with stable IDs', () => {
    const map = {
      ...validMap(),
      shopInterfaces: [
        { shopSlug: 'celadon-mart' },
        { id: 'custom-counter', shopSlug: 'pewter-shop', label: '  Fossils  ', playerVisible: 'true' },
      ],
    }

    const normalized = normalizeMapDocument(map, { sourceLabel: 'fixture' })

    expect(normalized.shopInterfaces).toEqual([
      { id: 'map-shop-interface-1', shopSlug: 'celadon-mart', label: 'celadon-mart' },
      { id: 'custom-counter', shopSlug: 'pewter-shop', label: 'Fossils', playerVisible: true },
    ])
  })

  it('allocates deterministic replacement IDs for duplicate shop interface rows', () => {
    const map = {
      ...validMap(),
      shopInterfaces: [
        { id: 'counter', shopSlug: 'viridian-mart', label: 'Front Counter' },
        { id: 'counter', shopSlug: 'celadon-mart', label: 'Back Counter' },
        { id: 'map-shop-interface-3', shopSlug: 'pewter-shop', label: 'Museum Desk' },
        { shopSlug: 'saffron-market', label: 'Market Stall' },
      ],
    }

    const normalized = normalizeMapDocument(map, { sourceLabel: 'fixture' })

    expect(normalized.shopInterfaces?.map((shopInterface) => shopInterface.id)).toEqual([
      'counter',
      'map-shop-interface-2',
      'map-shop-interface-3',
      'map-shop-interface-4',
    ])
  })

  it('drops invalid shop interface rows and normalizes optional values predictably', () => {
    const map = {
      ...validMap(),
      shopInterfaces: [
        { id: 'bad-slug', shopSlug: 'Bad Slug', label: 'Invalid' },
        { id: 'missing-slug', label: 'Missing' },
        null,
        {
          id: 'valid',
          shopSlug: 'valid-shop',
          label: '  Valid  ',
          position: { x: '1.5', y: 0, z: 2 },
          interactionRangeMeters: '6.25',
          playerVisible: 'false',
          price: 999,
          stock: 1,
        },
        {
          id: 'invalid-options',
          shopSlug: 'options-shop',
          label: 'Options',
          position: { x: 1, y: 'nope', z: 3 },
          interactionRangeMeters: -1,
          playerVisible: 'sometimes',
        },
      ],
    }

    const normalized = normalizeMapDocument(map, { sourceLabel: 'fixture' })

    expect(normalized.shopInterfaces).toEqual([
      {
        id: 'valid',
        shopSlug: 'valid-shop',
        label: 'Valid',
        position: { x: 1.5, y: 0, z: 2 },
        interactionRangeMeters: 6.25,
        playerVisible: false,
      },
      {
        id: 'invalid-options',
        shopSlug: 'options-shop',
        label: 'Options',
      },
    ])
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
