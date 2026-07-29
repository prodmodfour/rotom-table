import type { GridAnchor, MapVoxelV2, TabletopMap } from '~/types/map'
import { footprintsOverlap, gridFootprintCells, isAnchorWithinBounds } from '~/utils/gridGeometry'
import { gridCellsBetweenCellCenters } from '~/utils/gridLineTraversal'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'

export interface CapabilityJumpFootprint {
  readonly id: string
  readonly position: GridAnchor
  readonly base: number
  readonly clearance: number
}

export interface CapabilityJumpTrajectoryResult {
  readonly legal: boolean
  readonly path: readonly GridAnchor[]
  readonly reasonCode: 'jump-trajectory-legal' | 'jump-endpoint-unsupported' | 'jump-trajectory-blocked'
}

const key = (cell: GridAnchor): string => `${cell.x}:${cell.y}:${cell.z}`

const blocksMovement = (voxel: MapVoxelV2): boolean => (
  voxel.blocksMovement ?? getVoxelMaterialDefinition(voxel).blocksMovementDefault ?? false
)

const uniqueAnchors = (anchors: readonly GridAnchor[]): readonly GridAnchor[] => {
  const result: GridAnchor[] = []
  for (const anchor of anchors) {
    if (result.length === 0 || key(result[result.length - 1]!) !== key(anchor)) result.push(anchor)
  }
  return result
}

const compareAnchors = (left: GridAnchor, right: GridAnchor): number => (
  left.x - right.x || left.y - right.y || left.z - right.z
)

const rasterizeCanonicalTrajectory = (
  origin: GridAnchor,
  destination: GridAnchor,
  apexY: number,
): readonly GridAnchor[] => {
  const originDropRoot = Math.sqrt(apexY - origin.y)
  const destinationDropRoot = Math.sqrt(apexY - destination.y)
  const dropRootSum = originDropRoot + destinationDropRoot
  const apexT = dropRootSum === 0 ? 0.5 : originDropRoot / dropRootSum
  const extent = Math.max(
    Math.abs(destination.x - origin.x),
    Math.abs(destination.z - origin.z),
    apexY - Math.min(origin.y, destination.y),
    1,
  )
  // This density keeps successive rounded samples in neighbouring cells even
  // at the steep ends of the parabola. DDA then conservatively closes any
  // boundary gap caused by floating-point rounding.
  const sampleCount = Math.max(8, Math.ceil(extent * 8))
  const parameters = Array.from({ length: sampleCount + 1 }, (_, index) => index / sampleCount)
  if (apexT > 0 && apexT < 1) parameters.push(apexT)
  parameters.sort((left, right) => left - right)

  const sampled = parameters.map((t): GridAnchor => {
    const fromApex = dropRootSum * t - originDropRoot
    return {
      x: Math.round(origin.x + (destination.x - origin.x) * t),
      // A - (sqrt(A-y0) + sqrt(A-y1))²(t-tA)² is the unique
      // downward-opening parabola through both endpoints with maximum A.
      y: Math.round(apexY - fromApex * fromApex),
      z: Math.round(origin.z + (destination.z - origin.z) * t),
    }
  })
  sampled[0] = { ...origin }
  sampled[sampled.length - 1] = { ...destination }

  const anchors: GridAnchor[] = []
  for (const anchor of sampled) {
    if (anchors.length === 0) anchors.push(anchor)
    else anchors.push(...gridCellsBetweenCellCenters(anchors[anchors.length - 1]!, anchor).slice(1))
  }
  return uniqueAnchors(anchors)
}

/**
 * Rasterize a prescribed-apex Jump arc. Valid apexes are integral elevations
 * at or above both endpoints. Endpoint canonicalization makes the discrete
 * path exactly reversible as well as making the continuous parabola symmetric.
 */
export const rasterizeCapabilityJumpTrajectory = (
  origin: GridAnchor,
  destination: GridAnchor,
  apexY: number,
): readonly GridAnchor[] => {
  if (!Number.isSafeInteger(apexY) || apexY < Math.max(origin.y, destination.y)) {
    throw new RangeError('Jump apex must be an integer at or above both endpoints.')
  }
  const reverse = compareAnchors(origin, destination) > 0
  const canonical = rasterizeCanonicalTrajectory(
    reverse ? destination : origin,
    reverse ? origin : destination,
    apexY,
  )
  return reverse ? [...canonical].reverse() : canonical
}

const endpointHasSupport = (
  map: TabletopMap,
  destination: GridAnchor,
  actor: CapabilityJumpFootprint,
  blockingVoxelKeys: ReadonlySet<string>,
): boolean => {
  const groundLevelY = map.groundLevelY ?? 0
  if (destination.y === groundLevelY) return true
  // A landing must have support under every base cell. A wall beside the user
  // is not a landing surface, unlike Teleporter's broader “touching” rule.
  for (let z = destination.z; z < destination.z + actor.base; z += 1) {
    for (let x = destination.x; x < destination.x + actor.base; x += 1) {
      if (!blockingVoxelKeys.has(key({ x, y: destination.y - 1, z }))) return false
    }
  }
  return true
}

const anchorBlocked = (
  map: TabletopMap,
  anchor: GridAnchor,
  actor: CapabilityJumpFootprint,
  otherPlacements: readonly CapabilityJumpFootprint[],
  blockingVoxelKeys: ReadonlySet<string>,
): boolean => {
  if (!isAnchorWithinBounds(anchor, actor, map.dimensions)) return true
  if (gridFootprintCells(anchor, actor).some(cell => blockingVoxelKeys.has(key(cell)))) return true
  return otherPlacements.some(other => footprintsOverlap(
    anchor,
    actor.base,
    actor.clearance,
    other.position,
    other.base,
    other.clearance,
  ))
}

/**
 * Find a collision-free reviewed grid trajectory whose feet never rise above
 * the effective High Jump ceiling. The endpoint must be a genuine landing
 * surface; intervening cells need not be supported.
 */
export const resolveCapabilityJumpTrajectory = (input: {
  readonly map: TabletopMap
  readonly actor: CapabilityJumpFootprint
  readonly otherPlacements: readonly CapabilityJumpFootprint[]
  readonly destination: GridAnchor
  readonly effectiveHighJump: number
}): CapabilityJumpTrajectoryResult => {
  const blockingVoxelKeys = new Set(input.map.voxels.filter(blocksMovement).map(voxel => key(voxel)))
  if (!endpointHasSupport(input.map, input.destination, input.actor, blockingVoxelKeys)) {
    return { legal: false, path: [], reasonCode: 'jump-endpoint-unsupported' }
  }
  const minimumApex = Math.max(input.actor.position.y, input.destination.y)
  const maximumApex = input.actor.position.y + Math.max(0, Math.floor(input.effectiveHighJump))
  if (minimumApex > maximumApex) return { legal: false, path: [], reasonCode: 'jump-trajectory-blocked' }
  for (let apexY = minimumApex; apexY <= maximumApex; apexY += 1) {
    const path = rasterizeCapabilityJumpTrajectory(input.actor.position, input.destination, apexY)
    if (path.slice(1).every(anchor => !anchorBlocked(
      input.map,
      anchor,
      input.actor,
      input.otherPlacements,
      blockingVoxelKeys,
    ))) return { legal: true, path, reasonCode: 'jump-trajectory-legal' }
  }
  return { legal: false, path: [], reasonCode: 'jump-trajectory-blocked' }
}
