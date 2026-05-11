import { describe, expect, it } from 'vitest'
import {
  blockTextureSideDepthOverlayScale,
  resolveBlockTexturePattern,
} from '~/utils/isometric/blockTexturePatterns'
import type { BlockTextureRole } from '~/utils/isometric/blockTextureColors'

const tags = (...values: string[]) => new Set(values)

const pattern = (
  role: BlockTextureRole,
  materialId: string,
  tagValues: string[],
  isCustom = false,
) => resolveBlockTexturePattern({
  role,
  materialId,
  tags: tags(...tagValues),
  isCustom,
})

describe('isometric block texture pattern helpers', () => {
  it('resolves material tags to stable generated texture patterns', () => {
    expect(pattern('top', 'meadow_grass', [])).toBe('grass-top')
    expect(pattern('side', 'flowering_grass', ['grass'])).toBe('grass-side')
    expect(pattern('bottom', 'flowering_grass', ['grass'])).toBe('grass-bottom')

    expect(pattern('top', 'burrow_dirt', ['dirt'])).toBe('dirt')
    expect(pattern('top', 'cave_stone', ['cave'])).toBe('stone')
    expect(pattern('top', 'shallow_water', ['water'])).toBe('water')
    expect(pattern('top', 'snow', ['ice'])).toBe('snow')
    expect(pattern('top', 'sand', ['sand'])).toBe('sand')
    expect(pattern('top', 'wood', ['wood'])).toBe('wood')
    expect(pattern('top', 'lava', ['emissive'])).toBe('lava')
  })

  it('keeps special floor and custom-color pattern precedence explicit', () => {
    expect(pattern('top', 'hazard_stripe_floor', [])).toBe('hazard-stripe')
    expect(pattern('top', 'warning_floor', ['hazard'])).toBe('hazard-stripe')
    expect(pattern('top', 'medical_tile', ['medical'])).toBe('tech-panel')
    expect(pattern('top', 'electric_floor', ['electric'])).toBe('tech-panel')
    expect(pattern('top', 'custom_water', ['water'], true)).toBe('custom')
    expect(pattern('top', 'unknown', [])).toBe('custom')
  })

  it('derives side-depth overlay scale from visual material traits', () => {
    expect(blockTextureSideDepthOverlayScale({ tags: tags('water'), isCustom: false })).toBe(0.5)
    expect(blockTextureSideDepthOverlayScale({ tags: tags(), transparent: true, isCustom: false })).toBe(0.5)
    expect(blockTextureSideDepthOverlayScale({ tags: tags('thermal'), isCustom: false })).toBe(0.52)
    expect(blockTextureSideDepthOverlayScale({ tags: tags('snow'), isCustom: false })).toBe(0.66)
    expect(blockTextureSideDepthOverlayScale({ tags: tags('sand'), isCustom: false })).toBe(0.9)
    expect(blockTextureSideDepthOverlayScale({ tags: tags('metal'), isCustom: false })).toBe(1.08)
    expect(blockTextureSideDepthOverlayScale({ tags: tags('water'), isCustom: true })).toBe(0.78)
    expect(blockTextureSideDepthOverlayScale({ tags: tags(), isCustom: false })).toBe(1)
  })
})
