import * as THREE from 'three'
import type { SpriteCrop } from '~/types/pokemon'

export const configureSpriteTexture = (texture: THREE.Texture) => {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
}

export const spriteCropCacheKey = (url: string, crop: SpriteCrop) => [
  url,
  crop.canvasWidth,
  crop.canvasHeight,
  crop.left,
  crop.top,
  crop.width,
  crop.height,
].join('|')

export const applySpriteTextureCrop = (texture: THREE.Texture, crop: SpriteCrop) => {
  texture.repeat.set(crop.width / crop.canvasWidth, crop.height / crop.canvasHeight)
  texture.offset.set(
    crop.left / crop.canvasWidth,
    1 - (crop.top + crop.height) / crop.canvasHeight,
  )
  texture.needsUpdate = true
}
