import { describe, expect, it } from 'vitest'
import { formatLayerVisibilityLabel } from '~/utils/mapLayerVisibility'

describe('map layer visibility helpers', () => {
  it('formats camel-case layer keys for compact labels', () => {
    expect(formatLayerVisibilityLabel('grid')).toBe('grid')
    expect(formatLayerVisibilityLabel('fieldEffects')).toBe('field Effects')
    expect(formatLayerVisibilityLabel('movementGrid')).toBe('movement Grid')
  })
})
