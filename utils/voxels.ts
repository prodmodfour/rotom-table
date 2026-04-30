/**
 * Voxel terrain helpers.
 *
 * Voxels are 1×1×1 cubes stored sparsely as ``GridVoxel`` records.
 * This module exposes:
 *
 *   • A fixed material palette (``VOXEL_MATERIALS``) with blocky,
 *     Minecraft-inspired base colors used by swatches and custom fills.
 *   • Per-face palette derivation (``buildFacePalette``) implementing
 *     the standard isometric brightness ramp (top 100 / sides 80 /
 *     shadow 62 / bottom 42 %).
 *   • Hex-color helpers for the custom-color picker.
 *   • Occupancy / collision helpers used by both pathfinding (mons
 *     can't walk through voxels) and build-mode placement (can't
 *     place a voxel inside a mon).
 */
import type { GridAnchor } from '~/types/pokemon'
import type { GridVoxel, VoxelMaterial } from '~/types/map'

export interface VoxelMaterialDef {
  material: VoxelMaterial
  label: string
  /** Top-face hex; sides/shadow/bottom are derived. */
  baseColor: number
}

export const VOXEL_MATERIALS: ReadonlyArray<VoxelMaterialDef> = [
  { material: 'grass', label: 'Grass', baseColor: 0x5da130 },
  { material: 'dirt',  label: 'Dirt',  baseColor: 0x8a5a32 },
  { material: 'stone', label: 'Stone', baseColor: 0x7d7d7d },
  { material: 'water', label: 'Water', baseColor: 0x2e77d0 },
  { material: 'sand',  label: 'Sand',  baseColor: 0xd5c16b },
  { material: 'snow',  label: 'Snow',  baseColor: 0xf4fbff },
  { material: 'wood',  label: 'Wood',  baseColor: 0x9a5d2e },
  { material: 'lava',  label: 'Lava',  baseColor: 0xff6d1a },
  { material: 'path',  label: 'Path',  baseColor: 0x9b7653 },
]

const MATERIAL_INDEX = new Map<VoxelMaterial, VoxelMaterialDef>(
  VOXEL_MATERIALS.map((def) => [def.material, def]),
)

export const getMaterialDef = (material: VoxelMaterial): VoxelMaterialDef =>
  MATERIAL_INDEX.get(material) ?? VOXEL_MATERIALS[0]

export interface VoxelFacePalette {
  top: number
  side: number
  shadow: number
  bottom: number
}

const scaleColorChannel = (channel: number, factor: number) =>
  Math.min(255, Math.max(0, Math.round(channel * factor)))

const scaleColor = (hex: number, factor: number) =>
  (scaleColorChannel((hex >> 16) & 0xff, factor) << 16) |
  (scaleColorChannel((hex >> 8) & 0xff, factor) << 8) |
  scaleColorChannel(hex & 0xff, factor)

export const buildFacePalette = (baseColor: number): VoxelFacePalette => ({
  top:    baseColor,
  side:   scaleColor(baseColor, 0.8),
  shadow: scaleColor(baseColor, 0.62),
  bottom: scaleColor(baseColor, 0.42),
})

export const parseHexColor = (input: string): number | null => {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(input.trim())
  if (!match) return null
  return parseInt(match[1], 16)
}

export const hexColorString = (hex: number): string =>
  `#${hex.toString(16).padStart(6, '0')}`

export const voxelBaseColor = (voxel: GridVoxel): number => {
  if (voxel.color) {
    const parsed = parseHexColor(voxel.color)
    if (parsed !== null) return parsed
  }
  return getMaterialDef(voxel.material).baseColor
}

export const voxelFacePalette = (voxel: GridVoxel): VoxelFacePalette =>
  buildFacePalette(voxelBaseColor(voxel))

/**
 * Bucket key for sharing an ``InstancedMesh`` across visually identical
 * voxels. Custom-colored voxels group by color; preset voxels group by
 * material name.
 */
export const voxelGroupKey = (voxel: GridVoxel): string => {
  if (voxel.color) {
    const parsed = parseHexColor(voxel.color)
    if (parsed !== null) return `c:${parsed.toString(16).padStart(6, '0')}`
  }
  return `m:${voxel.material}`
}

export const voxelKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

export const voxelKeyOf = (voxel: GridVoxel): string => voxelKey(voxel.x, voxel.y, voxel.z)

export const buildVoxelOccupancy = (voxels: ReadonlyArray<GridVoxel>): Set<string> => {
  const set = new Set<string>()
  for (const v of voxels) set.add(voxelKey(v.x, v.y, v.z))
  return set
}

export const footprintOverlapsVoxels = (
  position: GridAnchor,
  base: number,
  clearance: number,
  voxelKeys: ReadonlySet<string>,
): boolean => {
  if (voxelKeys.size === 0) return false
  for (let dx = 0; dx < base; dx += 1) {
    for (let dy = 0; dy < clearance; dy += 1) {
      for (let dz = 0; dz < base; dz += 1) {
        if (voxelKeys.has(voxelKey(position.x + dx, position.y + dy, position.z + dz))) {
          return true
        }
      }
    }
  }
  return false
}

export interface PokemonFootprintCell {
  position: GridAnchor
  base: number
  clearance: number
}

export const cellInsidePokemonFootprint = (
  x: number,
  y: number,
  z: number,
  pokemons: ReadonlyArray<PokemonFootprintCell>,
): boolean => {
  for (const p of pokemons) {
    if (
      x >= p.position.x &&
      x < p.position.x + p.base &&
      y >= p.position.y &&
      y < p.position.y + p.clearance &&
      z >= p.position.z &&
      z < p.position.z + p.base
    ) {
      return true
    }
  }
  return false
}

export const filterVoxelsInBounds = (
  voxels: ReadonlyArray<GridVoxel>,
  dimensions: { x: number; y: number; z: number },
): GridVoxel[] =>
  voxels.filter(
    (v) =>
      v.x >= 0 &&
      v.x < dimensions.x &&
      v.y >= 0 &&
      v.y < dimensions.y &&
      v.z >= 0 &&
      v.z < dimensions.z,
  )
