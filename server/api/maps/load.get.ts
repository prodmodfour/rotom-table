/**
 * GET /api/maps/load?slug=<slug>
 *
 * Returns the full map document for the given slug. 404 if not found.
 */
import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { projectAbilityAutomationMapForPlayer } from '../../domain/abilityAutomation/clientStateProjection'
import { loadMapUseCase } from '../../useCases/loadMap'
import {
  projectCapabilityAutomationMapForPlayer,
  projectCapabilityAutomationPresentationMap,
} from '../../domain/capabilityAutomation/clientStateProjection'
import { getRotomDatabase } from '../../storage/database'
import { createSqliteMapRepository } from '../../storage/mapRepository'
import {
  createSqliteRealtimeEventRepository,
  type PersistedRealtimeEvent,
} from '../../storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../storage/sheetRepository'
import { listRepositorySheets } from '../../useCases/listSheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { TabletopMap } from '~/types/map'
import { persistCapabilitySourceLossOnLoad } from '../../useCases/persistCapabilitySourceLossOnLoad'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
} from '../../realtime/persistedBatchPublication'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    const database = getRotomDatabase()
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtimeEventRepository = createSqliteRealtimeEventRepository({ database })
    let sourceLossRealtimeEvents: readonly PersistedRealtimeEvent[] = []
    const response = database.withTransaction(() => {
      const result = loadMapUseCase({
        role,
        slug: getQuery(event).slug,
      }, { mapRepository })
      const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
      const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
      const sheets = {
        pokemon: new Map(pokemonSheets.map(sheet => [sheet.slug, sheet])),
        trainer: new Map(trainerSheets.map(sheet => [sheet.slug, sheet])),
      }
      const sourceLoss = persistCapabilitySourceLossOnLoad({
        map: result.map,
        revision: result.revision,
        sheets,
      }, {
        database,
        mapRepository,
        sheetRepository,
        realtimeEventRepository,
      })
      sourceLossRealtimeEvents = sourceLoss.persistedRealtimeEvents
      return role === 'player'
        ? {
            ...result,
            revision: sourceLoss.revision,
            map: projectCapabilityAutomationMapForPlayer(
              projectAbilityAutomationMapForPlayer(sourceLoss.map),
              sheets,
            ),
          }
        : {
            ...result,
            revision: sourceLoss.revision,
            map: projectCapabilityAutomationPresentationMap(sourceLoss.map, sheets),
          }
    })
    publishPersistedRealtimeEventsAfterCommit({
      events: sourceLossRealtimeEvents,
      operation: 'capability-source-loss-map-load-reconciliation',
      publish: defaultPersistedRealtimeEventPublisher,
      reportFailure: defaultPersistedRealtimePublicationFailureReporter,
    })
    return response
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
