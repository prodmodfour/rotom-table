import * as THREE from 'three'
import { BLOCK_FACE_ROLES, applyVoxelFaceMaterialStyle, type VoxelRenderStyle } from './blockTextures'
import {
  DEFAULT_TRAINER_ACCENT_COLOR,
  normalizeTrainerAccentColor,
} from '~/utils/trainerAccent'

/**
 * Tactical cage face palette for isometric footprint/clearance affordances.
 *
 * The classic isometric trick is roughly 100 / 80 / 60 % brightness for
 * top / left / right faces. We keep neutral tactical cages in a
 * white-to-graphite ramp, use warm orange for selected-token feedback, and
 * reserve red for invalid tactical feedback.
 *
 * Opposite faces share roles so 90° azimuth rotations preserve the
 * lighting pattern: ±X faces are always the "shadow" axis, ±Z faces
 * are always the "side" axis, and ±Y is top/bottom.
 */
export const TACTICAL_SELECTION_HIGHLIGHT_COLOR = 0xffb84d

export interface VolumeFacePalette {
  top: number
  side: number
  shadow: number
  bottom: number
}

const DEFAULT_VOLUME_ACCENT_COLOR = Number.parseInt(DEFAULT_TRAINER_ACCENT_COLOR.slice(1), 16)

const clampColorChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)))

const scaleColorChannel = (color: number, shift: number, factor: number): number => (
  clampColorChannel(((color >> shift) & 0xff) * factor)
)

const scaleColor = (color: number, factor: number): number => (
  (scaleColorChannel(color, 16, factor) << 16) |
  (scaleColorChannel(color, 8, factor) << 8) |
  scaleColorChannel(color, 0, factor)
)

const mixColorChannel = (from: number, to: number, shift: number, amount: number): number => {
  const fromChannel = (from >> shift) & 0xff
  const toChannel = (to >> shift) & 0xff
  return clampColorChannel(fromChannel + (toChannel - fromChannel) * amount)
}

const mixColor = (from: number, to: number, amount: number): number => (
  (mixColorChannel(from, to, 16, amount) << 16) |
  (mixColorChannel(from, to, 8, amount) << 8) |
  mixColorChannel(from, to, 0, amount)
)

export const resolveVolumeAccentColor = (accentColor: unknown): number => {
  const normalized = normalizeTrainerAccentColor(accentColor) ?? DEFAULT_TRAINER_ACCENT_COLOR
  const parsed = Number.parseInt(normalized.slice(1), 16)
  return Number.isNaN(parsed) ? DEFAULT_VOLUME_ACCENT_COLOR : parsed
}

export const accentVolumeFacePalette = (accentColor: unknown): VolumeFacePalette => {
  const baseColor = resolveVolumeAccentColor(accentColor)

  return {
    // Keep the actual trainer/app colour on the strongest side while using
    // isometric light/shadow ramps so the tactical clearance volume stays readable.
    top: mixColor(baseColor, 0xffffff, 0.46),
    side: mixColor(baseColor, 0xffffff, 0.14),
    shadow: scaleColor(baseColor, 0.68),
    bottom: scaleColor(baseColor, 0.4),
  }
}

export const TERRAIN_PALETTE = {
  idle: {
    // White/graphite band so a requested tactical cage sits visually above
    // the terrain's brightness range without taking on the active red accent.
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
} as const satisfies Record<string, VolumeFacePalette>

export type TerrainVariant = keyof typeof TERRAIN_PALETTE

const volumeMaterialColors = (palette: VolumeFacePalette): ReadonlyArray<number> => [
  palette.shadow, // +X
  palette.shadow, // -X
  palette.top,    // +Y
  palette.bottom, // -Y
  palette.side,   // +Z
  palette.side,   // -Z
]

/**
 * Build a 6-material array for a ``THREE.BoxGeometry`` with theme-aware
 * face shading. BoxGeometry face groups are ordered
 * ``+X, -X, +Y, -Y, +Z, -Z`` — we map opposing faces to the same role
 * so tactical footprint/clearance cages read consistently regardless of camera azimuth.
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
      // Tactical cages should disappear behind terrain, but their translucent
      // faces must not reserve depth and hide sprites/voxels drawn later.
      depthTest: true,
      depthWrite: false,
    })

  return volumeMaterialColors(palette).map(make)
}

/**
 * Re-tint an existing per-face material array in place. Avoids
 * disposing/recreating materials when state flips (selected,
 * reachable, etc.).
 */
export const paintVolumeFacePalette = (
  materials: THREE.MeshBasicMaterial[],
  palette: VolumeFacePalette,
  opacity: number,
) => {
  const colors = volumeMaterialColors(palette)
  for (let i = 0; i < materials.length; i += 1) {
    materials[i].color.setHex(colors[i])
    materials[i].opacity = opacity
    materials[i].transparent = opacity < 1
    materials[i].depthTest = true
    materials[i].depthWrite = false
  }
}

export const paintVolumeMaterials = (
  materials: THREE.MeshBasicMaterial[],
  variant: TerrainVariant,
  opacity: number,
) => paintVolumeFacePalette(materials, TERRAIN_PALETTE[variant], opacity)

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
    // Terrain voxels are the occluders for sprites and tactical cages, so
    // normal blocks write depth. Preview ghosts opt out via ``depthWrite``.
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
