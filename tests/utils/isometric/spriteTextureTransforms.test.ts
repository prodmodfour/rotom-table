import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SpriteCrop } from '~/types/pokemon'
import {
  applySpriteTextureCrop,
  configureSpriteTexture,
  spriteCropCacheKey,
} from '~/utils/isometric/spriteTextureTransforms'

const crop: SpriteCrop = {
  canvasWidth: 128,
  canvasHeight: 64,
  left: 16,
  top: 8,
  width: 32,
  height: 24,
}

describe('sprite texture transform helpers', () => {
  it('configures sprite textures with pixel-art filtering and sRGB color space', () => {
    const texture = new THREE.Texture()

    configureSpriteTexture(texture)

    expect(texture.magFilter).toBe(THREE.NearestFilter)
    expect(texture.minFilter).toBe(THREE.NearestFilter)
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.version).toBe(1)
  })

  it('builds stable cache keys for cropped sprite clones', () => {
    expect(spriteCropCacheKey('/sprites/front.png', crop)).toBe('/sprites/front.png|128|64|16|8|32|24')
  })

  it('applies crop repeat and offset coordinates using canvas-space input', () => {
    const texture = new THREE.Texture()

    applySpriteTextureCrop(texture, crop)

    expect(texture.repeat.x).toBeCloseTo(0.25)
    expect(texture.repeat.y).toBeCloseTo(0.375)
    expect(texture.offset.x).toBeCloseTo(0.125)
    expect(texture.offset.y).toBeCloseTo(0.5)
    expect(texture.version).toBe(1)
  })
})
