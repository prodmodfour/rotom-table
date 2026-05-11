import * as THREE from 'three'
import type { SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import {
  applySpriteTextureCrop,
  configureSpriteTexture,
  spriteCropCacheKey,
} from '~/utils/isometric/spriteTextureTransforms'

/**
 * Lazily-built radial-gradient texture for sprite contact shadows. A
 * soft dark blob laid flat on the floor under each pokemon — the
 * "this thing is sitting on the world" cue the cage alone can't give.
 * Tinted ``bg0_h`` (warm near-black, same as floor seam lines) so the
 * shadow blends into the gruvbox palette instead of reading as a hard
 * black decal.
 */
let contactShadowTexture: THREE.CanvasTexture | null = null

export const getContactShadowTexture = (): THREE.CanvasTexture => {
  if (contactShadowTexture) return contactShadowTexture
  const canvas = document.createElement('canvas')
  const size = 128
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  const center = size / 2
  // Radial fade from opaque core to fully-transparent rim. The 0.85
  // stop ensures the geometry's edge sits in transparent territory so
  // the disc has no visible boundary.
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0,    'rgba(29, 32, 33, 0.78)') // bg0_h core
  gradient.addColorStop(0.55, 'rgba(29, 32, 33, 0.42)')
  gradient.addColorStop(0.85, 'rgba(29, 32, 33, 0)')
  gradient.addColorStop(1,    'rgba(29, 32, 33, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  contactShadowTexture = texture
  return texture
}

/** Directional sprite glow that replaces the old CSS drop-shadow. */
let spriteHaloTexture: THREE.CanvasTexture | null = null

export const getSpriteHaloTexture = (): THREE.CanvasTexture => {
  if (spriteHaloTexture) return spriteHaloTexture
  const canvas = document.createElement('canvas')
  const size = 128
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  const center = size / 2
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(250, 189, 47, 0.46)')
  gradient.addColorStop(0.45, 'rgba(250, 189, 47, 0.22)')
  gradient.addColorStop(0.82, 'rgba(250, 189, 47, 0.04)')
  gradient.addColorStop(1, 'rgba(250, 189, 47, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  spriteHaloTexture = texture
  return texture
}

let transparentSpriteTexture: THREE.CanvasTexture | null = null

export const getTransparentSpriteTexture = (): THREE.CanvasTexture => {
  if (transparentSpriteTexture) return transparentSpriteTexture
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const texture = new THREE.CanvasTexture(canvas)
  configureSpriteTexture(texture)
  transparentSpriteTexture = texture
  return texture
}

export interface SpriteVisualAsset {
  url: string
  animation?: SpriteAnimation
  crop?: SpriteCrop
}

export interface TextureHandle {
  promise: Promise<THREE.Texture>
  release: () => void
}

interface CachedTextureRecord {
  promise: Promise<THREE.Texture>
  texture?: THREE.Texture
}

interface RefCountedTextureRecord extends CachedTextureRecord {
  refs: number
}

const spriteTextureLoader = new THREE.TextureLoader()
const baseSpriteTextureCache = new Map<string, CachedTextureRecord>()
const croppedSpriteTextureCache = new Map<string, RefCountedTextureRecord>()
const loadBaseSpriteTexture = (url: string): Promise<THREE.Texture> => {
  const cached = baseSpriteTextureCache.get(url)
  if (cached) return cached.promise

  const record: CachedTextureRecord = { promise: Promise.resolve(null as never) }
  record.promise = new Promise<THREE.Texture>((resolve, reject) => {
    spriteTextureLoader.load(
      url,
      (texture) => {
        configureSpriteTexture(texture)
        record.texture = texture
        resolve(texture)
      },
      undefined,
      (error) => {
        baseSpriteTextureCache.delete(url)
        reject(error)
      },
    )
  })
  baseSpriteTextureCache.set(url, record)
  return record.promise
}

export const acquireStaticSpriteTexture = (url: string, crop?: SpriteCrop): TextureHandle => {
  if (!crop) {
    return {
      promise: loadBaseSpriteTexture(url),
      release: () => {},
    }
  }

  const key = spriteCropCacheKey(url, crop)
  let record = croppedSpriteTextureCache.get(key)
  if (!record) {
    const newRecord: RefCountedTextureRecord = {
      refs: 0,
      promise: Promise.resolve(null as never),
    }
    newRecord.promise = loadBaseSpriteTexture(url).then((baseTexture) => {
      const texture = baseTexture.clone()
      configureSpriteTexture(texture)
      applySpriteTextureCrop(texture, crop)
      newRecord.texture = texture
      if (newRecord.refs <= 0) {
        texture.dispose()
      }
      return texture
    })
    record = newRecord
    croppedSpriteTextureCache.set(key, record)
  }

  record.refs += 1
  let released = false
  return {
    promise: record.promise,
    release: () => {
      if (released) return
      released = true
      record!.refs -= 1
      if (record!.refs <= 0) {
        croppedSpriteTextureCache.delete(key)
        record!.promise.then((texture) => texture.dispose()).catch(() => {})
      }
    },
  }
}

export const acquireAnimatedSpriteTexture = (url: string): TextureHandle => {
  let released = false
  const promise = loadBaseSpriteTexture(url).then((baseTexture) => {
    // Animation updates mutate texture.repeat/offset, so every token gets
    // its own clone while sharing the decoded image source from the cache.
    const texture = baseTexture.clone()
    configureSpriteTexture(texture)
    if (released) texture.dispose()
    return texture
  })

  return {
    promise,
    release: () => {
      if (released) return
      released = true
      promise.then((texture) => texture.dispose()).catch(() => {})
    },
  }
}

export const disposeSpriteTextureCaches = () => {
  for (const record of croppedSpriteTextureCache.values()) {
    record.texture?.dispose()
  }
  croppedSpriteTextureCache.clear()
  for (const record of baseSpriteTextureCache.values()) {
    record.texture?.dispose()
  }
  baseSpriteTextureCache.clear()
}


export const disposeSpriteSharedTextures = () => {
  if (contactShadowTexture) {
    contactShadowTexture.dispose()
    contactShadowTexture = null
  }
  if (spriteHaloTexture) {
    spriteHaloTexture.dispose()
    spriteHaloTexture = null
  }
  if (transparentSpriteTexture) {
    transparentSpriteTexture.dispose()
    transparentSpriteTexture = null
  }
}
