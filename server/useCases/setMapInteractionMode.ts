import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { MapInteractionMode } from '#shared/mapInteractionMode'
import {
  createSqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  interactionModeRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class SetMapInteractionModeUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface SetMapInteractionModeInput {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly clientId?: string
}

type SetMapInteractionModeRepository = Pick<MapInteractionModeRepository, 'get' | 'set'> & {
  readonly database?: RotomDatabase
}

type SetMapInteractionMapRepository = Pick<MapRepository, 'getBySlug'> & {
  readonly database?: RotomDatabase
}

type SetMapInteractionModeRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface SetMapInteractionModeDependencies {
  readonly database?: RotomDatabase
  readonly modeRepository?: SetMapInteractionModeRepository
  readonly mapRepository?: SetMapInteractionMapRepository
  readonly realtimeEventRepository?: SetMapInteractionModeRealtimeEventRepository
  readonly publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
  readonly now?: () => number
}

export interface SetMapInteractionModeResult {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly previousInteractionMode: MapInteractionMode
  readonly updatedAt: number
  readonly syncedMapForLivePlay: boolean
  readonly realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const setMapInteractionModeUseCase = (
  input: SetMapInteractionModeInput,
  dependencies: SetMapInteractionModeDependencies = {},
): SetMapInteractionModeResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Set map interaction mode repository', dependency: dependencies.modeRepository },
      { label: 'Set map interaction map repository', dependency: dependencies.mapRepository },
      { label: 'Set map interaction realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const modeRepository = dependencies.modeRepository ?? createSqliteMapInteractionModeRepository(database)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const transactionResult = database.withTransaction(() => {
    const map = mapRepository.getBySlug(input.slug)
    if (!map) throw new SetMapInteractionModeUseCaseError(404, `Map ${input.slug}.json not found`)

    const previousInteractionMode = modeRepository.get(input.slug).interactionMode
    const updatedAt = now()
    const state = modeRepository.set({
      slug: input.slug,
      interactionMode: input.interactionMode,
      updatedAt,
    })
    const realtimeEvents = realtimeEventRepository.appendMany(interactionModeRealtimeAppendInputs({
      slug: state.slug,
      interactionMode: state.interactionMode,
      updatedAt: state.updatedAt,
      clientId: input.clientId,
    }))

    return { state, previousInteractionMode, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    slug: transactionResult.state.slug,
    interactionMode: transactionResult.state.interactionMode,
    previousInteractionMode: transactionResult.previousInteractionMode,
    updatedAt: transactionResult.state.updatedAt,
    syncedMapForLivePlay: false,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
