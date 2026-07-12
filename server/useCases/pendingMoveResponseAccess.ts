import type { AuthRole } from '#shared/auth'
import type {
  PendingMoveResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import type { MoveResponseCommand } from '#shared/moveAutomation/responseCommands'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import {
  pendingMoveResponseAuthorizationGrant,
  type PendingMoveResponseAuthorizationGrant,
  type PendingMoveResponseViewer,
} from '../policies/pendingMoveResponsePolicy'
import {
  playerProfileLinkedTrainerSheetsForTokenControl,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
import type { StoredPendingMoveResolution } from '../storage/pendingMoveResolutionRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { loadMapUseCase } from './loadMap'

export class PendingMoveResponseAccessError extends UseCaseHttpError<403 | 409> {}

export interface PendingMoveResponseAccessDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'>
}

export interface PendingMoveResponseAccessContext {
  readonly map: TabletopMap
  readonly viewer: PendingMoveResponseViewer
}

const trainerSheetForControl = (
  sheet: PersistedSheet,
): ServerTokenControlLinkedTrainerSheet => ({
  slug: sheet.slug,
  ...(Array.isArray(sheet.sheet.currentTeam) ? { currentTeam: sheet.sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.sheet.boxedPokemon) ? { boxedPokemon: sheet.sheet.boxedPokemon } : {}),
})

const dependenciesWithDefaults = (
  dependencies: PendingMoveResponseAccessDependencies,
): Required<Pick<PendingMoveResponseAccessDependencies, 'mapRepository' | 'sheetRepository'>> => {
  const database = dependencies.database ?? getRotomDatabase()
  return {
    mapRepository: dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    sheetRepository: dependencies.sheetRepository
      ?? createSqliteSheetRepository<Record<string, unknown>>(database),
  }
}

export const resolvePendingMoveResponseAccessContext = (input: {
  readonly role: AuthRole
  readonly mapSlug: unknown
  readonly playerProfile?: PlayerProfile | null
}, dependencies: PendingMoveResponseAccessDependencies = {}): PendingMoveResponseAccessContext => {
  const deps = dependenciesWithDefaults(dependencies)
  const { map } = loadMapUseCase(
    { role: input.role, slug: input.mapSlug },
    { mapRepository: deps.mapRepository },
  )
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    (slug) => {
      const sheet = deps.sheetRepository.getByRef('trainer', slug)
      return sheet ? trainerSheetForControl(sheet) : null
    },
  )

  return Object.freeze({
    map,
    viewer: Object.freeze({
      role: input.role,
      playerProfile: input.playerProfile ?? null,
      linkedTrainerSheets: Object.freeze([...linkedTrainerSheets]),
    }),
  })
}

/** Bind a player response command to the profile context resolved by its route. */
export const assertPendingMoveResponseProfileBoundary = (input: {
  readonly role: AuthRole
  readonly command: MoveResponseCommand
  readonly playerProfile?: PlayerProfile | null
}): void => {
  if (input.role === 'gm') {
    if (input.command.profileId !== undefined) {
      throw new PendingMoveResponseAccessError(
        403,
        'GM move response requests must not include a player profile ID.',
      )
    }
    return
  }

  if (
    !input.playerProfile
    || input.command.profileId === undefined
    || input.command.profileId !== input.playerProfile.id
  ) {
    throw new PendingMoveResponseAccessError(
      403,
      'Player move response requests must match a selected player profile.',
    )
  }
}

/** Authorize one already-parsed current response window without exposing its principals. */
export const authorizePendingMoveResponseWindow = (input: {
  readonly role: AuthRole
  readonly command: MoveResponseCommand
  readonly playerProfile?: PlayerProfile | null
  readonly storedResolution: StoredPendingMoveResolution
  readonly window: PendingMoveResponseWindow | null
}, dependencies: PendingMoveResponseAccessDependencies = {}): PendingMoveResponseAuthorizationGrant => {
  assertPendingMoveResponseProfileBoundary(input)
  const context = resolvePendingMoveResponseAccessContext({
    role: input.role,
    mapSlug: input.command.mapSlug,
    playerProfile: input.playerProfile,
  }, dependencies)
  const stored = input.storedResolution
  if (
    stored.originMapSlug !== context.map.slug
    || stored.resolution.originMapSlug !== context.map.slug
    || stored.status !== 'pending'
    || stored.resolution.status !== 'pending'
  ) {
    throw new PendingMoveResponseAccessError(
      409,
      'The pending move response no longer matches current map authority.',
    )
  }

  if (input.window === null) {
    if (input.role === 'gm' && input.command.type === 'gm-cancel') {
      return Object.freeze({
        chosenBy: Object.freeze({ kind: 'gm', id: null }),
        source: 'gm-authority',
      })
    }
    throw new PendingMoveResponseAccessError(403, 'This move response window is not available.')
  }

  const grant = pendingMoveResponseAuthorizationGrant({
    resolution: stored.resolution,
    window: input.window,
    map: context.map,
    viewer: context.viewer,
  })
  if (!grant) {
    throw new PendingMoveResponseAccessError(
      403,
      'This move response window is not available to the selected participant.',
    )
  }
  return grant
}
