import * as THREE from 'three'
import type { MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { MapVoxelV2 } from '~/types/map'
import type { AttackOfOpportunityPrompt } from '~/utils/attackOfOpportunity'
import { voxelKey } from '~/utils/voxelOccupancy'

export const SMART_TERRAIN_CUTAWAY_DEFAULT_OPACITY = 0.16
export const SMART_TERRAIN_CUTAWAY_MAX_VOXELS = 64
export const SMART_TERRAIN_CUTAWAY_MAX_HITS_PER_RAY = 3

const FOCUS_POINT_NDC_MARGIN = 0.18
const FOCUS_DISTANCE_EPSILON = 0.025

const XZ_DILATION_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export interface SmartCutawayFocusTokenIdOptions {
  readonly selectedId?: string | null
  readonly activeTurnId?: string | null
  readonly moveAutomationTargeting?: MoveAutomationTargetingOverlayState | null
  readonly hoveredId?: string | null
  readonly attackOfOpportunityPrompts?: readonly AttackOfOpportunityPrompt[] | null
}

export interface SmartCutawayFocusToken {
  readonly center: THREE.Vector3 | { readonly x: number; readonly y: number; readonly z: number }
  readonly base: number
  readonly height: number
  readonly clearance: number
}

export interface SmartTerrainCutawayOptions {
  readonly camera: THREE.Camera
  readonly raycaster: THREE.Raycaster
  readonly voxelMeshes: readonly THREE.Object3D[]
  readonly focusPoints: readonly THREE.Vector3[]
  readonly terrainVoxelKeys?: ReadonlySet<string>
  readonly maxVoxels?: number
  readonly maxHitsPerRay?: number
  readonly dilateXZ?: boolean
  readonly intersections?: THREE.Intersection[]
  readonly ndcMargin?: number
}

export const smartGhostVoxelKeySetSignature = (
  keys: ReadonlySet<string> | null | undefined,
): string => {
  if (!keys?.size) return ''

  return Array.from(keys).sort().join('|')
}

export const smartGhostVoxelKeySetsEqual = (
  left: ReadonlySet<string> | null | undefined,
  right: ReadonlySet<string> | null | undefined,
): boolean => {
  if (left === right) return true
  if ((left?.size ?? 0) !== (right?.size ?? 0)) return false
  if (!left?.size || !right?.size) return true

  for (const key of left) {
    if (!right.has(key)) return false
  }

  return true
}

const appendUniqueId = (target: string[], seen: Set<string>, id: string | null | undefined) => {
  if (!id || seen.has(id)) return

  seen.add(id)
  target.push(id)
}

export const resolveSmartCutawayFocusTokenIds = ({
  selectedId,
  activeTurnId,
  moveAutomationTargeting,
  hoveredId,
  attackOfOpportunityPrompts,
}: SmartCutawayFocusTokenIdOptions): string[] => {
  const ids: string[] = []
  const seen = new Set<string>()

  appendUniqueId(ids, seen, selectedId)
  appendUniqueId(ids, seen, activeTurnId)

  if (moveAutomationTargeting) {
    appendUniqueId(ids, seen, moveAutomationTargeting.userId)
    for (const id of moveAutomationTargeting.affectedIds ?? []) appendUniqueId(ids, seen, id)
    for (const id of moveAutomationTargeting.candidateIds) appendUniqueId(ids, seen, id)
  }

  if (!selectedId) appendUniqueId(ids, seen, hoveredId)

  for (const prompt of attackOfOpportunityPrompts ?? []) {
    appendUniqueId(ids, seen, prompt.attackerId)
    appendUniqueId(ids, seen, prompt.provokerId)
  }

  return ids
}

const safePositive = (value: number, fallback: number): number => (
  Number.isFinite(value) && value > 0 ? value : fallback
)

const focusTokenBodyHeight = (token: Pick<SmartCutawayFocusToken, 'height' | 'clearance'>): number => Math.max(
  safePositive(token.height, 0),
  safePositive(token.clearance, 0),
  1,
)

const focusTokenVisualHeight = (token: Pick<SmartCutawayFocusToken, 'height' | 'clearance'>): number => {
  const height = safePositive(token.height, 0)
  return height > 0 ? height : focusTokenBodyHeight(token)
}

const vectorFromPointLike = (
  point: THREE.Vector3 | { readonly x: number; readonly y: number; readonly z: number },
): THREE.Vector3 => point instanceof THREE.Vector3
  ? point.clone()
  : new THREE.Vector3(point.x, point.y, point.z)

export const smartCutawayFocusPointsForToken = (token: SmartCutawayFocusToken): THREE.Vector3[] => {
  const foot = vectorFromPointLike(token.center)
  const bodyHeight = focusTokenBodyHeight(token)
  const visualHeight = focusTokenVisualHeight(token)
  const base = safePositive(token.base, 1)
  const lateral = Math.min(Math.max(base * 0.34, 0.28), 0.85)
  const chestY = foot.y + Math.max(visualHeight * 0.58, 0.45)
  const headY = foot.y + Math.max(visualHeight * 0.92, 0.85)
  const centerY = foot.y + bodyHeight * 0.5
  const baseY = foot.y + Math.min(Math.max(bodyHeight * 0.12, 0.08), 0.22)

  return [
    new THREE.Vector3(foot.x, centerY, foot.z),
    new THREE.Vector3(foot.x, headY, foot.z),
    new THREE.Vector3(foot.x, baseY, foot.z),
    new THREE.Vector3(foot.x + lateral, chestY, foot.z),
    new THREE.Vector3(foot.x - lateral, chestY, foot.z),
    new THREE.Vector3(foot.x, chestY, foot.z + lateral),
    new THREE.Vector3(foot.x, chestY, foot.z - lateral),
  ]
}

const parseVoxelKey = (key: string): { x: number; y: number; z: number } | null => {
  const [x, y, z, extra] = key.split(',')
  if (extra !== undefined || x === undefined || y === undefined || z === undefined) return null

  const cell = {
    x: Number(x),
    y: Number(y),
    z: Number(z),
  }

  return Number.isInteger(cell.x) && Number.isInteger(cell.y) && Number.isInteger(cell.z)
    ? cell
    : null
}

const voxelKeyFromIntersection = (intersection: THREE.Intersection): string | null => {
  const voxels = intersection.object.userData.voxels as readonly MapVoxelV2[] | undefined
  const voxel = voxels && intersection.instanceId !== undefined
    ? voxels[intersection.instanceId]
    : null

  return voxel ? voxelKey(voxel.x, voxel.y, voxel.z) : null
}

const focusPointWithinRaycastWindow = (point: THREE.Vector3, ndcMargin: number): boolean => {
  const limit = 1 + ndcMargin
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.z)
    && point.z >= -1 - ndcMargin
    && point.z <= 1 + ndcMargin
    && point.x >= -limit
    && point.x <= limit
    && point.y >= -limit
    && point.y <= limit
}

const appendWithCap = (target: Set<string>, key: string, maxVoxels: number): boolean => {
  if (target.size >= maxVoxels) return false

  target.add(key)
  return target.size < maxVoxels
}

const appendDilatedVoxelKeys = (options: {
  readonly target: Set<string>
  readonly sourceKeys: readonly string[]
  readonly terrainVoxelKeys?: ReadonlySet<string>
  readonly maxVoxels: number
}) => {
  for (const key of options.sourceKeys) {
    const cell = parseVoxelKey(key)
    if (!cell) continue

    for (const [dx, dz] of XZ_DILATION_OFFSETS) {
      const dilatedKey = voxelKey(cell.x + dx, cell.y, cell.z + dz)
      if (options.terrainVoxelKeys && !options.terrainVoxelKeys.has(dilatedKey)) continue
      if (!appendWithCap(options.target, dilatedKey, options.maxVoxels)) return
    }
  }
}

export const resolveSmartTerrainCutawayVoxelKeys = ({
  camera,
  raycaster,
  voxelMeshes,
  focusPoints,
  terrainVoxelKeys,
  maxVoxels = SMART_TERRAIN_CUTAWAY_MAX_VOXELS,
  maxHitsPerRay = SMART_TERRAIN_CUTAWAY_MAX_HITS_PER_RAY,
  dilateXZ = true,
  intersections,
  ndcMargin = FOCUS_POINT_NDC_MARGIN,
}: SmartTerrainCutawayOptions): ReadonlySet<string> => {
  const cappedMaxVoxels = Math.max(0, Math.floor(maxVoxels))
  const cappedMaxHitsPerRay = Math.max(0, Math.floor(maxHitsPerRay))
  if (
    cappedMaxVoxels === 0
    || cappedMaxHitsPerRay === 0
    || voxelMeshes.length === 0
    || focusPoints.length === 0
  ) return new Set()

  const sourceKeys: string[] = []
  const sourceKeySet = new Set<string>()
  const pointer = new THREE.Vector2()
  const projected = new THREE.Vector3()
  const scratchIntersections = intersections ?? []

  for (const focusPoint of focusPoints) {
    if (sourceKeySet.size >= cappedMaxVoxels) break

    projected.copy(focusPoint).project(camera)
    if (!focusPointWithinRaycastWindow(projected, ndcMargin)) continue

    pointer.set(projected.x, projected.y)
    raycaster.setFromCamera(pointer, camera)

    scratchIntersections.length = 0
    const hits = raycaster.intersectObjects(voxelMeshes as THREE.Object3D[], false, scratchIntersections)
    const focusDistance = raycaster.ray.origin.distanceTo(focusPoint)
    const perRayKeys = new Set<string>()

    for (const hit of hits) {
      if (hit.distance >= focusDistance - FOCUS_DISTANCE_EPSILON) continue

      const key = voxelKeyFromIntersection(hit)
      if (!key || perRayKeys.has(key)) continue

      perRayKeys.add(key)
      if (!sourceKeySet.has(key)) {
        sourceKeySet.add(key)
        sourceKeys.push(key)
      }

      if (perRayKeys.size >= cappedMaxHitsPerRay || sourceKeySet.size >= cappedMaxVoxels) break
    }
  }

  if (sourceKeys.length === 0) return new Set()
  if (!dilateXZ) return new Set(sourceKeys.slice(0, cappedMaxVoxels))

  const result = new Set<string>()
  appendDilatedVoxelKeys({
    target: result,
    sourceKeys,
    terrainVoxelKeys,
    maxVoxels: cappedMaxVoxels,
  })

  return result
}
