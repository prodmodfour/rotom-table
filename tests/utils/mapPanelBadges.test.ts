import { describe, expect, it } from 'vitest'
import {
  formatActiveFieldEffectsBadge,
  formatFieldEffectsHazardsBadge,
  formatMapDimensionsBadge,
  formatTerrainBuildBadge,
  formatTerrainHazardBadge,
  pluralizeCount,
} from '~/utils/mapPanelBadges'

describe('map panel badge helpers', () => {
  it('pluralizes count labels', () => {
    expect(pluralizeCount(0, 'block')).toBe('0 blocks')
    expect(pluralizeCount(1, 'block')).toBe('1 block')
    expect(pluralizeCount(2, 'hazard')).toBe('2 hazards')
    expect(pluralizeCount(3, 'die', 'dice')).toBe('3 dice')
  })

  it('formats map dimensions consistently', () => {
    expect(formatMapDimensionsBadge({ x: 12, y: 4, z: 9 })).toBe('12 × 4 × 9')
  })

  it('formats terrain and hazard counts', () => {
    expect(formatTerrainBuildBadge(1)).toBe('1 block')
    expect(formatTerrainBuildBadge(3)).toBe('3 blocks')
    expect(formatTerrainHazardBadge(1, 2)).toBe('1 block · 2 hazards')
    expect(formatTerrainHazardBadge(3, 1)).toBe('3 blocks · 1 hazard')
  })

  it('formats active field-effect counts', () => {
    expect(formatActiveFieldEffectsBadge(0)).toBe('0 active')
    expect(formatActiveFieldEffectsBadge(2)).toBe('2 active')
    expect(formatFieldEffectsHazardsBadge(1, 2)).toBe('1 active · 2 hazards')
  })
})
