import * as THREE from 'three'
import { BLOCK_FACE_ROLES, applyVoxelFaceMaterialStyle, type VoxelRenderStyle } from './blockTextures'

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
export const TERRAIN_PALETTE = {
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

export type TerrainVariant = keyof typeof TERRAIN_PALETTE

/**
 * Build a 6-material array for a ``THREE.BoxGeometry`` with gruvbox
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
