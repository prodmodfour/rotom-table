import { describe, expect, it } from 'vitest'
import type { MapGroundItem } from '#shared/moveAutomation/groundItems'
import type { LayerVisibility, MapHazardV2, MapVoxelV2 } from '~/types/map'
import {
  DEFAULT_ISOMETRIC_LAYER_VISIBILITY,
  clampIsometricGroundLevelY,
  getFieldEffectsRevisionKey,
  getGroundItemsRevisionKey,
  getHazardsRevisionKey,
  getTerrainVoxelsRevisionKey,
  resolveIsometricLayerVisibility,
  shouldShowMovementGrid,
} from '~/utils/isometric/sceneState'

describe('isometric scene state helpers', () => {
  it('resolves layer visibility with defaults', () => {
    expect(resolveIsometricLayerVisibility(null)).toEqual(DEFAULT_ISOMETRIC_LAYER_VISIBILITY)
    expect(resolveIsometricLayerVisibility({ tokens: false, hazards: false } as Partial<LayerVisibility>))
      .toEqual({
        terrain: true,
        shadows: true,
        tokens: false,
        grid: true,
        hazards: false,
        fieldEffects: true,
      })
  })

  it('shows the movement grid while selecting, building, or editing hazards', () => {
    expect(shouldShowMovementGrid({ hasSelectedPokemon: false, buildMode: false, hazardMode: false })).toBe(false)
    expect(shouldShowMovementGrid({ hasSelectedPokemon: true, buildMode: false, hazardMode: false })).toBe(true)
    expect(shouldShowMovementGrid({ hasSelectedPokemon: false, buildMode: true, hazardMode: false })).toBe(true)
    expect(shouldShowMovementGrid({ hasSelectedPokemon: false, buildMode: false, hazardMode: true })).toBe(true)
  })

  it('clamps ground level to integer map bounds', () => {
    expect(clampIsometricGroundLevelY({ y: 4 }, 2.6)).toBe(3)
    expect(clampIsometricGroundLevelY({ y: 4 }, -2)).toBe(0)
    expect(clampIsometricGroundLevelY({ y: 4 }, 99)).toBe(3)
    expect(clampIsometricGroundLevelY({ y: Number.NaN }, 2)).toBe(0)
    expect(clampIsometricGroundLevelY({ y: 4 }, 'bad')).toBe(0)
  })

  it('creates stable field-effect revision keys for already-normalized effects', () => {
    expect(getFieldEffectsRevisionKey({
      weather: [{ kind: 'rainy', rounds: 3 }],
      terrains: [],
      rooms: [{ kind: 'trick', startsNextRound: true }],
    })).toBe('{"weather":[{"kind":"rainy","rounds":3}],"terrains":[],"rooms":[{"kind":"trick","startsNextRound":true}]}')
  })

  it('includes every rendered and selectable ground-item field in revision keys', () => {
    const groundItem: MapGroundItem = {
      id: 'ground-item-1',
      canonicalItemId: 'iron-ball',
      canonicalItemName: 'Iron Ball',
      quantity: 2,
      position: { x: 1, y: 0, z: 2 },
      sourceResource: { kind: 'sheet', sheetKind: 'pokemon', slug: 'pikachu', revision: 4 },
      sourceOperationId: 'op_drop_item_0001',
      sideId: 'heroes',
      ownerPlacementId: 'token-1',
    }

    const first = getGroundItemsRevisionKey([groundItem])
    expect(first).toContain('ground-item-1')
    expect(first).toContain('Iron Ball')
    expect(getGroundItemsRevisionKey([{ ...groundItem, quantity: 3 }])).not.toBe(first)
    expect(getGroundItemsRevisionKey([{ ...groundItem, position: { x: 2, y: 0, z: 2 } }]))
      .not.toBe(first)
    expect(getGroundItemsRevisionKey([])).toBe('')
  })

  it('includes visual hazard and voxel fields in revision keys', () => {
    const hazards: MapHazardV2[] = [
      { kind: 'spikes', x: 1, y: 0, z: 2, owner: 'foe' },
      { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2 },
    ]
    const voxels: MapVoxelV2[] = [
      {
        x: 0,
        y: 1,
        z: 2,
        materialId: 'stone',
        color: '#aabbcc',
        ghost: true,
        blocksMovement: true,
        tags: ['ledge', 'cover'],
      },
    ]

    expect(getHazardsRevisionKey(hazards)).toBe('spikes\u001e1\u001e0\u001e2\u001e\u001efoe\u001dtoxic-spikes\u001e1\u001e0\u001e2\u001e2\u001e')
    expect(getTerrainVoxelsRevisionKey(voxels)).toBe('0\u001e1\u001e2\u001estone\u001e#aabbcc\u001etrue\u001etrue\u001e\u001eledge\u001fcover')
  })
})
