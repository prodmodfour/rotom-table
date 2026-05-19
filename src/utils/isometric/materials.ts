import * as THREE from 'three'
import { BLOCK_FACE_ROLES, applyVoxelFaceMaterialStyle, type VoxelRenderStyle } from './blockTextures'

/**
 * Black / white / orange / red terrain palette for isometric face shading.
 *
 * The classic isometric trick is roughly 100 / 80 / 60 % brightness for
 * top / left / right faces. We keep neutral cages in a white-to-graphite
 * ramp, use warm orange for selected-token feedback, and reserve red for
 * invalid tactical feedback.
 *
 * Opposite faces share roles so 90° azimuth rotations preserve the
 * lighting pattern: ±X faces are always the "shadow" axis, ±Z faces
 * are always the "side" axis, and ±Y is top/bottom.
 */
export const TACTICAL_SELECTION_HIGHLIGHT_COLOR = 0xffb84d

export const TERRAIN_PALETTE = {
  idle: {
    // White/graphite band so the cage sits visually above the terrain's
    // brightness range without taking on the active red accent.
    top:    0xdfe3e8, // white-soft — lit top
    side:   0xaeb5bd, // white-muted — Z-perp visible side
    shadow: 0x66707a, // faint steel — X-perp shadowed side
    bottom: 0x29303a, // steel-2 — floor of the cage (rarely seen)
  },
  selected: {
    top:    0xffd18a,
    side:   TACTICAL_SELECTION_HIGHLIGHT_COLOR,
    shadow: 0xd98220,
    bottom: 0x6a3908,
  },
  reachable: {
    top:    0xf7f7f2,
    side:   0xdfe3e8,
    shadow: 0xaeb5bd,
    bottom: 0x66707a,
  },
  unreachable: {
    top:    0xff4a55,
    side:   0xd7192c,
    shadow: 0x9d0b1c,
    bottom: 0x5a0710,
  },
} as const

export type TerrainVariant = keyof typeof TERRAIN_PALETTE

/**
 * Build a 6-material array for a ``THREE.BoxGeometry`` with theme-aware
 * face shading. BoxGeometry face groups are ordered
 * ``+X, -X, +Y, -Y, +Z, -Z`` — we map opposing faces to the same role
 * so the box reads consistently regardless of camera azimuth.
 */
export const buildVolumeMaterials = (
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
export const paintVolumeMaterials = (
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
 * Build a 6-material array for a textured voxel block. BoxGeometry face
 * groups are ordered ``+X, -X, +Y, -Y, +Z, -Z``; each face gets the
 * matching Minecraft-style pixel texture from ``BLOCK_FACE_ROLES``.
 */
export const buildVoxelFaceMaterials = (
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
export const paintBuildGhostMaterials = (
  materials: THREE.MeshBasicMaterial[],
  style: VoxelRenderStyle,
  opacity: number,
) => {
  applyVoxelFaceMaterialStyle(materials, style, opacity, false)
}
