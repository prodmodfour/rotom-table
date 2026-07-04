import {
  LIVE_PLAY_COMMAND_TYPES,
  type BuildTerrainVoxelPayload,
  type EditTerrainVoxelsPayload,
  type LivePlayTerrainCommand,
  type RemoveTerrainVoxelPayload,
  type TerrainVoxelBatchChangePatchPayload,
} from '#shared/livePlayCommands'
import {
  parseEditTerrainVoxelsPayload,
  type EditTerrainVoxelOperation,
} from '#shared/livePlayBatchCommands'
import type { GridAnchor, MapVoxelV2, SheetPlacement, TabletopMap } from '~/types/map'
import { MATERIAL_BY_ID, getMaterialDefinition, normalizeMaterialId } from '~/utils/mapMaterials'
import { withDefaultBuilderVoxelColor } from '~/utils/voxelColors'
import { voxelKey } from '~/utils/voxelOccupancy'
import { rejectLivePlayCommand } from './commandExecutor'

export const LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS = [
  'terrain',
  'movement-preview',
  'build-preview',
  'hazard-preview',
] as const

export interface LivePlayTerrainCellState {
  readonly cell: GridAnchor
  readonly voxel: MapVoxelV2 | null
}

export interface LivePlayTerrainPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL
  readonly cell: GridAnchor
  readonly previous: MapVoxelV2 | null
  readonly current: MapVoxelV2 | null
  readonly built?: MapVoxelV2
  readonly removed?: MapVoxelV2
  readonly rendererInvalidation: typeof LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS
}

export interface LivePlayTerrainBatchPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS
  readonly changes: readonly TerrainVoxelBatchChangePatchPayload[]
  readonly rendererInvalidation: typeof LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS
}

export interface AppliedLivePlayTerrainChange {
  readonly changeKind: 'single'
  readonly nextMap: TabletopMap
  readonly cell: GridAnchor
  readonly previous: MapVoxelV2 | null
  readonly current: MapVoxelV2 | null
  readonly built?: MapVoxelV2
  readonly removed?: MapVoxelV2
}

export interface AppliedLivePlayTerrainBatchChange {
  readonly changeKind: 'batch'
  readonly nextMap: TabletopMap
  readonly changes: readonly TerrainVoxelBatchChangePatchPayload[]
}

export type AppliedLivePlayTerrainCommandChange =
  | AppliedLivePlayTerrainChange
  | AppliedLivePlayTerrainBatchChange

type UnknownRecord = Record<string, unknown>

type TerrainCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL
  | typeof LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const safeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const expectRecord = (value: unknown, label: string): UnknownRecord => {
  if (isRecord(value)) return value
  return rejectLivePlayCommand('invalid', `${label} must be an object`)
}

const expectCoordinate = (record: UnknownRecord, key: keyof GridAnchor, label: string): number => {
  const value = record[key]
  if (safeInteger(value)) return value
  return rejectLivePlayCommand('invalid', `${label}.${key} must be a safe integer`)
}

export const cloneTerrainCell = (cell: GridAnchor): GridAnchor => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

export const cloneTerrainVoxel = (voxel: MapVoxelV2): MapVoxelV2 => ({
  x: voxel.x,
  y: voxel.y,
  z: voxel.z,
  materialId: voxel.materialId,
  ...(voxel.color === undefined ? {} : { color: voxel.color }),
  ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost }),
  ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement }),
  ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight }),
  ...(voxel.tags === undefined ? {} : { tags: [...voxel.tags] }),
})

export const terrainCellKey = (cell: GridAnchor): string => voxelKey(cell.x, cell.y, cell.z)

export const terrainCellsEqual = (
  left: Pick<GridAnchor, 'x' | 'y' | 'z'>,
  right: Pick<GridAnchor, 'x' | 'y' | 'z'>,
): boolean => terrainCellKey(left) === terrainCellKey(right)

const expectTerrainCell = (value: unknown, label: string): GridAnchor => {
  const record = expectRecord(value, label)
  return {
    x: expectCoordinate(record, 'x', label),
    y: expectCoordinate(record, 'y', label),
    z: expectCoordinate(record, 'z', label),
  }
}

const expectOptionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  return rejectLivePlayCommand('invalid', `${label} must be boolean when provided`)
}

const expectOptionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  if (nonEmptyString(value)) return value.trim()
  return rejectLivePlayCommand('invalid', `${label} must be a non-empty string when provided`)
}

const expectOptionalTags = (value: unknown, label: string): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return rejectLivePlayCommand('invalid', `${label} must be an array when provided`)
  const tags: string[] = []
  for (const [index, tag] of value.entries()) {
    if (!nonEmptyString(tag)) {
      return rejectLivePlayCommand('invalid', `${label}[${index}] must be a non-empty string`)
    }
    tags.push(tag.trim())
  }
  return tags
}

const expectTerrainVoxel = (value: unknown, label: string): MapVoxelV2 => {
  const record = expectRecord(value, label)
  const cell = expectTerrainCell(record, label)
  if (!nonEmptyString(record.materialId)) {
    return rejectLivePlayCommand('invalid', `${label}.materialId must be a non-empty string`)
  }

  const voxel: MapVoxelV2 = {
    ...cell,
    materialId: record.materialId.trim(),
  }
  const color = expectOptionalString(record.color, `${label}.color`)
  const ghost = expectOptionalBoolean(record.ghost, `${label}.ghost`)
  const blocksMovement = expectOptionalBoolean(record.blocksMovement, `${label}.blocksMovement`)
  const blocksSight = expectOptionalBoolean(record.blocksSight, `${label}.blocksSight`)
  const tags = expectOptionalTags(record.tags, `${label}.tags`)

  if (color !== undefined) voxel.color = color
  if (ghost !== undefined) voxel.ghost = ghost
  if (blocksMovement !== undefined) voxel.blocksMovement = blocksMovement
  if (blocksSight !== undefined) voxel.blocksSight = blocksSight
  if (tags !== undefined) voxel.tags = tags
  return voxel
}

export const expectBuildTerrainVoxelPayload = (payload: unknown): BuildTerrainVoxelPayload => {
  const record = expectRecord(payload, 'buildTerrainVoxel payload')
  return { voxel: expectTerrainVoxel(record.voxel, 'buildTerrainVoxel payload.voxel') }
}

export const expectRemoveTerrainVoxelPayload = (payload: unknown): RemoveTerrainVoxelPayload => {
  const record = expectRecord(payload, 'removeTerrainVoxel payload')
  return { cell: expectTerrainCell(record.cell, 'removeTerrainVoxel payload.cell') }
}

const batchIssueSummary = (issues: readonly { readonly path: string; readonly message: string }[]): string => (
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
)

export const expectEditTerrainVoxelsPayload = (payload: unknown): EditTerrainVoxelsPayload => {
  const result = parseEditTerrainVoxelsPayload(payload)
  if (result.valid) return result.value
  return rejectLivePlayCommand('invalid', `editTerrainVoxels payload is invalid: ${batchIssueSummary(result.issues)}`)
}

const terrainCellForOperation = (operation: EditTerrainVoxelOperation): GridAnchor => (
  operation.action === 'upsert' ? cloneTerrainCell(operation.voxel) : cloneTerrainCell(operation.cell)
)

export const terrainCellForCommand = (command: LivePlayTerrainCommand): GridAnchor => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL) {
    return cloneTerrainCell(expectBuildTerrainVoxelPayload(command.payload).voxel)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL) {
    return cloneTerrainCell(expectRemoveTerrainVoxelPayload(command.payload).cell)
  }
  const firstOperation = expectEditTerrainVoxelsPayload(command.payload).operations[0]
  if (firstOperation) return terrainCellForOperation(firstOperation)
  return rejectLivePlayCommand('invalid', 'editTerrainVoxels payload must include at least one terrain operation')
}

const commandHasTerrainScope = (command: LivePlayTerrainCommand): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'terrain'
))

const sameTerrainCell = (
  left: Pick<GridAnchor, 'x' | 'y' | 'z'>,
  right: Pick<GridAnchor, 'x' | 'y' | 'z'>,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const scopeHasTerrainCell = (
  scope: LivePlayTerrainCommand['scopes'][number],
): scope is LivePlayTerrainCommand['scopes'][number] & { readonly cell: GridAnchor } => {
  const record = scope as unknown as UnknownRecord
  return isRecord(record.cell)
}

const hasBroadTerrainScope = (command: LivePlayTerrainCommand): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'terrain' && !scopeHasTerrainCell(scope)
))

const hasTerrainCellScope = (command: LivePlayTerrainCommand, cell: GridAnchor): boolean => command.scopes.some((scope) => (
  scope.kind === 'map'
  && scope.lane === 'terrain'
  && scopeHasTerrainCell(scope)
  && sameTerrainCell(scope.cell, cell)
))

const expectEditTerrainVoxelsScopes = (
  command: LivePlayTerrainCommand,
  payload: EditTerrainVoxelsPayload,
): void => {
  if (hasBroadTerrainScope(command)) return

  const missingCell = payload.operations
    .map(terrainCellForOperation)
    .find((cell) => !hasTerrainCellScope(command, cell))
  if (!missingCell) return

  rejectLivePlayCommand(
    'invalid',
    `editTerrainVoxels scopes must include every requested terrain cell or the broad map terrain scope; missing ${missingCell.x},${missingCell.y},${missingCell.z}`,
  )
}

export const validateLivePlayTerrainCommandPayloadAndScopes = (command: LivePlayTerrainCommand): void => {
  if (!commandHasTerrainScope(command)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map terrain scope`)
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL) {
    expectBuildTerrainVoxelPayload(command.payload)
    return
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL) {
    expectRemoveTerrainVoxelPayload(command.payload)
    return
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS) {
    expectEditTerrainVoxelsScopes(command, expectEditTerrainVoxelsPayload(command.payload))
    return
  }

  rejectLivePlayCommand('invalid', 'Terrain live-play routes support buildTerrainVoxel, removeTerrainVoxel, and editTerrainVoxels commands only')
}

const timestampedMap = (map: TabletopMap, timestamp: number): TabletopMap => ({
  ...map,
  updatedAt: timestamp,
})

const voxelInBounds = (
  cell: GridAnchor,
  dimensions: TabletopMap['dimensions'],
): boolean => cell.x >= 0 && cell.x < dimensions.x &&
  cell.y >= 0 && cell.y < dimensions.y &&
  cell.z >= 0 && cell.z < dimensions.z

const materialCanBeBuilt = (materialId: string): boolean => {
  const material = getMaterialDefinition(materialId)
  return !material.transparent || (material.tags ?? []).includes('water')
}

const normalizeTerrainVoxel = (voxel: MapVoxelV2): MapVoxelV2 => {
  const materialId = normalizeMaterialId(voxel.materialId)
  if (!MATERIAL_BY_ID.has(materialId)) {
    return rejectLivePlayCommand('invalid', `Terrain material ${voxel.materialId} is not in the terrain builder palette`)
  }
  if (!materialCanBeBuilt(materialId)) {
    return rejectLivePlayCommand('invalid', `Terrain material ${materialId} is not available to the terrain builder palette`)
  }

  return withDefaultBuilderVoxelColor({
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    materialId,
    ...(voxel.color === undefined ? {} : { color: voxel.color }),
    ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost }),
    ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement }),
    ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight }),
    ...(voxel.tags === undefined ? {} : { tags: [...voxel.tags] }),
  })
}

const voxelAtCell = (map: TabletopMap, cell: GridAnchor): MapVoxelV2 | undefined => (
  map.voxels.find((voxel) => terrainCellsEqual(voxel, cell))
)

const currentTerrainState = (map: TabletopMap, cell: GridAnchor): LivePlayTerrainCellState => {
  const voxel = voxelAtCell(map, cell)
  return {
    cell: cloneTerrainCell(cell),
    voxel: voxel === undefined ? null : cloneTerrainVoxel(voxel),
  }
}

const voxelEquals = (left: MapVoxelV2, right: MapVoxelV2): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.z === right.z &&
  left.materialId === right.materialId &&
  (left.color ?? '') === (right.color ?? '') &&
  (left.ghost ?? false) === (right.ghost ?? false) &&
  (left.blocksMovement ?? null) === (right.blocksMovement ?? null) &&
  (left.blocksSight ?? null) === (right.blocksSight ?? null) &&
  (left.tags ?? []).join('\u001f') === (right.tags ?? []).join('\u001f')

const placementOccupiesCell = (placement: SheetPlacement, cell: GridAnchor): boolean => (
  placement.position.x === cell.x && placement.position.y === cell.y && placement.position.z === cell.z
)

const terrainBatchPatchChange = (
  change: Omit<TerrainVoxelBatchChangePatchPayload, 'cell' | 'previous' | 'current'> & {
    readonly cell: GridAnchor
    readonly previous: MapVoxelV2 | null
    readonly current: MapVoxelV2 | null
  },
): TerrainVoxelBatchChangePatchPayload => ({
  cell: cloneTerrainCell(change.cell),
  previous: change.previous === null ? null : cloneTerrainVoxel(change.previous),
  current: change.current === null ? null : cloneTerrainVoxel(change.current),
  ...(change.built === undefined ? {} : { built: cloneTerrainVoxel(change.built) }),
  ...(change.removed === undefined ? {} : { removed: cloneTerrainVoxel(change.removed) }),
})

const planBuildTerrainVoxelChange = (
  map: TabletopMap,
  voxelInput: MapVoxelV2,
  noOpMessage: (cell: GridAnchor) => string,
): TerrainVoxelBatchChangePatchPayload => {
  const voxel = normalizeTerrainVoxel(voxelInput)
  const cell = cloneTerrainCell(voxel)
  const previous = voxelAtCell(map, cell)
  const previousClone = previous === undefined ? null : cloneTerrainVoxel(previous)

  if (!voxelInBounds(cell, map.dimensions)) {
    rejectLivePlayCommand(
      'invalid',
      `Terrain voxel cannot be built at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${map.slug}.`,
      { currentState: currentTerrainState(map, cell) },
    )
  }

  if (map.placements.some((placement) => placementOccupiesCell(placement, cell))) {
    rejectLivePlayCommand(
      'conflict',
      `Terrain voxel cannot be built at ${cell.x},${cell.y},${cell.z}; a token occupies that cell.`,
      { currentState: currentTerrainState(map, cell) },
    )
  }

  if (previous !== undefined && voxelEquals(previous, voxel)) {
    rejectLivePlayCommand('no-op', noOpMessage(cell), { currentState: currentTerrainState(map, cell) })
  }

  return terrainBatchPatchChange({
    cell,
    previous: previousClone,
    current: cloneTerrainVoxel(voxel),
    built: cloneTerrainVoxel(voxel),
  })
}

const planRemoveTerrainVoxelChange = (
  map: TabletopMap,
  cellInput: GridAnchor,
  noOpMessage: (cell: GridAnchor) => string,
): TerrainVoxelBatchChangePatchPayload => {
  const cell = cloneTerrainCell(cellInput)
  const previous = voxelAtCell(map, cell)

  if (!voxelInBounds(cell, map.dimensions)) {
    rejectLivePlayCommand(
      'invalid',
      `Terrain voxel cannot be removed at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${map.slug}.`,
      { currentState: currentTerrainState(map, cell) },
    )
  }

  if (previous === undefined) {
    return rejectLivePlayCommand('no-op', noOpMessage(cell), { currentState: currentTerrainState(map, cell) })
  }

  const removed = cloneTerrainVoxel(previous)
  return terrainBatchPatchChange({
    cell,
    previous: removed,
    current: null,
    removed,
  })
}

const mapWithTerrainChanges = (
  map: TabletopMap,
  changes: readonly TerrainVoxelBatchChangePatchPayload[],
  timestamp: number,
): TabletopMap => {
  const changedCellKeys = new Set(changes.map((change) => terrainCellKey(change.cell)))
  const nextVoxels = map.voxels
    .filter((voxel) => !changedCellKeys.has(terrainCellKey(voxel)))
    .map(cloneTerrainVoxel)

  for (const change of changes) {
    if (change.current !== null) nextVoxels.push(cloneTerrainVoxel(change.current))
  }

  return timestampedMap({
    ...map,
    voxels: nextVoxels,
  }, timestamp)
}

const singleTerrainChange = (
  change: TerrainVoxelBatchChangePatchPayload,
  nextMap: TabletopMap,
): AppliedLivePlayTerrainChange => ({
  changeKind: 'single',
  nextMap,
  cell: cloneTerrainCell(change.cell),
  previous: change.previous === null ? null : cloneTerrainVoxel(change.previous),
  current: change.current === null ? null : cloneTerrainVoxel(change.current),
  ...(change.built === undefined ? {} : { built: cloneTerrainVoxel(change.built) }),
  ...(change.removed === undefined ? {} : { removed: cloneTerrainVoxel(change.removed) }),
})

const applyBuildTerrainVoxel = (
  map: TabletopMap,
  payload: BuildTerrainVoxelPayload,
  timestamp: number,
): AppliedLivePlayTerrainChange => {
  const change = planBuildTerrainVoxelChange(
    map,
    payload.voxel,
    (cell) => `Terrain voxel at ${cell.x},${cell.y},${cell.z} already matches the requested build payload.`,
  )
  return singleTerrainChange(change, mapWithTerrainChanges(map, [change], timestamp))
}

const applyRemoveTerrainVoxel = (
  map: TabletopMap,
  payload: RemoveTerrainVoxelPayload,
  timestamp: number,
): AppliedLivePlayTerrainChange => {
  const change = planRemoveTerrainVoxelChange(
    map,
    payload.cell,
    (cell) => `No terrain voxel is present at ${cell.x},${cell.y},${cell.z}.`,
  )
  return singleTerrainChange(change, mapWithTerrainChanges(map, [change], timestamp))
}

const batchUpsertChange = (
  map: TabletopMap,
  operation: Extract<EditTerrainVoxelOperation, { readonly action: 'upsert' }>,
): TerrainVoxelBatchChangePatchPayload => planBuildTerrainVoxelChange(
  map,
  operation.voxel,
  (cell) => `Terrain voxel at ${cell.x},${cell.y},${cell.z} already matches the requested batch build payload.`,
)

const batchRemoveChange = (
  map: TabletopMap,
  operation: Extract<EditTerrainVoxelOperation, { readonly action: 'remove' }>,
): TerrainVoxelBatchChangePatchPayload => planRemoveTerrainVoxelChange(
  map,
  operation.cell,
  (cell) => `No terrain voxel is present at ${cell.x},${cell.y},${cell.z} for the requested batch removal.`,
)

const batchChangeForOperation = (
  map: TabletopMap,
  operation: EditTerrainVoxelOperation,
): TerrainVoxelBatchChangePatchPayload => (
  operation.action === 'upsert'
    ? batchUpsertChange(map, operation)
    : batchRemoveChange(map, operation)
)

const applyEditTerrainVoxels = (
  map: TabletopMap,
  payload: EditTerrainVoxelsPayload,
  timestamp: number,
): AppliedLivePlayTerrainBatchChange => {
  const changes = payload.operations.map((operation) => batchChangeForOperation(map, operation))
  if (changes.length === 0) {
    rejectLivePlayCommand('invalid', 'editTerrainVoxels payload must include at least one terrain operation')
  }

  return {
    changeKind: 'batch',
    nextMap: mapWithTerrainChanges(map, changes, timestamp),
    changes,
  }
}

export const applyLivePlayTerrainChange = (
  command: LivePlayTerrainCommand,
  map: TabletopMap,
  timestamp: number,
): AppliedLivePlayTerrainCommandChange => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL) {
    return applyBuildTerrainVoxel(map, expectBuildTerrainVoxelPayload(command.payload), timestamp)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL) {
    return applyRemoveTerrainVoxel(map, expectRemoveTerrainVoxelPayload(command.payload), timestamp)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS) {
    return applyEditTerrainVoxels(map, expectEditTerrainVoxelsPayload(command.payload), timestamp)
  }
  return rejectLivePlayCommand('invalid', 'Terrain live-play routes support buildTerrainVoxel, removeTerrainVoxel, and editTerrainVoxels commands only')
}

export const createLivePlayTerrainPatchPayload = (
  command: Exclude<TerrainCommandType, typeof LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS>,
  change: AppliedLivePlayTerrainChange,
): LivePlayTerrainPatchPayload => ({
  command,
  cell: cloneTerrainCell(change.cell),
  previous: change.previous === null ? null : cloneTerrainVoxel(change.previous),
  current: change.current === null ? null : cloneTerrainVoxel(change.current),
  ...(change.built === undefined ? {} : { built: cloneTerrainVoxel(change.built) }),
  ...(change.removed === undefined ? {} : { removed: cloneTerrainVoxel(change.removed) }),
  rendererInvalidation: LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS,
})

export const createLivePlayTerrainBatchPatchPayload = (
  change: AppliedLivePlayTerrainBatchChange,
): LivePlayTerrainBatchPatchPayload => ({
  command: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
  changes: change.changes.map(terrainBatchPatchChange),
  rendererInvalidation: LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS,
})
