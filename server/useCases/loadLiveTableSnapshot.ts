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
import {
  createSqliteRealtimeEventRepository,
  type PersistedRealtimeEvent,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
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
import { buildCapabilityClientCapabilityBundle } from '../domain/capabilityAutomation/clientCapabilities'
import {
  projectCapabilityAutomationMapForPlayer,
  projectCapabilityAutomationPresentationMap,
} from '../domain/capabilityAutomation/clientStateProjection'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { persistCapabilitySourceLossOnLoad } from './persistCapabilitySourceLossOnLoad'

export interface LoadLiveTableSnapshotInput {
  readonly role: AuthRole
  readonly slug?: unknown
  readonly playerProfile?: PlayerProfile | null
  readonly sessionAccess?: PlayerSessionAccessGrant | null
}

type SnapshotMapRepository = Pick<MapRepository<TabletopMap>, 'get' | 'list'>
  & Partial<Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>>
type SnapshotModeRepository = Pick<MapInteractionModeRepository, 'get'>
type SnapshotSheetRepository = ListSheetsRepository
  & Partial<Pick<SheetRepository<Record<string, unknown>>, 'assertRevisions'>>
type SnapshotRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany' | 'cursorState' | 'readAfter'>

export interface LoadLiveTableSnapshotDependencies {
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly mapRepository?: SnapshotMapRepository
  readonly modeRepository?: SnapshotModeRepository
  readonly sheetRepository?: SnapshotSheetRepository
  readonly realtimeEventRepository?: SnapshotRealtimeEventRepository
  readonly now?: () => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
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
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? ('connection' in database
      ? createSqliteRealtimeEventRepository({ database: database as RotomDatabase })
      : undefined)
  let sourceLossRealtimeEvents: readonly PersistedRealtimeEvent[] = []

  const snapshot = database.withTransaction(() => {
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
    const projectionSheets = {
      pokemon: new Map(pokemonSheets.map(sheet => [sheet.slug, sheet])),
      trainer: new Map(trainerSheets.map(sheet => [sheet.slug, sheet])),
    }
    const sourceLoss = persistCapabilitySourceLossOnLoad({
      map,
      revision,
      sheets: projectionSheets,
    }, {
      database,
      mapRepository,
      sheetRepository,
      realtimeEventRepository,
      now: dependencies.now,
    })
    sourceLossRealtimeEvents = sourceLoss.persistedRealtimeEvents
    const authoritativeMap = sourceLoss.map
    const authoritativeRevision = sourceLoss.revision
    const authorizedSheets = authorizeSheetList({
      role: input.role,
      playerProfile: input.playerProfile,
      ...playerAccessContext,
      pokemonSheets,
      trainerSheets,
    })

    const authorizedPokemonSlugs = new Set(authorizedSheets.pokemonSheets.map(sheet => sheet.slug))
    const authorizedTrainerSlugs = new Set(authorizedSheets.trainerSheets.map(sheet => sheet.slug))
    // Authorization and projection are separate boundaries: offers are derived
    // from raw server-owned ledgers, then only the already-redacted sheet
    // documents are returned to the player.
    const authorizedRawPokemonSheets = input.role === 'player'
      ? pokemonSheets.filter(sheet => authorizedPokemonSlugs.has(sheet.slug))
      : authorizedSheets.pokemonSheets
    const authorizedRawTrainerSheets = input.role === 'player'
      ? trainerSheets.filter(sheet => authorizedTrainerSlugs.has(sheet.slug))
      : authorizedSheets.trainerSheets

    const projectedMap = input.role === 'player'
      ? projectCapabilityAutomationMapForPlayer(projectAbilityAutomationMapForPlayer(authoritativeMap), projectionSheets)
      : projectCapabilityAutomationPresentationMap(authoritativeMap, projectionSheets)
    const projectedPokemonSheets = input.role === 'player'
      ? authorizedSheets.pokemonSheets.map(sheet => projectAbilityAutomationSheetForPlayer(sheet))
      : authorizedSheets.pokemonSheets
    const projectedTrainerSheets = input.role === 'player'
      ? authorizedSheets.trainerSheets.map(sheet => projectAbilityAutomationSheetForPlayer(sheet))
      : authorizedSheets.trainerSheets
    const abilityCapabilities = buildAbilityClientCapabilityBundle({
      role: input.role,
      playerProfile: input.playerProfile,
      map: authoritativeMap,
      mapRevision: authoritativeRevision,
      pokemonSheets: authorizedRawPokemonSheets,
      trainerSheets: authorizedRawTrainerSheets,
    })
    const capabilityCapabilities = buildCapabilityClientCapabilityBundle({
      role: input.role,
      playerProfile: input.playerProfile,
      map: authoritativeMap,
      mapRevision: authoritativeRevision,
      pokemonSheets: authorizedRawPokemonSheets,
      trainerSheets: authorizedRawTrainerSheets,
      now: authoritativeMap.updatedAt ?? 0,
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
      ? dependencies.listAcceptedEncounterPresentations({
          mapSlug: authoritativeMap.slug,
          mapRevision: authoritativeRevision,
        })
      : realtimeEventRepository
        ? (() => {
            const latestSequence = realtimeEventRepository.cursorState().latestSequence
            const events = realtimeEventRepository.readAfter({
              afterSequence: Math.max(0, latestSequence - 500),
              limit: 500,
            }).events
            return acceptedEncounterPresentationsFromPersistedRealtimeEvents({
              events,
              mapSlug: authoritativeMap.slug,
              mapRevision: authoritativeRevision,
            })
          })()
        : []
    const encounterPresentation = buildEncounterPresentationProjection({
      role: input.role,
      playerProfile: input.playerProfile,
      map: projectedMap,
      mapRevision: authoritativeRevision,
      pokemonSheets: projectedPokemonSheets,
      trainerSheets: projectedTrainerSheets,
      generatedAt: authoritativeMap.updatedAt ?? 0,
    }, { abilityCapabilities, capabilityCapabilities, pendingMoveResponses, acceptedPresentations })
    return {
      schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
      map: projectedMap,
      mapRevision: authoritativeRevision,
      interactionMode: mode.interactionMode,
      interactionModeUpdatedAt: mode.updatedAt,
      pokemonSheets: projectedPokemonSheets,
      trainerSheets: projectedTrainerSheets,
      encounterPresentation,
    }
  })
  publishPersistedRealtimeEventsAfterCommit({
    events: sourceLossRealtimeEvents,
    operation: 'capability-source-loss-load-reconciliation',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure
      ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return snapshot
}
