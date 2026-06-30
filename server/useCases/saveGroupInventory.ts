import type { AuthRole } from '#shared/auth'
import { validateSlug } from '#shared/paths'
import { isRevision } from '#shared/sessionRevisions'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { groupInventoryUpdatedRealtimeAppendInputs } from '../realtime/groupInventoryRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class SaveGroupInventoryUseCaseError extends UseCaseHttpError<400 | 403 | 409> {}

export interface SaveGroupInventoryInput {
  readonly role: AuthRole
  readonly slug: unknown
  readonly expectedRevision?: unknown
  readonly document: unknown
  readonly clientId?: unknown
}

type SaveGroupInventoryRepository = Pick<GroupInventoryRepository, 'replaceSetupInventory'> & {
  readonly database?: RotomDatabase
}

type SaveGroupInventoryRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface SaveGroupInventoryDependencies {
  readonly database?: RotomDatabase
  readonly groupInventoryRepository?: SaveGroupInventoryRepository
  readonly realtimeEventRepository?: SaveGroupInventoryRealtimeEventRepository
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly now?: () => number
}

export interface SaveGroupInventoryResult {
  readonly ok: true
  readonly changed: boolean
  readonly document: GroupInventoryDocument
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const normalizeSaveGroupInventorySlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'group inventory slug')
  } catch {
    throw new SaveGroupInventoryUseCaseError(
      400,
      'group inventory slug must match /^[a-z0-9-]+$/',
    )
  }
}

const expectGroupInventoryDocumentRecord = (document: unknown): Record<string, unknown> => {
  if (!isRecord(document)) throw new SaveGroupInventoryUseCaseError(400, 'document must be an object')
  return document
}

const documentSlug = (document: Record<string, unknown>): string => String(document.slug ?? '')

const databaseFromDependencies = (dependencies: SaveGroupInventoryDependencies): RotomDatabase => {
  const groupInventoryDatabase = dependencies.groupInventoryRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const database = dependencies.database ?? groupInventoryDatabase ?? realtimeDatabase ?? getRotomDatabase()

  if (groupInventoryDatabase && groupInventoryDatabase !== database) {
    throw new Error('Group inventory save repository must use the same RotomDatabase as the save transaction')
  }
  if (realtimeDatabase && realtimeDatabase !== database) {
    throw new Error('Group inventory save realtime event repository must use the same RotomDatabase as the save transaction')
  }

  return database
}

export const saveGroupInventoryUseCase = (
  input: SaveGroupInventoryInput,
  dependencies: SaveGroupInventoryDependencies = {},
): SaveGroupInventoryResult => {
  if (input.role !== 'gm') {
    throw new SaveGroupInventoryUseCaseError(403, 'Only GMs can save group inventory')
  }

  const slug = normalizeSaveGroupInventorySlug(input.slug)
  if (!isRevision(input.expectedRevision)) {
    throw new SaveGroupInventoryUseCaseError(400, 'expectedRevision must be a safe non-negative integer')
  }
  const expectedRevision = input.expectedRevision

  const document = expectGroupInventoryDocumentRecord(input.document)
  const payloadSlug = documentSlug(document)
  if (payloadSlug !== slug) {
    throw new SaveGroupInventoryUseCaseError(
      400,
      `document.slug "${payloadSlug}" must match request slug "${slug}"`,
    )
  }

  const database = databaseFromDependencies(dependencies)
  const groupInventoryRepository = dependencies.groupInventoryRepository
    ?? createSqliteGroupInventoryRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const transactionResult = database.withTransaction(() => {
    const result = groupInventoryRepository.replaceSetupInventory({
      slug,
      expectedRevision,
      document,
      now: now(),
    })

    if (result.stale) {
      const currentRevision = result.current?.revision
      const revisionDetail = currentRevision === undefined
        ? 'no authoritative document exists at that revision'
        : `current revision is ${currentRevision}`
      throw new SaveGroupInventoryUseCaseError(
        409,
        `Group inventory ${slug} has changed (${revisionDetail}); reload before saving.`,
      )
    }

    const realtimeEvents = result.changed
      ? realtimeEventRepository.appendMany(groupInventoryUpdatedRealtimeAppendInputs(result.document, input.clientId, 'save'))
      : []

    return {
      result,
      realtimeEvents,
    }
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    operation: 'group-inventory-save',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    changed: transactionResult.result.changed,
    document: transactionResult.result.document,
  }
}
