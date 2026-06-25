import type { AuthRole } from '#shared/auth'
import type { LivePlayCommandEnvelope } from '#shared/livePlayCommands'
import {
  LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
  parseLivePlayOperationStatusResponse,
  type LivePlayOperationStatusResponse,
} from '#shared/livePlayOperationStatus'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import {
  createLivePlayCommandHash,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
} from '../livePlay/opResult'
import type { LivePlayOpStore } from '../livePlay/opStore'
import { sqliteLivePlayOpRepository } from '../storage/opRepository'
import type { MapRepository } from '../storage/mapRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  validateLivePlayOperationAccess,
  type LivePlayOperationAccessDependencies,
} from './livePlayOperationAccess'

export class LivePlayOperationStatusUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface GetLivePlayOperationStatusInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly playerProfile?: PlayerProfile | null
}

export interface GetLivePlayOperationStatusDependencies extends LivePlayOperationAccessDependencies {
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'>
  readonly operationStore?: Pick<LivePlayOpStore, 'getOpRecord'>
  readonly commandHash?: (command: LivePlayCommandEnvelope) => LivePlayCommandHash
}

const dependenciesWithDefaults = (
  dependencies: GetLivePlayOperationStatusDependencies,
): Required<Pick<GetLivePlayOperationStatusDependencies, 'operationStore' | 'commandHash'>> => ({
  operationStore: dependencies.operationStore ?? sqliteLivePlayOpRepository,
  commandHash: dependencies.commandHash ?? createLivePlayCommandHash,
})

const accessDependencies = (
  dependencies: GetLivePlayOperationStatusDependencies,
): LivePlayOperationAccessDependencies => ({
  ...(dependencies.mapRepository === undefined ? {} : { mapRepository: dependencies.mapRepository }),
  ...(dependencies.canAccessMap === undefined ? {} : { canAccessMap: dependencies.canAccessMap }),
})

/**
 * Reads a recorded terminal command result without executing the command. An
 * `unknown` response only means no terminal record is currently stored; it does
 * not prove that an already in-flight request cannot still finish later.
 */
export const getLivePlayOperationStatusUseCase = async (
  input: GetLivePlayOperationStatusInput,
  dependencies: GetLivePlayOperationStatusDependencies = {},
): Promise<LivePlayOperationStatusResponse> => {
  const deps = dependenciesWithDefaults(dependencies)
  const { command } = await validateLivePlayOperationAccess(input, accessDependencies(dependencies), {
    operationName: 'operation-status',
    error: (statusCode, message) => new LivePlayOperationStatusUseCaseError(statusCode, message),
  })

  let commandHash: LivePlayCommandHash
  try {
    commandHash = deps.commandHash(command)
  } catch (error) {
    throw new LivePlayOperationStatusUseCaseError(
      400,
      error instanceof Error ? error.message : String(error),
    )
  }

  const record = deps.operationStore.getOpRecord(command.mapSlug, command.opId)
  if (!record) {
    return parseLivePlayOperationStatusResponse({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug: command.mapSlug,
      opId: command.opId,
    })
  }

  if (record.commandHash !== commandHash) {
    throw new LivePlayOperationStatusUseCaseError(
      409,
      livePlayIdempotencyViolationMessage(record.mapSlug, record.opId),
    )
  }

  return parseLivePlayOperationStatusResponse({
    schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
    status: 'terminal',
    mapSlug: command.mapSlug,
    opId: command.opId,
    result: record.result,
  })
}
