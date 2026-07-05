import { describe, expect, it } from 'vitest'
import {
  WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING,
  WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING,
  WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER,
  WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER,
  WORLD_SPRITE_ISO_LIGHTING_SHAPE,
  WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS,
  WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST,
} from '~/utils/isometric/worldSpriteIsoLighting'

describe('world sprite isometric lighting constants', () => {
  it('exposes visual-intent values through a reusable lighting shape', () => {
    expect(WORLD_SPRITE_ISO_LIGHTING_SHAPE).toEqual({
      topBrightnessBoost: WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST,
      lowerFrontDarkening: WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING,
      sideToSideBias: WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS,
      footBaseDarkening: WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING,
      minBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER,
      maxBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER,
    })
  })

  it('keeps the planned sprite lighting subtle around neutral brightness', () => {
    expect(WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST).toBeGreaterThan(0)
    expect(WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST).toBeLessThanOrEqual(0.08)
    expect(WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING).toBeGreaterThan(0)
    expect(WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING).toBeLessThanOrEqual(0.08)
    expect(WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS).toBeGreaterThan(0)
    expect(WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS).toBeLessThanOrEqual(0.05)
    expect(WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING).toBeGreaterThan(0)
    expect(WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING).toBeLessThanOrEqual(0.06)
  })

  it('bounds combined lighting multipliers without heavy recolouring', () => {
    const brightestPlannedMultiplier = 1 + WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST
    const darkestPlannedMultiplier = 1
      - WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING
      - WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS
      - WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING

    expect(WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER).toBeGreaterThanOrEqual(0.85)
    expect(WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER).toBeLessThan(1)
    expect(WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER).toBeGreaterThan(1)
    expect(WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER).toBeLessThanOrEqual(1.1)
    expect(darkestPlannedMultiplier).toBeGreaterThanOrEqual(
      WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER,
    )
    expect(brightestPlannedMultiplier).toBeLessThanOrEqual(
      WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER,
    )
  })
})
