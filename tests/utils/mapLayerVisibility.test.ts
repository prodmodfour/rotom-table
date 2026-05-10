import { describe, expect, it } from 'vitest'
import {
  createDefaultMapLayerVisibility,
  DEFAULT_MAP_LAYER_VISIBILITY,
  formatLayerVisibilityLabel,
  MAP_LAYER_OPTIONS,
  resolveMapLayerVisibility,
} from '~/utils/mapLayerVisibility'

describe('map layer visibility helpers', () => {
  it('exposes the canonical map layer order', () => {
    expect(MAP_LAYER_OPTIONS).toEqual([
      'terrain',
      'shadows',
      'tokens',
      'grid',
      'hazards',
      'fieldEffects',
    ])
  })

  it('creates independent default layer visibility state', () => {
    const first = createDefaultMapLayerVisibility()
    const second = createDefaultMapLayerVisibility()

    first.terrain = false

    expect(DEFAULT_MAP_LAYER_VISIBILITY.terrain).toBe(true)
    expect(second.terrain).toBe(true)
  })

  it('resolves partial visibility over the shared defaults', () => {
    expect(resolveMapLayerVisibility({ tokens: false, hazards: false })).toEqual({
      terrain: true,
      shadows: true,
      tokens: false,
      grid: true,
      hazards: false,
      fieldEffects: true,
    })
    expect(resolveMapLayerVisibility(null)).toEqual(createDefaultMapLayerVisibility())
  })

  it('formats camel-case layer keys for compact labels', () => {
    expect(formatLayerVisibilityLabel('grid')).toBe('grid')
    expect(formatLayerVisibilityLabel('fieldEffects')).toBe('field Effects')
    expect(formatLayerVisibilityLabel('movementGrid')).toBe('movement Grid')
  })
})
