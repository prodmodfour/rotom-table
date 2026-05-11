import * as THREE from 'three'
import type { MapVoxelV2 } from '~/types/map'
import { getMaterialDefinition, materialColorNumber } from '~/utils/mapMaterials'
import { parseHexColor, voxelMaterialDefinition, voxelMaterialId } from '~/utils/voxels'
import {
  blockHexCss,
  hashString,
  jitterBlockColor,
  mixBlockColor,
  pixelNoise,
  shadeBlockColor,
  shiftBlockColor,
  type BlockTextureRole,
} from './blockTextureColors'
export { blockHexCss }
export type { BlockTextureRole }

/**
 * Minecraft-inspired terrain textures.
 *
 * We generate tiny 16×16 pixel-art maps at runtime instead of bundling
 * or downloading Mojang's copyrighted files. The look is intentionally
 * blocky/voxel-like: nearest-neighbour filtering, noisy pixel clusters,
 * grass-over-dirt sides, bark rings, lava cracks, etc.
 */
export type VoxelRenderStyle = Pick<MapVoxelV2, 'materialId' | 'color'>

const BLOCK_TEXTURE_SIZE = 16
export const BLOCK_FACE_ROLES: ReadonlyArray<BlockTextureRole> = [
  'shadow', // +X
  'shadow', // -X
  'top',    // +Y
  'bottom', // -Y
  'side',   // +Z
  'side',   // -Z
]
const blockTextureCache = new Map<string, THREE.Texture>()
const CLEAR_WATER_TEXTURE_PACK = 'clear-water-4.0'
const CLEAR_WATER_TEXTURE_URL_BY_ROLE: Record<BlockTextureRole, string> = {
  top: '/textures/clear-water-4.0/water-top.png',
  side: '/textures/clear-water-4.0/water-side.png',
  shadow: '/textures/clear-water-4.0/water-shadow.png',
  bottom: '/textures/clear-water-4.0/water-bottom.png',
}
let blockTextureLoader: THREE.TextureLoader | null = null

const configureBlockTexture = (texture: THREE.Texture, markNeedsUpdate = true): THREE.Texture => {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  if (markNeedsUpdate) texture.needsUpdate = true
  return texture
}

const getBlockTextureLoader = (): THREE.TextureLoader => {
  if (!blockTextureLoader) blockTextureLoader = new THREE.TextureLoader()
  return blockTextureLoader
}

const getClearWaterPackTexture = (role: BlockTextureRole): THREE.Texture => {
  const key = `${CLEAR_WATER_TEXTURE_PACK}:${role}`
  const cached = blockTextureCache.get(key)
  if (cached) return cached

  const url = CLEAR_WATER_TEXTURE_URL_BY_ROLE[role]
  const texture = getBlockTextureLoader().load(
    url,
    (loaded) => {
      configureBlockTexture(loaded)
    },
    undefined,
    (error) => {
      console.warn('Failed to load clear-water block texture', url, error)
    },
  )
  configureBlockTexture(texture, false)
  blockTextureCache.set(key, texture)
  return texture
}

const putBlockPixel = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: number,
) => {
  ctx.fillStyle = blockHexCss(color)
  ctx.fillRect(x, y, 1, 1)
}

const SIDE_DEPTH_MAX_ALPHA: Record<BlockTextureRole, number> = {
  top: 0,
  side: 0.16,
  shadow: 0.24,
  bottom: 0.28,
}

const sideDepthOverlayScale = (style: VoxelRenderStyle, isCustom: boolean): number => {
  if (isCustom) return 0.78
  const definition = voxelMaterialDefinition(style)
  const tags = new Set(definition.tags ?? [])

  if (tags.has('water') || tags.has('glass') || definition.transparent) return 0.5
  if (tags.has('thermal') || tags.has('emissive')) return 0.52
  if (tags.has('snow') || tags.has('ice')) return 0.66
  if (tags.has('sand')) return 0.9
  if (tags.has('metal')) return 1.08
  return 1
}

const drawSideDepthOverlay = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  intensity = 1,
) => {
  if (role === 'top') return

  const size = BLOCK_TEXTURE_SIZE
  const maxAlpha = SIDE_DEPTH_MAX_ALPHA[role] * intensity
  if (maxAlpha <= 0) return

  ctx.save()
  ctx.fillStyle = '#000000'
  for (let y = 0; y < size; y += 1) {
    const t = y / (size - 1)
    ctx.globalAlpha = Math.pow(t, 1.35) * maxAlpha
    ctx.fillRect(0, y, size, 1)
  }
  ctx.restore()

  // A one-pixel contact seam at the bottom of vertical faces makes
  // stacked blocks read as separate physical layers without adding UI.
  ctx.save()
  ctx.globalAlpha = (role === 'shadow' ? 0.34 : role === 'bottom' ? 0.3 : 0.26) * intensity
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, size - 1, size, 1)
  ctx.restore()

  // Subtle cap lip: a restrained highlight just under the top face.
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(1, 0, size - 2, 1)
  ctx.restore()
}

const drawBlockBorder = (ctx: CanvasRenderingContext2D, role: BlockTextureRole) => {
  const size = BLOCK_TEXTURE_SIZE
  ctx.save()

  if (role === 'top') {
    // Directional pixel rim instead of a uniform black box. This keeps
    // flat fields calm while still giving lit/back edges and lower/front
    // edges a subtle material cue.
    ctx.globalAlpha = 0.1
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, 1)
    ctx.fillRect(0, 0, 1, size)

    ctx.globalAlpha = 0.12
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, size - 1, size, 1)
    ctx.fillRect(size - 1, 0, 1, size)
    ctx.restore()
    return
  }

  ctx.globalAlpha = role === 'side' ? 0.09 : role === 'shadow' ? 0.12 : 0.14
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, 1, size)
  ctx.fillRect(size - 1, 0, 1, size)

  ctx.globalAlpha = role === 'side' ? 0.16 : role === 'shadow' ? 0.2 : 0.22
  ctx.fillRect(0, size - 1, size, 1)
  ctx.restore()
}

const paintDirtTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
  base = 0x8a5a32,
) => {
  const shaded = shadeBlockColor(base, role)
  const darkPebble = shadeBlockColor(0x5c3822, role)
  const warmPebble = shadeBlockColor(0xa46d3a, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const p = pixelNoise(seed ^ 0x4d3c2b1a, x, y)
      let color = jitterBlockColor(shaded, seed, x, y, 18)
      if (p > 0.91) color = jitterBlockColor(darkPebble, seed, x + 11, y, 8)
      else if (p < 0.08) color = jitterBlockColor(warmPebble, seed, x, y + 13, 8)
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintGrassTopTexture = (ctx: CanvasRenderingContext2D, seed: number) => {
  const colors = [0x4a8f24, 0x5da130, 0x6fb33f, 0x3e751d]
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const n = pixelNoise(seed, x, y)
      const idx = n > 0.82 ? 2 : n < 0.18 ? 3 : n > 0.55 ? 1 : 0
      putBlockPixel(ctx, x, y, jitterBlockColor(colors[idx], seed ^ 0x77aa33, x, y, 10))
    }
  }
}

const paintGrassSideTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  paintDirtTexture(ctx, role, seed ^ 0x12345678)
  const grassBase = shadeBlockColor(0x5da130, role)
  const grassDark = shadeBlockColor(0x3f7d20, role)
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const droop = pixelNoise(seed ^ 0x55aa55aa, x, 0)
      const edge = y < 3 || (y === 3 && droop > 0.28) || (y === 4 && droop > 0.72) || (y === 5 && droop > 0.9)
      if (!edge) continue
      const color = droop > 0.86 ? grassDark : grassBase
      putBlockPixel(ctx, x, y, jitterBlockColor(color, seed, x, y, 12))
    }
  }
}

const paintStoneTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  const shaded = shadeBlockColor(0x7d7d7d, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const large = pixelNoise(seed ^ 0x90909090, Math.floor(x / 2), Math.floor(y / 2))
      const fine = pixelNoise(seed, x, y)
      let color = jitterBlockColor(shaded, seed, x, y, 22)
      if (large > 0.78) color = shiftBlockColor(color, 22)
      if (large < 0.2) color = shiftBlockColor(color, -20)
      if (fine > 0.94) color = shiftBlockColor(color, -30)
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintWaterTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  const base = shadeBlockColor(0x2e77d0, role)
  const light = shadeBlockColor(0x5aa7ff, role)
  const deep = shadeBlockColor(0x194f9c, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const wave = (x * 3 + y * 2 + Math.floor(pixelNoise(seed, x, y) * 4)) % 9
      const color = wave < 2 ? light : wave > 6 ? deep : jitterBlockColor(base, seed, x, y, 10)
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintSandTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  const shaded = shadeBlockColor(0xd5c16b, role)
  const pale = shadeBlockColor(0xeadf9a, role)
  const dark = shadeBlockColor(0xb99a4f, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const n = pixelNoise(seed, x, y)
      let color = jitterBlockColor(shaded, seed, x, y, 12)
      if (n > 0.9) color = dark
      else if (n < 0.1) color = pale
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintSnowTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  const base = shadeBlockColor(role === 'top' ? 0xf4fbff : 0xdcebf4, role)
  const blue = shadeBlockColor(0xc6d9e9, role)
  const white = shadeBlockColor(0xffffff, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const n = pixelNoise(seed, x, y)
      const color = n > 0.88 ? blue : n < 0.12 ? white : jitterBlockColor(base, seed, x, y, 8)
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintWoodTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  if (role === 'top' || role === 'bottom') {
    const center = (BLOCK_TEXTURE_SIZE - 1) / 2
    for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
      for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
        const dx = x - center
        const dy = y - center
        const dist = Math.sqrt(dx * dx + dy * dy)
        const ring = Math.floor(dist * 1.65 + pixelNoise(seed, x, y) * 1.8) % 2
        const base = ring ? 0xa76b32 : 0xc18645
        putBlockPixel(ctx, x, y, jitterBlockColor(shadeBlockColor(base, role), seed, x, y, 10))
      }
    }
    return
  }

  const base = shadeBlockColor(0x8f5529, role)
  const dark = shadeBlockColor(0x5c321d, role)
  const light = shadeBlockColor(0xb87835, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const stripe = (x + Math.floor(pixelNoise(seed ^ 0x40404040, x, 0) * 3)) % 5
      const crack = pixelNoise(seed ^ 0x7f4a1d, x, Math.floor(y / 2)) > 0.88
      const color = crack || stripe === 0 ? dark : stripe === 2 ? light : jitterBlockColor(base, seed, x, y, 12)
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintLavaTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  const red = shadeBlockColor(0xb73618, role)
  const orange = shadeBlockColor(0xff6d1a, role)
  const yellow = shadeBlockColor(0xffd35a, role)
  const dark = shadeBlockColor(0x6f1d10, role)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const crack = (x + y + Math.floor(pixelNoise(seed, x, y) * 3)) % 7 === 0
      const n = pixelNoise(seed ^ 0xff6600, x, y)
      let color = n > 0.72 ? orange : n < 0.15 ? dark : red
      if (crack || n > 0.9) color = yellow
      putBlockPixel(ctx, x, y, jitterBlockColor(color, seed, x, y, 6))
    }
  }
}

const paintPathTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
) => {
  if (role !== 'top') {
    paintDirtTexture(ctx, role, seed ^ 0x22334455, 0x7a4f2f)
    return
  }

  const base = 0x9b7653
  const light = 0xb99568
  const stone = 0x7d7365
  const dark = 0x6e5138
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const n = pixelNoise(seed, x, y)
      let color = jitterBlockColor(base, seed, x, y, 16)
      if (n > 0.9) color = stone
      else if (n < 0.12) color = light
      else if (n > 0.75) color = dark
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const paintCustomTexture = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  seed: number,
  baseColor: number,
) => {
  const shaded = shadeBlockColor(baseColor, role)
  const highlight = mixBlockColor(shaded, 0xffffff, 0.18)
  const lowlight = mixBlockColor(shaded, 0x000000, 0.18)
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_TEXTURE_SIZE; x += 1) {
      const n = pixelNoise(seed, x, y)
      let color = jitterBlockColor(shaded, seed, x, y, 14)
      if (n > 0.9) color = lowlight
      else if (n < 0.1) color = highlight
      putBlockPixel(ctx, x, y, color)
    }
  }
}

const getBlockTexture = (style: VoxelRenderStyle, role: BlockTextureRole): THREE.Texture => {
  const parsedCustomColor = style.color ? parseHexColor(style.color) : null
  const isCustom = parsedCustomColor !== null
  const materialId = voxelMaterialId(style)
  const definition = getMaterialDefinition(materialId)
  const tags = new Set(definition.tags ?? [])
  if (!isCustom && tags.has('water') && definition.texture === CLEAR_WATER_TEXTURE_PACK) {
    return getClearWaterPackTexture(role)
  }
  const baseColor = isCustom ? parsedCustomColor : materialColorNumber(definition)
  const styleKey = isCustom
    ? `custom:${baseColor.toString(16).padStart(6, '0')}`
    : materialId
  const key = `${styleKey}:${role}`
  const cached = blockTextureCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = BLOCK_TEXTURE_SIZE
  canvas.height = BLOCK_TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  ctx.imageSmoothingEnabled = false

  const seed = hashString(`${key}:${baseColor.toString(16)}`)
  if (isCustom) {
    paintCustomTexture(ctx, role, seed, baseColor)
  } else {
    if (tags.has('grass') || materialId === 'meadow_grass') {
      if (role === 'top') paintGrassTopTexture(ctx, seed)
      else if (role === 'bottom') paintDirtTexture(ctx, role, seed)
      else paintGrassSideTexture(ctx, role, seed)
    } else if (tags.has('dirt') || tags.has('mud') || tags.has('wetland')) {
      paintDirtTexture(ctx, role, seed, baseColor)
    } else if (tags.has('stone') || tags.has('cave')) {
      paintStoneTexture(ctx, role, seed)
    } else if (tags.has('water')) {
      paintWaterTexture(ctx, role, seed)
    } else if (tags.has('snow') || tags.has('ice')) {
      paintSnowTexture(ctx, role, seed)
    } else if (tags.has('sand')) {
      paintSandTexture(ctx, role, seed)
    } else if (tags.has('wood')) {
      paintWoodTexture(ctx, role, seed)
    } else if (tags.has('thermal') || tags.has('emissive')) {
      paintLavaTexture(ctx, role, seed)
    } else if (tags.has('hazard') || materialId === 'hazard_stripe_floor') {
      paintPathTexture(ctx, role, seed)
      if (role === 'top') {
        ctx.save()
        ctx.globalAlpha = 0.9
        for (let x = -BLOCK_TEXTURE_SIZE; x < BLOCK_TEXTURE_SIZE * 2; x += 6) {
          ctx.fillStyle = '#1d2021'
          ctx.fillRect(x, 0, 3, BLOCK_TEXTURE_SIZE)
        }
        ctx.restore()
      }
    } else if (tags.has('metal') || tags.has('tile') || tags.has('medical') || tags.has('electric') || tags.has('poison')) {
      paintCustomTexture(ctx, role, seed, baseColor)
      if (role === 'top') {
        ctx.save()
        ctx.globalAlpha = tags.has('medical') ? 0.16 : 0.22
        ctx.strokeStyle = tags.has('electric') ? '#83a9ff' : tags.has('poison') ? '#b8f48a' : '#ffffff'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, 8)
        ctx.lineTo(16, 8)
        ctx.moveTo(8, 0)
        ctx.lineTo(8, 16)
        ctx.stroke()
        ctx.restore()
      }
    } else {
      paintCustomTexture(ctx, role, seed, baseColor)
    }
  }
  drawSideDepthOverlay(ctx, role, sideDepthOverlayScale(style, isCustom))
  drawBlockBorder(ctx, role)

  const texture = configureBlockTexture(new THREE.CanvasTexture(canvas))
  blockTextureCache.set(key, texture)
  return texture
}

export const disposeBlockTextureCache = () => {
  for (const texture of blockTextureCache.values()) texture.dispose()
  blockTextureCache.clear()
}

export const applyVoxelFaceMaterialStyle = (
  materials: THREE.MeshBasicMaterial[],
  style: VoxelRenderStyle,
  opacity: number,
  depthWrite: boolean,
) => {
  const definition = getMaterialDefinition(voxelMaterialId(style))
  const tags = new Set(definition.tags ?? [])
  const tint = !style.color && definition.texture === CLEAR_WATER_TEXTURE_PACK
    // The pack enables strong biome water-color contribution; keep the
    // same clear-water texture, but tint deep water much harder so the
    // lagoon's dark-blue sections remain visually distinct.
    ? mixBlockColor(0xffffff, materialColorNumber(definition), tags.has('deep') ? 0.7 : 0.22)
    : 0xffffff

  for (let i = 0; i < materials.length; i += 1) {
    const material = materials[i]
    const texture = getBlockTexture(style, BLOCK_FACE_ROLES[i])
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    material.color.setHex(tint)
    material.opacity = opacity
    material.transparent = opacity < 1
    material.depthTest = true
    material.depthWrite = depthWrite
  }
}
