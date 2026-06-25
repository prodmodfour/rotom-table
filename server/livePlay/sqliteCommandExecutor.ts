import type { MapInteractionMode } from '#shared/mapInteractionMode'
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

export interface CreateSqliteAuthoritativeLivePlayCommandExecutorOptions {
  readonly database?: RotomDatabase
  readonly opStore?: LivePlayOpRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly publishPersistedRealtimeEvent?: PersistedLivePlayRealtimeEventPublisher
  readonly publishAcceptedRealtimeEvent?: PersistedLivePlayRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: AcceptedLivePlayAfterCommitPublicationFailureReporter
  readonly readMapInteractionMode?: (mapSlug: string) => MapInteractionMode
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

  return createAuthoritativeLivePlayCommandExecutor({
    opStore,
    readMapInteractionMode,
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
