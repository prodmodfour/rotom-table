import type { AuthRole } from '#shared/auth'
import {
  validateLivePlayCommandEnvelope,
  type LivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import { parsePlayerProfileId, type PlayerProfile, type PlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export type LivePlayOperationAccessStatusCode = 400 | 403 | 404
export type LivePlayOperationAccessErrorFactory = (
  statusCode: LivePlayOperationAccessStatusCode,
  message: string,
) => UseCaseHttpError<number>

export interface LivePlayOperationAccessInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly playerProfile?: PlayerProfile | null
}

export interface LivePlayOperationAccessDependencies {
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'>
  readonly canAccessMap?: (role: AuthRole, map: TabletopMap) => boolean
}

export interface LivePlayOperationAccessOptions {
  readonly operationName: string
  readonly error: LivePlayOperationAccessErrorFactory
}

export interface LivePlayOperationAccessContext {
  readonly command: LivePlayCommandEnvelope
  readonly map: TabletopMap
}

type UnknownRecord = Record<string, unknown>

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const commandValidationSummary = (
  issues: readonly { readonly path: string; readonly message: string }[],
): string => issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

export const validateLivePlayOperationCommand = (
  value: unknown,
  options: Pick<LivePlayOperationAccessOptions, 'error'>,
): LivePlayCommandEnvelope => {
  const validation = validateLivePlayCommandEnvelope(value)
  if (!validation.valid) {
    throw options.error(
      400,
      `Invalid live-play command envelope: ${commandValidationSummary(validation.issues)}`,
    )
  }
  return validation.command
}

const profileIdFromCommand = (
  command: LivePlayCommandEnvelope,
  options: Pick<LivePlayOperationAccessOptions, 'error'>,
): PlayerProfileId | null => {
  const record = command as unknown as UnknownRecord
  if (!hasOwn(record, 'profileId')) return null
  const value = record.profileId
  if (value === undefined || value === null || value === '') return null
  try {
    return parsePlayerProfileId(value)
  } catch (error) {
    throw options.error(400, error instanceof Error ? error.message : String(error))
  }
}

export const assertLivePlayOperationProfileBoundary = (
  role: AuthRole,
  command: LivePlayCommandEnvelope,
  playerProfile: PlayerProfile | null | undefined,
  options: LivePlayOperationAccessOptions,
): void => {
  const commandRecord = command as unknown as UnknownRecord
  if (role === 'gm') {
    if (hasOwn(commandRecord, 'profileId')) {
      throw options.error(
        403,
        `GM ${options.operationName} requests must not include a player profile ID.`,
      )
    }
    return
  }

  const commandProfileId = profileIdFromCommand(command, options)
  const resolvedProfileId = playerProfile?.id ?? null
  if (commandProfileId !== resolvedProfileId) {
    throw options.error(
      403,
      `Player ${options.operationName} requests must match the selected command profile context.`,
    )
  }
}

export const loadLivePlayOperationAccessibleMap = async (
  role: AuthRole,
  command: LivePlayCommandEnvelope,
  dependencies: Required<LivePlayOperationAccessDependencies>,
  options: Pick<LivePlayOperationAccessOptions, 'error'>,
): Promise<TabletopMap> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw options.error(404, `Map ${command.mapSlug}.json not found`)
  if (!dependencies.canAccessMap(role, map)) {
    throw options.error(403, 'Map is not player visible')
  }
  return map
}

export const livePlayOperationAccessDependenciesWithDefaults = (
  dependencies: LivePlayOperationAccessDependencies,
): Required<LivePlayOperationAccessDependencies> => ({
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  canAccessMap: dependencies.canAccessMap ?? canAccessMapForRole,
})

export const validateLivePlayOperationAccess = async (
  input: LivePlayOperationAccessInput,
  dependencies: LivePlayOperationAccessDependencies,
  options: LivePlayOperationAccessOptions,
): Promise<LivePlayOperationAccessContext> => {
  const deps = livePlayOperationAccessDependenciesWithDefaults(dependencies)
  const command = validateLivePlayOperationCommand(input.command, options)
  assertLivePlayOperationProfileBoundary(input.role, command, input.playerProfile, options)
  const map = await loadLivePlayOperationAccessibleMap(input.role, command, deps, options)
  return { command, map }
}
