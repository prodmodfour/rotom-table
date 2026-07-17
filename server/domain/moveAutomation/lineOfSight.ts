import type { MapVoxelV2 } from '~/types/map'
import type { GridAnchor } from '~/types/pokemon'
import {
  gridCellKey,
  gridCellsBetweenCellCenters,
} from '~/utils/gridLineTraversal'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import type { MoveAutomationBarrierSightCell } from './barriersAndSmoke'

/** PTU Core p.231: targeting through Rough Terrain applies one -2 penalty. */
export const MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER = -2 as const

export const MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS = Object.freeze({
  identifierChars: 160,
  footprintExtent: 32,
  footprintCells: 512,
  /** Covers a diagonal across the maximum normalized 200×200×200 map. */
  rayCells: 1_024,
  /** Above the largest pair of canonical creature footprints (320 × 320). */
  footprintRays: 131_072,
})

export type MoveAutomationLineOfSightVisibility =
  | 'full'
  | 'partial'
  | 'none'
  | 'unavailable'

export type MoveAutomationLineOfSightCover =
  | 'none'
  | 'rough-terrain'
  | 'blocked'

export type MoveAutomationLineOfSightReasonCode =
  | 'line-of-sight-clear'
  | 'line-of-sight-rough-cover'
  | 'line-of-sight-blocked-voxel'
  | 'line-of-sight-blocked-placement'
  | 'line-of-sight-blocked-mixed'
  | 'line-of-sight-blocked-barrier'
  | 'line-of-sight-source-missing'
  | 'line-of-sight-target-missing'

/**
 * Server-projected placement geometry. Ordinary placements provide Rough
 * Terrain cover. `blocksSight` is reserved for authoritative effects that make
 * a combatant Blocking Terrain; it is not a map-placement wire field.
 */
export interface MoveAutomationLineOfSightPlacement {
  readonly id: string
  readonly position: GridAnchor
  readonly base: number
  readonly clearance?: number
  readonly blocksSight?: boolean
}

export interface MoveAutomationLineOfSightPolicy {
  /** Reviewed exceptions such as Groundsource may ignore Blocking Terrain. */
  readonly ignoreBlockingTerrain?: boolean
  /** Reviewed exceptions such as Groundsource may ignore Rough Terrain. */
  readonly ignoreRoughTerrain?: boolean
}

export interface MoveAutomationLineOfSightResult {
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly policy: Readonly<Required<MoveAutomationLineOfSightPolicy>>
  /** The legality value consumed by target selection. */
  readonly targetable: boolean
  /** The modifier from the same selected legal sight line. */
  readonly accuracyModifier: number
  readonly visibility: MoveAutomationLineOfSightVisibility
  readonly cover: MoveAutomationLineOfSightCover
  readonly reasonCode: MoveAutomationLineOfSightReasonCode
  /** Deterministically selected least-obstructed source/target cell pair. */
  readonly originCell: GridAnchor | null
  readonly targetCell: GridAnchor | null
  /** Target footprint cells visible from at least one source footprint cell. */
  readonly visibleTargetCells: readonly GridAnchor[]
  readonly targetFootprintCellCount: number
  /** Blocking evidence from the least-obstructed representative blocked ray. */
  readonly blockingVoxelCells: readonly GridAnchor[]
  readonly blockingPlacementIds: readonly string[]
  readonly blockingZoneIds: readonly string[]
  /** Rough Terrain evidence on the selected legal ray only. */
  readonly coverVoxelCells: readonly GridAnchor[]
  readonly coverPlacementIds: readonly string[]
  /** A partially occluding Barrier grants the same single Rough Terrain penalty. */
  readonly coverZoneIds: readonly string[]
  /** Placement-backed dimensions that materially participated in the query. */
  readonly consultedPlacementIds: readonly string[]
}

export interface CreateMoveAutomationLineOfSightResolverInput {
  readonly voxels: readonly MapVoxelV2[]
  readonly placements: readonly MoveAutomationLineOfSightPlacement[]
  /** Server-projected exact occupied cells for active destructible Barrier zones. */
  readonly barrierCells?: readonly MoveAutomationBarrierSightCell[]
  /** Authoritative read-set seam. Standalone pure geometry omits it. */
  readonly recordPlacementRead?: (placementId: string) => void
}

export interface ResolveMoveAutomationLineOfSightInput
  extends Omit<CreateMoveAutomationLineOfSightResolverInput, 'recordPlacementRead'> {
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly policy?: MoveAutomationLineOfSightPolicy
}

export interface MoveAutomationLineOfSightResolver {
  resolve(
    sourcePlacementId: string,
    targetPlacementId: string,
    policy?: MoveAutomationLineOfSightPolicy,
  ): MoveAutomationLineOfSightResult
}

export type MoveAutomationLineOfSightErrorCode =
  | 'invalid-placement'
  | 'duplicate-placement-id'
  | 'invalid-voxel'
  | 'invalid-query'
  | 'limit-exceeded'

export class MoveAutomationLineOfSightError extends Error {
  readonly code: MoveAutomationLineOfSightErrorCode

  constructor(code: MoveAutomationLineOfSightErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationLineOfSightError'
    this.code = code
  }
}

type PlacementSnapshot = Readonly<{
  id: string
  position: Readonly<GridAnchor>
  base: number
  clearance: number
  blocksSight: boolean
  cells: readonly Readonly<GridAnchor>[]
  cellKeys: ReadonlySet<string>
}>

type VoxelCell = Readonly<{
  position: Readonly<GridAnchor>
  blocksSight: boolean
  rough: boolean
}>

type BarrierCell = Readonly<{
  zoneId: string
  position: Readonly<GridAnchor>
}>

type GeometryIndex = Readonly<{
  placementOrder: readonly string[]
  barrierOrder: readonly string[]
  placementsById: ReadonlyMap<string, PlacementSnapshot>
  placementsByCell: ReadonlyMap<string, readonly PlacementSnapshot[]>
  voxelsByCell: ReadonlyMap<string, VoxelCell>
  barriersByCell: ReadonlyMap<string, readonly BarrierCell[]>
}>

interface EvaluatedSightRay {
  readonly originCell: GridAnchor
  readonly targetCell: GridAnchor
  readonly traversedCellCount: number
  readonly targetable: boolean
  readonly accuracyModifier: number
  readonly blockingVoxelCells: readonly GridAnchor[]
  readonly blockingPlacementIds: readonly string[]
  readonly blockingZoneIds: readonly string[]
  readonly coverVoxelCells: readonly GridAnchor[]
  readonly coverPlacementIds: readonly string[]
}

const ROUGH_TERRAIN_TAGS = new Set([
  'rough',
  'rough-terrain',
  'cover',
])

const fail = (
  code: MoveAutomationLineOfSightErrorCode,
  message: string,
): never => {
  throw new MoveAutomationLineOfSightError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const validId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.identifierChars
  && value.trim() === value
)

const validCoordinate = (value: unknown): value is number => Number.isSafeInteger(value)

const cloneCell = (cell: GridAnchor): GridAnchor => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cellsForFootprint = (options: {
  readonly position: GridAnchor
  readonly base: number
  readonly clearance: number
}): GridAnchor[] => {
  const cells: GridAnchor[] = []
  for (let x = options.position.x; x < options.position.x + options.base; x += 1) {
    for (let y = options.position.y; y < options.position.y + options.clearance; y += 1) {
      for (let z = options.position.z; z < options.position.z + options.base; z += 1) {
        cells.push({ x, y, z })
      }
    }
  }
  return cells
}

const placementSnapshot = (
  placement: MoveAutomationLineOfSightPlacement,
  index: number,
): PlacementSnapshot => {
  if (!validId(placement.id)) {
    return fail('invalid-placement', `Line-of-sight placement ${index} has an invalid ID.`)
  }
  if (
    !placement.position
    || !validCoordinate(placement.position.x)
    || !validCoordinate(placement.position.y)
    || !validCoordinate(placement.position.z)
  ) {
    return fail(
      'invalid-placement',
      `Line-of-sight placement ${placement.id} must have safe integer coordinates.`,
    )
  }
  const clearance = placement.clearance ?? 1
  if (
    !Number.isSafeInteger(placement.base)
    || placement.base < 1
    || placement.base > MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.footprintExtent
    || !Number.isSafeInteger(clearance)
    || clearance < 1
    || clearance > MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.footprintExtent
    || (placement.blocksSight !== undefined && typeof placement.blocksSight !== 'boolean')
  ) {
    return fail(
      'invalid-placement',
      `Line-of-sight placement ${placement.id} has an invalid footprint.`,
    )
  }
  const cellCount = placement.base * placement.base * clearance
  if (cellCount > MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.footprintCells) {
    return fail(
      'limit-exceeded',
      `Line-of-sight placement ${placement.id} exceeds ${MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.footprintCells} footprint cells.`,
    )
  }
  const position = deepFreeze(cloneCell(placement.position))
  const cells = deepFreeze(cellsForFootprint({
    position,
    base: placement.base,
    clearance,
  }))
  return Object.freeze({
    id: placement.id,
    position,
    base: placement.base,
    clearance,
    blocksSight: placement.blocksSight === true,
    cells,
    cellKeys: new Set(cells.map(gridCellKey)),
  })
}

const voxelSnapshot = (voxel: MapVoxelV2, index: number): VoxelCell => {
  if (
    !validCoordinate(voxel.x)
    || !validCoordinate(voxel.y)
    || !validCoordinate(voxel.z)
    || typeof voxel.materialId !== 'string'
    || voxel.materialId.trim().length === 0
    || (voxel.blocksSight !== undefined && typeof voxel.blocksSight !== 'boolean')
    || (voxel.tags !== undefined && (
      !Array.isArray(voxel.tags)
      || voxel.tags.some(tag => typeof tag !== 'string')
    ))
  ) {
    return fail('invalid-voxel', `Line-of-sight voxel ${index} is invalid.`)
  }
  const material = getVoxelMaterialDefinition(voxel)
  const tags = [...(material.tags ?? []), ...(voxel.tags ?? [])]
    .map(tag => tag.trim().toLowerCase())
  return Object.freeze({
    position: deepFreeze({ x: voxel.x, y: voxel.y, z: voxel.z }),
    blocksSight: voxel.blocksSight ?? material.blocksSightDefault ?? false,
    rough: tags.some(tag => ROUGH_TERRAIN_TAGS.has(tag)),
  })
}

const mergeVoxelCell = (left: VoxelCell, right: VoxelCell): VoxelCell => Object.freeze({
  position: left.position,
  /** Duplicate malformed cells fail closed to their strongest mechanics. */
  blocksSight: left.blocksSight || right.blocksSight,
  rough: left.rough || right.rough,
})

const barrierCellSnapshot = (
  value: MoveAutomationBarrierSightCell,
  index: number,
): BarrierCell => {
  if (
    !value
    || !validId(value.zoneId)
    || !value.cell
    || !validCoordinate(value.cell.x)
    || !validCoordinate(value.cell.y)
    || !validCoordinate(value.cell.z)
  ) {
    return fail('invalid-voxel', `Line-of-sight barrier cell ${index} is invalid.`)
  }
  return Object.freeze({
    zoneId: value.zoneId,
    position: deepFreeze(cloneCell(value.cell)),
  })
}

const buildGeometryIndex = (
  input: Pick<
    CreateMoveAutomationLineOfSightResolverInput,
    'voxels' | 'placements' | 'barrierCells'
  >,
): GeometryIndex => {
  if (!Array.isArray(input.voxels)) fail('invalid-voxel', 'Line-of-sight voxels must be an array.')
  if (!Array.isArray(input.placements)) {
    fail('invalid-placement', 'Line-of-sight placements must be an array.')
  }

  const placementsById = new Map<string, PlacementSnapshot>()
  const placementsByCell = new Map<string, PlacementSnapshot[]>()
  const placementOrder: string[] = []
  for (const [index, placement] of input.placements.entries()) {
    const snapshot = placementSnapshot(placement, index)
    if (placementsById.has(snapshot.id)) {
      fail(
        'duplicate-placement-id',
        `Line-of-sight placement ${snapshot.id} was listed more than once.`,
      )
    }
    placementsById.set(snapshot.id, snapshot)
    placementOrder.push(snapshot.id)
    for (const cell of snapshot.cells) {
      const key = gridCellKey(cell)
      const occupants = placementsByCell.get(key)
      if (occupants) occupants.push(snapshot)
      else placementsByCell.set(key, [snapshot])
    }
  }

  const voxelsByCell = new Map<string, VoxelCell>()
  for (const [index, voxel] of input.voxels.entries()) {
    const snapshot = voxelSnapshot(voxel, index)
    const key = gridCellKey(snapshot.position)
    const existing = voxelsByCell.get(key)
    voxelsByCell.set(key, existing ? mergeVoxelCell(existing, snapshot) : snapshot)
  }

  if (input.barrierCells !== undefined && !Array.isArray(input.barrierCells)) {
    fail('invalid-voxel', 'Line-of-sight barrier cells must be an array.')
  }
  const barriersByCell = new Map<string, BarrierCell[]>()
  const barrierOrder: string[] = []
  const seenBarrierIds = new Set<string>()
  for (const [index, value] of (input.barrierCells ?? []).entries()) {
    const barrier = barrierCellSnapshot(value, index)
    if (!seenBarrierIds.has(barrier.zoneId)) {
      seenBarrierIds.add(barrier.zoneId)
      barrierOrder.push(barrier.zoneId)
    }
    const key = gridCellKey(barrier.position)
    const entries = barriersByCell.get(key)
    if (entries?.some(entry => entry.zoneId === barrier.zoneId)) {
      fail(
        'invalid-voxel',
        `Line-of-sight barrier ${barrier.zoneId} repeats occupied cell ${key}.`,
      )
    }
    if (entries) entries.push(barrier)
    else barriersByCell.set(key, [barrier])
  }

  return Object.freeze({
    placementOrder: Object.freeze(placementOrder),
    barrierOrder: Object.freeze(barrierOrder),
    placementsById,
    placementsByCell: new Map(
      [...placementsByCell].map(([key, placements]) => [key, Object.freeze(placements)]),
    ),
    voxelsByCell,
    barriersByCell: new Map(
      [...barriersByCell].map(([key, barriers]) => [key, Object.freeze(barriers)]),
    ),
  })
}

const normalizedPolicy = (
  policy: MoveAutomationLineOfSightPolicy | undefined,
): Readonly<Required<MoveAutomationLineOfSightPolicy>> => {
  if (
    policy !== undefined
    && (
      typeof policy !== 'object'
      || policy === null
      || (policy.ignoreBlockingTerrain !== undefined
        && typeof policy.ignoreBlockingTerrain !== 'boolean')
      || (policy.ignoreRoughTerrain !== undefined
        && typeof policy.ignoreRoughTerrain !== 'boolean')
    )
  ) {
    return fail('invalid-query', 'Line-of-sight policy flags must be booleans.')
  }
  return Object.freeze({
    ignoreBlockingTerrain: policy?.ignoreBlockingTerrain === true,
    ignoreRoughTerrain: policy?.ignoreRoughTerrain === true,
  })
}

const uniqueCells = (cells: readonly GridAnchor[]): GridAnchor[] => Array.from(
  new Map(cells.map(cell => [gridCellKey(cell), cloneCell(cell)])).values(),
)

const voxelCoverForRayCell = (
  cell: GridAnchor,
  voxelsByCell: ReadonlyMap<string, VoxelCell>,
): readonly VoxelCell[] => {
  const exact = voxelsByCell.get(gridCellKey(cell))
  const supporting = voxelsByCell.get(gridCellKey({ x: cell.x, y: cell.y - 1, z: cell.z }))
  if (exact?.rough && supporting?.rough && exact !== supporting) return [exact, supporting]
  if (exact?.rough) return [exact]
  if (supporting?.rough) return [supporting]
  return []
}

const evaluateRay = (options: {
  readonly index: GeometryIndex
  readonly source: PlacementSnapshot
  readonly target: PlacementSnapshot
  readonly originCell: GridAnchor
  readonly targetCell: GridAnchor
  readonly policy: Readonly<Required<MoveAutomationLineOfSightPolicy>>
  readonly consultedPlacementIds: Set<string>
}): EvaluatedSightRay => {
  const maximumTraversedCells = Math.abs(options.targetCell.x - options.originCell.x)
    + Math.abs(options.targetCell.y - options.originCell.y)
    + Math.abs(options.targetCell.z - options.originCell.z)
    + 1
  if (maximumTraversedCells > MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.rayCells) {
    return fail(
      'limit-exceeded',
      `Line-of-sight ray exceeds ${MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.rayCells} grid cells.`,
    )
  }
  const traversed = gridCellsBetweenCellCenters(options.originCell, options.targetCell)
  const blockingVoxelCells: GridAnchor[] = []
  const blockingPlacementIds = new Set<string>()
  const blockingZoneIds = new Set<string>()
  const coverVoxelCells: GridAnchor[] = []
  const coverPlacementIds = new Set<string>()

  for (const cell of traversed) {
    const key = gridCellKey(cell)
    const insideEndpointFootprint = options.source.cellKeys.has(key)
      || options.target.cellKeys.has(key)
    const voxel = options.index.voxelsByCell.get(key)
    if (
      !options.policy.ignoreBlockingTerrain
      && !insideEndpointFootprint
      && voxel?.blocksSight
    ) {
      blockingVoxelCells.push(cloneCell(voxel.position))
    }
    if (!options.policy.ignoreBlockingTerrain && !insideEndpointFootprint) {
      for (const barrier of options.index.barriersByCell.get(key) ?? []) {
        blockingZoneIds.add(barrier.zoneId)
      }
    }

    for (const placement of options.index.placementsByCell.get(key) ?? []) {
      if (
        insideEndpointFootprint
        || placement.id === options.source.id
        || placement.id === options.target.id
      ) continue
      options.consultedPlacementIds.add(placement.id)
      if (placement.blocksSight && !options.policy.ignoreBlockingTerrain) {
        blockingPlacementIds.add(placement.id)
      }
      if (!options.policy.ignoreRoughTerrain) coverPlacementIds.add(placement.id)
    }

    if (!options.policy.ignoreRoughTerrain) {
      for (const coverVoxel of voxelCoverForRayCell(cell, options.index.voxelsByCell)) {
        coverVoxelCells.push(cloneCell(coverVoxel.position))
      }
    }
  }

  const uniqueBlockingVoxels = uniqueCells(blockingVoxelCells)
  const uniqueCoverVoxels = uniqueCells(coverVoxelCells)
  const targetable = uniqueBlockingVoxels.length === 0
    && blockingPlacementIds.size === 0
    && blockingZoneIds.size === 0
  const hasCover = uniqueCoverVoxels.length > 0 || coverPlacementIds.size > 0
  return {
    originCell: cloneCell(options.originCell),
    targetCell: cloneCell(options.targetCell),
    traversedCellCount: traversed.length,
    targetable,
    accuracyModifier: targetable && hasCover
      ? MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER
      : 0,
    blockingVoxelCells: uniqueBlockingVoxels,
    blockingPlacementIds: [...blockingPlacementIds],
    blockingZoneIds: [...blockingZoneIds],
    coverVoxelCells: uniqueCoverVoxels,
    coverPlacementIds: [...coverPlacementIds],
  }
}

const visibleRayIsBetter = (
  candidate: EvaluatedSightRay,
  current: EvaluatedSightRay | null,
): boolean => {
  if (!current) return true
  if (candidate.accuracyModifier !== current.accuracyModifier) {
    return candidate.accuracyModifier > current.accuracyModifier
  }
  const candidateCoverCount = candidate.coverVoxelCells.length + candidate.coverPlacementIds.length
  const currentCoverCount = current.coverVoxelCells.length + current.coverPlacementIds.length
  if (candidateCoverCount !== currentCoverCount) return candidateCoverCount < currentCoverCount
  return candidate.traversedCellCount < current.traversedCellCount
}

const blockedRayIsBetter = (
  candidate: EvaluatedSightRay,
  current: EvaluatedSightRay | null,
): boolean => {
  if (!current) return true
  const candidateBlockerCount = candidate.blockingVoxelCells.length
    + candidate.blockingPlacementIds.length
    + candidate.blockingZoneIds.length
  const currentBlockerCount = current.blockingVoxelCells.length
    + current.blockingPlacementIds.length
    + current.blockingZoneIds.length
  if (candidateBlockerCount !== currentBlockerCount) {
    return candidateBlockerCount < currentBlockerCount
  }
  return candidate.traversedCellCount < current.traversedCellCount
}

const reasonForBlockedRay = (
  ray: EvaluatedSightRay,
): MoveAutomationLineOfSightReasonCode => {
  const blockerKinds = [
    ray.blockingVoxelCells.length > 0,
    ray.blockingPlacementIds.length > 0,
    ray.blockingZoneIds.length > 0,
  ].filter(Boolean).length
  if (blockerKinds > 1) return 'line-of-sight-blocked-mixed'
  if (ray.blockingPlacementIds.length > 0) return 'line-of-sight-blocked-placement'
  if (ray.blockingZoneIds.length > 0) return 'line-of-sight-blocked-barrier'
  return 'line-of-sight-blocked-voxel'
}

const unavailableResult = (options: {
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly policy: Readonly<Required<MoveAutomationLineOfSightPolicy>>
  readonly reasonCode: Extract<MoveAutomationLineOfSightReasonCode,
    'line-of-sight-source-missing' | 'line-of-sight-target-missing'>
  readonly consultedPlacementIds: readonly string[]
}): MoveAutomationLineOfSightResult => deepFreeze({
  sourcePlacementId: options.sourcePlacementId,
  targetPlacementId: options.targetPlacementId,
  policy: options.policy,
  targetable: false,
  accuracyModifier: 0,
  visibility: 'unavailable',
  cover: 'blocked',
  reasonCode: options.reasonCode,
  originCell: null,
  targetCell: null,
  visibleTargetCells: [],
  targetFootprintCellCount: 0,
  blockingVoxelCells: [],
  blockingPlacementIds: [],
  blockingZoneIds: [],
  coverVoxelCells: [],
  coverPlacementIds: [],
  coverZoneIds: [],
  consultedPlacementIds: [...options.consultedPlacementIds],
})

const orderedPlacementIds = (
  index: GeometryIndex,
  placementIds: ReadonlySet<string>,
): string[] => index.placementOrder.filter(id => placementIds.has(id))

const orderedBarrierIds = (
  index: GeometryIndex,
  barrierIds: ReadonlySet<string>,
): string[] => index.barrierOrder.filter(id => barrierIds.has(id))

const resolveIndexedLineOfSight = (options: {
  readonly index: GeometryIndex
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly policy?: MoveAutomationLineOfSightPolicy
}): MoveAutomationLineOfSightResult => {
  if (!validId(options.sourcePlacementId) || !validId(options.targetPlacementId)) {
    return fail('invalid-query', 'Line-of-sight source and target IDs must be bounded placement IDs.')
  }
  const policy = normalizedPolicy(options.policy)
  const source = options.index.placementsById.get(options.sourcePlacementId)
  const target = options.index.placementsById.get(options.targetPlacementId)
  if (!source) {
    return unavailableResult({
      sourcePlacementId: options.sourcePlacementId,
      targetPlacementId: options.targetPlacementId,
      policy,
      reasonCode: 'line-of-sight-source-missing',
      consultedPlacementIds: target ? [target.id] : [],
    })
  }
  if (!target) {
    return unavailableResult({
      sourcePlacementId: options.sourcePlacementId,
      targetPlacementId: options.targetPlacementId,
      policy,
      reasonCode: 'line-of-sight-target-missing',
      consultedPlacementIds: [source.id],
    })
  }

  const footprintRayCount = source.cells.length * target.cells.length
  if (footprintRayCount > MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.footprintRays) {
    return fail(
      'limit-exceeded',
      `Line-of-sight query exceeds ${MOVE_AUTOMATION_LINE_OF_SIGHT_LIMITS.footprintRays} footprint rays.`,
    )
  }

  const consultedPlacementIds = new Set([source.id, target.id])
  const visibleTargetCellKeys = new Set<string>()
  const blockedBarrierIds = new Set<string>()
  let bestVisibleRay: EvaluatedSightRay | null = null
  let bestBlockedRay: EvaluatedSightRay | null = null

  for (const originCell of source.cells) {
    for (const targetCell of target.cells) {
      const ray = evaluateRay({
        index: options.index,
        source,
        target,
        originCell,
        targetCell,
        policy,
        consultedPlacementIds,
      })
      if (ray.targetable) {
        visibleTargetCellKeys.add(gridCellKey(targetCell))
        if (visibleRayIsBetter(ray, bestVisibleRay)) bestVisibleRay = ray
        continue
      }
      for (const zoneId of ray.blockingZoneIds) blockedBarrierIds.add(zoneId)
      if (blockedRayIsBetter(ray, bestBlockedRay)) bestBlockedRay = ray
    }
  }

  const visibleTargetCells = target.cells
    .filter(cell => visibleTargetCellKeys.has(gridCellKey(cell)))
    .map(cloneCell)
  const orderedConsultedPlacementIds = orderedPlacementIds(
    options.index,
    consultedPlacementIds,
  )

  if (bestVisibleRay) {
    const partialBarrierCover = !policy.ignoreRoughTerrain && blockedBarrierIds.size > 0
    const covered = bestVisibleRay.accuracyModifier !== 0 || partialBarrierCover
    const accuracyModifier = covered
      ? MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER
      : 0
    return deepFreeze({
      sourcePlacementId: source.id,
      targetPlacementId: target.id,
      policy,
      targetable: true,
      accuracyModifier,
      visibility: visibleTargetCells.length === target.cells.length ? 'full' : 'partial',
      cover: covered ? 'rough-terrain' : 'none',
      reasonCode: covered ? 'line-of-sight-rough-cover' : 'line-of-sight-clear',
      originCell: bestVisibleRay.originCell,
      targetCell: bestVisibleRay.targetCell,
      visibleTargetCells,
      targetFootprintCellCount: target.cells.length,
      blockingVoxelCells: bestBlockedRay?.blockingVoxelCells.map(cloneCell) ?? [],
      blockingPlacementIds: bestBlockedRay
        ? orderedPlacementIds(options.index, new Set(bestBlockedRay.blockingPlacementIds))
        : [],
      blockingZoneIds: bestBlockedRay
        ? orderedBarrierIds(options.index, new Set(bestBlockedRay.blockingZoneIds))
        : [],
      coverVoxelCells: bestVisibleRay.coverVoxelCells.map(cloneCell),
      coverPlacementIds: [...bestVisibleRay.coverPlacementIds],
      coverZoneIds: partialBarrierCover
        ? orderedBarrierIds(options.index, blockedBarrierIds)
        : [],
      consultedPlacementIds: orderedConsultedPlacementIds,
    })
  }

  const blockedRay = bestBlockedRay ?? fail(
    'invalid-query',
    `Line-of-sight query ${source.id} -> ${target.id} produced no footprint rays.`,
  )
  return deepFreeze({
    sourcePlacementId: source.id,
    targetPlacementId: target.id,
    policy,
    targetable: false,
    accuracyModifier: 0,
    visibility: 'none',
    cover: 'blocked',
    reasonCode: reasonForBlockedRay(blockedRay),
    originCell: blockedRay.originCell,
    targetCell: blockedRay.targetCell,
    visibleTargetCells: [],
    targetFootprintCellCount: target.cells.length,
    blockingVoxelCells: blockedRay.blockingVoxelCells.map(cloneCell),
    blockingPlacementIds: orderedPlacementIds(
      options.index,
      new Set(blockedRay.blockingPlacementIds),
    ),
    blockingZoneIds: orderedBarrierIds(
      options.index,
      new Set(blockedRay.blockingZoneIds),
    ),
    coverVoxelCells: [],
    coverPlacementIds: [],
    coverZoneIds: [],
    consultedPlacementIds: orderedConsultedPlacementIds,
  })
}

/** Build one immutable query seam over a snapshotted authoritative map. */
export const createMoveAutomationLineOfSightResolver = (
  input: CreateMoveAutomationLineOfSightResolverInput,
): MoveAutomationLineOfSightResolver => {
  const index = buildGeometryIndex(input)
  return Object.freeze({
    resolve: (
      sourcePlacementId: string,
      targetPlacementId: string,
      policy?: MoveAutomationLineOfSightPolicy,
    ): MoveAutomationLineOfSightResult => {
      const result = resolveIndexedLineOfSight({
        index,
        sourcePlacementId,
        targetPlacementId,
        policy,
      })
      for (const placementId of result.consultedPlacementIds) {
        input.recordPlacementRead?.(placementId)
      }
      return result
    },
  })
}

/** Resolve one standalone, deterministic LOS/cover decision without side effects. */
export const resolveMoveAutomationLineOfSight = (
  input: ResolveMoveAutomationLineOfSightInput,
): MoveAutomationLineOfSightResult => createMoveAutomationLineOfSightResolver({
  voxels: input.voxels,
  placements: input.placements,
  barrierCells: input.barrierCells,
}).resolve(input.sourcePlacementId, input.targetPlacementId, input.policy)
