import type { AuthRole } from '#shared/auth'
import {
  LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
  type LiveTableSnapshot,
} from '#shared/liveTableSnapshot'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { PendingMoveResponseWindowList } from '#shared/moveAutomation/responseViews'
import type { AcceptedEncounterPresentation } from '#shared/encounterPresentation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createSqliteMapInteractionModeRepository, type MapInteractionModeRepository } from '../storage/mapInteractionModeRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqlitePlayerVisibleMapSheetAccessKeys } from '../utils/mapSheetAccess'
import type { PlayerSessionAccessGrant } from '../utils/sessionPlayerAccess'
import { authorizeSheetList, playerSheetAccessContextFromKeys } from './authorizeSheetList'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'
import { buildAbilityClientCapabilityBundle } from '../domain/abilityAutomation/clientCapabilities'
import { buildEncounterPresentationProjection } from '../domain/encounterPresentation/buildProjection'
import { acceptedEncounterPresentationsFromPersistedRealtimeEvents } from '../domain/encounterPresentation/replay'
import {
  projectAbilityAutomationMapForPlayer,
  projectAbilityAutomationSheetForPlayer,
} from '../domain/abilityAutomation/clientStateProjection'
import { loadMapUseCase, normalizeLoadMapSlug } from './loadMap'
import { listPendingMoveResponsesUseCase } from './listPendingMoveResponses'

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
  readonly listPendingMoveResponses?: (input: {
    readonly role: AuthRole
    readonly mapSlug: string
    readonly playerProfile?: PlayerProfile | null
  }) => PendingMoveResponseWindowList
  readonly listAcceptedEncounterPresentations?: (input: {
    readonly mapSlug: string
    readonly mapRevision: number
  }) => readonly AcceptedEncounterPresentation[]
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

    const projectedMap = input.role === 'player' ? projectAbilityAutomationMapForPlayer(map) : map
    const projectedPokemonSheets = input.role === 'player'
      ? authorizedSheets.pokemonSheets.map(sheet => projectAbilityAutomationSheetForPlayer(sheet))
      : authorizedSheets.pokemonSheets
    const projectedTrainerSheets = input.role === 'player'
      ? authorizedSheets.trainerSheets.map(sheet => projectAbilityAutomationSheetForPlayer(sheet))
      : authorizedSheets.trainerSheets
    const abilityCapabilities = buildAbilityClientCapabilityBundle({
      role: input.role,
      playerProfile: input.playerProfile,
      map,
      mapRevision: revision,
      pokemonSheets: authorizedSheets.pokemonSheets,
      trainerSheets: authorizedSheets.trainerSheets,
    })
    const pendingMoveResponses = dependencies.listPendingMoveResponses
      ? dependencies.listPendingMoveResponses({
          role: input.role,
          mapSlug: map.slug,
          playerProfile: input.playerProfile,
        })
      : 'connection' in database
        ? listPendingMoveResponsesUseCase({
            role: input.role,
            mapSlug: map.slug,
            playerProfile: input.playerProfile,
          }, {
            database: database as RotomDatabase,
            mapRepository: mapRepository as MapRepository<TabletopMap>,
            sheetRepository: sheetRepository as SheetRepository<Record<string, unknown>>,
          })
        : null
    const acceptedPresentations = dependencies.listAcceptedEncounterPresentations
      ? dependencies.listAcceptedEncounterPresentations({ mapSlug: map.slug, mapRevision: revision })
      : 'connection' in database
        ? (() => {
            const repository = createSqliteRealtimeEventRepository({ database: database as RotomDatabase })
            const latestSequence = repository.cursorState().latestSequence
            const events = repository.readAfter({
              afterSequence: Math.max(0, latestSequence - 500),
              limit: 500,
            }).events
            return acceptedEncounterPresentationsFromPersistedRealtimeEvents({
              events,
              mapSlug: map.slug,
              mapRevision: revision,
            })
          })()
        : []
    const encounterPresentation = buildEncounterPresentationProjection({
      role: input.role,
      playerProfile: input.playerProfile,
      map: projectedMap,
      mapRevision: revision,
      pokemonSheets: projectedPokemonSheets,
      trainerSheets: projectedTrainerSheets,
      generatedAt: map.updatedAt ?? 0,
    }, { abilityCapabilities, pendingMoveResponses, acceptedPresentations })
    return {
      schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
      map: projectedMap,
      mapRevision: revision,
      interactionMode: mode.interactionMode,
      interactionModeUpdatedAt: mode.updatedAt,
      pokemonSheets: projectedPokemonSheets,
      trainerSheets: projectedTrainerSheets,
      encounterPresentation,
    }
  })
}
