import { describe, expect, it } from 'vitest'
import {
  canAccessMapForRole,
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
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'gm-token',
      sheetKind: 'trainer',
      sheetSlug: 'gm-npc',
      position: { x: 2, y: 1, z: 2 },
      facing: 'south-east',
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

describe('map policy helpers', () => {
  it('checks visibility access without granting player whole-map save permission', () => {
    expect(canAccessMapForRole('gm', baseMap({ playerVisible: false }))).toBe(true)
    expect(canAccessMapForRole('player', baseMap({ playerVisible: true }))).toBe(true)
    expect(canAccessMapForRole('player', baseMap({ playerVisible: false }))).toBe(false)
  })

  it('clamps anchors to map dimensions', () => {
    expect(clampAnchorToDimensions(
      { x: 999, y: -10, z: 1.4 },
      { x: 1, y: 1, z: 1 },
      { x: 5, y: 3, z: 4 },
    )).toEqual({ x: 4, y: 0, z: 1 })
  })
})
