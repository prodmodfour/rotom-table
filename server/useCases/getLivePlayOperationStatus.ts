import type { AuthRole } from '#shared/auth'
import {
  validateLivePlayCommandEnvelope,
  type LivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
  parseLivePlayOperationStatusResponse,
  type LivePlayOperationStatusResponse,
} from '#shared/livePlayOperationStatus'
import { parsePlayerProfileId, type PlayerProfile, type PlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import {
  createLivePlayCommandHash,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
} from '../livePlay/opResult'
import type { LivePlayOpStore } from '../livePlay/opStore'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { sqliteLivePlayOpRepository } from '../storage/opRepository'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LivePlayOperationStatusUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface GetLivePlayOperationStatusInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly playerProfile?: PlayerProfile | null
}

export interface GetLivePlayOperationStatusDependencies {
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'>
  readonly operationStore?: Pick<LivePlayOpStore, 'getOpRecord'>
  readonly commandHash?: (command: LivePlayCommandEnvelope) => LivePlayCommandHash
  readonly canAccessMap?: (role: AuthRole, map: TabletopMap) => boolean
}

type UnknownRecord = Record<string, unknown>

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const commandValidationSummary = (
  issues: readonly { readonly path: string; readonly message: string }[],
): string => issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const validateCommand = (value: unknown): LivePlayCommandEnvelope => {
  const validation = validateLivePlayCommandEnvelope(value)
  if (!validation.valid) {
    throw new LivePlayOperationStatusUseCaseError(
      400,
      `Invalid live-play command envelope: ${commandValidationSummary(validation.issues)}`,
    )
  }
  return validation.command
}

const profileIdFromCommand = (command: LivePlayCommandEnvelope): PlayerProfileId | null => {
  const record = command as unknown as UnknownRecord
  if (!hasOwn(record, 'profileId')) return null
  const value = record.profileId
  if (value === undefined || value === null || value === '') return null
  try {
    return parsePlayerProfileId(value)
  } catch (error) {
    throw new LivePlayOperationStatusUseCaseError(
      400,
      error instanceof Error ? error.message : String(error),
    )
  }
}

const assertProfileBoundary = (
  role: AuthRole,
  command: LivePlayCommandEnvelope,
  playerProfile: PlayerProfile | null | undefined,
): void => {
  const commandRecord = command as unknown as UnknownRecord
  if (role === 'gm') {
    if (hasOwn(commandRecord, 'profileId')) {
      throw new LivePlayOperationStatusUseCaseError(
        403,
        'GM operation-status requests must not include a player profile ID.',
      )
    }
    return
  }

  const commandProfileId = profileIdFromCommand(command)
  const resolvedProfileId = playerProfile?.id ?? null
  if (commandProfileId !== resolvedProfileId) {
    throw new LivePlayOperationStatusUseCaseError(
      403,
      'Player operation-status requests must match the selected command profile context.',
    )
  }
}

const loadAccessibleMap = async (
  role: AuthRole,
  command: LivePlayCommandEnvelope,
  dependencies: Required<Pick<GetLivePlayOperationStatusDependencies, 'mapRepository' | 'canAccessMap'>>,
): Promise<TabletopMap> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlayOperationStatusUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  if (!dependencies.canAccessMap(role, map)) {
    throw new LivePlayOperationStatusUseCaseError(403, 'Map is not player visible')
  }
  return map
}

const dependenciesWithDefaults = (
  dependencies: GetLivePlayOperationStatusDependencies,
): Required<GetLivePlayOperationStatusDependencies> => ({
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  operationStore: dependencies.operationStore ?? sqliteLivePlayOpRepository,
  commandHash: dependencies.commandHash ?? createLivePlayCommandHash,
  canAccessMap: dependencies.canAccessMap ?? canAccessMapForRole,
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
  const command = validateCommand(input.command)
  assertProfileBoundary(input.role, command, input.playerProfile)
  await loadAccessibleMap(input.role, command, deps)

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
