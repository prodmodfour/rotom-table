import type { AuthRole } from '#shared/auth'
import {
  createLivePlayRejectedResult,
  type LivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
  parseLivePlayOperationAbandonmentResponse,
  type LivePlayOperationAbandonmentResponse,
} from '#shared/livePlayOperationAbandonment'
import type { PlayerProfile } from '#shared/playerProfiles'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import {
  createLivePlayCommandHash,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
} from '../livePlay/opResult'
import { livePlayMapWriteQueue, type MapWriteQueue } from '../livePlay/mapWriteQueue'
import type { LivePlayOpRecord, LivePlayOpStore, SaveLivePlayOpResultInput } from '../livePlay/opStore'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteLivePlayOpRepository } from '../storage/opRepository'
import type { MapRepository } from '../storage/mapRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  livePlayOperationAccessDependenciesWithDefaults,
  loadLivePlayOperationAccessibleMap,
  validateLivePlayOperationAccess,
  type LivePlayOperationAccessDependencies,
} from './livePlayOperationAccess'

export class AbandonLivePlayOperationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface AbandonLivePlayOperationInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly playerProfile?: PlayerProfile | null
}

type CommandRecordingOperationStore = Pick<LivePlayOpStore, 'getOpRecord' | 'saveOpResult'> & {
  saveCommandResult?: (input: SaveLivePlayOpResultInput & { readonly command: unknown }) => LivePlayOpRecord
}

export interface AbandonLivePlayOperationDependencies extends LivePlayOperationAccessDependencies {
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'>
  readonly operationStore?: CommandRecordingOperationStore
  readonly commandHash?: (command: LivePlayCommandEnvelope) => LivePlayCommandHash
  readonly queue?: MapWriteQueue
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
}

interface AbandonmentDependencySet {
  readonly access: Required<LivePlayOperationAccessDependencies>
  readonly operationStore: CommandRecordingOperationStore
  readonly commandHash: (command: LivePlayCommandEnvelope) => LivePlayCommandHash
  readonly queue: MapWriteQueue
  readonly database: Pick<RotomDatabase, 'withTransaction'>
}

const noOpTransaction = {
  withTransaction: <T>(work: () => T): T => work(),
}

const dependenciesWithDefaults = (
  dependencies: AbandonLivePlayOperationDependencies,
): AbandonmentDependencySet => ({
  access: livePlayOperationAccessDependenciesWithDefaults(dependencies),
  operationStore: dependencies.operationStore ?? sqliteLivePlayOpRepository,
  commandHash: dependencies.commandHash ?? createLivePlayCommandHash,
  queue: dependencies.queue ?? livePlayMapWriteQueue,
  database: dependencies.database ?? (dependencies.operationStore === undefined ? getRotomDatabase() : noOpTransaction),
})

const accessDependencies = (
  dependencies: AbandonLivePlayOperationDependencies,
): LivePlayOperationAccessDependencies => ({
  ...(dependencies.mapRepository === undefined ? {} : { mapRepository: dependencies.mapRepository }),
  ...(dependencies.canAccessMap === undefined ? {} : { canAccessMap: dependencies.canAccessMap }),
})

const saveOperationResult = (
  store: CommandRecordingOperationStore,
  input: SaveLivePlayOpResultInput,
  command: LivePlayCommandEnvelope,
): LivePlayOpRecord => {
  if (typeof store.saveCommandResult === 'function') {
    return store.saveCommandResult({ ...input, command })
  }
  return store.saveOpResult(input)
}

const alreadyTerminalResponse = (
  command: LivePlayCommandEnvelope,
  record: LivePlayOpRecord,
): LivePlayOperationAbandonmentResponse => parseLivePlayOperationAbandonmentResponse({
  schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
  disposition: 'already-terminal',
  mapSlug: command.mapSlug,
  opId: command.opId,
  result: record.result,
})

const abandonedResponse = (
  command: LivePlayCommandEnvelope,
  record: LivePlayOpRecord,
): LivePlayOperationAbandonmentResponse => parseLivePlayOperationAbandonmentResponse({
  schemaVersion: LIVE_PLAY_OPERATION_ABANDONMENT_SCHEMA_VERSION,
  disposition: 'abandoned',
  mapSlug: command.mapSlug,
  opId: command.opId,
  result: record.result,
})

const assertMatchingCommandHash = (
  record: LivePlayOpRecord,
  commandHash: LivePlayCommandHash,
): void => {
  if (record.commandHash !== commandHash) {
    throw new AbandonLivePlayOperationUseCaseError(
      409,
      livePlayIdempotencyViolationMessage(record.mapSlug, record.opId),
    )
  }
}

export const abandonLivePlayOperationUseCase = async (
  input: AbandonLivePlayOperationInput,
  dependencies: AbandonLivePlayOperationDependencies = {},
): Promise<LivePlayOperationAbandonmentResponse> => {
  const deps = dependenciesWithDefaults(dependencies)
  const { command } = await validateLivePlayOperationAccess(input, accessDependencies(dependencies), {
    operationName: 'operation-abandonment',
    error: (statusCode, message) => new AbandonLivePlayOperationUseCaseError(statusCode, message),
  })

  return await deps.queue.withMapWriteQueue(command.mapSlug, async () => {
    const map = await loadLivePlayOperationAccessibleMap(input.role, command, deps.access, {
      error: (statusCode, message) => new AbandonLivePlayOperationUseCaseError(statusCode, message),
    })

    let commandHash: LivePlayCommandHash
    try {
      commandHash = deps.commandHash(command)
    } catch (error) {
      throw new AbandonLivePlayOperationUseCaseError(
        400,
        error instanceof Error ? error.message : String(error),
      )
    }

    const existing = deps.operationStore.getOpRecord(command.mapSlug, command.opId)
    if (existing) {
      assertMatchingCommandHash(existing, commandHash)
      return alreadyTerminalResponse(command, existing)
    }

    const abandonedResult = createLivePlayRejectedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'abandoned',
      message: 'This live-play operation was abandoned before execution.',
      currentRevision: normalizeRevision(map.revision),
    })

    return deps.database.withTransaction(() => {
      const transactionalExisting = deps.operationStore.getOpRecord(command.mapSlug, command.opId)
      if (transactionalExisting) {
        assertMatchingCommandHash(transactionalExisting, commandHash)
        return alreadyTerminalResponse(command, transactionalExisting)
      }

      const record = saveOperationResult(deps.operationStore, {
        mapSlug: command.mapSlug,
        opId: command.opId,
        commandHash,
        result: abandonedResult,
      }, command)
      return abandonedResponse(command, record)
    })
  })
}
