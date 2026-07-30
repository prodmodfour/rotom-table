import type { GridAnchor } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'
import { getClearanceValue, type GridFootprint } from '~/utils/gridGeometry'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import { voxelKey } from '~/utils/voxelOccupancy'

export type MovementTerrainRequirement = 'overland' | 'swim' | 'burrow' | 'aerial'

export interface MapMovementTerrainIndex {
  voxelAt: (x: number, y: number, z: number) => MapVoxelV2 | null
  highestVoxelYBelow: (x: number, y: number, z: number) => number | null
  /** Optional server-owned overlay such as a typed battlefield Slow Terrain zone. */
  slowAt?: (x: number, y: number, z: number) => boolean
}

export type MapMovementTerrainIndexBuilder = (
  voxels: readonly MapVoxelV2[] | null | undefined,
) => MapMovementTerrainIndex

export interface MapMovementTerrainIndexCache {
  get: (
    voxels: readonly MapVoxelV2[] | null | undefined,
    revision: string | number | null | undefined,
  ) => MapMovementTerrainIndex
  clear: () => void
  snapshot: () => {
    revision: string | null
    hasIndex: boolean
  }
}

export interface MapMovementTerrainIndexCacheOptions {
  buildIndex?: MapMovementTerrainIndexBuilder
}

export interface MovementAnchorTerrain {
  blocked: boolean
  requirements: MovementTerrainRequirement[]
  slow: boolean
  air: boolean
  airHeight: number
  hoverable: boolean
  blockingReason?: string
}

interface MovementCellTerrain {
  blocked: boolean
  requirements: MovementTerrainRequirement[]
  slow: boolean
  air: boolean
  airHeight: number
  hoverable: boolean
  blockingReason?: string
}

const EMPTY_TERRAIN: MovementCellTerrain = {
  blocked: false,
  requirements: [],
  slow: false,
  air: false,
  airHeight: 0,
  hoverable: true,
}

const REGULAR_TERRAIN: MovementCellTerrain = {
  blocked: false,
  requirements: ['overland'],
  slow: false,
  air: false,
  airHeight: 0,
  hoverable: true,
}

const SLOW_TERRAIN_TAGS = new Set([
  'ice',
  'mud',
  'muck',
  'snow',
  'slow-terrain',
])

export const mapMovementTerrainTagsForVoxel = (voxel: MapVoxelV2): ReadonlySet<string> => {
  const material = getVoxelMaterialDefinition(voxel)
  return new Set([...(material.tags ?? []), ...(voxel.tags ?? [])].map((tag) => tag.toLowerCase()))
}

const materialBlocksMovement = (voxel: MapVoxelV2): boolean => {
  const material = getVoxelMaterialDefinition(voxel)
  return voxel.blocksMovement ?? material.blocksMovementDefault ?? true
}

export const buildMapMovementTerrainIndex = (
  voxels: readonly MapVoxelV2[] | null | undefined,
): MapMovementTerrainIndex => {
  const byKey = new Map<string, MapVoxelV2>()
  const columnYs = new Map<string, number[]>()
  for (const voxel of voxels ?? []) {
    byKey.set(voxelKey(voxel.x, voxel.y, voxel.z), voxel)
    const columnKey = `${voxel.x},${voxel.z}`
    const ys = columnYs.get(columnKey)
    if (ys) ys.push(voxel.y)
    else columnYs.set(columnKey, [voxel.y])
  }
  for (const ys of columnYs.values()) ys.sort((left, right) => right - left)

  return {
    voxelAt: (x, y, z) => byKey.get(voxelKey(x, y, z)) ?? null,
    highestVoxelYBelow: (x, y, z) => columnYs.get(`${x},${z}`)?.find((voxelY) => voxelY < y) ?? null,
  }
}

export const createMapMovementTerrainIndexCache = (
  options: MapMovementTerrainIndexCacheOptions = {},
): MapMovementTerrainIndexCache => {
  const buildIndex = options.buildIndex ?? buildMapMovementTerrainIndex
  let cachedRevision: string | null = null
  let cachedIndex: MapMovementTerrainIndex | null = null

  return {
    get: (voxels, revision) => {
      if (revision == null) {
        return buildIndex(voxels)
      }

      const revisionKey = String(revision)
      if (cachedIndex && cachedRevision === revisionKey) {
        return cachedIndex
      }

      const nextIndex = buildIndex(voxels)
      cachedRevision = revisionKey
      cachedIndex = nextIndex
      return nextIndex
    },
    clear: () => {
      cachedRevision = null
      cachedIndex = null
    },
    snapshot: () => ({
      revision: cachedRevision,
      hasIndex: Boolean(cachedIndex),
    }),
  }
}

const uniqueRequirements = (
  requirements: readonly MovementTerrainRequirement[],
): MovementTerrainRequirement[] => Array.from(new Set(requirements))

const isSlowTaggedTerrain = (tags: ReadonlySet<string>): boolean =>
  !tags.has('basic-terrain') && Array.from(SLOW_TERRAIN_TAGS).some((tag) => tags.has(tag))

const isWaterTerrain = (tags: ReadonlySet<string>): boolean => tags.has('water')

const isDeepWaterTerrain = (voxel: MapVoxelV2, tags: ReadonlySet<string>): boolean =>
  tags.has('deep') || voxel.materialId === 'deep_water'

const isBurrowTerrain = (tags: ReadonlySet<string>): boolean => tags.has('burrow')

const occupiedVoxelTerrain = (voxel: MapVoxelV2): MovementCellTerrain => {
  const tags = mapMovementTerrainTagsForVoxel(voxel)
  const blocksMovement = materialBlocksMovement(voxel)

  if (isWaterTerrain(tags)) {
    return {
      blocked: false,
      requirements: ['swim'],
      slow: false,
      air: false,
      airHeight: 0,
      hoverable: true,
    }
  }

  if (blocksMovement) {
    if (isBurrowTerrain(tags)) {
      return {
        blocked: false,
        requirements: ['burrow'],
        slow: false,
        air: false,
        airHeight: 0,
        hoverable: false,
      }
    }

    return {
      blocked: true,
      requirements: [],
      slow: false,
      air: false,
      airHeight: 0,
      hoverable: false,
      blockingReason: 'blocking terrain',
    }
  }

  return {
    blocked: false,
    requirements: ['overland'],
    slow: isSlowTaggedTerrain(tags),
    air: false,
    airHeight: 0,
    hoverable: true,
  }
}

const surfaceVoxelTerrain = (voxel: MapVoxelV2): MovementCellTerrain => {
  const tags = mapMovementTerrainTagsForVoxel(voxel)

  if (isWaterTerrain(tags)) {
    return {
      blocked: false,
      requirements: isDeepWaterTerrain(voxel, tags) ? ['swim'] : ['overland'],
      slow: !isDeepWaterTerrain(voxel, tags),
      air: false,
      airHeight: 0,
      hoverable: true,
    }
  }

  return {
    blocked: false,
    requirements: ['overland'],
    slow: isSlowTaggedTerrain(tags),
    air: false,
    airHeight: 0,
    hoverable: true,
  }
}

const cellTerrainAt = ({
  x,
  y,
  z,
  terrain,
  groundLevelY,
}: {
  x: number
  y: number
  z: number
  terrain: MapMovementTerrainIndex
  groundLevelY: number
}): MovementCellTerrain => {
  const withSlowOverlay = (value: MovementCellTerrain): MovementCellTerrain => (
    terrain.slowAt?.(x, y, z) === true && !value.blocked
      ? { ...value, slow: true }
      : value
  )
  const occupied = terrain.voxelAt(x, y, z)
  if (occupied) return withSlowOverlay(occupiedVoxelTerrain(occupied))

  const underfoot = terrain.voxelAt(x, y - 1, z)
  if (underfoot) return withSlowOverlay(surfaceVoxelTerrain(underfoot))

  if (y > groundLevelY) {
    const surfaceY = terrain.highestVoxelYBelow(x, y, z)
    return withSlowOverlay({
      blocked: false,
      requirements: ['aerial'],
      slow: false,
      air: true,
      airHeight: Math.max(0, y - (surfaceY == null ? groundLevelY : surfaceY + 1)),
      hoverable: false,
    })
  }

  return withSlowOverlay(REGULAR_TERRAIN)
}

const mergeCellTerrain = (cells: readonly MovementCellTerrain[]): MovementAnchorTerrain => {
  const blocked = cells.find((cell) => cell.blocked)
  if (blocked) {
    return {
      blocked: true,
      requirements: [],
      slow: false,
      air: false,
      airHeight: 0,
      hoverable: false,
      blockingReason: blocked.blockingReason,
    }
  }

  return {
    blocked: false,
    requirements: uniqueRequirements(cells.flatMap((cell) => cell.requirements)),
    slow: cells.some((cell) => cell.slow),
    air: cells.some((cell) => cell.air),
    airHeight: Math.max(0, ...cells.map((cell) => cell.airHeight)),
    hoverable: cells.every((cell) => cell.hoverable),
  }
}

export const movementTerrainForAnchor = ({
  anchor,
  footprint,
  terrain,
  groundLevelY,
}: {
  anchor: GridAnchor
  footprint: GridFootprint
  terrain: MapMovementTerrainIndex
  groundLevelY: number
}): MovementAnchorTerrain => {
  const base = Math.max(1, Math.trunc(footprint.base))
  const clearance = Math.max(1, Math.trunc(getClearanceValue(footprint)))
  const cells: MovementCellTerrain[] = []

  for (let y = anchor.y; y < anchor.y + clearance; y += 1) {
    for (let z = anchor.z; z < anchor.z + base; z += 1) {
      for (let x = anchor.x; x < anchor.x + base; x += 1) {
        const occupied = terrain.voxelAt(x, y, z)
        if (occupied) cells.push(occupiedVoxelTerrain(occupied))
      }
    }
  }

  for (let z = anchor.z; z < anchor.z + base; z += 1) {
    for (let x = anchor.x; x < anchor.x + base; x += 1) {
      cells.push(cellTerrainAt({ x, y: anchor.y, z, terrain, groundLevelY }))
    }
  }

  return mergeCellTerrain(cells.length ? cells : [EMPTY_TERRAIN])
}
