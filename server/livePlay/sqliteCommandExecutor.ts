import type { MapInteractionMode } from '#shared/mapInteractionMode'
import { LIVE_PLAY_COMMAND_TYPES, type LivePlayCommandEnvelope } from '#shared/livePlayCommands'
import { acceptedCommandRealtimeAppendInput } from './acceptedCommandRealtime'
import {
  createAuthoritativeLivePlayCommandExecutor,
  type AcceptedLivePlayAfterCommitPublicationFailureReporter,
  type PersistedLivePlayRealtimeEventPublisher,
} from './commandExecutor'
import type { RotomDatabase } from '../storage/database'
import { createSqliteLivePlayOpRepository, sqliteLivePlayOpRepository, type LivePlayOpRepository } from '../storage/opRepository'
import { createSqliteMapInteractionModeRepository, sqliteMapInteractionModeRepository } from '../storage/mapInteractionModeRepository'
import {
  createSqliteRealtimeEventRepository,
  sqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { publishSequencedRealtime } from '../utils/realtime'
import { createSqliteEncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import { createSqliteContestRepository } from '../storage/contestRepository'
import { createSqliteMapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { findNextBattleContestLiveplayHandoff } from '../domain/contests/battleLiveplay'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

export interface CreateSqliteAuthoritativeLivePlayCommandExecutorOptions {
  readonly database?: RotomDatabase
  readonly opStore?: LivePlayOpRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly publishPersistedRealtimeEvent?: PersistedLivePlayRealtimeEventPublisher
  readonly publishAcceptedRealtimeEvent?: PersistedLivePlayRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: AcceptedLivePlayAfterCommitPublicationFailureReporter
  readonly readMapInteractionMode?: (mapSlug: string) => MapInteractionMode
  readonly readMapCommandInterruption?: (command: LivePlayCommandEnvelope) => string | null
}

export const createSqliteAuthoritativeLivePlayCommandExecutor = (
  options: CreateSqliteAuthoritativeLivePlayCommandExecutorOptions = {},
) => {
  const database = options.database
  const opStore = options.opStore
    ?? (database ? createSqliteLivePlayOpRepository({ database }) : sqliteLivePlayOpRepository)
  const realtimeEventRepository = options.realtimeEventRepository
    ?? (database ? createSqliteRealtimeEventRepository({ database }) : sqliteRealtimeEventRepository)
  const readMapInteractionMode = options.readMapInteractionMode
    ?? (database
      ? (mapSlug: string) => createSqliteMapInteractionModeRepository(database).get(mapSlug).interactionMode
      : (mapSlug: string) => sqliteMapInteractionModeRepository.get(mapSlug).interactionMode)
  const readMapCommandInterruption = options.readMapCommandInterruption ?? (database
    ? (command: LivePlayCommandEnvelope): string | null => {
        const encounter = createSqliteEncounterDocumentRepository(database).findByMapSlug(command.mapSlug)
        if (!encounter?.battleContest) return null
        const contest = createSqliteContestRepository(database).get(encounter.battleContest.link.contestId)?.document ?? null
        const cancelled = contest?.stage === 'cancelled'
        if (cancelled && command.type === LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER) return null
        if (encounter.lifecycle === 'paused' || contest?.paused === true || cancelled) return cancelled
          ? 'The linked Battle Contest is cancelled. End the encounter before issuing another live-play command.'
          : 'The linked Battle Contest and Encounter are paused. Resume them before issuing another live-play command.'
        if (contest?.stage === 'settling') {
          return 'The linked Battle Contest has ended. Complete joined settlement before issuing another live-play command.'
        }
        if (!contest || contest.stage !== 'performance' || contest.variantId !== 'battle') return null
        try {
          const binding = contest.battle?.encounter
          if (!binding) return 'The linked Battle Contest has stale Encounter authority.'
          const map = createSqliteMapRepository<TabletopMap>(database).get(command.mapSlug)?.document
          if (!map) return 'The linked Battle Contest map authority is unavailable.'
          const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
          const pokemonHitPointsBySheetSlug = Object.fromEntries(binding.teams.flatMap(team => team.pokemon.map(member => {
            const stored = sheets.get('pokemon', member.sheetSlug)
            const currentHp = Number((stored?.document as unknown as CharacterSheet | undefined)?.combat?.currentHp)
            if (!stored || !Number.isSafeInteger(currentHp)) throw new Error('Battle roster HP authority is unavailable.')
            return [member.sheetSlug, currentHp] as const
          })))
          const pending = findNextBattleContestLiveplayHandoff({
            document: contest,
            encounterDocument: encounter,
            map,
            sourceOperations: opStore.listStoredOpsForMap(command.mapSlug, 10_000),
            pokemonHitPointsBySheetSlug,
          })
          return pending ? 'Contest Appeal must settle before the next Encounter action.' : null
        } catch {
          return 'Battle Contest authority must synchronize before the next Encounter action.'
        }
      }
    : undefined)

  return createAuthoritativeLivePlayCommandExecutor({
    opStore,
    readMapInteractionMode,
    ...(readMapCommandInterruption ? { readMapCommandInterruption } : {}),
    recordRealtimeEvents: (inputs) => realtimeEventRepository.appendMany(inputs),
    recordAcceptedRealtimeEvent: ({ command, result, clientId }) => {
      const [event] = realtimeEventRepository.appendMany([
        acceptedCommandRealtimeAppendInput({ command, result, clientId }),
      ])
      if (!event) throw new Error('accepted live-play realtime event append returned no event')
      return event
    },
    publishPersistedRealtimeEvent: options.publishPersistedRealtimeEvent
      ?? options.publishAcceptedRealtimeEvent
      ?? ((event) => publishSequencedRealtime(event.event)),
    reportAfterCommitPublicationFailure: options.reportAfterCommitPublicationFailure,
  })
}
