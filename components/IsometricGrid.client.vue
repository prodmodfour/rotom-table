<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS3DRenderer, CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridAnchor, GridDimensions, SpawnedPokemon, SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import type { GridVoxel, VoxelMaterial } from '~/types/grid'
import type { PreviewState } from '~/utils/grid'
import { findPathForPokemon, getAnchorCenter, getPokemonCenter } from '~/utils/grid'
import {
  buildVoxelOccupancy,
  cellInsidePokemonFootprint,
  getMaterialDef,
  parseHexColor,
  voxelGroupKey,
  voxelKey,
} from '~/utils/voxels'
import { POKEMON_TYPES, computeMultiplier, formatMultiplier } from '~/utils/typeChart'

export type BuildTool = 'pencil' | 'eraser'

const props = defineProps<{
  dimensions: GridDimensions
  pokemons: SpawnedPokemon[]
  selectedId: string | null
  voxels: GridVoxel[]
  buildMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: { id: string; currentHp: number }): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: GridVoxel): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
}>()

interface WorldSpriteState {
  sprite: THREE.Sprite<THREE.SpriteMaterial>
  material: THREE.SpriteMaterial
  halo: THREE.Sprite<THREE.SpriteMaterial>
  haloMaterial: THREE.SpriteMaterial
  texture: THREE.Texture | null
  releaseTexture: (() => void) | null
  assetKey: string | null
  loadToken: number
  animationMeta: SpriteAnimation | null
  animationStartedAtMs: number
  currentFrame: number
  ghost: boolean
  invalid: boolean
}

interface PokemonRenderObject {
  id: string
  sprite: THREE.Sprite<THREE.SpriteMaterial>
  spriteState: WorldSpriteState
  elevationBadge: CSS3DSprite
  hpBar: CSS3DSprite
  /**
   * Volume box wrapping the pokemon's footprint × clearance. Uses a
   * 6-material array so we can paint each face with the gruvbox
   * top/left/right brightness ramp (see ``TERRAIN_PALETTE``).
   */
  volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]>
  edges: THREE.LineSegments
  proxy: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  /** Soft radial-gradient disc on the floor; the "planted on the ground" cue. */
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  currentCenter: THREE.Vector3
  targetCenter: THREE.Vector3
  width: number
  height: number
  base: number
  clearance: number
  elevation: number
  spriteUrl: string
  backSpriteUrl?: string
  spriteAnimation?: SpriteAnimation
  backSpriteAnimation?: SpriteAnimation
  spriteCrop?: SpriteCrop
  turned: boolean
  currentHp: number
  maxHp: number
  /** Eased 0→1 selection-lift factor; target flips on selection state. */
  liftFactor: number
  liftTarget: number
}

interface VoxelGroup {
  key: string
  geometry: THREE.BoxGeometry
  materials: THREE.MeshBasicMaterial[]
  mesh: THREE.InstancedMesh
  voxels: GridVoxel[]
}

interface BuildTarget {
  action: 'place' | 'remove'
  cell: { x: number; y: number; z: number }
  valid: boolean
}

/**
 * Gruvbox terrain palette for isometric face shading.
 *
 * The classic isometric trick is roughly 100 / 80 / 60 % brightness for
 * top / left / right faces. With gruvbox we step bg3 → bg2 → bg1
 * (and dark/neutral/bright for accent variants) so everything stays
 * in-palette without any literal HSL math.
 *
 * Opposite faces share roles so 90° azimuth rotations preserve the
 * lighting pattern: ±X faces are always the "shadow" axis, ±Z faces
 * are always the "side" axis, and ±Y is top/bottom.
 */
const TERRAIN_PALETTE = {
  idle: {
    // fg-band rather than bg-band so the cage sits visually above the
    // terrain's brightness range. Terrain pulls from gruvbox bg/mid,
    // sprites pull from bright accents — the cage takes the fg/grey
    // band in between, giving each layer its own zone instead of the
    // cage merging with the grid underneath it.
    top:    0xbdae93, // fg3 — lit top
    side:   0xa89984, // fg4 — Z-perp visible side
    shadow: 0x7c6f64, // bg4 — X-perp shadowed side (sharpened ramp so
                      //       top↔shadow contrast reads across the table)
    bottom: 0x665c54, // bg3 — floor of the cage (rarely seen)
  },
  selected: {
    top:    0xfabd2f, // yellow bright
    side:   0xd79921, // yellow neutral
    shadow: 0xb57614, // yellow faded
    bottom: 0x79740e, // yellow dim
  },
  reachable: {
    top:    0xfabd2f,
    side:   0xd79921,
    shadow: 0xb57614,
    bottom: 0x79740e,
  },
  unreachable: {
    top:    0xfb4934, // red bright
    side:   0xcc241d, // red neutral
    shadow: 0x9d0006, // red faded
    bottom: 0x79190f, // red dim
  },
} as const

type TerrainVariant = keyof typeof TERRAIN_PALETTE

/**
 * Build a 6-material array for a ``THREE.BoxGeometry`` with gruvbox
 * face shading. BoxGeometry face groups are ordered
 * ``+X, -X, +Y, -Y, +Z, -Z`` — we map opposing faces to the same role
 * so the box reads consistently regardless of camera azimuth.
 */
const buildVolumeMaterials = (
  variant: TerrainVariant,
  opacity: number,
): THREE.MeshBasicMaterial[] => {
  const palette = TERRAIN_PALETTE[variant]
  const make = (color: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      // Cages should disappear behind terrain, but their translucent
      // faces must not reserve depth and hide sprites/voxels drawn later.
      depthTest: true,
      depthWrite: false,
    })

  return [
    make(palette.shadow), // +X — "right" visible from default isometric
    make(palette.shadow), // -X — becomes "right" after 180° rotation
    make(palette.top),    // +Y — top
    make(palette.bottom), // -Y — bottom
    make(palette.side),   // +Z — "left" visible from default isometric
    make(palette.side),   // -Z — becomes "left" after 180° rotation
  ]
}

/**
 * Re-tint an existing per-face material array in place. Avoids
 * disposing/recreating materials when state flips (selected,
 * reachable, etc.).
 */
const paintVolumeMaterials = (
  materials: THREE.MeshBasicMaterial[],
  variant: TerrainVariant,
  opacity: number,
) => {
  const palette = TERRAIN_PALETTE[variant]
  const colors: ReadonlyArray<number> = [
    palette.shadow, // +X
    palette.shadow, // -X
    palette.top,    // +Y
    palette.bottom, // -Y
    palette.side,   // +Z
    palette.side,   // -Z
  ]
  for (let i = 0; i < materials.length; i += 1) {
    materials[i].color.setHex(colors[i])
    materials[i].opacity = opacity
    materials[i].transparent = opacity < 1
    materials[i].depthTest = true
    materials[i].depthWrite = false
  }
}

/**
 * Minecraft-inspired terrain textures.
 *
 * We generate tiny 16×16 pixel-art maps at runtime instead of bundling
 * or downloading Mojang's copyrighted files. The look is intentionally
 * blocky/voxel-like: nearest-neighbour filtering, noisy pixel clusters,
 * grass-over-dirt sides, bark rings, lava cracks, etc.
 */
type BlockTextureRole = 'top' | 'side' | 'shadow' | 'bottom'
type VoxelRenderStyle = Pick<GridVoxel, 'material' | 'color'>

const BLOCK_TEXTURE_SIZE = 16
const BLOCK_FACE_ROLES: ReadonlyArray<BlockTextureRole> = [
  'shadow', // +X
  'shadow', // -X
  'top',    // +Y
  'bottom', // -Y
  'side',   // +Z
  'side',   // -Z
]
const BLOCK_ROLE_SHADING: Record<BlockTextureRole, number> = {
  top: 1,
  side: 0.82,
  shadow: 0.62,
  bottom: 0.5,
}
const blockTextureCache = new Map<string, THREE.CanvasTexture>()

const blockHexCss = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

const clampColorByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

const scaleBlockColor = (hex: number, factor: number): number =>
  (clampColorByte(((hex >> 16) & 0xff) * factor) << 16) |
  (clampColorByte(((hex >> 8) & 0xff) * factor) << 8) |
  clampColorByte((hex & 0xff) * factor)

const shiftBlockColor = (hex: number, amount: number): number =>
  (clampColorByte(((hex >> 16) & 0xff) + amount) << 16) |
  (clampColorByte(((hex >> 8) & 0xff) + amount) << 8) |
  clampColorByte((hex & 0xff) + amount)

const mixBlockColor = (from: number, to: number, t: number): number => {
  const inv = 1 - t
  return (
    clampColorByte(((from >> 16) & 0xff) * inv + ((to >> 16) & 0xff) * t) << 16
  ) | (
    clampColorByte(((from >> 8) & 0xff) * inv + ((to >> 8) & 0xff) * t) << 8
  ) | clampColorByte((from & 0xff) * inv + (to & 0xff) * t)
}

const shadeBlockColor = (hex: number, role: BlockTextureRole): number =>
  scaleBlockColor(hex, BLOCK_ROLE_SHADING[role])

const hashString = (input: string): number => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const pixelNoise = (seed: number, x: number, y: number): number => {
  let n = seed ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0xc2b2ae35, 0x27d4eb2f)
  n ^= n >>> 15
  n = Math.imul(n, 0x2c1b3c6d)
  n ^= n >>> 12
  n = Math.imul(n, 0x297a2d39)
  n ^= n >>> 15
  return (n >>> 0) / 0xffffffff
}

const jitterBlockColor = (
  hex: number,
  seed: number,
  x: number,
  y: number,
  spread: number,
): number => shiftBlockColor(hex, Math.round((pixelNoise(seed, x, y) - 0.5) * spread * 2))

const putBlockPixel = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: number,
) => {
  ctx.fillStyle = blockHexCss(color)
  ctx.fillRect(x, y, 1, 1)
}

const drawBlockBorder = (ctx: CanvasRenderingContext2D, role: BlockTextureRole) => {
  const size = BLOCK_TEXTURE_SIZE
  ctx.save()
  ctx.globalAlpha = role === 'top' ? 0.24 : 0.18
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, 1)
  ctx.fillRect(0, size - 1, size, 1)
  ctx.fillRect(0, 0, 1, size)
  ctx.fillRect(size - 1, 0, 1, size)

  if (role === 'top') {
    ctx.globalAlpha = 0.1
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(1, 1, size - 2, 1)
    ctx.fillRect(1, 1, 1, size - 2)
  } else {
    ctx.globalAlpha = 0.16
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, size - 2, size, 1)
    ctx.fillRect(size - 2, 0, 1, size)
  }
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

const getBlockTexture = (style: VoxelRenderStyle, role: BlockTextureRole): THREE.CanvasTexture => {
  const parsedCustomColor = style.color ? parseHexColor(style.color) : null
  const isCustom = parsedCustomColor !== null
  const baseColor = isCustom ? parsedCustomColor : getMaterialDef(style.material).baseColor
  const styleKey = isCustom
    ? `custom:${baseColor.toString(16).padStart(6, '0')}`
    : style.material
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
    switch (style.material) {
      case 'grass':
        if (role === 'top') paintGrassTopTexture(ctx, seed)
        else if (role === 'bottom') paintDirtTexture(ctx, role, seed)
        else paintGrassSideTexture(ctx, role, seed)
        break
      case 'dirt':
        paintDirtTexture(ctx, role, seed)
        break
      case 'stone':
        paintStoneTexture(ctx, role, seed)
        break
      case 'water':
        paintWaterTexture(ctx, role, seed)
        break
      case 'sand':
        paintSandTexture(ctx, role, seed)
        break
      case 'snow':
        paintSnowTexture(ctx, role, seed)
        break
      case 'wood':
        paintWoodTexture(ctx, role, seed)
        break
      case 'lava':
        paintLavaTexture(ctx, role, seed)
        break
      case 'path':
        paintPathTexture(ctx, role, seed)
        break
      default:
        paintCustomTexture(ctx, role, seed, baseColor)
        break
    }
  }
  drawBlockBorder(ctx, role)

  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  blockTextureCache.set(key, texture)
  return texture
}

const disposeBlockTextureCache = () => {
  for (const texture of blockTextureCache.values()) texture.dispose()
  blockTextureCache.clear()
}

const applyVoxelFaceMaterialStyle = (
  materials: THREE.MeshBasicMaterial[],
  style: VoxelRenderStyle,
  opacity: number,
  depthWrite: boolean,
) => {
  for (let i = 0; i < materials.length; i += 1) {
    const material = materials[i]
    const texture = getBlockTexture(style, BLOCK_FACE_ROLES[i])
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    material.color.setHex(0xffffff)
    material.opacity = opacity
    material.transparent = opacity < 1
    material.depthTest = true
    material.depthWrite = depthWrite
  }
}

/**
 * Lazily-built radial-gradient texture for sprite contact shadows. A
 * soft dark blob laid flat on the floor under each pokemon — the
 * "this thing is sitting on the world" cue the cage alone can't give.
 * Tinted ``bg0_h`` (warm near-black, same as floor seam lines) so the
 * shadow blends into the gruvbox palette instead of reading as a hard
 * black decal.
 */
let contactShadowTexture: THREE.CanvasTexture | null = null

const getContactShadowTexture = (): THREE.CanvasTexture => {
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

const getSpriteHaloTexture = (): THREE.CanvasTexture => {
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

const getTransparentSpriteTexture = (): THREE.CanvasTexture => {
  if (transparentSpriteTexture) return transparentSpriteTexture
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const texture = new THREE.CanvasTexture(canvas)
  configureSpriteTexture(texture)
  transparentSpriteTexture = texture
  return texture
}

interface SpriteVisualAsset {
  url: string
  animation?: SpriteAnimation
  crop?: SpriteCrop
}

interface TextureHandle {
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

const configureSpriteTexture = (texture: THREE.Texture) => {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
}

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

const cropCacheKey = (url: string, crop: SpriteCrop) => [
  url,
  crop.canvasWidth,
  crop.canvasHeight,
  crop.left,
  crop.top,
  crop.width,
  crop.height,
].join('|')

const applyTextureCrop = (texture: THREE.Texture, crop: SpriteCrop) => {
  texture.repeat.set(crop.width / crop.canvasWidth, crop.height / crop.canvasHeight)
  texture.offset.set(
    crop.left / crop.canvasWidth,
    1 - (crop.top + crop.height) / crop.canvasHeight,
  )
  texture.needsUpdate = true
}

const acquireStaticSpriteTexture = (url: string, crop?: SpriteCrop): TextureHandle => {
  if (!crop) {
    return {
      promise: loadBaseSpriteTexture(url),
      release: () => {},
    }
  }

  const key = cropCacheKey(url, crop)
  let record = croppedSpriteTextureCache.get(key)
  if (!record) {
    const newRecord: RefCountedTextureRecord = {
      refs: 0,
      promise: Promise.resolve(null as never),
    }
    newRecord.promise = loadBaseSpriteTexture(url).then((baseTexture) => {
      const texture = baseTexture.clone()
      configureSpriteTexture(texture)
      applyTextureCrop(texture, crop)
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

const acquireAnimatedSpriteTexture = (url: string): TextureHandle => {
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

const disposeSpriteTextureCaches = () => {
  for (const record of croppedSpriteTextureCache.values()) {
    record.texture?.dispose()
  }
  croppedSpriteTextureCache.clear()
  for (const record of baseSpriteTextureCache.values()) {
    record.texture?.dispose()
  }
  baseSpriteTextureCache.clear()
}

/**
 * Build a 6-material array for a textured voxel block. BoxGeometry face
 * groups are ordered ``+X, -X, +Y, -Y, +Z, -Z``; each face gets the
 * matching Minecraft-style pixel texture from ``BLOCK_FACE_ROLES``.
 */
const buildVoxelFaceMaterials = (
  style: VoxelRenderStyle,
  opacity = 1,
  depthWrite = true,
): THREE.MeshBasicMaterial[] => {
  const materials = BLOCK_FACE_ROLES.map(() => new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: opacity < 1,
    opacity,
    // Terrain voxels are the occluders for sprites/cages, so normal
    // blocks write depth. Preview ghosts opt out via ``depthWrite``.
    depthTest: true,
    depthWrite,
  }))
  applyVoxelFaceMaterialStyle(materials, style, opacity, depthWrite)
  return materials
}

/**
 * Re-skin the build ghost in place. This lets the preview switch
 * between the active block texture and a red blocked/erase texture
 * without recreating its mesh every pointer move.
 */
const paintBuildGhostMaterials = (
  materials: THREE.MeshBasicMaterial[],
  style: VoxelRenderStyle,
  opacity: number,
) => {
  applyVoxelFaceMaterialStyle(materials, style, opacity, false)
}

const ELEVATION_BADGE_PIXELS_PER_METRE = 48
const HP_BAR_PIXELS_PER_METRE = 48
const ISO_POLAR_ANGLE = THREE.MathUtils.degToRad(54.735610317245346)
const ISO_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45)
const DEFAULT_FACING_DIRECTION = new THREE.Vector2(
  Math.cos(ISO_AZIMUTH_ANGLE),
  Math.sin(ISO_AZIMUTH_ANGLE),
)

// Subtle directional tint matching the cage's implied light: lit
// quadrant is full brightness, shadowed quadrant dims to 0.92.
// Applied to WebGL sprite material colors.
const SPRITE_BRIGHTNESS_LIT = 1.0
const SPRITE_BRIGHTNESS_SHADOW = 0.92

// Selection lift: selected pokemon pops up while the shadow stays
// anchored and grows more diffuse. Visible separation between sprite
// and shadow is the strongest "this thing is in 3D" cue available.
const SPRITE_LIFT_AMOUNT = 0.08
const SHADOW_LIFT_SCALE = 1.3
const SHADOW_LIFT_OPACITY = 0.55

// Slight ellipse along the cage's shadow axis (±X). Mimics how shadows
// fall away from a light source instead of reading as a perfect circle.
const SHADOW_X_STRETCH = 1.15

// Directional halo: replaces the wrapper's static yellow halo with one
// that breathes with camera angle — brighter when the sprite faces the
// implied light, dimmer (not zero) when backlit. Same gruvbox yellow
// the wrapper used to have, just responsive now. One halo that means
// something instead of two halos compounding.
const SPRITE_HALO_MIN_ALPHA = 0.1
const SPRITE_HALO_MAX_ALPHA = 0.28

const EMPTY_PREVIEW: PreviewState = {
  position: null,
  reachable: false,
  pathLength: 0,
}

interface DamageBaseDef {
  db: number
  count: number
  sides: number
  mod: number
}

// PTU PHB Damage Base table. Mods are always positive in this table; the
// formatter assumes that and skips a +0 suffix only because no entry has it.
const DAMAGE_BASE_TABLE: DamageBaseDef[] = [
  { db: 1,  count: 1, sides: 6,  mod: 1 },
  { db: 2,  count: 1, sides: 6,  mod: 3 },
  { db: 3,  count: 1, sides: 6,  mod: 5 },
  { db: 4,  count: 1, sides: 6,  mod: 7 },
  { db: 5,  count: 1, sides: 8,  mod: 8 },
  { db: 6,  count: 2, sides: 6,  mod: 8 },
  { db: 7,  count: 2, sides: 6,  mod: 10 },
  { db: 8,  count: 2, sides: 8,  mod: 10 },
  { db: 9,  count: 2, sides: 10, mod: 10 },
  { db: 10, count: 3, sides: 8,  mod: 10 },
  { db: 11, count: 3, sides: 10, mod: 10 },
  { db: 12, count: 3, sides: 12, mod: 10 },
  { db: 13, count: 4, sides: 10, mod: 10 },
  { db: 14, count: 4, sides: 10, mod: 15 },
  { db: 15, count: 4, sides: 10, mod: 20 },
  { db: 16, count: 5, sides: 10, mod: 20 },
  { db: 17, count: 5, sides: 12, mod: 25 },
  { db: 18, count: 6, sides: 12, mod: 25 },
  { db: 19, count: 6, sides: 12, mod: 30 },
  { db: 20, count: 6, sides: 12, mod: 35 },
  { db: 21, count: 6, sides: 12, mod: 40 },
  { db: 22, count: 6, sides: 12, mod: 45 },
  { db: 23, count: 6, sides: 12, mod: 50 },
  { db: 24, count: 7, sides: 12, mod: 50 },
  { db: 25, count: 8, sides: 12, mod: 50 },
  { db: 26, count: 8, sides: 12, mod: 55 },
  { db: 27, count: 8, sides: 12, mod: 60 },
  { db: 28, count: 8, sides: 12, mod: 65 },
]

const formatDbFormula = (def: DamageBaseDef): string =>
  `${def.count}d${def.sides}+${def.mod}`

const rollDamageBase = (def: DamageBaseDef): { rolls: number[]; total: number } => {
  const rolls: number[] = []
  for (let i = 0; i < def.count; i += 1) {
    rolls.push(1 + Math.floor(Math.random() * def.sides))
  }
  const total = rolls.reduce((sum, n) => sum + n, 0) + def.mod
  return { rolls, total }
}

const container = ref<HTMLDivElement | null>(null)
const contextMenu = ref<{ x: number; y: number; id: string; canTurn: boolean } | null>(null)

interface HpDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  mode: 'damage' | 'heal'
  amount: string
}

const hpDialog = ref<HpDialogState | null>(null)
const hpAmountInput = ref<HTMLInputElement | null>(null)

const hpDialogDelta = computed(() => {
  if (!hpDialog.value) return 0
  const parsed = Number.parseInt(hpDialog.value.amount, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return hpDialog.value.mode === 'damage' ? -parsed : parsed
})

const hpDialogPreview = computed(() => {
  if (!hpDialog.value) return 0
  const next = hpDialog.value.currentHp + hpDialogDelta.value
  return Math.max(0, Math.min(hpDialog.value.maxHp, next))
})

interface DamageRollResult {
  db: number
  formula: string
  rolls: number[]
  mod: number
  total: number
}

interface DamageDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  def: number
  sdef: number
  defenderTypes: string[]
  mode: 'physical' | 'special'
  attackType: string
  source: 'flat' | 'db'
  amount: string
  db: number
  roll: DamageRollResult | null
  attackerId: string | null
}

const damageDialog = ref<DamageDialogState | null>(null)
const damageAmountInput = ref<HTMLInputElement | null>(null)

const damageDialogDbDef = computed(() => {
  if (!damageDialog.value) return null
  return DAMAGE_BASE_TABLE.find((entry) => entry.db === damageDialog.value!.db) ?? null
})

const damageDialogRawAmount = computed(() => {
  if (!damageDialog.value) return 0
  if (damageDialog.value.source === 'db') {
    return damageDialog.value.roll?.total ?? 0
  }
  const parsed = Number.parseInt(damageDialog.value.amount, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
})

const damageDialogDefense = computed(() => {
  if (!damageDialog.value) return 0
  return damageDialog.value.mode === 'physical'
    ? damageDialog.value.def
    : damageDialog.value.sdef
})

// Tokens on the grid the user can pick as the attacker, sorted by
// display name so the dropdown reads alphabetically.
const damageDialogAttackerOptions = computed(() =>
  [...props.pokemons].sort((a, b) => a.species.localeCompare(b.species)),
)

const damageDialogAttacker = computed(() => {
  if (!damageDialog.value?.attackerId) return null
  return props.pokemons.find((p) => p.id === damageDialog.value!.attackerId) ?? null
})

// Atk / Sp.Atk added to the rolled total. Only applied in DB mode —
// flat damage assumes the user already baked the offence stat in.
const damageDialogAttackBonus = computed(() => {
  if (!damageDialog.value || damageDialog.value.source !== 'db') return 0
  const attacker = damageDialogAttacker.value
  if (!attacker) return 0
  return damageDialog.value.mode === 'physical' ? attacker.atk : attacker.satk
})

const damageDialogMultiplier = computed(() => {
  if (!damageDialog.value) return 1
  return computeMultiplier(damageDialog.value.attackType, damageDialog.value.defenderTypes)
})

const damageDialogHpLoss = computed(() => {
  if (damageDialogRawAmount.value === 0) return 0
  // Immunity short-circuits before the 1-floor — a 0× hit deals 0.
  if (damageDialogMultiplier.value === 0) return 0
  const beforeDefense = damageDialogRawAmount.value + damageDialogAttackBonus.value
  const afterDefense = beforeDefense - damageDialogDefense.value
  const scaled = Math.floor(afterDefense * damageDialogMultiplier.value)
  // PTU floor: any successful hit deals at least 1 HP regardless of defense.
  return Math.max(1, scaled)
})

const damageDialogPreview = computed(() => {
  if (!damageDialog.value) return 0
  return Math.max(0, damageDialog.value.currentHp - damageDialogHpLoss.value)
})

const damageDialogMultiplierTone = computed(() => {
  const m = damageDialogMultiplier.value
  if (m === 0) return 'is-immune'
  if (m < 1) return 'is-resist'
  if (m > 1) return 'is-weak'
  return null
})

const damageDialogMultiplierLabel = computed(() =>
  formatMultiplier(damageDialogMultiplier.value),
)
const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)
const voxelOccupancy = computed(() => buildVoxelOccupancy(props.voxels))

// Voxel y-values bucketed by ``x,z`` column key. Lets a shadow-cast
// raycast stay O(footprint) instead of O(voxels) — most cells have 0
// or 1 voxels above ground, so the sorted-array scan is trivial.
const voxelColumnsByXZ = computed(() => {
  const columns = new Map<string, number[]>()
  for (const v of props.voxels) {
    const key = `${v.x},${v.z}`
    const list = columns.get(key)
    if (list) list.push(v.y)
    else columns.set(key, [v.y])
  }
  return columns
})

/**
 * Shadow surface Y for a pokemon's footprint. Walks every (x, z) cell
 * the cage covers, picks the highest voxel top that's at or below the
 * sprite's foot, and returns the max across all cells. Falls back to
 * the floor (y = 0) when nothing's below.
 *
 * Without this, a flying mon's shadow stays glued to its foot —
 * floating in mid-air over voxels, missing the surface entirely.
 */
const getShadowSurfaceY = (
  centerX: number,
  centerZ: number,
  base: number,
  footY: number,
): number => {
  const columns = voxelColumnsByXZ.value
  if (columns.size === 0) return 0

  const minX = Math.floor(centerX - base / 2)
  const minZ = Math.floor(centerZ - base / 2)
  // Tiny epsilon: treat a voxel top exactly at footY as "below" so a
  // mon standing flush on a voxel still gets a shadow on that voxel.
  const ceiling = footY + 0.001

  let surface = 0
  for (let dx = 0; dx < base; dx += 1) {
    for (let dz = 0; dz < base; dz += 1) {
      const column = columns.get(`${minX + dx},${minZ + dz}`)
      if (!column) continue
      for (const y of column) {
        const top = y + 1
        if (top <= ceiling && top > surface) surface = top
      }
    }
  }
  return surface
}

const scene = new THREE.Scene()
const raycaster = new THREE.Raycaster()
const gridGroup = new THREE.Group()
const worldGroup = new THREE.Group()
const previewGroup = new THREE.Group()
const voxelContainer = new THREE.Group()
const clock = new THREE.Clock()

scene.add(gridGroup)
scene.add(worldGroup)
scene.add(previewGroup)
worldGroup.add(voxelContainer)

const renderObjects = new Map<string, PokemonRenderObject>()
const voxelGroups = new Map<string, VoxelGroup>()
let renderer: THREE.WebGLRenderer | null = null
let cssRenderer: CSS3DRenderer | null = null
let camera: THREE.OrthographicCamera | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let floorGridLines: THREE.LineSegments | null = null
let moveGridLines: THREE.LineSegments | null = null
let floorPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
let ghostSprite: THREE.Sprite<THREE.SpriteMaterial> | null = null
let ghostSpriteState: WorldSpriteState | null = null
let previewElevationBadge: CSS3DSprite | null = null
let previewVolume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
let previewEdges: THREE.LineSegments | null = null
let previewPathLine: THREE.Line | null = null
let previewOwnerId: string | null = null
let buildGhost: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
let buildGhostEdges: THREE.LineSegments | null = null
let activePreview: PreviewState = { ...EMPTY_PREVIEW }
let activePreviewAnchor: GridAnchor | null = null
let pointerDown = { x: 0, y: 0 }
let pointerTravel = 0
let lastPointerCoords: { clientX: number; clientY: number } | null = null
let hoveredPokemonId: string | null = null

const getPreviewLayerY = () => activePreviewAnchor?.y ?? selectedPokemon.value?.position.y ?? 0

const getSceneTarget = () =>
  new THREE.Vector3(props.dimensions.x / 2, 0, props.dimensions.z / 2)

const buildFloorGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []
  const y = 0.02

  for (let z = 0; z <= dimensions.z; z += 1) {
    points.push(0, y, z, dimensions.x, y, z)
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    points.push(x, y, 0, x, y, dimensions.z)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

const buildMoveGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []

  for (let y = 1; y <= dimensions.y; y += 1) {
    for (let z = 0; z <= dimensions.z; z += 1) {
      points.push(0, y, z, dimensions.x, y, z)
    }
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let z = 0; z <= dimensions.z; z += 1) {
      points.push(x, 0, z, x, dimensions.y, z)
    }
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let y = 1; y <= dimensions.y; y += 1) {
      points.push(x, y, 0, x, y, dimensions.z)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

const nowMs = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

const spriteAnimationFrameAt = (animation: SpriteAnimation, elapsedMs: number) => {
  const fallbackDuration = animation.durationsMs.at(-1) ?? 100
  const totalDuration = animation.totalDurationMs > 0
    ? animation.totalDurationMs
    : animation.durationsMs.reduce((sum, duration) => sum + duration, 0)

  if (animation.frames <= 1 || totalDuration <= 0) return 0

  let remaining = ((elapsedMs % totalDuration) + totalDuration) % totalDuration
  for (let i = 0; i < animation.frames; i += 1) {
    const duration = animation.durationsMs[i] ?? fallbackDuration
    if (remaining < duration) return i
    remaining -= duration
  }
  return animation.frames - 1
}

const applyAnimationFrame = (state: WorldSpriteState, timestampMs: number) => {
  const animation = state.animationMeta
  const texture = state.texture
  if (!animation || !texture) return

  const frame = spriteAnimationFrameAt(animation, timestampMs - state.animationStartedAtMs)
  if (frame === state.currentFrame) return

  const columns = Math.max(1, animation.columns)
  const rows = Math.max(1, animation.rows)
  const column = frame % columns
  const row = Math.floor(frame / columns)
  texture.repeat.set(1 / columns, 1 / rows)
  texture.offset.set(
    column / columns,
    1 - (row + 1) / rows,
  )
  texture.needsUpdate = true
  state.currentFrame = frame
}

const spriteAssetKey = (asset: SpriteVisualAsset) => {
  const crop = asset.crop
    ? `${asset.crop.canvasWidth},${asset.crop.canvasHeight},${asset.crop.left},${asset.crop.top},${asset.crop.width},${asset.crop.height}`
    : 'full'
  return `${asset.animation?.url ?? asset.url}|${asset.animation ? 'animated' : 'static'}|${crop}`
}

const setWorldSpriteAsset = (state: WorldSpriteState, asset: SpriteVisualAsset) => {
  const key = spriteAssetKey(asset)
  if (state.assetKey === key) return

  const token = state.loadToken + 1
  state.loadToken = token
  state.assetKey = key

  const handle = asset.animation
    ? acquireAnimatedSpriteTexture(asset.animation.url)
    : acquireStaticSpriteTexture(asset.url, asset.crop)

  handle.promise
    .then((texture) => {
      if (state.loadToken !== token || state.assetKey !== key) {
        handle.release()
        return
      }

      const previousRelease = state.releaseTexture
      state.texture = texture
      state.releaseTexture = handle.release
      state.animationMeta = asset.animation ?? null
      state.currentFrame = -1
      if (state.animationMeta) {
        applyAnimationFrame(state, nowMs())
      }
      state.material.map = texture
      state.material.needsUpdate = true
      previousRelease?.()
    })
    .catch((error) => {
      handle.release()
      if (state.loadToken === token && state.assetKey === key) {
        state.assetKey = null
        console.warn('Failed to load sprite texture', asset.animation?.url ?? asset.url, error)
      }
    })
}

const setWorldSpriteVisible = (state: WorldSpriteState | null, visible: boolean) => {
  if (!state) return
  state.sprite.visible = visible
  state.halo.visible = visible
}

const setWorldSpriteInvalid = (state: WorldSpriteState | null, invalid: boolean) => {
  if (!state) return
  state.invalid = invalid
}

const updateWorldSpriteLighting = (
  state: WorldSpriteState,
  brightness: number,
  haloAlpha: number,
) => {
  if (state.ghost) {
    if (state.invalid) {
      state.material.opacity = 0.28
      state.material.color.setRGB(
        Math.min(1.4, brightness * 1.05),
        Math.min(1.0, brightness * 0.68),
        Math.min(1.0, brightness * 0.62),
      )
      state.haloMaterial.color.setHex(0xfb4934)
      state.haloMaterial.opacity = 0.16
    } else {
      state.material.opacity = 0.4
      state.material.color.setScalar(Math.min(1.35, brightness * 1.2))
      state.haloMaterial.color.setHex(0xd5c4a1)
      state.haloMaterial.opacity = 0.18
    }
    return
  }

  state.material.color.setScalar(brightness)
  state.haloMaterial.color.setHex(0xfabd2f)
  state.haloMaterial.opacity = haloAlpha
}

const buildWorldSprite = (pokemon: SpawnedPokemon, ghost = false): WorldSpriteState => {
  const material = new THREE.SpriteMaterial({
    map: getTransparentSpriteTexture(),
    alphaTest: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.4 : 1,
    depthTest: true,
    depthWrite: !ghost,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  // Bottom-center anchoring keeps the feet planted at the token's
  // ground/elevation Y while preserving the old visual footprint/height.
  sprite.center.set(0.5, 0)
  sprite.scale.set(Math.max(0.1, pokemon.width), Math.max(0.1, pokemon.height), 1)
  sprite.visible = true

  const haloMaterial = new THREE.SpriteMaterial({
    map: getSpriteHaloTexture(),
    color: ghost ? 0xd5c4a1 : 0xfabd2f,
    transparent: true,
    opacity: ghost ? 0.18 : SPRITE_HALO_MIN_ALPHA,
    alphaTest: 0.02,
    // Halo is transparent eye-candy: depth-test it against terrain and
    // sprites, but never write depth or it would occlude real pixels.
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessDepth,
    toneMapped: false,
  })
  const halo = new THREE.Sprite(haloMaterial)
  halo.center.set(0.5, 0)
  halo.scale.set(Math.max(0.1, pokemon.width) * 1.25, Math.max(0.1, pokemon.height) * 1.15, 1)
  halo.visible = true

  const state: WorldSpriteState = {
    sprite,
    material,
    halo,
    haloMaterial,
    texture: null,
    releaseTexture: null,
    assetKey: null,
    loadToken: 0,
    animationMeta: null,
    animationStartedAtMs: nowMs(),
    currentFrame: -1,
    ghost,
    invalid: false,
  }

  setWorldSpriteAsset(state, {
    url: pokemon.spriteUrl,
    animation: pokemon.spriteAnimation,
    crop: pokemon.spriteCrop,
  })

  return state
}

const disposeWorldSprite = (state: WorldSpriteState | null) => {
  if (!state) return
  state.loadToken += 1
  state.releaseTexture?.()
  state.releaseTexture = null
  state.texture = null
  state.material.map = null
  state.sprite.parent?.remove(state.sprite)
  state.material.dispose()
  state.halo.parent?.remove(state.halo)
  state.haloMaterial.dispose()
}

const buildElevationBadge = (ghost = false) => {
  const wrapper = document.createElement('div')
  wrapper.className = `elevation-badge${ghost ? ' is-ghost' : ''}`
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const badge = new CSS3DSprite(wrapper)
  badge.element.style.pointerEvents = 'none'
  badge.scale.setScalar(1 / ELEVATION_BADGE_PIXELS_PER_METRE)
  badge.visible = false
  return badge
}

const buildHpBar = () => {
  const wrapper = document.createElement('div')
  wrapper.className = 'hp-bar'
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const fill = document.createElement('div')
  fill.className = 'hp-bar__fill'
  wrapper.appendChild(fill)

  // CSS3DSprite billboards to the camera so the bar reads as a flat ribbon
  // floating above the sprite regardless of orbit angle.
  const bar = new CSS3DSprite(wrapper)
  bar.element.style.pointerEvents = 'none'
  bar.scale.setScalar(1 / HP_BAR_PIXELS_PER_METRE)
  bar.visible = false
  return bar
}

/**
 * Flat circular contact shadow under a pokemon sprite. Slightly larger
 * than the cage footprint so the soft alpha rim spills past the cage
 * edges, anchoring the billboarded sprite to the ground.
 */
const buildContactShadow = (
  pokemon: SpawnedPokemon,
): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> => {
  // Scale by clearance so a Wailord doesn't share Cutiefly's shadow.
  // Base term keeps small/wide mons grounded; clearance term grows the
  // disc as the cage gets taller without making it absurdly wide.
  const radius = Math.max(pokemon.base, 0.5) * 0.55 + pokemon.clearance * 0.06
  const geometry = new THREE.CircleGeometry(radius, 32)
  const material = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  // Lay flat on the XZ plane so the disc reads as ground shadow.
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

const shouldUseFrontSprite = (center: THREE.Vector3, turned = false) => {
  if (!camera) {
    return true
  }

  const toCamera = new THREE.Vector2(camera.position.x - center.x, camera.position.z - center.z)

  if (toCamera.lengthSq() === 0) {
    return true
  }

  toCamera.normalize()
  const facing = DEFAULT_FACING_DIRECTION.clone().multiplyScalar(turned ? -1 : 1)

  return facing.dot(toCamera) >= 0
}

const updateSpriteFacing = (
  state: WorldSpriteState,
  center: THREE.Vector3,
  frontSpriteUrl: string,
  frontSpriteAnimation?: SpriteAnimation,
  backSpriteUrl?: string,
  backSpriteAnimation?: SpriteAnimation,
  spriteCrop?: SpriteCrop,
  turned = false,
) => {
  const useBack = Boolean(backSpriteUrl && !shouldUseFrontSprite(center, turned))
  setWorldSpriteAsset(state, useBack
    ? {
        url: backSpriteUrl!,
        animation: backSpriteAnimation,
      }
    : {
        url: frontSpriteUrl,
        animation: frontSpriteAnimation,
        crop: spriteCrop,
      })
}

const disposeObject3D = (object: THREE.Object3D | null) => {
  if (!object) {
    return
  }

  object.parent?.remove(object)

  const mesh = object as THREE.Mesh
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined

  geometry?.dispose?.()

  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose()
    }
  } else {
    material?.dispose?.()
  }

  if ('element' in object && object.element instanceof HTMLElement) {
    object.element.remove()
  }
}

const setOrthographicFrustum = () => {
  if (!camera || !container.value) {
    return
  }

  const bounds = container.value.getBoundingClientRect()
  const aspect = bounds.width / Math.max(bounds.height, 1)
  const frustumSize = Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 1.7

  camera.left = (-frustumSize * aspect) / 2
  camera.right = (frustumSize * aspect) / 2
  camera.top = frustumSize / 2
  camera.bottom = -frustumSize / 2
  camera.near = -frustumSize * 6
  camera.far = frustumSize * 6
  camera.updateProjectionMatrix()
}

const syncRendererSize = () => {
  if (!renderer || !cssRenderer || !container.value) {
    return
  }

  const bounds = container.value.getBoundingClientRect()
  renderer.setSize(bounds.width, bounds.height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  cssRenderer.setSize(bounds.width, bounds.height)
  setOrthographicFrustum()
}

const alignCameraToGrid = (initial = false) => {
  if (!camera || !controls) {
    return
  }

  const nextTarget = getSceneTarget()

  if (initial) {
    const radius = Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 2.1
    camera.position.set(
      nextTarget.x + radius * Math.sin(ISO_POLAR_ANGLE) * Math.cos(ISO_AZIMUTH_ANGLE),
      nextTarget.y + radius * Math.cos(ISO_POLAR_ANGLE),
      nextTarget.z + radius * Math.sin(ISO_POLAR_ANGLE) * Math.sin(ISO_AZIMUTH_ANGLE),
    )
  } else {
    const offset = camera.position.clone().sub(controls.target)
    camera.position.copy(nextTarget.clone().add(offset))
  }

  controls.target.copy(nextTarget)
  controls.update()
}

const updateGridVisibility = () => {
  const isMovingPokemon = Boolean(selectedPokemon.value)

  if (floorGridLines) {
    floorGridLines.visible = true
  }

  if (moveGridLines) {
    moveGridLines.visible = isMovingPokemon || props.buildMode
  }
}

const buildGrid = () => {
  disposeObject3D(floorGridLines)
  disposeObject3D(moveGridLines)
  disposeObject3D(floorPlane)

  // Gruvbox terrain seam lines: bg0_h, the same warm near-black as the
  // page background. Per the reference palette, seam lines should
  // "keep the grid legible without harsh contrast" — they read as
  // dark grout between lit tiles rather than a bright overlay.
  floorGridLines = new THREE.LineSegments(
    buildFloorGridGeometry(props.dimensions),
    new THREE.LineBasicMaterial({
      color: 0x1d2021, // bg0_h
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
    }),
  )
  gridGroup.add(floorGridLines)

  moveGridLines = new THREE.LineSegments(
    buildMoveGridGeometry(props.dimensions),
    new THREE.LineBasicMaterial({
      color: 0x1d2021,
      transparent: true,
      opacity: 0.01,
      depthTest: true,
      depthWrite: false,
    }),
  )
  gridGroup.add(moveGridLines)

  // Floor plane = the lit "top" of the tabletop. bg2 is the classic
  // gruvbox "left/mid face" tone but feels right for a horizontal
  // surface that catches no direct sun in the per-face ramp — it
  // sits just below the bg3 box-tops so anything placed on the grid
  // visually pops upward.
  floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(props.dimensions.x, props.dimensions.z),
    new THREE.MeshBasicMaterial({
      color: 0x504945, // bg2 — lit horizontal surface
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  floorPlane.rotation.x = -Math.PI / 2
  floorPlane.position.set(props.dimensions.x / 2, 0, props.dimensions.z / 2)
  gridGroup.add(floorPlane)

  updateGridVisibility()
}

const getElevationBadgeOffset = (center: THREE.Vector3, base: number) => {
  const inset = Math.min(0.18, base / 4)
  const edgeOffset = Math.max(base / 2 - inset, 0)

  if (!camera) {
    return {
      x: edgeOffset,
      z: edgeOffset,
    }
  }

  return {
    x: (camera.position.x >= center.x ? 1 : -1) * edgeOffset,
    z: (camera.position.z >= center.z ? 1 : -1) * edgeOffset,
  }
}

const updateElevationBadge = (
  badge: CSS3DSprite,
  center: THREE.Vector3,
  base: number,
  elevation: number,
  show = true,
) => {
  if (!show || elevation <= 0) {
    badge.visible = false
    return
  }

  const offset = getElevationBadgeOffset(center, base)
  badge.position.set(center.x + offset.x, center.y + 0.08, center.z + offset.z)
  badge.element.textContent = `${elevation} ↑`
  badge.visible = true
}

const setHoveredPokemonId = (id: string | null) => {
  if (hoveredPokemonId === id) {
    return
  }

  const previousId = hoveredPokemonId
  hoveredPokemonId = id

  if (previousId && previousId !== id) {
    const previous = renderObjects.get(previousId)
    if (previous) previous.elevationBadge.visible = false
  }

  if (id) {
    const next = renderObjects.get(id)
    if (next) {
      updateElevationBadge(
        next.elevationBadge,
        next.currentCenter,
        next.base,
        next.elevation,
        true,
      )
    }
  }
}

const hpTierForRatio = (ratio: number): 'critical' | 'wounded' | 'healthy' => {
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

const updateHpBar = (
  bar: CSS3DSprite,
  center: THREE.Vector3,
  spriteHeight: number,
  currentHp: number,
  maxHp: number,
) => {
  // Hidden at full HP (per spec) and when there's nothing meaningful to
  // show (max ≤ 0).
  if (maxHp <= 0 || currentHp >= maxHp) {
    bar.visible = false
    return
  }

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp))
  const fill = bar.element.firstElementChild as HTMLElement | null
  if (fill) {
    fill.style.width = `${ratio * 100}%`
  }
  bar.element.dataset.hpTier = hpTierForRatio(ratio)

  // Floats just above the sprite's head. WebGL world sprites are
  // bottom-anchored at ``center.y``, so the top edge is
  // ``center.y + spriteHeight``.
  bar.position.set(center.x, center.y + spriteHeight + 0.18, center.z)
  bar.visible = true
}

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject => {
  const spriteState = buildWorldSprite(pokemon)
  const sprite = spriteState.sprite
  const elevationBadge = buildElevationBadge()
  const hpBar = buildHpBar()
  const shadow = buildContactShadow(pokemon)
  const volumeGeometry = new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)
  // Per-face gruvbox shading: top=fg3, Z-sides=fg4, X-sides=gray.
  // Sits in the foreground brightness band so the cage reads above
  // the bg-band terrain instead of merging with it.
  const volume = new THREE.Mesh(
    volumeGeometry,
    buildVolumeMaterials('idle', 0.28),
  )

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(volumeGeometry),
    new THREE.LineBasicMaterial({
      color: 0xa89984, // fg4
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    }),
  )

  const pickWidth = Math.max(pokemon.base, pokemon.width, 1)
  const pickHeight = Math.max(pokemon.clearance, pokemon.height, 1)
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(pickWidth, pickHeight, pickWidth),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  )
  proxy.userData.pokemonId = pokemon.id

  const center = getPokemonCenter(pokemon)
  const currentCenter = new THREE.Vector3(center.x, center.y, center.z)
  const targetCenter = currentCenter.clone()

  worldGroup.add(shadow)
  worldGroup.add(volume)
  worldGroup.add(edges)
  worldGroup.add(spriteState.halo)
  worldGroup.add(sprite)
  worldGroup.add(proxy)
  scene.add(elevationBadge)
  scene.add(hpBar)

  return {
    id: pokemon.id,
    sprite,
    spriteState,
    elevationBadge,
    hpBar,
    volume,
    edges,
    proxy,
    shadow,
    currentCenter,
    targetCenter,
    width: pokemon.width,
    height: pokemon.height,
    base: pokemon.base,
    clearance: pokemon.clearance,
    elevation: pokemon.position.y,
    spriteUrl: pokemon.spriteUrl,
    backSpriteUrl: pokemon.backSpriteUrl,
    spriteAnimation: pokemon.spriteAnimation,
    backSpriteAnimation: pokemon.backSpriteAnimation,
    spriteCrop: pokemon.spriteCrop,
    turned: Boolean(pokemon.turned),
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    liftFactor: 0,
    liftTarget: 0,
  }
}

const applyRenderObjectPosition = (renderObject: PokemonRenderObject) => {
  renderObject.sprite.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y,
    renderObject.currentCenter.z,
  )
  renderObject.spriteState.halo.position.copy(renderObject.sprite.position)
  renderObject.volume.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + renderObject.clearance / 2,
    renderObject.currentCenter.z,
  )
  renderObject.edges.position.copy(renderObject.volume.position)
  renderObject.proxy.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + Math.max(renderObject.height, renderObject.clearance) / 2,
    renderObject.currentCenter.z,
  )
  // Voxel-aware projection: shadow drops to whatever surface is
  // beneath the sprite (floor or highest voxel top in the footprint),
  // not glued to the sprite's foot. Tiny y-offset dodges z-fighting
  // with the floor plane / voxel top.
  const surfaceY = getShadowSurfaceY(
    renderObject.currentCenter.x,
    renderObject.currentCenter.z,
    renderObject.base,
    renderObject.currentCenter.y,
  )
  renderObject.shadow.position.set(
    renderObject.currentCenter.x,
    surfaceY + 0.005,
    renderObject.currentCenter.z,
  )
  updateElevationBadge(
    renderObject.elevationBadge,
    renderObject.currentCenter,
    renderObject.base,
    renderObject.elevation,
    hoveredPokemonId === renderObject.id,
  )
  updateHpBar(
    renderObject.hpBar,
    renderObject.currentCenter,
    renderObject.height,
    renderObject.currentHp,
    renderObject.maxHp,
  )
}

const refreshPokemonStyles = () => {
  for (const pokemon of props.pokemons) {
    const renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      continue
    }

    const selected = props.selectedId === pokemon.id
    // Re-tint the per-face material array with the appropriate
    // gruvbox terrain ramp instead of a single solid color.
    paintVolumeMaterials(
      renderObject.volume.material,
      selected ? 'selected' : 'idle',
      selected ? 0.32 : 0.28,
    )
    ;(renderObject.edges.material as THREE.LineBasicMaterial).color.set(selected ? 0xfbf1c7 : 0xa89984)
    // Idle edges fade so the cage reads via faces; selection sharpens
    // them back up so the active token has a clear hard outline.
    ;(renderObject.edges.material as THREE.LineBasicMaterial).opacity = selected ? 0.95 : 0.35
    renderObject.liftTarget = selected ? 1 : 0
  }
}

const syncPokemonObjects = () => {
  const nextIds = new Set(props.pokemons.map((pokemon) => pokemon.id))

  for (const [id, renderObject] of renderObjects.entries()) {
    if (nextIds.has(id)) {
      continue
    }

    if (hoveredPokemonId === id) {
      setHoveredPokemonId(null)
    }

    disposeWorldSprite(renderObject.spriteState)
    disposeObject3D(renderObject.elevationBadge)
    disposeObject3D(renderObject.hpBar)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
    disposeObject3D(renderObject.shadow)
    renderObjects.delete(id)
  }

  for (const pokemon of props.pokemons) {
    let renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      renderObject = buildRenderObject(pokemon)
      renderObjects.set(pokemon.id, renderObject)
      applyRenderObjectPosition(renderObject)
    }

    const center = getPokemonCenter(pokemon)
    renderObject.targetCenter.set(center.x, center.y, center.z)
    renderObject.elevation = pokemon.position.y
    renderObject.spriteUrl = pokemon.spriteUrl
    renderObject.backSpriteUrl = pokemon.backSpriteUrl
    renderObject.spriteAnimation = pokemon.spriteAnimation
    renderObject.backSpriteAnimation = pokemon.backSpriteAnimation
    renderObject.spriteCrop = pokemon.spriteCrop
    renderObject.turned = Boolean(pokemon.turned)
    renderObject.currentHp = pokemon.currentHp
    renderObject.maxHp = pokemon.maxHp
  }

  refreshPokemonStyles()
}

const disposeVoxelGroup = (group: VoxelGroup) => {
  voxelContainer.remove(group.mesh)
  group.mesh.dispose()
  group.geometry.dispose()
  for (const material of group.materials) material.dispose()
}

const disposeAllVoxelGroups = () => {
  for (const group of voxelGroups.values()) {
    disposeVoxelGroup(group)
  }
  voxelGroups.clear()
}

const syncVoxelMeshes = () => {
  // Bucket voxels by group key so visually identical voxels share
  // an InstancedMesh.
  const buckets = new Map<string, GridVoxel[]>()
  for (const voxel of props.voxels) {
    const key = voxelGroupKey(voxel)
    let arr = buckets.get(key)
    if (!arr) {
      arr = []
      buckets.set(key, arr)
    }
    arr.push(voxel)
  }

  // Drop groups that no longer have any voxels.
  for (const [key, group] of voxelGroups.entries()) {
    if (!buckets.has(key)) {
      disposeVoxelGroup(group)
      voxelGroups.delete(key)
    }
  }

  // Rebuild each bucket. We always rebuild rather than try to mutate
  // ``InstancedMesh.count`` in place — voxel changes are debounced
  // through the save layer so the cost is bounded.
  const matrix = new THREE.Matrix4()
  for (const [key, voxels] of buckets.entries()) {
    const existing = voxelGroups.get(key)
    if (existing) {
      disposeVoxelGroup(existing)
      voxelGroups.delete(key)
    }
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const materials = buildVoxelFaceMaterials(voxels[0])
    const mesh = new THREE.InstancedMesh(geometry, materials, voxels.length)
    mesh.userData.voxels = voxels
    for (let i = 0; i < voxels.length; i += 1) {
      const v = voxels[i]
      matrix.makeTranslation(v.x + 0.5, v.y + 0.5, v.z + 0.5)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    voxelContainer.add(mesh)
    voxelGroups.set(key, { key, geometry, materials, mesh, voxels })
  }
}

const ensureBuildGhost = () => {
  if (buildGhost && buildGhostEdges) return
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const materials = buildVoxelFaceMaterials({ material: 'stone', color: '#fabd2f' }, 0.45, false)
  buildGhost = new THREE.Mesh(geometry, materials)
  buildGhost.visible = false
  previewGroup.add(buildGhost)

  const edgeGeometry = new THREE.EdgesGeometry(geometry)
  buildGhostEdges = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({
      color: 0xfbf1c7,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    }),
  )
  buildGhostEdges.visible = false
  previewGroup.add(buildGhostEdges)
}

const disposeBuildGhost = () => {
  if (buildGhost) {
    disposeObject3D(buildGhost)
    buildGhost = null
  }
  if (buildGhostEdges) {
    disposeObject3D(buildGhostEdges)
    buildGhostEdges = null
  }
}

const hideBuildGhost = () => {
  if (buildGhost) buildGhost.visible = false
  if (buildGhostEdges) buildGhostEdges.visible = false
}

const customVoxelStyle = (baseColor: number): VoxelRenderStyle => ({
  material: 'stone',
  color: blockHexCss(baseColor),
})

const currentBuildVoxelStyle = (): VoxelRenderStyle => {
  const style: VoxelRenderStyle = { material: props.buildMaterial }
  if (props.buildColor && parseHexColor(props.buildColor) !== null) style.color = props.buildColor
  return style
}

const ensurePreviewObjects = () => {
  if (!selectedPokemon.value) {
    return
  }

  if (
    previewOwnerId === selectedPokemon.value.id &&
    ghostSprite &&
    ghostSpriteState &&
    previewElevationBadge &&
    previewVolume &&
    previewEdges &&
    previewPathLine
  ) {
    return
  }

  disposeWorldSprite(ghostSpriteState)
  disposeObject3D(previewElevationBadge)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  ghostSprite = null
  ghostSpriteState = null
  previewElevationBadge = null
  previewVolume = null
  previewEdges = null

  const selected = selectedPokemon.value
  previewOwnerId = selected.id
  ghostSpriteState = buildWorldSprite(selected, true)
  ghostSprite = ghostSpriteState.sprite
  setWorldSpriteVisible(ghostSpriteState, false)
  previewGroup.add(ghostSpriteState.halo)
  previewGroup.add(ghostSprite)

  previewElevationBadge = buildElevationBadge(true)
  previewElevationBadge.visible = false
  scene.add(previewElevationBadge)

  // Preview volume gets the same per-face shading as live pokemon
  // boxes, but tinted with gruvbox yellow (reachable) or red
  // (unreachable) instead of the warm gray ramp.
  previewVolume = new THREE.Mesh(
    new THREE.BoxGeometry(selected.base, selected.clearance, selected.base),
    buildVolumeMaterials('reachable', 0.24),
  )
  previewVolume.visible = false
  previewGroup.add(previewVolume)

  previewEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(selected.base, selected.clearance, selected.base)),
    new THREE.LineBasicMaterial({
      color: 0xfbf1c7, // fg0 - bright cream highlight on the yellow box
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
    }),
  )
  previewEdges.visible = false
  previewGroup.add(previewEdges)

  if (!previewPathLine) {
    previewPathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xfabd2f, // gruvbox yellow path trail
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    )
    previewPathLine.visible = false
    previewGroup.add(previewPathLine)
  }
}

const clearPreviewVisuals = () => {
  activePreview = { ...EMPTY_PREVIEW }
  activePreviewAnchor = null

  if (ghostSpriteState) {
    setWorldSpriteVisible(ghostSpriteState, false)
    setWorldSpriteInvalid(ghostSpriteState, false)
  }

  if (previewElevationBadge) {
    previewElevationBadge.visible = false
  }

  if (previewVolume) {
    previewVolume.visible = false
  }

  if (previewEdges) {
    previewEdges.visible = false
  }

  if (previewPathLine) {
    previewPathLine.visible = false
    previewPathLine.geometry.dispose()
    previewPathLine.geometry = new THREE.BufferGeometry()
  }

  emit('preview-change', { ...EMPTY_PREVIEW })
}

const updatePreviewAtAnchor = (anchor: GridAnchor | null) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  ensurePreviewObjects()

  if (!anchor || !ghostSprite || !ghostSpriteState || !previewElevationBadge || !previewVolume || !previewEdges) {
    clearPreviewVisuals()
    return
  }

  const selected = selectedPokemon.value
  const path = findPathForPokemon(
    selected,
    selected.position,
    anchor,
    [],
    props.dimensions,
    selected.id,
    voxelOccupancy.value,
  )
  const reachable = Boolean(path)
  const center = getAnchorCenter(anchor, selected.base)

  ghostSprite.position.set(center.x, anchor.y, center.z)
  ghostSpriteState.halo.position.copy(ghostSprite.position)
  setWorldSpriteVisible(ghostSpriteState, true)
  setWorldSpriteInvalid(ghostSpriteState, !reachable)

  previewVolume.position.set(center.x, anchor.y + selected.clearance / 2, center.z)
  // Repaint all 6 faces with the appropriate brightness ramp.
  paintVolumeMaterials(
    previewVolume.material,
    reachable ? 'reachable' : 'unreachable',
    reachable ? 0.24 : 0.22,
  )
  previewVolume.visible = true

  ;(previewEdges.material as THREE.LineBasicMaterial).color.set(reachable ? 0xfbf1c7 : 0xfb4934)
  previewEdges.position.copy(previewVolume.position)
  previewEdges.visible = true

  updateElevationBadge(
    previewElevationBadge,
    new THREE.Vector3(center.x, anchor.y, center.z),
    selected.base,
    anchor.y,
  )

  if (previewPathLine) {
    const points =
      path?.map((step) => {
        const waypoint = getAnchorCenter(step, selected.base)
        return new THREE.Vector3(waypoint.x, waypoint.y + selected.clearance / 2, waypoint.z)
      }) ?? []

    previewPathLine.geometry.dispose()
    previewPathLine.geometry = new THREE.BufferGeometry().setFromPoints(points)
    previewPathLine.visible = points.length >= 2
  }

  activePreviewAnchor = anchor
  activePreview = {
    position: anchor,
    reachable,
    pathLength: path ? Math.max(path.length - 1, 0) : 0,
  }
  emit('preview-change', { ...activePreview })
}

const setPointerFromCoords = (coords: { clientX: number; clientY: number }) => {
  if (!renderer || !camera) {
    return null
  }

  const bounds = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((coords.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((coords.clientY - bounds.top) / bounds.height) * 2 + 1,
  )

  raycaster.setFromCamera(pointer, camera)
  return pointer
}

const pickPokemonId = (event: MouseEvent | PointerEvent) => {
  if (!camera) {
    return null
  }

  setPointerFromCoords(event)
  const proxies = Array.from(renderObjects.values(), (renderObject) => renderObject.proxy)
  const intersections = raycaster.intersectObjects(proxies, false)
  const hit = intersections[0]?.object

  return (hit?.userData.pokemonId as string | undefined) ?? null
}

const updateHoverFromPointer = (event: PointerEvent) => {
  // Match normal link hover behaviour: touch/drag interactions don't leave a
  // sticky hover state behind, while every mouse move immediately re-picks the
  // token under the cursor (or clears the badge when there isn't one).
  if (event.pointerType === 'touch') {
    setHoveredPokemonId(null)
    return
  }

  setHoveredPokemonId(pickPokemonId(event))
}

const getMoveGridIntersection = (event: MouseEvent | PointerEvent, yLevel: number) => {
  if (!camera) {
    return null
  }

  setPointerFromCoords(event)
  const point = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -yLevel),
    point,
  )

  if (!hit) {
    return null
  }

  return point
}

const updatePreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  const previewLayerY = getPreviewLayerY()
  const point = getMoveGridIntersection(event, previewLayerY)

  if (
    !point ||
    point.x < 0 ||
    point.x > props.dimensions.x ||
    point.z < 0 ||
    point.z > props.dimensions.z
  ) {
    clearPreviewVisuals()
    return
  }

  const maxX = props.dimensions.x - selectedPokemon.value.base
  const maxY = props.dimensions.y - selectedPokemon.value.clearance
  const maxZ = props.dimensions.z - selectedPokemon.value.base

  if (maxX < 0 || maxY < 0 || maxZ < 0) {
    clearPreviewVisuals()
    return
  }

  const anchor = {
    x: Math.min(maxX, Math.max(0, Math.round(point.x - selectedPokemon.value.base / 2))),
    y: Math.min(maxY, Math.max(0, previewLayerY)),
    z: Math.min(maxZ, Math.max(0, Math.round(point.z - selectedPokemon.value.base / 2))),
  }

  updatePreviewAtAnchor(anchor)
}

const pickBuildTarget = (
  event: MouseEvent | PointerEvent,
  tool: BuildTool,
): BuildTarget | null => {
  if (!renderer || !camera) return null
  setPointerFromCoords(event)

  const targets: THREE.Object3D[] = []
  if (floorPlane) targets.push(floorPlane)
  for (const group of voxelGroups.values()) targets.push(group.mesh)

  const intersections = raycaster.intersectObjects(targets, false)
  const hit = intersections[0]
  if (!hit) return null

  let voxel: GridVoxel | null = null
  if (hit.object !== floorPlane) {
    const mesh = hit.object as THREE.InstancedMesh
    const voxels = mesh.userData.voxels as GridVoxel[] | undefined
    if (voxels && hit.instanceId !== undefined) {
      voxel = voxels[hit.instanceId] ?? null
    }
  }

  if (tool === 'eraser') {
    if (!voxel) return null
    return {
      action: 'remove',
      cell: { x: voxel.x, y: voxel.y, z: voxel.z },
      valid: true,
    }
  }

  let cell: { x: number; y: number; z: number }
  if (voxel && hit.face) {
    const normal = hit.face.normal
    cell = {
      x: voxel.x + Math.round(normal.x),
      y: voxel.y + Math.round(normal.y),
      z: voxel.z + Math.round(normal.z),
    }
  } else {
    cell = {
      x: Math.floor(hit.point.x),
      y: 0,
      z: Math.floor(hit.point.z),
    }
  }

  const inBounds =
    cell.x >= 0 &&
    cell.x < props.dimensions.x &&
    cell.y >= 0 &&
    cell.y < props.dimensions.y &&
    cell.z >= 0 &&
    cell.z < props.dimensions.z
  const occupiedByVoxel = voxelOccupancy.value.has(voxelKey(cell.x, cell.y, cell.z))
  const insidePokemon = cellInsidePokemonFootprint(cell.x, cell.y, cell.z, props.pokemons)

  return {
    action: 'place',
    cell,
    valid: inBounds && !occupiedByVoxel && !insidePokemon,
  }
}

const updateBuildGhost = (target: BuildTarget | null) => {
  if (!props.buildMode) {
    hideBuildGhost()
    return
  }

  ensureBuildGhost()
  if (!buildGhost || !buildGhostEdges) return

  if (!target) {
    hideBuildGhost()
    return
  }

  buildGhost.position.set(target.cell.x + 0.5, target.cell.y + 0.5, target.cell.z + 0.5)
  buildGhostEdges.position.copy(buildGhost.position)
  buildGhost.visible = true
  buildGhostEdges.visible = true

  const edgeMaterial = buildGhostEdges.material as THREE.LineBasicMaterial
  if (target.action === 'remove') {
    paintBuildGhostMaterials(buildGhost.material, customVoxelStyle(0xfb4934), 0.42)
    edgeMaterial.color.setHex(0xfb4934)
  } else if (!target.valid) {
    paintBuildGhostMaterials(buildGhost.material, customVoxelStyle(0xfb4934), 0.32)
    edgeMaterial.color.setHex(0xfb4934)
  } else {
    paintBuildGhostMaterials(buildGhost.material, currentBuildVoxelStyle(), 0.55)
    edgeMaterial.color.setHex(0xfbf1c7)
  }
}

const updateBuildPreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!props.buildMode) {
    hideBuildGhost()
    return
  }
  const target = pickBuildTarget(event, props.buildTool)
  updateBuildGhost(target)
}

const replayBuildPreview = () => {
  if (!props.buildMode || !lastPointerCoords) return
  const synthetic = {
    clientX: lastPointerCoords.clientX,
    clientY: lastPointerCoords.clientY,
  } as MouseEvent
  updateBuildPreviewFromPointer(synthetic)
}

const performBuildAction = (event: MouseEvent | PointerEvent, tool: BuildTool) => {
  const target = pickBuildTarget(event, tool)
  if (!target) return
  if (target.action === 'remove') {
    emit('remove-voxel', target.cell)
    return
  }
  if (!target.valid) return
  const voxel: GridVoxel = {
    x: target.cell.x,
    y: target.cell.y,
    z: target.cell.z,
    material: props.buildMaterial,
  }
  if (props.buildColor) voxel.color = props.buildColor
  emit('place-voxel', voxel)
}

const closeContextMenu = () => {
  contextMenu.value = null
}

const openContextMenu = (event: MouseEvent, id: string) => {
  if (!container.value) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === id)
  const canTurn = Boolean(target?.entityKind === 'pokemon' && target.backSpriteUrl)
  const bounds = container.value.getBoundingClientRect()
  const menuWidth = 180
  const menuHeight = canTurn ? 188 : 144
  const padding = 12

  contextMenu.value = {
    id,
    canTurn,
    x: Math.min(bounds.width - menuWidth - padding, Math.max(padding, event.clientX - bounds.left)),
    y: Math.min(bounds.height - menuHeight - padding, Math.max(padding, event.clientY - bounds.top)),
  }
}

const handleContextTurn = () => {
  if (!contextMenu.value) {
    return
  }

  emit('turn-pokemon', contextMenu.value.id)
  closeContextMenu()
}

const closeHpDialog = () => {
  hpDialog.value = null
}

const handleContextModifyHp = () => {
  if (!contextMenu.value) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === contextMenu.value!.id)
  if (!target) {
    closeContextMenu()
    return
  }

  hpDialog.value = {
    id: target.id,
    species: target.species,
    currentHp: target.currentHp,
    maxHp: target.maxHp,
    mode: 'damage',
    amount: '',
  }
  closeContextMenu()
  void nextTick(() => {
    hpAmountInput.value?.focus()
    hpAmountInput.value?.select()
  })
}

const handleHpDialogSubmit = () => {
  if (!hpDialog.value) return
  if (hpDialogDelta.value === 0) return
  if (hpDialogPreview.value === hpDialog.value.currentHp) {
    closeHpDialog()
    return
  }

  emit('modify-hp', { id: hpDialog.value.id, currentHp: hpDialogPreview.value })
  closeHpDialog()
}

const closeDamageDialog = () => {
  damageDialog.value = null
}

const handleContextDealDamage = () => {
  if (!contextMenu.value) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === contextMenu.value!.id)
  if (!target) {
    closeContextMenu()
    return
  }

  damageDialog.value = {
    id: target.id,
    species: target.species,
    currentHp: target.currentHp,
    maxHp: target.maxHp,
    def: target.def,
    sdef: target.sdef,
    defenderTypes: [...target.defenderTypes],
    mode: 'physical',
    attackType: 'Normal',
    source: 'flat',
    amount: '',
    db: 1,
    roll: null,
    attackerId: null,
  }
  closeContextMenu()
  void nextTick(() => {
    damageAmountInput.value?.focus()
    damageAmountInput.value?.select()
  })
}

const handleDamageDialogDbChange = () => {
  // Stale rolls confuse the breakdown — clear so the user re-rolls the
  // formula they actually selected.
  if (damageDialog.value) damageDialog.value.roll = null
}

const handleDamageDialogRoll = () => {
  if (!damageDialog.value) return
  const def = damageDialogDbDef.value
  if (!def) return
  const { rolls, total } = rollDamageBase(def)
  damageDialog.value.roll = {
    db: def.db,
    formula: formatDbFormula(def),
    rolls,
    mod: def.mod,
    total,
  }
}

const handleDamageDialogSubmit = () => {
  if (!damageDialog.value) return
  if (damageDialogRawAmount.value === 0) return
  if (damageDialogPreview.value === damageDialog.value.currentHp) {
    closeDamageDialog()
    return
  }

  emit('modify-hp', { id: damageDialog.value.id, currentHp: damageDialogPreview.value })
  closeDamageDialog()
}

const handleContextDelete = () => {
  if (!contextMenu.value) {
    return
  }

  emit('delete-pokemon', contextMenu.value.id)
  closeContextMenu()
}

const handleLeftClick = (event: PointerEvent) => {
  closeContextMenu()
  const hitId = pickPokemonId(event)

  if (!props.selectedId) {
    if (hitId) {
      emit('select-pokemon', hitId)
    }

    return
  }

  if (activePreview.position && activePreview.reachable) {
    emit('move-pokemon', {
      id: props.selectedId,
      position: activePreview.position,
    })
  }
}

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()

  if (props.buildMode) {
    if (pointerTravel <= 6) {
      performBuildAction(event, 'eraser')
    }
    return
  }

  const hitId = pickPokemonId(event)

  if (!hitId) {
    closeContextMenu()
    return
  }

  openContextMenu(event, hitId)
}

const handlePointerDown = (event: PointerEvent) => {
  closeContextMenu()
  pointerDown = { x: event.clientX, y: event.clientY }
  pointerTravel = 0
}

const handlePointerMove = (event: PointerEvent) => {
  pointerTravel = Math.max(
    pointerTravel,
    Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y),
  )
  lastPointerCoords = { clientX: event.clientX, clientY: event.clientY }
  updateHoverFromPointer(event)

  if (props.buildMode) {
    updateBuildPreviewFromPointer(event)
    return
  }

  if (selectedPokemon.value) {
    updatePreviewFromPointer(event)
  }
}

const handleWheel = (event: WheelEvent) => {
  if (!selectedPokemon.value) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const maxY = props.dimensions.y - selectedPokemon.value.clearance

  if (maxY < 0) {
    return
  }

  const currentAnchor = activePreview.position ?? selectedPokemon.value.position
  const direction = event.deltaY < 0 ? 1 : -1
  const nextY = Math.min(maxY, Math.max(0, currentAnchor.y + direction))

  if (nextY === currentAnchor.y) {
    return
  }

  updatePreviewAtAnchor({
    ...currentAnchor,
    y: nextY,
  })
}

const handlePointerUp = (event: PointerEvent) => {
  if (pointerTravel > 6 || event.button !== 0) {
    return
  }

  if (props.buildMode) {
    performBuildAction(event, props.buildTool)
    return
  }

  handleLeftClick(event)
}

const handlePointerLeave = () => {
  lastPointerCoords = null
  setHoveredPokemonId(null)
  if (props.buildMode) {
    hideBuildGhost()
  }
}

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (damageDialog.value) {
      closeDamageDialog()
      return
    }

    if (hpDialog.value) {
      closeHpDialog()
      return
    }

    if (contextMenu.value) {
      closeContextMenu()
      return
    }

    emit('select-pokemon', null)
  }
}

const animate = () => {
  animationFrame = window.requestAnimationFrame(animate)

  if (!renderer || !cssRenderer || !camera || !controls) {
    return
  }

  const delta = Math.min(clock.getDelta(), 0.1)
  const damping = 1 - Math.exp(-delta * 12)

  for (const renderObject of renderObjects.values()) {
    if (renderObject.currentCenter.distanceToSquared(renderObject.targetCenter) < 0.000001) {
      renderObject.currentCenter.copy(renderObject.targetCenter)
    } else {
      renderObject.currentCenter.lerp(renderObject.targetCenter, damping)
    }

    applyRenderObjectPosition(renderObject)
  }

  controls.update()

  // Light alignment: camera's XZ offset dotted against the cage's
  // implied light direction. +1 = lit quadrant, -1 = shadowed.
  // Lerps to a material color scalar shared across every sprite this
  // frame (ortho camera → all sprites see the same direction).
  const cameraXZ = new THREE.Vector2(
    camera.position.x - controls.target.x,
    camera.position.z - controls.target.z,
  )
  const lightAlignment = cameraXZ.lengthSq() > 0
    ? cameraXZ.normalize().dot(DEFAULT_FACING_DIRECTION)
    : 1
  const lightAlignment01 = (lightAlignment + 1) / 2
  const spriteBrightness = THREE.MathUtils.lerp(
    SPRITE_BRIGHTNESS_SHADOW,
    SPRITE_BRIGHTNESS_LIT,
    lightAlignment01,
  )
  // Directional halo: same gruvbox yellow glow the wrapper used to
  // paint statically, now lerped between min/max alpha by camera
  // alignment so the sprite picks up "light" as it rotates into the
  // lit quadrant. Single halo, native palette, responsive.
  const haloAlpha = THREE.MathUtils.lerp(
    SPRITE_HALO_MIN_ALPHA,
    SPRITE_HALO_MAX_ALPHA,
    lightAlignment01,
  )
  const frameNowMs = nowMs()

  for (const renderObject of renderObjects.values()) {
    updateSpriteFacing(
      renderObject.spriteState,
      renderObject.currentCenter,
      renderObject.spriteUrl,
      renderObject.spriteAnimation,
      renderObject.backSpriteUrl,
      renderObject.backSpriteAnimation,
      renderObject.spriteCrop,
      renderObject.turned,
    )
    if (renderObject.spriteState.animationMeta) {
      applyAnimationFrame(renderObject.spriteState, frameNowMs)
    }
    updateWorldSpriteLighting(renderObject.spriteState, spriteBrightness, haloAlpha)

    // Selection lift: sprite + HP bar pop up, cage stays anchored,
    // shadow scales up and fades so it reads as a more diffuse blob
    // — the visible detachment is the "off the ground" cue.
    if (Math.abs(renderObject.liftFactor - renderObject.liftTarget) < 0.001) {
      renderObject.liftFactor = renderObject.liftTarget
    } else {
      renderObject.liftFactor = THREE.MathUtils.lerp(
        renderObject.liftFactor,
        renderObject.liftTarget,
        damping,
      )
    }

    if (renderObject.liftFactor > 0) {
      const lift = renderObject.liftFactor * SPRITE_LIFT_AMOUNT
      renderObject.sprite.position.y += lift
      renderObject.spriteState.halo.position.y += lift
      if (renderObject.hpBar.visible) {
        renderObject.hpBar.position.y += lift
      }
    }

    // Non-uniform: lift grows the disc, X-stretch elongates it along
    // the cage's shadow axis so it reads as an ellipse falling away
    // from the implied light, not a perfect circle.
    const shadowScale = THREE.MathUtils.lerp(1, SHADOW_LIFT_SCALE, renderObject.liftFactor)
    renderObject.shadow.scale.set(shadowScale * SHADOW_X_STRETCH, shadowScale, 1)
    renderObject.shadow.material.opacity = THREE.MathUtils.lerp(
      1,
      SHADOW_LIFT_OPACITY,
      renderObject.liftFactor,
    )
  }

  if (ghostSprite && ghostSpriteState && selectedPokemon.value) {
    const ghostCenter = new THREE.Vector3(
      ghostSprite.position.x,
      activePreview.position?.y ?? selectedPokemon.value.position.y,
      ghostSprite.position.z,
    )
    updateSpriteFacing(
      ghostSpriteState,
      ghostCenter,
      selectedPokemon.value.spriteUrl,
      selectedPokemon.value.spriteAnimation,
      selectedPokemon.value.backSpriteUrl,
      selectedPokemon.value.backSpriteAnimation,
      selectedPokemon.value.spriteCrop,
      Boolean(selectedPokemon.value.turned),
    )
    // Ghost gets the directional tint too so it previews how the
    // pokemon will be lit at the destination.
    if (ghostSpriteState.animationMeta) {
      applyAnimationFrame(ghostSpriteState, frameNowMs)
    }
    updateWorldSpriteLighting(ghostSpriteState, spriteBrightness, haloAlpha)
  }

  renderer.render(scene, camera)
  cssRenderer.render(scene, camera)
}

onMounted(() => {
  if (!container.value) {
    return
  }

  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 200)
  camera.up.set(0, 1, 0)
  camera.zoom = 1.1

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setClearColor(0x1d2021, 1) // gruvbox bg0_h
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.touchAction = 'none'

  cssRenderer = new CSS3DRenderer()
  cssRenderer.domElement.style.position = 'absolute'
  cssRenderer.domElement.style.inset = '0'
  cssRenderer.domElement.style.pointerEvents = 'none'
  cssRenderer.domElement.style.overflow = 'hidden'

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.screenSpacePanning = false
  controls.zoomToCursor = true
  controls.enableZoom = !selectedPokemon.value
  controls.minPolarAngle = ISO_POLAR_ANGLE
  controls.maxPolarAngle = ISO_POLAR_ANGLE
  controls.minZoom = 0.4
  controls.maxZoom = 5
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 0.8

  container.value.append(renderer.domElement, cssRenderer.domElement)
  syncRendererSize()
  buildGrid()
  syncPokemonObjects()
  syncVoxelMeshes()
  ensurePreviewObjects()
  if (props.buildMode) ensureBuildGhost()
  alignCameraToGrid(true)
  refreshPokemonStyles()

  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerup', handlePointerUp)
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
  renderer.domElement.addEventListener('contextmenu', handleRightClick)
  renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
  window.addEventListener('keydown', handleEscape)

  resizeObserver = new ResizeObserver(() => {
    syncRendererSize()
  })
  resizeObserver.observe(container.value)

  animate()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame)
  window.removeEventListener('keydown', handleEscape)

  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
    renderer.domElement.removeEventListener('pointermove', handlePointerMove)
    renderer.domElement.removeEventListener('pointerup', handlePointerUp)
    renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.removeEventListener('contextmenu', handleRightClick)
    renderer.domElement.removeEventListener('wheel', handleWheel)
  }

  resizeObserver?.disconnect()
  resizeObserver = null

  clearPreviewVisuals()
  disposeWorldSprite(ghostSpriteState)
  ghostSprite = null
  ghostSpriteState = null
  disposeObject3D(previewElevationBadge)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  disposeObject3D(previewPathLine)
  disposeBuildGhost()
  disposeAllVoxelGroups()
  disposeBlockTextureCache()
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

  for (const renderObject of renderObjects.values()) {
    disposeWorldSprite(renderObject.spriteState)
    disposeObject3D(renderObject.elevationBadge)
    disposeObject3D(renderObject.hpBar)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
    disposeObject3D(renderObject.shadow)
  }

  renderObjects.clear()
  disposeSpriteTextureCaches()
  disposeObject3D(floorGridLines)
  disposeObject3D(moveGridLines)
  disposeObject3D(floorPlane)
  controls?.dispose()
  renderer?.dispose()
  cssRenderer?.domElement.remove()
})

watch(
  () => props.pokemons,
  () => {
    if (!renderer) {
      return
    }

    syncPokemonObjects()

    if (selectedPokemon.value && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
    } else if (!selectedPokemon.value) {
      clearPreviewVisuals()
    }

    if (hpDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === hpDialog.value!.id)
      if (!live) {
        closeHpDialog()
      } else {
        hpDialog.value.currentHp = live.currentHp
        hpDialog.value.maxHp = live.maxHp
        hpDialog.value.species = live.species
      }
    }

    if (damageDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === damageDialog.value!.id)
      if (!live) {
        closeDamageDialog()
      } else {
        damageDialog.value.currentHp = live.currentHp
        damageDialog.value.maxHp = live.maxHp
        damageDialog.value.species = live.species
        damageDialog.value.def = live.def
        damageDialog.value.sdef = live.sdef
        damageDialog.value.defenderTypes = [...live.defenderTypes]
        if (
          damageDialog.value.attackerId &&
          !props.pokemons.some((p) => p.id === damageDialog.value!.attackerId)
        ) {
          damageDialog.value.attackerId = null
        }
      }
    }

    replayBuildPreview()
  },
  { deep: true },
)

watch(
  () => props.voxels,
  () => {
    if (!renderer) {
      return
    }

    syncVoxelMeshes()

    if (selectedPokemon.value && activePreviewAnchor) {
      // Voxels affect pathfinding — refresh the move preview.
      updatePreviewAtAnchor(activePreviewAnchor)
    }

    replayBuildPreview()
  },
  { deep: true },
)

watch(
  () => props.selectedId,
  () => {
    if (!renderer) {
      return
    }

    refreshPokemonStyles()
    updateGridVisibility()

    if (controls) {
      controls.enableZoom = !selectedPokemon.value
    }

    if (!selectedPokemon.value) {
      clearPreviewVisuals()
      closeContextMenu()
      disposeWorldSprite(ghostSpriteState)
      disposeObject3D(previewElevationBadge)
      disposeObject3D(previewVolume)
      disposeObject3D(previewEdges)
      ghostSprite = null
      ghostSpriteState = null
      previewElevationBadge = null
      previewVolume = null
      previewEdges = null
      previewOwnerId = null
      return
    }

    activePreviewAnchor = null
    activePreview = { ...EMPTY_PREVIEW }
    ensurePreviewObjects()
    emit('preview-change', { ...EMPTY_PREVIEW })
  },
)

watch(
  () => props.buildMode,
  (active) => {
    if (!renderer) return

    updateGridVisibility()

    if (active) {
      closeContextMenu()
      clearPreviewVisuals()
      ensureBuildGhost()
      replayBuildPreview()
    } else {
      hideBuildGhost()
    }
  },
)

watch(
  () => [props.buildTool, props.buildMaterial, props.buildColor] as const,
  () => {
    if (!renderer || !props.buildMode) return
    replayBuildPreview()
  },
)

watch(
  () => [props.dimensions.x, props.dimensions.y, props.dimensions.z] as const,
  () => {
    if (!renderer) {
      return
    }

    buildGrid()
    updateGridVisibility()
    alignCameraToGrid(false)
    syncRendererSize()

    if (selectedPokemon.value && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
    } else if (!selectedPokemon.value) {
      clearPreviewVisuals()
    }

    if (props.buildMode) {
      hideBuildGhost()
    }
  },
)
</script>

<template>
  <div ref="container" class="scene-root">
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <button
        v-if="contextMenu.canTurn"
        type="button"
        class="context-menu__button"
        @click.stop="handleContextTurn"
      >
        Turn sprite
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextModifyHp"
      >
        Modify HP
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextDealDamage"
      >
        Deal damage
      </button>
      <button type="button" class="context-menu__button" @click.stop="handleContextDelete">
        Delete
      </button>
    </div>

    <div
      v-if="hpDialog"
      class="hp-dialog-backdrop"
      @pointerdown.self="closeHpDialog"
      @contextmenu.prevent
    >
      <form
        class="hp-dialog"
        @submit.prevent="handleHpDialogSubmit"
        @pointerdown.stop
      >
        <header class="hp-dialog__header">
          <h3>Modify HP</h3>
          <p class="hp-dialog__species">{{ hpDialog.species }}</p>
        </header>

        <div class="hp-dialog__readout">
          <span class="hp-dialog__current">{{ hpDialog.currentHp }} / {{ hpDialog.maxHp }}</span>
          <span class="hp-dialog__arrow" aria-hidden="true">→</span>
          <span
            class="hp-dialog__preview"
            :class="{
              'is-damage': hpDialogDelta < 0,
              'is-heal': hpDialogDelta > 0,
            }"
          >{{ hpDialogPreview }} / {{ hpDialog.maxHp }}</span>
        </div>

        <div class="hp-dialog__mode" role="group" aria-label="Operation">
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': hpDialog.mode === 'damage' }"
            :aria-pressed="hpDialog.mode === 'damage'"
            @click="hpDialog.mode = 'damage'"
          >
            − Lose
          </button>
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': hpDialog.mode === 'heal' }"
            :aria-pressed="hpDialog.mode === 'heal'"
            @click="hpDialog.mode = 'heal'"
          >
            + Gain
          </button>
        </div>

        <label class="hp-dialog__field">
          <span>Amount</span>
          <input
            ref="hpAmountInput"
            v-model="hpDialog.amount"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="0"
          />
        </label>

        <footer class="hp-dialog__footer">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="closeHpDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="hp-dialog__button hp-dialog__button--primary"
            :disabled="hpDialogDelta === 0 || hpDialogPreview === hpDialog.currentHp"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>

    <div
      v-if="damageDialog"
      class="hp-dialog-backdrop"
      @pointerdown.self="closeDamageDialog"
      @contextmenu.prevent
    >
      <form
        class="hp-dialog"
        @submit.prevent="handleDamageDialogSubmit"
        @pointerdown.stop
      >
        <header class="hp-dialog__header">
          <h3>Deal damage</h3>
          <p class="hp-dialog__species">
            {{ damageDialog.species }}
            <span v-if="damageDialog.defenderTypes.length" class="hp-dialog__types">
              <span aria-hidden="true">·</span>
              <TypeBadge
                v-for="type in damageDialog.defenderTypes"
                :key="type"
                :type="type"
                size="xs"
              />
            </span>
          </p>
        </header>

        <div class="hp-dialog__readout">
          <span class="hp-dialog__current">{{ damageDialog.currentHp }} / {{ damageDialog.maxHp }}</span>
          <span class="hp-dialog__arrow" aria-hidden="true">→</span>
          <span
            class="hp-dialog__preview"
            :class="{ 'is-damage': damageDialogHpLoss > 0 }"
          >{{ damageDialogPreview }} / {{ damageDialog.maxHp }}</span>
          <span
            v-if="damageDialogMultiplierTone"
            class="hp-dialog__multiplier"
            :class="damageDialogMultiplierTone"
          >×{{ damageDialogMultiplierLabel }}</span>
        </div>

        <div class="hp-dialog__mode" role="group" aria-label="Damage category">
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.mode === 'physical' }"
            :aria-pressed="damageDialog.mode === 'physical'"
            @click="damageDialog.mode = 'physical'"
          >
            <DamageClassBadge category="Physical" size="xs" />
            <span class="hp-dialog__mode-stat">Def {{ damageDialog.def }}</span>
          </button>
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.mode === 'special' }"
            :aria-pressed="damageDialog.mode === 'special'"
            @click="damageDialog.mode = 'special'"
          >
            <DamageClassBadge category="Special" size="xs" />
            <span class="hp-dialog__mode-stat">Sp.Def {{ damageDialog.sdef }}</span>
          </button>
        </div>

        <label class="hp-dialog__field">
          <span>Attack type</span>
          <div class="hp-dialog__select-row">
            <TypeBadge :type="damageDialog.attackType" size="xs" />
            <select v-model="damageDialog.attackType">
              <option v-for="type in POKEMON_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
        </label>

        <div class="hp-dialog__mode" role="group" aria-label="Damage source">
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.source === 'flat' }"
            :aria-pressed="damageDialog.source === 'flat'"
            @click="damageDialog.source = 'flat'"
          >
            Set damage
          </button>
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.source === 'db' }"
            :aria-pressed="damageDialog.source === 'db'"
            @click="damageDialog.source = 'db'"
          >
            Damage Base
          </button>
        </div>

        <label v-if="damageDialog.source === 'flat'" class="hp-dialog__field">
          <span>Damage</span>
          <input
            ref="damageAmountInput"
            v-model="damageDialog.amount"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="0"
          />
        </label>

        <template v-else>
          <label class="hp-dialog__field">
            <span>Attacker</span>
            <select v-model="damageDialog.attackerId">
              <option :value="null">None</option>
              <option
                v-for="attacker in damageDialogAttackerOptions"
                :key="attacker.id"
                :value="attacker.id"
              >{{ attacker.species }} · Atk {{ attacker.atk }} / Sp.Atk {{ attacker.satk }}</option>
            </select>
          </label>

          <label class="hp-dialog__field">
            <span>Damage Base</span>
            <select v-model.number="damageDialog.db" @change="handleDamageDialogDbChange">
              <option
                v-for="entry in DAMAGE_BASE_TABLE"
                :key="entry.db"
                :value="entry.db"
              >DB {{ entry.db }} · {{ formatDbFormula(entry) }}</option>
            </select>
          </label>

          <p class="hp-dialog__note">
            DB is taken as final — STAB and other DB modifiers aren't applied.
          </p>

          <div class="hp-dialog__roll">
            <button
              type="button"
              class="hp-dialog__button hp-dialog__button--ghost"
              @click="handleDamageDialogRoll"
            >{{ damageDialog.roll ? 'Re-roll' : 'Roll' }}</button>
            <p v-if="damageDialog.roll" class="hp-dialog__roll-result">
              <span>[{{ damageDialog.roll.rolls.join(', ') }}]</span>
              <span aria-hidden="true">+</span>
              <span>{{ damageDialog.roll.mod }}</span>
              <span aria-hidden="true">=</span>
              <strong>{{ damageDialog.roll.total }}</strong>
            </p>
            <p v-else class="hp-dialog__roll-empty">No roll yet</p>
          </div>
        </template>

        <p
          v-if="damageDialogMultiplier === 0 && damageDialogRawAmount > 0"
          class="hp-dialog__breakdown is-immune"
        >
          <strong class="hp-dialog__immune-line">
            <span>Immune to</span>
            <TypeBadge :type="damageDialog.attackType" size="xs" />
            <span>— 0 HP lost</span>
          </strong>
        </p>
        <p v-else class="hp-dialog__breakdown">
          <span>{{ damageDialogRawAmount }} dmg</span>
          <template v-if="damageDialogAttackBonus > 0">
            <span aria-hidden="true">+</span>
            <span>{{ damageDialogAttackBonus }} {{ damageDialog.mode === 'physical' ? 'Atk' : 'Sp.Atk' }}</span>
          </template>
          <span aria-hidden="true">−</span>
          <span>{{ damageDialogDefense }} {{ damageDialog.mode === 'physical' ? 'Def' : 'Sp.Def' }}</span>
          <span aria-hidden="true">×</span>
          <span>{{ damageDialogMultiplierLabel }}</span>
          <span aria-hidden="true">=</span>
          <strong>{{ damageDialogHpLoss }} HP lost</strong>
        </p>

        <footer class="hp-dialog__footer">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="closeDamageDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="hp-dialog__button hp-dialog__button--primary"
            :disabled="damageDialogRawAmount === 0 || damageDialogPreview === damageDialog.currentHp"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.scene-root {
  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  background: var(--paper);
}

.context-menu {
  position: absolute;
  z-index: 8;
  min-width: 160px;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.context-menu__button {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  text-align: left;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.context-menu__button + .context-menu__button {
  margin-top: 0.3rem;
}

.context-menu__button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.hp-dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: grid;
  place-items: center;
  background: rgba(29, 32, 33, 0.45);
  backdrop-filter: blur(2px);
}

.hp-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: min(320px, 90vw);
  padding: 1rem 1.1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
}

.hp-dialog__header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.hp-dialog__header h3 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.hp-dialog__species {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}

.hp-dialog__types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  color: var(--ink);
}

.hp-dialog__readout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
  color: var(--ink);
}

.hp-dialog__arrow {
  color: var(--ink-muted);
}

.hp-dialog__preview.is-damage {
  color: #fb4934;
}

.hp-dialog__preview.is-heal {
  color: #b8bb26;
}

.hp-dialog__multiplier {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.12rem 0.55rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  font-weight: 600;
  border: 1px solid currentColor;
}

.hp-dialog__multiplier.is-weak {
  color: #fb4934;
  background: rgba(251, 73, 52, 0.12);
}

.hp-dialog__multiplier.is-resist {
  color: #b8bb26;
  background: rgba(184, 187, 38, 0.12);
}

.hp-dialog__multiplier.is-immune {
  color: var(--ink-muted);
  background: var(--paper);
}

.hp-dialog__mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.hp-dialog__mode-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.hp-dialog__mode-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hp-dialog__mode-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.hp-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hp-dialog__field span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.hp-dialog__select-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
}

.hp-dialog__mode-stat {
  white-space: nowrap;
}

.hp-dialog__field input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.hp-dialog__field input:focus,
.hp-dialog__field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.hp-dialog__field select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  outline: none;
  font: inherit;
  cursor: pointer;
}

.hp-dialog__roll {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.hp-dialog__roll .hp-dialog__button {
  flex: 0 0 auto;
}

.hp-dialog__roll-result {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.hp-dialog__roll-result strong {
  color: var(--ink-bright);
  font-weight: 600;
}

.hp-dialog__roll-empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
  font-style: italic;
}

.hp-dialog__note {
  margin: -0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--ink-muted);
  letter-spacing: 0.01em;
  line-height: 1.4;
}

.hp-dialog__breakdown {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 0.35rem;
  margin: 0;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.hp-dialog__breakdown.is-immune {
  color: var(--ink-muted);
  border-style: dashed;
}

.hp-dialog__breakdown strong {
  color: var(--ink-bright);
  font-weight: 600;
}

.hp-dialog__immune-line {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.hp-dialog__footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.hp-dialog__button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.hp-dialog__button--ghost {
  background: var(--paper);
  color: var(--ink);
}

.hp-dialog__button--ghost:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hp-dialog__button--primary {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.hp-dialog__button--primary:hover:not(:disabled) {
  background: var(--accent);
  color: var(--paper);
}

.hp-dialog__button--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
