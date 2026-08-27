import * as THREE from 'three'
import type { MapVoxelV2 } from '~/types/map'
import { getMaterialDefinition, materialColorNumber } from '~/utils/mapMaterials'
import { parseHexColor } from '~/utils/voxelColors'
import { voxelMaterialId } from '~/utils/voxelMaterials'
import {
  blockHexCss,
  hashString,
  type BlockTextureRole,
} from './blockTextureColors'
import {
  BLOCK_TEXTURE_SIZE,
  paintBlockTexture,
} from './blockTexturePatterns'
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

export const BLOCK_FACE_ROLES: ReadonlyArray<BlockTextureRole> = [
  'shadow', // +X
  'shadow', // -X
  'top', // +Y
  'bottom', // -Y
  'side', // +Z
  'side', // -Z
]
const blockTextureCache = new Map<string, THREE.Texture>()

const configureBlockTexture = (texture: THREE.Texture, markNeedsUpdate = true): THREE.Texture => {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  if (markNeedsUpdate) texture.needsUpdate = true
  return texture
}

const getBlockTexture = (style: VoxelRenderStyle, role: BlockTextureRole): THREE.Texture => {
  const parsedCustomColor = style.color ? parseHexColor(style.color) : null
  const isCustom = parsedCustomColor !== null
  const materialId = voxelMaterialId(style)
  const definition = getMaterialDefinition(materialId)
  const tags = new Set(definition.tags ?? [])
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
  paintBlockTexture(ctx, {
    role,
    seed,
    baseColor,
    materialId,
    tags,
    isCustom,
    transparent: definition.transparent,
  })

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
  for (let i = 0; i < materials.length; i += 1) {
    const material = materials[i]
    const role = BLOCK_FACE_ROLES[i]
    if (!material || !role) continue
    const texture = getBlockTexture(style, role)
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
