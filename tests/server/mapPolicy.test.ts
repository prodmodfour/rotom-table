import { describe, expect, it } from 'vitest'
import {
  applyPlayerMapSavePolicy,
  canSaveMap,
  clampAnchorToDimensions,
} from '../../server/policies/mapPolicy'
import type { TabletopMap } from '~/types/map'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'test-map',
  name: 'Test Map',
  dimensions: { x: 5, y: 3, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [{ x: 0, y: 0, z: 0, materialId: 'grass' }],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'player-token',
      sheetKind: 'pokemon',
      sheetSlug: 'player-mon',
      position: { x: 1, y: 1, z: 1 },
      turned: false,
    },
    {
      id: 'gm-token',
      sheetKind: 'trainer',
      sheetSlug: 'gm-npc',
      position: { x: 2, y: 1, z: 2 },
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: 'gm-token', round: 2 },
  metadata: { owner: 'gm' },
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

describe('map save policy', () => {
  it('allows GMs to save any map and players only visible maps', () => {
    expect(canSaveMap('gm', baseMap({ playerVisible: false }))).toBe(true)
    expect(canSaveMap('player', baseMap({ playerVisible: true }))).toBe(true)
    expect(canSaveMap('player', baseMap({ playerVisible: false }))).toBe(false)
  })

  it('clamps player placement positions to map dimensions', () => {
    expect(clampAnchorToDimensions(
      { x: 999, y: -10, z: 1.4 },
      { x: 1, y: 1, z: 1 },
      { x: 5, y: 3, z: 4 },
    )).toEqual({ x: 4, y: 0, z: 1 })
  })

  it('only merges allowed player token movement/turning edits', () => {
    const existing = baseMap()
    const incoming = baseMap({
      name: 'Player tried to rename map',
      playerVisible: false,
      voxels: [],
      initiative: { activeId: 'player-token', round: 99 },
      placements: [
        {
          id: 'player-token',
          sheetKind: 'pokemon',
          sheetSlug: 'player-mon',
          position: { x: 99, y: -5, z: 3 },
          turned: true,
        },
        {
          id: 'gm-token',
          sheetKind: 'trainer',
          sheetSlug: 'gm-npc',
          position: { x: 0, y: 0, z: 0 },
          turned: true,
        },
        {
          id: 'new-player-created-token',
          sheetKind: 'pokemon',
          sheetSlug: 'player-mon',
          position: { x: 0, y: 0, z: 0 },
        },
      ],
    })

    const result = applyPlayerMapSavePolicy(
      existing,
      incoming,
      (kind, slug) => kind === 'pokemon' && slug === 'player-mon',
    )

    expect(result.name).toBe(existing.name)
    expect(result.playerVisible).toBe(true)
    expect(result.voxels).toEqual(existing.voxels)
    expect(result.initiative).toEqual(existing.initiative)
    expect(result.placements).toHaveLength(2)
    expect(result.placements[0]).toMatchObject({
      id: 'player-token',
      position: { x: 4, y: 0, z: 3 },
      turned: true,
    })
    expect(result.placements[1]).toEqual(existing.placements[1])
  })

  it('does not merge an incoming placement that changes sheet identity', () => {
    const existing = baseMap()
    const incoming = baseMap({
      placements: [
        {
          id: 'player-token',
          sheetKind: 'pokemon',
          sheetSlug: 'different-mon',
          position: { x: 4, y: 0, z: 3 },
          turned: true,
        },
      ],
    })

    const result = applyPlayerMapSavePolicy(existing, incoming, () => true)
    expect(result.placements[0]).toEqual(existing.placements[0])
  })
})
