import type { LegacyVoxelMaterial, MapMaterialId, MapVoxelV2, MaterialDefinition } from '~/types/map'

const mat = (
  id: string,
  displayName: string,
  color: string,
  tags: string[] = [],
  options: Partial<MaterialDefinition> = {},
): MaterialDefinition => ({ id, displayName, color, tags, ...options })

/**
 * Visual-first material registry. Mechanical defaults live here only when the
 * material clearly implies them; individual voxels may still override flags.
 */
export const MATERIAL_DEFINITIONS: readonly MaterialDefinition[] = [
  mat('airship_hull_dark', 'Airship Hull Dark', '#2f3542', ['airship', 'metal', 'hull'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('airship_floor_metal', 'Airship Floor Metal', '#66717f', ['airship', 'metal', 'floor']),
  mat('airship_wall_bulkhead', 'Airship Wall Bulkhead', '#465160', ['airship', 'metal', 'wall', 'bulkhead'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('reinforced_glass', 'Reinforced Glass', '#8fd5ff', ['airship', 'glass', 'transparent'], { transparent: true, opacity: 0.36, blocksMovementDefault: true, blocksSightDefault: false }),
  mat('observation_wood', 'Observation Wood', '#a47543', ['wood', 'observation', 'deck']),
  mat('meadow_grass', 'Meadow Grass', '#5da130', ['habitat', 'grass', 'organic']),
  mat('soft_nursery_mat', 'Soft Nursery Mat', '#d9a7c7', ['habitat', 'nursery', 'soft']),
  mat('mud', 'Mud', '#70503b', ['habitat', 'mud', 'wet']),
  mat('shallow_water', 'Shallow Water', '#46a9d8', ['habitat', 'water', 'transparent'], { transparent: true, opacity: 0.62, blocksMovementDefault: false, blocksSightDefault: false }),
  mat('deep_water', 'Deep Water', '#1f5f9f', ['habitat', 'water', 'deep', 'transparent'], { transparent: true, opacity: 0.72, blocksMovementDefault: true, blocksSightDefault: false }),
  mat('wetland_bank', 'Wetland Bank', '#7f8f4f', ['habitat', 'wetland', 'bank']),
  mat('cave_stone', 'Cave Stone', '#64656b', ['habitat', 'stone', 'cave'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('burrow_dirt', 'Burrow Dirt', '#8b5a34', ['habitat', 'dirt', 'burrow']),
  mat('thermal_rock', 'Thermal Rock', '#6f4c45', ['habitat', 'thermal', 'stone']),
  mat('thermal_warning_floor', 'Thermal Warning Floor', '#b86b2b', ['habitat', 'thermal', 'warning', 'hazard']),
  mat('snow', 'Snow', '#eef8ff', ['habitat', 'snow', 'ice']),
  mat('ice', 'Ice', '#a7e6ff', ['habitat', 'ice', 'transparent'], { transparent: true, opacity: 0.58 }),
  mat('sand', 'Sand', '#d5c16b', ['habitat', 'sand', 'scrub']),
  mat('scrub_dirt', 'Scrub Dirt', '#a77c4c', ['habitat', 'dirt', 'scrub']),
  mat('electric_insulated_floor', 'Electric Insulated Floor', '#3e5f8a', ['airship', 'electric', 'tech', 'floor']),
  mat('biosecure_poison_floor', 'Biosecure Poison Floor', '#5f7d42', ['airship', 'poison', 'biosecure', 'floor']),
  mat('medical_tile', 'Medical Tile', '#d9f1f2', ['airship', 'medical', 'tile']),
  mat('engineering_floor', 'Engineering Floor', '#5e6570', ['airship', 'engineering', 'metal']),
  mat('cargo_lift_floor', 'Cargo Lift Floor', '#5b646e', ['airship', 'cargo', 'lift', 'metal']),
  mat('hazard_stripe_floor', 'Hazard Stripe Floor', '#c9912c', ['airship', 'hazard', 'stripe', 'warning']),

  // Legacy aliases kept so old maps and build habits do not crash.
  mat('grass', 'Grass (legacy)', '#5da130', ['legacy', 'grass', 'organic']),
  mat('dirt', 'Dirt (legacy)', '#8a5a32', ['legacy', 'dirt']),
  mat('stone', 'Stone (legacy)', '#7d7d7d', ['legacy', 'stone'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('water', 'Water (legacy)', '#2e77d0', ['legacy', 'water', 'transparent'], { transparent: true, opacity: 0.68 }),
  mat('wood', 'Wood (legacy)', '#9a5d2e', ['legacy', 'wood']),
  mat('lava', 'Lava (legacy)', '#ff6d1a', ['legacy', 'thermal', 'lava', 'emissive'], { emissive: '#ff6d1a' }),
  mat('path', 'Path (legacy)', '#9b7653', ['legacy', 'path']),
] as const

export const MATERIAL_BY_ID = new Map<string, MaterialDefinition>(
  MATERIAL_DEFINITIONS.map((definition) => [definition.id, definition]),
)

export const LEGACY_MATERIAL_MAP: Record<LegacyVoxelMaterial, MapMaterialId> = {
  grass: 'meadow_grass',
  dirt: 'burrow_dirt',
  stone: 'airship_wall_bulkhead',
  water: 'shallow_water',
  sand: 'sand',
  snow: 'snow',
  wood: 'observation_wood',
  lava: 'thermal_warning_floor',
  path: 'airship_floor_metal',
}

export const DEFAULT_MATERIAL_ID = 'airship_floor_metal'

export const materialIdForLegacy = (material: string | undefined): string => {
  if (!material) return DEFAULT_MATERIAL_ID
  return LEGACY_MATERIAL_MAP[material as LegacyVoxelMaterial] ?? material
}

export const normalizeMaterialId = (id: string | undefined): string => {
  if (!id) return DEFAULT_MATERIAL_ID
  return MATERIAL_BY_ID.has(id) ? id : materialIdForLegacy(id)
}

export const materialIdForVoxel = (voxel: Pick<MapVoxelV2, 'materialId' | 'material'>): string =>
  normalizeMaterialId(voxel.materialId ?? voxel.material)

export const getMaterialDefinition = (id: string | undefined): MaterialDefinition =>
  MATERIAL_BY_ID.get(normalizeMaterialId(id)) ?? MATERIAL_BY_ID.get(DEFAULT_MATERIAL_ID)!

export const getVoxelMaterialDefinition = (voxel: Pick<MapVoxelV2, 'materialId' | 'material'>): MaterialDefinition =>
  getMaterialDefinition(materialIdForVoxel(voxel))

export const materialColorNumber = (definition: MaterialDefinition): number =>
  Number.parseInt((definition.color ?? '#66717f').replace('#', ''), 16)

export interface MaterialPaletteEntry {
  material: string
  label: string
  baseColor: number
  transparent?: boolean
  opacity?: number
  tags?: string[]
}

export const MAP_MATERIAL_PALETTE: readonly MaterialPaletteEntry[] = MATERIAL_DEFINITIONS
  .filter((definition) => !definition.tags?.includes('legacy'))
  .map((definition) => ({
    material: definition.id,
    label: definition.displayName,
    baseColor: materialColorNumber(definition),
    transparent: definition.transparent,
    opacity: definition.opacity,
    tags: definition.tags,
  }))
