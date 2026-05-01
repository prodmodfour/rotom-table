import type { DoorPlacement, MapVoxelV2, PropPlacement } from '~/types/map'
import { getDoorDefinition, getPropDefinition } from './mapAssets'
import { getVoxelMaterialDefinition } from './mapMaterials'
import { voxelKey } from './voxels'

export interface BuildMapOccupancyOptions {
  voxels?: ReadonlyArray<MapVoxelV2>
  props?: ReadonlyArray<PropPlacement>
  doors?: ReadonlyArray<DoorPlacement>
  /**
   * Movement should normally include transparent blockers: glass walls,
   * glass gates, ice crystals, etc. Set false only for tooling that wants an
   * "opaque-only" occupancy pass.
   */
  includeTransparent?: boolean
  /**
   * Movement should normally ignore open doors. This opt-in is reserved for
   * tooling that wants the full doorway footprint regardless of state.
   */
  includeOpenDoors?: boolean
}

const DEFAULT_PROP_FOOTPRINT = { x: 1, z: 1 }
const DEFAULT_PROP_HEIGHT = 1
const DEFAULT_DOOR_WIDTH = 1
const DEFAULT_DOOR_HEIGHT = 2
const EPSILON = 1e-6

const positiveOr = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const addVolumeCells = (
  occupied: Set<string>,
  originX: number,
  originY: number,
  originZ: number,
  width: number,
  height: number,
  depth: number,
) => {
  const minX = Math.floor(originX)
  const minY = Math.floor(originY)
  const minZ = Math.floor(originZ)
  const maxX = Math.ceil(originX + Math.max(width, EPSILON) - EPSILON)
  const maxY = Math.ceil(originY + Math.max(height, EPSILON) - EPSILON)
  const maxZ = Math.ceil(originZ + Math.max(depth, EPSILON) - EPSILON)

  for (let x = minX; x < maxX; x += 1) {
    for (let y = minY; y < maxY; y += 1) {
      for (let z = minZ; z < maxZ; z += 1) {
        occupied.add(voxelKey(x, y, z))
      }
    }
  }
}

const propScaleVector = (placement: PropPlacement) => {
  if (typeof placement.scale === 'number') {
    return { x: placement.scale, y: placement.scale, z: placement.scale }
  }
  return placement.scale ?? { x: 1, y: 1, z: 1 }
}

const propBlocksMovement = (placement: PropPlacement): boolean => {
  if (placement.blocksMovement != null) return placement.blocksMovement
  const definition = getPropDefinition(placement.propId)
  return definition?.blocksMovementDefault ?? false
}

const addPropOccupancy = (
  occupied: Set<string>,
  placement: PropPlacement,
  includeTransparent: boolean,
) => {
  if (!propBlocksMovement(placement)) return

  const definition = getPropDefinition(placement.propId)
  if (!includeTransparent && definition?.transparent) return

  const scale = propScaleVector(placement)
  const baseFootprint = placement.footprint ?? definition?.footprint ?? DEFAULT_PROP_FOOTPRINT
  const width = positiveOr(baseFootprint.x * scale.x, DEFAULT_PROP_FOOTPRINT.x)
  const depth = positiveOr(baseFootprint.z * scale.z, DEFAULT_PROP_FOOTPRINT.z)
  const height = positiveOr((placement.height ?? definition?.height ?? DEFAULT_PROP_HEIGHT) * scale.y, DEFAULT_PROP_HEIGHT)
  const originX = placement.anchor === 'center'
    ? placement.position.x - width / 2
    : placement.position.x
  const originZ = placement.anchor === 'center'
    ? placement.position.z - depth / 2
    : placement.position.z

  addVolumeCells(occupied, originX, placement.position.y, originZ, width, height, depth)
}

const normalizedQuarterTurns = (rotation: number | undefined): number => {
  const turns = Math.round((rotation ?? 0) / 90)
  return ((turns % 4) + 4) % 4
}

const addDoorOccupancy = (
  occupied: Set<string>,
  placement: DoorPlacement,
  includeTransparent: boolean,
  includeOpenDoors: boolean,
) => {
  const state = placement.state ?? 'closed'
  if (state === 'open' && !includeOpenDoors) return

  const definition = getDoorDefinition(placement.doorId)
  if (!includeTransparent && definition?.transparent) return

  const width = positiveOr(placement.width ?? definition?.defaultWidth, DEFAULT_DOOR_WIDTH)
  const height = positiveOr(placement.height ?? definition?.defaultHeight, DEFAULT_DOOR_HEIGHT)
  const quarterTurns = normalizedQuarterTurns(placement.rotation)
  const spansZ = quarterTurns % 2 === 1
  const footprintX = spansZ ? 1 : width
  const footprintZ = spansZ ? width : 1

  addVolumeCells(
    occupied,
    placement.position.x,
    placement.position.y,
    placement.position.z,
    footprintX,
    height,
    footprintZ,
  )
}

/**
 * Build movement occupancy for map terrain plus v2 objects.
 *
 * The returned Set uses the same `"x,y,z"` cell keys as voxel helpers and is
 * intentionally conservative: any grid cell touched by a blocking object's
 * footprint/height is marked occupied so existing token placement and BFS
 * pathfinding can consume it without understanding props or doors directly.
 */
export const buildMapOccupancy = ({
  voxels = [],
  props = [],
  doors = [],
  includeTransparent = true,
  includeOpenDoors = false,
}: BuildMapOccupancyOptions): Set<string> => {
  const occupied = new Set<string>()

  for (const voxel of voxels) {
    const material = getVoxelMaterialDefinition(voxel)
    if (!includeTransparent && material.transparent) continue
    const blocks = voxel.blocksMovement ?? material.blocksMovementDefault ?? true
    if (blocks) occupied.add(voxelKey(voxel.x, voxel.y, voxel.z))
  }

  for (const prop of props) addPropOccupancy(occupied, prop, includeTransparent)
  for (const door of doors) addDoorOccupancy(occupied, door, includeTransparent, includeOpenDoors)

  return occupied
}
