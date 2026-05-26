import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandConflictRejection,
  type SessionCommandDuplicateResult,
  type SessionCommandInvalidRejection,
  type SessionCommandRejectedResult,
  type SessionCommandResultMetadata,
  type SessionCommandStaleRejection,
  type SessionCommandUnauthorizedRejection,
  type SessionCommandValidationIssue,
} from '#shared/sessionCommandResults'
import { type SessionCommandScope } from '#shared/sessionCommands'
import { validateSessionCommandEnvelope } from '#shared/sessionCommandValidation'
import {
  BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  createTerrainVoxelCommandScope,
  parseTerrainVoxelScopeField,
  terrainCellsEqual,
  validateTerrainCommand,
  type BuildTerrainVoxelCommandPayload,
  type RemoveTerrainVoxelCommandPayload,
  type SessionTerrainCell,
  type SessionTerrainVoxel,
  type TerrainCommand,
  type TerrainCommandPayload,
  type TerrainCommandType,
} from '#shared/sessionTerrainCommands'
import type { SessionId } from '#shared/sessionIdentity'
import type { PermissionDenied } from '#shared/sessionPermissions'
import { compareSessionRevisions, type MapRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import type { MapVoxelV2, SheetPlacement, TabletopMapV2 } from '~/types/map'
import { getMaterialDefinition, normalizeMaterialId } from '~/utils/mapMaterials'
import { withDefaultBuilderVoxelColor } from '~/utils/voxelColors'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionOperationTracker,
  type InMemorySessionOperationTracker,
  type SessionOperationRecord,
} from '../utils/sessionOperationTracker'
import {
  applyAcceptedSessionCommandEffect,
  type AcceptedSessionCommandPatchEvent,
  type ApplyAcceptedSessionCommandEffectResult,
} from '../utils/sessionRevisionApplication'
import {
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '../utils/sessionSnapshots'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ApplyTerrainCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE = 'terrainVoxelsUpdated' as const

export const TERRAIN_RENDER_INVALIDATION_REASONS = [
  'terrain',
  'movement-preview',
  'build-preview',
  'hazard-preview',
] as const

export interface TerrainVoxelCellState {
  readonly mapSlug: SessionMapSlug
  readonly cell: SessionTerrainCell
  readonly voxel?: MapVoxelV2
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface TerrainPatchPayload {
  readonly mapSlug: SessionMapSlug
  readonly command: TerrainCommandType
  readonly cell: SessionTerrainCell
  readonly previous: MapVoxelV2 | null
  readonly current: MapVoxelV2 | null
  readonly built?: MapVoxelV2
  readonly removed?: MapVoxelV2
  /** Applying this patch to `map.voxels` must preserve terrain renderer invalidation. */
  readonly rendererInvalidation: typeof TERRAIN_RENDER_INVALIDATION_REASONS
}

export type TerrainPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE,
  TerrainPatchPayload
>

export type TerrainAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  TerrainCommandType,
  TerrainCommandPayload,
  TabletopMapV2,
  typeof TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE,
  TerrainPatchPayload
>

export type TerrainRejectedResult = SessionCommandRejectedResult<
  TerrainCommandType,
  TerrainVoxelCellState | null,
  SessionRevision
>

export type TerrainDuplicateResult = SessionCommandDuplicateResult<
  TerrainCommandType,
  SessionRevision
>

export interface ApplyTerrainCommandInput {
  readonly command?: unknown
}

export type ApplyTerrainCommandClock = () => string
export type ApplyTerrainCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface ApplyTerrainCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyTerrainCommandClock
  readonly writeSnapshot?: ApplyTerrainCommandSnapshotWriter
}

export interface AppliedTerrainSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedTerrainSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyTerrainAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedTerrainSessionDetails
  readonly command: TerrainCommand
  readonly result: TerrainAcceptedApplication['result']
  readonly patchEvent: TerrainPatchEvent
  readonly eventLogEntry: TerrainAcceptedApplication['eventLogEntry']
  readonly previousTerrain: TerrainVoxelCellState
  readonly terrain: TerrainVoxelCellState
  readonly snapshot: AppliedTerrainSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: TerrainAcceptedApplication['mapRevisionChanges']
}

export interface ApplyTerrainRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedTerrainSessionDetails
  readonly command: TerrainCommand
  readonly result: TerrainRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyTerrainDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedTerrainSessionDetails
  readonly command: TerrainCommand
  readonly result: TerrainDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyTerrainCommandUseCaseResult =
  | ApplyTerrainAcceptedResult
  | ApplyTerrainRejectedResult
  | ApplyTerrainDuplicateResult

type TerrainSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedTerrainMap = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
}

type TerrainMapChange = {
  readonly document: TabletopMapV2
  readonly cell: SessionTerrainCell
  readonly previous: MapVoxelV2 | null
  readonly current: MapVoxelV2 | null
  readonly built?: MapVoxelV2
  readonly removed?: MapVoxelV2
}

const defaultClock: ApplyTerrainCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: TerrainCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const cloneCell = (cell: SessionTerrainCell): SessionTerrainCell => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cloneVoxel = (voxel: MapVoxelV2): MapVoxelV2 => ({
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

const voxelAtCell = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  cell: SessionTerrainCell,
): MapVoxelV2 | undefined =>
  mapState.document.voxels.find((voxel) => terrainCellsEqual(voxel, cell))

const currentTerrainState = (
  mapSlug: SessionMapSlug,
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  sessionRevision: SessionRevision,
  cell: SessionTerrainCell,
): TerrainVoxelCellState => {
  const voxel = voxelAtCell(mapState, cell)
  return {
    mapSlug,
    cell: cloneCell(cell),
    ...(voxel === undefined ? {} : { voxel: cloneVoxel(voxel) }),
    revision: sessionRevision,
    mapRevision: mapState.revision,
  }
}

const getActiveTerrainRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<TerrainCommand, 'sessionId'>,
): TerrainSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyTerrainCommandUseCaseError(
      404,
      'No live session was found for the supplied terrain command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyTerrainCommandUseCaseError(
      409,
      'The live session must be active before terrain commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyTerrainCommandUseCaseError(
      500,
      'The live session has no authoritative state available for terrain commands',
    )
  }

  return record as TerrainSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedTerrainSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<TerrainCommandType, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || `${command.type} command is invalid.`,
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  TerrainCommandType,
  TerrainVoxelCellState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM can edit terrain voxels in a live session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly currentState?: TerrainVoxelCellState | null
    readonly conflictingScopes?: TerrainCommand['scopes']
  } = {},
): SessionCommandConflictRejection<
  TerrainCommandType,
  TerrainVoxelCellState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'conflict',
  message,
  retryable: options.retryable ?? true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  message: string,
  processedAt: string,
  currentState: TerrainVoxelCellState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  TerrainCommandType,
  TerrainVoxelCellState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'stale',
  message,
  retryable: true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: TerrainRejectedResult,
): ApplyTerrainRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const commandCell = (command: TerrainCommand): SessionTerrainCell => {
  if (command.type === BUILD_TERRAIN_VOXEL_COMMAND_TYPE) return cloneCell(command.payload.voxel)
  return cloneCell(command.payload.cell)
}

const mapSlugFromCommand = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  command: TerrainCommand,
  validationMapSlug: string | undefined,
): SessionMapSlug | undefined => {
  if (validationMapSlug !== undefined) return validationMapSlug
  if (command.payload.mapSlug !== undefined) return command.payload.mapSlug
  const scopedMapSlug = command.scopes.find((scope) => {
    if (scope.lane !== 'terrain') return false
    const scopedCell = parseTerrainVoxelScopeField(scope.field)
    return scopedCell !== undefined && terrainCellsEqual(scopedCell, commandCell(command))
  })?.mapSlug
  return scopedMapSlug ?? state.selectedMapSlug ?? undefined
}

const resolveTerrainMap = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  validationMapSlug: string | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedTerrainMap }
  | { readonly ok: false; readonly result: TerrainRejectedResult } => {
  const mapSlug = mapSlugFromCommand(record.state, command, validationMapSlug)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'Terrain commands must identify a map or the session must have a selected map.',
        processedAt,
        { retryable: false },
      ),
    }
  }

  const mapState = getSessionMapState(record.state, mapSlug)
  if (mapState === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Map ${mapSlug} is not available in the authoritative session state.`,
        processedAt,
        { retryable: true },
      ),
    }
  }

  return { ok: true, target: { mapSlug, mapState } }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesTerrainCell = (
  scope: SessionCommandScope,
  mapSlug: SessionMapSlug,
  cell: SessionTerrainCell,
): boolean => {
  if (scope.lane !== 'terrain') return false
  if (scope.mapSlug !== undefined && scope.mapSlug !== mapSlug) return false
  const scopedCell = parseTerrainVoxelScopeField(scope.field)
  if (scopedCell === undefined) return true
  return terrainCellsEqual(scopedCell, cell)
}

const operationTouchesTerrainTarget = (
  operation: SessionOperationRecord,
  target: ResolvedTerrainMap,
  cell: SessionTerrainCell,
): boolean => operation.scopes.some((scope) => scopeTouchesTerrainCell(scope, target.mapSlug, cell))

const staleTerrainRejection = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  target: ResolvedTerrainMap,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): TerrainRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  const cell = commandCell(command)
  const currentState = currentTerrainState(
    target.mapSlug,
    target.mapState,
    record.revision,
    cell,
  )

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Terrain at ${cell.x},${cell.y},${cell.z} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before editing terrain.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingTerrainChange = acceptedSinceBase.find((operation) =>
    operationTouchesTerrainTarget(operation, target, cell),
  )
  if (matchingTerrainChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Terrain at ${cell.x},${cell.y},${cell.z} changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingTerrainChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Terrain at ${cell.x},${cell.y},${cell.z} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before editing terrain.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const mapWithUpdatedAt = (map: TabletopMapV2, processedAt: string): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  return Number.isFinite(updatedAtMs) ? { ...map, updatedAt: updatedAtMs } : { ...map }
}

const voxelInBounds = (
  cell: SessionTerrainCell,
  dimensions: TabletopMapV2['dimensions'],
): boolean => cell.x >= 0 && cell.x < dimensions.x &&
  cell.y >= 0 && cell.y < dimensions.y &&
  cell.z >= 0 && cell.z < dimensions.z

const materialCanBeBuilt = (materialId: string): boolean => {
  const material = getMaterialDefinition(materialId)
  return !material.transparent || (material.tags ?? []).includes('water')
}

const normalizeTerrainVoxel = (voxel: SessionTerrainVoxel): MapVoxelV2 => withDefaultBuilderVoxelColor({
  x: voxel.x,
  y: voxel.y,
  z: voxel.z,
  materialId: normalizeMaterialId(voxel.materialId),
  ...(voxel.color === undefined ? {} : { color: voxel.color }),
  ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost }),
  ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement }),
  ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight }),
  ...(voxel.tags === undefined ? {} : { tags: [...voxel.tags] }),
})

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

const placementOccupiesCell = (
  placement: SheetPlacement,
  cell: SessionTerrainCell,
): boolean => placement.position.x === cell.x &&
  placement.position.y === cell.y &&
  placement.position.z === cell.z

const buildTerrainVoxelOnMap = (
  command: TerrainCommand,
  payload: BuildTerrainVoxelCommandPayload,
  record: TerrainSessionRecord,
  target: ResolvedTerrainMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: TerrainMapChange }
  | { readonly ok: false; readonly result: TerrainRejectedResult } => {
  const voxel = normalizeTerrainVoxel(payload.voxel)
  const cell = cloneCell(voxel)
  const previous = voxelAtCell(target.mapState, cell)
  const previousClone = previous === undefined ? null : cloneVoxel(previous)

  if (!voxelInBounds(cell, target.mapState.document.dimensions)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Terrain voxel cannot be built at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentTerrainState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  if (!materialCanBeBuilt(voxel.materialId)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Terrain material ${voxel.materialId} is not available to the terrain builder palette.`,
        processedAt,
        {
          retryable: false,
          currentState: currentTerrainState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  if (target.mapState.document.placements.some((placement) => placementOccupiesCell(placement, cell))) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Terrain voxel cannot be built at ${cell.x},${cell.y},${cell.z}; a token occupies that cell.`,
        processedAt,
        {
          retryable: true,
          currentState: currentTerrainState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  if (previous !== undefined && voxelEquals(previous, voxel)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Terrain voxel at ${cell.x},${cell.y},${cell.z} already matches the requested build payload.`,
        processedAt,
        {
          retryable: false,
          currentState: currentTerrainState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  const nextVoxels = target.mapState.document.voxels
    .filter((existing) => !terrainCellsEqual(existing, cell))
    .map(cloneVoxel)
  nextVoxels.push(cloneVoxel(voxel))

  const document = mapWithUpdatedAt({
    ...target.mapState.document,
    voxels: nextVoxels,
  }, processedAt)

  return {
    ok: true,
    change: {
      cell,
      previous: previousClone,
      current: cloneVoxel(voxel),
      built: cloneVoxel(voxel),
      document,
    },
  }
}

const removeTerrainVoxelFromMap = (
  command: TerrainCommand,
  payload: RemoveTerrainVoxelCommandPayload,
  record: TerrainSessionRecord,
  target: ResolvedTerrainMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: TerrainMapChange }
  | { readonly ok: false; readonly result: TerrainRejectedResult } => {
  const cell = cloneCell(payload.cell)
  const previous = voxelAtCell(target.mapState, cell)

  if (!voxelInBounds(cell, target.mapState.document.dimensions)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Terrain voxel cannot be removed at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentTerrainState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  if (previous === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `No terrain voxel is present at ${cell.x},${cell.y},${cell.z}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentTerrainState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  const removed = cloneVoxel(previous)
  const document = mapWithUpdatedAt({
    ...target.mapState.document,
    voxels: target.mapState.document.voxels
      .filter((existing) => !terrainCellsEqual(existing, cell))
      .map(cloneVoxel),
  }, processedAt)

  return {
    ok: true,
    change: {
      cell,
      previous: removed,
      current: null,
      removed,
      document,
    },
  }
}

const applyTerrainChange = (
  command: TerrainCommand,
  record: TerrainSessionRecord,
  target: ResolvedTerrainMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: TerrainMapChange }
  | { readonly ok: false; readonly result: TerrainRejectedResult } => {
  if (command.type === BUILD_TERRAIN_VOXEL_COMMAND_TYPE) {
    return buildTerrainVoxelOnMap(command, command.payload, record, target, processedAt)
  }
  return removeTerrainVoxelFromMap(command, command.payload, record, target, processedAt)
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: TerrainCommand,
  result: TerrainRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: TerrainCommand,
  result: TerrainAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForTerrain = (commandInput: unknown): TerrainCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<TerrainCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (
      envelopeValidation.command.type !== BUILD_TERRAIN_VOXEL_COMMAND_TYPE &&
      envelopeValidation.command.type !== REMOVE_TERRAIN_VOXEL_COMMAND_TYPE
    ) {
      throw new ApplyTerrainCommandUseCaseError(
        400,
        'applyTerrainCommandUseCase only handles buildTerrainVoxel and removeTerrainVoxel command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyTerrainCommandUseCaseError(
    400,
    `terrain command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyTerrainCommandUseCase = (
  input: ApplyTerrainCommandInput = {},
  dependencies: ApplyTerrainCommandDependencies = {},
): ApplyTerrainCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const envelope = validateEnvelopeForTerrain(input.command)
  const record = getActiveTerrainRecord(activeStore, envelope)
  const processedAt = clock()

  if (tracker !== false) {
    const duplicateCheck = tracker.check(envelope, {
      currentRevision: record.revision,
      processedAt,
    })

    if (duplicateCheck.status === 'duplicate') {
      return {
        status: 'duplicate',
        session: sessionDetailsFor(record),
        command: envelope,
        result: duplicateCheck.result as TerrainDuplicateResult,
        record,
        state: record.state,
      }
    }

    if (duplicateCheck.status === 'mismatched-opId') {
      const result = createConflictRejection(
        envelope,
        record,
        duplicateCheck.message,
        processedAt,
        { retryable: false },
      )
      return rejectionOutcome(envelope, record, record.state, result)
    }
  }

  const commandValidation = validateTerrainCommand(envelope)
  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveTerrainMap(
    commandValidation.command,
    record,
    commandValidation.mapSlug,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const staleRejection = staleTerrainRejection(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
    tracker,
  )
  if (staleRejection !== undefined) {
    rememberRejectedResult(tracker, envelope, staleRejection, processedAt)
    return rejectionOutcome(envelope, record, record.state, staleRejection)
  }

  const previousTerrain = currentTerrainState(
    targetResult.target.mapSlug,
    targetResult.target.mapState,
    record.revision,
    commandValidation.cell,
  )
  const change = applyTerrainChange(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
  )
  if (!change.ok) {
    rememberRejectedResult(tracker, envelope, change.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, change.result)
  }

  const applied = applyAcceptedSessionCommandEffect<
    TerrainCommandType,
    TerrainCommandPayload,
    TabletopMapV2,
    typeof TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE,
    TerrainPatchPayload
  >({
    state: record.state,
    command: commandValidation.command,
    eventType: TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE,
    eventPayload: {
      mapSlug: targetResult.target.mapSlug,
      command: commandValidation.command.type,
      cell: cloneCell(change.change.cell),
      previous: change.change.previous === null ? null : cloneVoxel(change.change.previous),
      current: change.change.current === null ? null : cloneVoxel(change.change.current),
      ...(change.change.built === undefined ? {} : { built: cloneVoxel(change.change.built) }),
      ...(change.change.removed === undefined ? {} : { removed: cloneVoxel(change.change.removed) }),
      rendererInvalidation: TERRAIN_RENDER_INVALIDATION_REASONS,
    },
    mapEffects: [
      {
        mapSlug: targetResult.target.mapSlug,
        document: change.change.document,
      },
    ],
  }, {
    processedAt,
  })

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    throw new ApplyTerrainCommandUseCaseError(
      409,
      'The live session ended before terrain could apply',
    )
  }

  let snapshot: WriteSessionSnapshotResult<TabletopMapV2>
  try {
    snapshot = snapshotWriter(applied.state, { clock: () => applied.processedAt })
  } catch (error) {
    activeStore.setState(record.sessionId, record.state, {
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
    throw new ApplyTerrainCommandUseCaseError(
      500,
      `Failed to write terrain session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  if (currentMapState === undefined) {
    throw new ApplyTerrainCommandUseCaseError(
      500,
      'terrain command applied but the target map could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    previousTerrain,
    terrain: currentTerrainState(
      targetResult.target.mapSlug,
      currentMapState,
      applied.currentRevision,
      change.change.cell,
    ),
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: applied.state,
    mapRevisionChanges: applied.mapRevisionChanges,
  }
}

export const createTerrainCellScope = createTerrainVoxelCommandScope
