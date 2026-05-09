import { describe, expect, it } from 'vitest'
import {
  ISOMETRIC_SPRITE_BRIGHTNESS_LIT,
  ISOMETRIC_SPRITE_BRIGHTNESS_SHADOW,
  getIsometricSpriteLighting,
} from '~/utils/isometric/spriteLighting'

describe('isometric sprite lighting helpers', () => {
  it('uses lit values when the camera faces the light direction', () => {
    const lighting = getIsometricSpriteLighting({
      cameraPosition: { x: 10, z: 0 },
      target: { x: 0, z: 0 },
      facingDirection: { x: 1, y: 0 },
      haloMinAlpha: 0.1,
      haloMaxAlpha: 0.3,
    })

    expect(lighting.lightAlignment).toBeCloseTo(1)
    expect(lighting.lightAlignment01).toBeCloseTo(1)
    expect(lighting.spriteBrightness).toBe(ISOMETRIC_SPRITE_BRIGHTNESS_LIT)
    expect(lighting.haloAlpha).toBeCloseTo(0.3)
  })

  it('uses shadow values when the camera is opposite the light direction', () => {
    const lighting = getIsometricSpriteLighting({
      cameraPosition: { x: -4, z: 0 },
      target: { x: 0, z: 0 },
      facingDirection: { x: 1, y: 0 },
      haloMinAlpha: 0.1,
      haloMaxAlpha: 0.3,
    })

    expect(lighting.lightAlignment).toBeCloseTo(-1)
    expect(lighting.lightAlignment01).toBeCloseTo(0)
    expect(lighting.spriteBrightness).toBe(ISOMETRIC_SPRITE_BRIGHTNESS_SHADOW)
    expect(lighting.haloAlpha).toBeCloseTo(0.1)
  })

  it('falls back to lit alignment when the camera sits on the target', () => {
    const lighting = getIsometricSpriteLighting({
      cameraPosition: { x: 2, z: 2 },
      target: { x: 2, z: 2 },
      facingDirection: { x: 1, y: 0 },
    })

    expect(lighting.lightAlignment).toBe(1)
    expect(lighting.spriteBrightness).toBe(ISOMETRIC_SPRITE_BRIGHTNESS_LIT)
  })
})
