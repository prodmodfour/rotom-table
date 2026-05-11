import { describe, expect, it } from 'vitest'
import {
  getWorldSpriteLightingStyle,
  WORLD_SPRITE_GHOST_HALO_COLOR,
  WORLD_SPRITE_HALO_COLOR,
  WORLD_SPRITE_INVALID_HALO_COLOR,
} from '~/utils/isometric/worldSpriteLighting'

describe('world sprite lighting helpers', () => {
  it('keeps live sprite lighting tied to frame brightness and halo alpha', () => {
    const style = getWorldSpriteLightingStyle({
      ghost: false,
      invalid: false,
      brightness: 0.93,
      haloAlpha: 0.2,
    })

    expect(style.materialOpacity).toBeNull()
    expect(style.materialColor).toEqual({ kind: 'scalar', value: 0.93 })
    expect(style.haloColor).toBe(WORLD_SPRITE_HALO_COLOR)
    expect(style.haloOpacity).toBe(0.2)
  })

  it('uses the warm translucent lighting style for valid ghost previews', () => {
    const style = getWorldSpriteLightingStyle({
      ghost: true,
      invalid: false,
      brightness: 1,
      haloAlpha: 0.2,
    })

    expect(style.materialOpacity).toBe(0.4)
    expect(style.materialColor).toEqual({ kind: 'scalar', value: 1.2 })
    expect(style.haloColor).toBe(WORLD_SPRITE_GHOST_HALO_COLOR)
    expect(style.haloOpacity).toBe(0.18)
  })

  it('clamps overly bright ghost previews to the existing maximum tint', () => {
    const style = getWorldSpriteLightingStyle({
      ghost: true,
      invalid: false,
      brightness: 2,
      haloAlpha: 0.2,
    })

    expect(style.materialColor).toEqual({ kind: 'scalar', value: 1.35 })
  })

  it('uses red invalid-preview tinting with clamped RGB channels', () => {
    const style = getWorldSpriteLightingStyle({
      ghost: true,
      invalid: true,
      brightness: 2,
      haloAlpha: 0.2,
    })

    expect(style.materialOpacity).toBe(0.28)
    expect(style.materialColor).toEqual({ kind: 'rgb', r: 1.4, g: 1, b: 1 })
    expect(style.haloColor).toBe(WORLD_SPRITE_INVALID_HALO_COLOR)
    expect(style.haloOpacity).toBe(0.16)
  })
})
