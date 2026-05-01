import type { MapVoxelV2, MaterialDefinition } from '~/types/map'

const mat = (
  id: string,
  displayName: string,
  color: string,
  tags: string[] = [],
  options: Partial<MaterialDefinition> = {},
): MaterialDefinition => ({ id, displayName, color, tags, ...options })

// The Clear Water 4.0 pack in temp/ provides clear-water fog/wave/caustic
// settings but no explicit block opacity, so water voxels use the requested
// 50% opacity fallback.
const CLEAR_WATER_TEXTURE_PACK = 'clear-water-4.0'
const CLEAR_WATER_OPACITY = 0.5

/**
 * Visual-first material registry. Mechanical defaults live here only when the
 * material clearly implies them; individual voxels may still override flags.
 *
 * These definitions are the material palette used by map voxels.
 */
export const MATERIAL_DEFINITIONS: readonly MaterialDefinition[] = [
  mat('airship_hull_dark', 'Airship Hull Dark', '#2f3542', ['airship', 'metal', 'hull'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('airship_floor_metal', 'Airship Floor Metal', '#66717f', ['airship', 'metal', 'floor']),
  mat('airship_floor_plating', 'Airship Floor Plating', '#778392', ['airship', 'metal', 'floor', 'panel']),
  mat('airship_wall_bulkhead', 'Airship Wall Bulkhead', '#465160', ['airship', 'metal', 'wall', 'bulkhead'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('reinforced_glass', 'Reinforced Glass', '#8fd5ff', ['airship', 'glass', 'transparent'], { transparent: true, opacity: 0.36, blocksMovementDefault: true, blocksSightDefault: false }),
  mat('observation_wood', 'Observation Wood', '#a47543', ['wood', 'observation', 'deck']),
  mat('meadow_grass', 'Meadow Grass', '#5da130', ['habitat', 'grass', 'organic']),
  mat('meadow_flower_grass', 'Flowering Meadow Grass', '#68ad3d', ['habitat', 'grass', 'meadow', 'flowers', 'organic']),
  mat('grove_leaf_litter', 'Grove Leaf Litter', '#58713a', ['habitat', 'grove', 'leaf', 'organic']),
  mat('soft_nursery_mat', 'Soft Nursery Mat', '#d9a7c7', ['habitat', 'nursery', 'soft']),
  mat('mud', 'Mud', '#70503b', ['habitat', 'mud', 'wet']),
  mat('shoreline_pebbles', 'Shoreline Pebbles', '#8a876d', ['habitat', 'shoreline', 'pebble', 'wetland']),
  mat('shallow_water', 'Shallow Water', '#46a9d8', ['habitat', 'water', 'transparent'], { texture: CLEAR_WATER_TEXTURE_PACK, transparent: true, opacity: CLEAR_WATER_OPACITY, blocksMovementDefault: false, blocksSightDefault: false }),
  mat('deep_water', 'Deep Water', '#1f5f9f', ['habitat', 'water', 'deep', 'transparent'], { texture: CLEAR_WATER_TEXTURE_PACK, transparent: true, opacity: CLEAR_WATER_OPACITY, blocksMovementDefault: true, blocksSightDefault: false }),
  mat('wetland_bank', 'Wetland Bank', '#7f8f4f', ['habitat', 'wetland', 'bank']),
  mat('cave_stone', 'Cave Stone', '#64656b', ['habitat', 'stone', 'cave'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('cave_shadow_stone', 'Cave Shadow Stone', '#4f5058', ['habitat', 'stone', 'cave', 'shadow'], { blocksMovementDefault: true, blocksSightDefault: true }),
  mat('burrow_dirt', 'Burrow Dirt', '#8b5a34', ['habitat', 'dirt', 'burrow']),
  mat('thermal_rock', 'Thermal Rock', '#6f4c45', ['habitat', 'thermal', 'stone']),
  mat('thermal_warning_floor', 'Thermal Warning Floor', '#b86b2b', ['habitat', 'thermal', 'warning', 'hazard']),
  mat('snow', 'Snow', '#eef8ff', ['habitat', 'snow', 'ice']),
  mat('cryo_snowpack', 'Cryo Snowpack', '#dbeefa', ['habitat', 'snow', 'ice', 'cryo']),
  mat('ice', 'Ice', '#a7e6ff', ['habitat', 'ice', 'transparent'], { transparent: true, opacity: 0.58 }),
  mat('sand', 'Sand', '#d5c16b', ['habitat', 'sand', 'scrub']),
  mat('desert_scrub_sand', 'Desert Scrub Sand', '#c9aa62', ['habitat', 'sand', 'scrub', 'desert']),
  mat('scrub_dirt', 'Scrub Dirt', '#a77c4c', ['habitat', 'dirt', 'scrub']),
  mat('electric_insulated_floor', 'Electric Insulated Floor', '#3e5f8a', ['airship', 'electric', 'tech', 'floor']),
  mat('biosecure_poison_floor', 'Biosecure Poison Floor', '#5f7d42', ['airship', 'poison', 'biosecure', 'floor']),
  mat('medical_tile', 'Medical Tile', '#d9f1f2', ['airship', 'medical', 'tile']),
  mat('facility_clean_tile', 'Facility Clean Tile', '#cfe6e8', ['facility', 'medical', 'tile', 'clean']),
  mat('quarantine_tile', 'Quarantine Tile', '#8fb06a', ['facility', 'poison', 'biosecure', 'quarantine', 'tile']),
  mat('decon_grate', 'Decon Grate', '#8aa0a6', ['facility', 'medical', 'decon', 'metal']),
  mat('nursery_soft_pad', 'Nursery Soft Pad', '#e6b6d8', ['facility', 'nursery', 'soft', 'egg']),
  mat('engineering_floor', 'Engineering Floor', '#5e6570', ['airship', 'engineering', 'metal']),
  mat('cargo_lift_floor', 'Cargo Lift Floor', '#5b646e', ['airship', 'cargo', 'lift', 'metal']),
  mat('hazard_stripe_floor', 'Hazard Stripe Floor', '#c9912c', ['airship', 'hazard', 'stripe', 'warning']),

] as const

export const MATERIAL_BY_ID = new Map<string, MaterialDefinition>(
  MATERIAL_DEFINITIONS.map((definition) => [definition.id, definition]),
)

export const DEFAULT_MATERIAL_ID = 'airship_floor_metal'

export const normalizeMaterialId = (id: string | undefined): string => {
  if (!id) return DEFAULT_MATERIAL_ID
  if (MATERIAL_BY_ID.has(id)) return id
  return id
}

export const materialIdForVoxel = (voxel: Pick<MapVoxelV2, 'materialId'>): string =>
  normalizeMaterialId(voxel.materialId)

export const getMaterialDefinition = (id: string | undefined): MaterialDefinition =>
  MATERIAL_BY_ID.get(normalizeMaterialId(id)) ?? MATERIAL_BY_ID.get(DEFAULT_MATERIAL_ID)!

export const getVoxelMaterialDefinition = (voxel: Pick<MapVoxelV2, 'materialId'>): MaterialDefinition =>
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

export const getMapMaterialPalette = (): MaterialPaletteEntry[] => Array.from(MATERIAL_BY_ID.values())
  .map((definition) => ({
    material: definition.id,
    label: definition.displayName,
    baseColor: materialColorNumber(definition),
    transparent: definition.transparent,
    opacity: definition.opacity,
    tags: definition.tags,
  }))

export const MAP_MATERIAL_PALETTE: readonly MaterialPaletteEntry[] = getMapMaterialPalette()
