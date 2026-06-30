import type { AuthRole } from '#shared/auth'
import { validateSlug } from '#shared/paths'
import { isRevision } from '#shared/sessionRevisions'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import {
  sqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class SaveGroupInventoryUseCaseError extends UseCaseHttpError<400 | 403 | 409> {}

export interface SaveGroupInventoryInput {
  readonly role: AuthRole
  readonly slug: unknown
  readonly expectedRevision?: unknown
  readonly document: unknown
}

export interface SaveGroupInventoryDependencies {
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'replaceSetupInventory'>
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

  const document = expectGroupInventoryDocumentRecord(input.document)
  const payloadSlug = documentSlug(document)
  if (payloadSlug !== slug) {
    throw new SaveGroupInventoryUseCaseError(
      400,
      `document.slug "${payloadSlug}" must match request slug "${slug}"`,
    )
  }

  const groupInventoryRepository = dependencies.groupInventoryRepository ?? sqliteGroupInventoryRepository
  const result = groupInventoryRepository.replaceSetupInventory({
    slug,
    expectedRevision: input.expectedRevision,
    document,
    now: dependencies.now?.(),
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

  return {
    ok: true,
    changed: result.changed,
    document: result.document,
  }
}
