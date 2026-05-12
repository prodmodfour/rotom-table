import type * as THREE from 'three'
import { DEFAULT_FACING_DIRECTION } from '~/utils/isometric/cameraControls'
import {
  WORLD_SPRITE_HALO_MAX_ALPHA,
  WORLD_SPRITE_HALO_MIN_ALPHA,
} from '~/utils/isometric/worldSpriteLighting'

export const ISOMETRIC_SPRITE_BRIGHTNESS_LIT = 1.0
export const ISOMETRIC_SPRITE_BRIGHTNESS_SHADOW = 0.92

type XzPoint = Pick<THREE.Vector3, 'x' | 'z'>
type XzDirection = Pick<THREE.Vector2, 'x' | 'y'>

export interface IsometricSpriteLightingOptions {
  cameraPosition: XzPoint
  target: XzPoint
  facingDirection?: XzDirection
  litBrightness?: number
  shadowBrightness?: number
  haloMinAlpha?: number
  haloMaxAlpha?: number
}

export interface IsometricSpriteLighting {
  lightAlignment: number
  lightAlignment01: number
  spriteBrightness: number
  haloAlpha: number
}

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount

export const getIsometricSpriteLighting = ({
  cameraPosition,
  target,
  facingDirection = DEFAULT_FACING_DIRECTION,
  litBrightness = ISOMETRIC_SPRITE_BRIGHTNESS_LIT,
  shadowBrightness = ISOMETRIC_SPRITE_BRIGHTNESS_SHADOW,
  haloMinAlpha = WORLD_SPRITE_HALO_MIN_ALPHA,
  haloMaxAlpha = WORLD_SPRITE_HALO_MAX_ALPHA,
}: IsometricSpriteLightingOptions): IsometricSpriteLighting => {
  const x = cameraPosition.x - target.x
  const z = cameraPosition.z - target.z
  const length = Math.hypot(x, z)
  const lightAlignment = length > 0
    ? ((x / length) * facingDirection.x) + ((z / length) * facingDirection.y)
    : 1
  const lightAlignment01 = (lightAlignment + 1) / 2

  return {
    lightAlignment,
    lightAlignment01,
    spriteBrightness: lerp(shadowBrightness, litBrightness, lightAlignment01),
    haloAlpha: lerp(haloMinAlpha, haloMaxAlpha, lightAlignment01),
  }
}
