import type { AuthRole } from '#shared/auth'
import {
  LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
  type LiveTableSnapshot,
} from '#shared/liveTableSnapshot'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createSqliteMapInteractionModeRepository, type MapInteractionModeRepository } from '../storage/mapInteractionModeRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqlitePlayerVisibleMapSheetAccessKeys } from '../utils/mapSheetAccess'
import type { PlayerSessionAccessGrant } from '../utils/sessionPlayerAccess'
import { authorizeSheetList, playerSheetAccessContextFromKeys } from './authorizeSheetList'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'
import { buildAbilityClientCapabilityBundle } from '../domain/abilityAutomation/clientCapabilities'
import {
  projectAbilityAutomationMapForPlayer,
  projectAbilityAutomationSheetForPlayer,
} from '../domain/abilityAutomation/clientStateProjection'
import { loadMapUseCase, normalizeLoadMapSlug } from './loadMap'

export interface LoadLiveTableSnapshotInput {
  readonly role: AuthRole
  readonly slug?: unknown
  readonly playerProfile?: PlayerProfile | null
  readonly sessionAccess?: PlayerSessionAccessGrant | null
}

type SnapshotMapRepository = Pick<MapRepository<unknown>, 'get' | 'list'>
type SnapshotModeRepository = Pick<MapInteractionModeRepository, 'get'>
type SnapshotSheetRepository = ListSheetsRepository

export interface LoadLiveTableSnapshotDependencies {
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly mapRepository?: SnapshotMapRepository
  readonly modeRepository?: SnapshotModeRepository
  readonly sheetRepository?: SnapshotSheetRepository
}

const defaultDatabase = (
  database: Pick<RotomDatabase, 'withTransaction'> | undefined,
): RotomDatabase | Pick<RotomDatabase, 'withTransaction'> => database ?? getRotomDatabase()

const defaultMapRepository = (
  database: RotomDatabase | Pick<RotomDatabase, 'withTransaction'>,
): SnapshotMapRepository => createSqliteMapRepository(database as RotomDatabase) as SnapshotMapRepository

const defaultModeRepository = (
  database: RotomDatabase | Pick<RotomDatabase, 'withTransaction'>,
): SnapshotModeRepository => createSqliteMapInteractionModeRepository(database as RotomDatabase)

const defaultSheetRepository = (
  database: RotomDatabase | Pick<RotomDatabase, 'withTransaction'>,
): SnapshotSheetRepository => createSqliteSheetRepository<Record<string, unknown>>(database as RotomDatabase) as SnapshotSheetRepository

export const loadLiveTableSnapshotUseCase = (
  input: LoadLiveTableSnapshotInput,
  dependencies: LoadLiveTableSnapshotDependencies = {},
): LiveTableSnapshot => {
  const slug = normalizeLoadMapSlug(input.slug)
  const database = defaultDatabase(dependencies.database)
  const mapRepository = dependencies.mapRepository ?? defaultMapRepository(database)
  const modeRepository = dependencies.modeRepository ?? defaultModeRepository(database)
  const sheetRepository = dependencies.sheetRepository ?? defaultSheetRepository(database)

  return database.withTransaction(() => {
    const { map, revision } = loadMapUseCase({ role: input.role, slug }, { mapRepository })
    const mode = modeRepository.get(map.slug)
    const mapSheetAccessKeys = input.role === 'player'
      ? sqlitePlayerVisibleMapSheetAccessKeys(mapRepository)
      : null
    const playerAccessContext = input.role === 'player'
      ? playerSheetAccessContextFromKeys({
          sessionAccessKeys: input.sessionAccess?.sheetKeys ?? null,
          mapSheetAccessKeys,
        })
      : {}

    const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
    const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
    const authorizedSheets = authorizeSheetList({
      role: input.role,
      playerProfile: input.playerProfile,
      ...playerAccessContext,
      pokemonSheets,
      trainerSheets,
    })

    const abilityCapabilities = buildAbilityClientCapabilityBundle({
      role: input.role,
      playerProfile: input.playerProfile,
      map,
      mapRevision: revision,
      pokemonSheets: authorizedSheets.pokemonSheets,
      trainerSheets: authorizedSheets.trainerSheets,
    })
    return {
      schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
      map: input.role === 'player' ? projectAbilityAutomationMapForPlayer(map) : map,
      mapRevision: revision,
      interactionMode: mode.interactionMode,
      interactionModeUpdatedAt: mode.updatedAt,
      pokemonSheets: input.role === 'player'
        ? authorizedSheets.pokemonSheets.map(sheet => projectAbilityAutomationSheetForPlayer(sheet))
        : authorizedSheets.pokemonSheets,
      trainerSheets: input.role === 'player'
        ? authorizedSheets.trainerSheets.map(sheet => projectAbilityAutomationSheetForPlayer(sheet))
        : authorizedSheets.trainerSheets,
      abilityCapabilities,
    }
  })
}
