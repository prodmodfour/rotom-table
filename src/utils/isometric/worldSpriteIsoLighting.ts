/**
 * Intent-only constants for the persistent UV-based fake-lighting pass on
 * normal world sprites. These values stay subtle so Pokémon gain a little
 * isometric shape without looking visibly recoloured.
 */
export const WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST = 0.06
export const WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING = 0.055
export const WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS = 0.035
export const WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING = 0.04
export const WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER = 0.86
export const WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER = 1.08

export interface WorldSpriteIsoLightingShape {
  topBrightnessBoost: number
  lowerFrontDarkening: number
  sideToSideBias: number
  footBaseDarkening: number
  minBrightnessMultiplier: number
  maxBrightnessMultiplier: number
}

export const WORLD_SPRITE_ISO_LIGHTING_SHAPE = Object.freeze({
  topBrightnessBoost: WORLD_SPRITE_ISO_LIGHTING_TOP_BRIGHTNESS_BOOST,
  lowerFrontDarkening: WORLD_SPRITE_ISO_LIGHTING_LOWER_FRONT_DARKENING,
  sideToSideBias: WORLD_SPRITE_ISO_LIGHTING_SIDE_TO_SIDE_BIAS,
  footBaseDarkening: WORLD_SPRITE_ISO_LIGHTING_FOOT_BASE_DARKENING,
  minBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_MIN_BRIGHTNESS_MULTIPLIER,
  maxBrightnessMultiplier: WORLD_SPRITE_ISO_LIGHTING_MAX_BRIGHTNESS_MULTIPLIER,
}) satisfies Readonly<WorldSpriteIsoLightingShape>
