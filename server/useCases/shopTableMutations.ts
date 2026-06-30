import type { AuthRole } from '#shared/auth'
import { validateSlug } from '#shared/paths'
import { isRevision } from '#shared/sessionRevisions'
import type { ShopTableDocument } from '~/types/shop'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteShopTableRepository,
  type CreateShopTableInput,
  type ShopTableRepository,
} from '../storage/shopTableRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ShopTableMutationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface CreateShopTableUseCaseInput {
  readonly role: AuthRole
  readonly slug?: unknown
  readonly baseSlug?: unknown
  readonly name?: unknown
  readonly document?: unknown
  readonly clientId?: unknown
}

export interface SaveShopTableUseCaseInput {
  readonly role: AuthRole
  readonly slug: unknown
  readonly expectedRevision?: unknown
  readonly document: unknown
  readonly clientId?: unknown
}

export interface DeleteShopTableUseCaseInput {
  readonly role: AuthRole
  readonly slug: unknown
  readonly expectedRevision?: unknown
  readonly clientId?: unknown
}

type CreateShopTableRepository = Pick<ShopTableRepository, 'create'> & {
  readonly database?: RotomDatabase
}

type SaveShopTableRepository = Pick<ShopTableRepository, 'replaceSetupShop' | 'get'> & {
  readonly database?: RotomDatabase
}

type DeleteShopTableRepository = Pick<ShopTableRepository, 'deleteDocument' | 'get'> & {
  readonly database?: RotomDatabase
}

export interface ShopTableMutationDependencies {
  readonly database?: RotomDatabase
  readonly shopTableRepository?: CreateShopTableRepository & SaveShopTableRepository & DeleteShopTableRepository
  readonly now?: () => number
}

export interface CreateShopTableUseCaseResult {
  readonly ok: true
  readonly shop: ShopTableDocument
}

export interface SaveShopTableUseCaseResult {
  readonly ok: true
  readonly changed: boolean
  readonly shop: ShopTableDocument
}

export interface DeleteShopTableUseCaseResult {
  readonly ok: true
  readonly shop: ShopTableDocument
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const stringOrUndefined = (value: unknown): string | undefined => (
  typeof value === 'string' ? value : undefined
)

const requireGmRole = (role: AuthRole): void => {
  if (role !== 'gm') throw new ShopTableMutationUseCaseError(403, 'Only GMs can manage shops')
}

const normalizeShopSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'shop slug')
  } catch {
    throw new ShopTableMutationUseCaseError(400, 'shop slug must match /^[a-z0-9-]+$/')
  }
}

const normalizeOptionalShopSlug = (value: unknown): string | undefined => (
  value === undefined ? undefined : normalizeShopSlug(value)
)

const normalizeExpectedRevision = (value: unknown): number => {
  if (!isRevision(value)) {
    throw new ShopTableMutationUseCaseError(400, 'expectedRevision must be a safe non-negative integer')
  }
  return value
}

const normalizeOptionalExpectedRevision = (value: unknown): number | undefined => (
  value === undefined ? undefined : normalizeExpectedRevision(value)
)

const expectShopDocumentRecord = (document: unknown): Record<string, unknown> => {
  if (!isRecord(document)) throw new ShopTableMutationUseCaseError(400, 'document must be an object')
  return document
}

const optionalDocumentSlug = (document: Record<string, unknown>): string | undefined => {
  if (document.slug === undefined || document.slug === null) return undefined
  const slug = String(document.slug).trim()
  return slug || undefined
}

const databaseFromDependencies = (dependencies: ShopTableMutationDependencies): RotomDatabase => {
  const repositoryDatabase = dependencies.shopTableRepository?.database
  const database = dependencies.database ?? repositoryDatabase ?? getRotomDatabase()

  if (repositoryDatabase && repositoryDatabase !== database) {
    throw new Error('Shop table mutation repository must use the same RotomDatabase as the mutation transaction')
  }

  return database
}

const repositoryFromDependencies = (
  dependencies: ShopTableMutationDependencies,
  database: RotomDatabase,
): CreateShopTableRepository & SaveShopTableRepository & DeleteShopTableRepository => (
  dependencies.shopTableRepository ?? createSqliteShopTableRepository(database)
)

const mapCreateError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Failed to create shop table'
  if (message.includes('already exists')) throw new ShopTableMutationUseCaseError(409, message)
  if (message.includes('must match')) throw new ShopTableMutationUseCaseError(400, message)
  throw error
}

const createShopTableInput = (
  input: CreateShopTableUseCaseInput,
  now: number,
): CreateShopTableInput => {
  const slug = normalizeOptionalShopSlug(input.slug)
  const baseSlug = stringOrUndefined(input.baseSlug)
  const name = stringOrUndefined(input.name)

  return {
    document: input.document,
    now,
    ...(slug !== undefined ? { slug } : {}),
    ...(baseSlug !== undefined ? { baseSlug } : {}),
    ...(name !== undefined ? { name } : {}),
  }
}

export const createShopTableUseCase = (
  input: CreateShopTableUseCaseInput,
  dependencies: ShopTableMutationDependencies = {},
): CreateShopTableUseCaseResult => {
  requireGmRole(input.role)

  const database = databaseFromDependencies(dependencies)
  const shopTableRepository = repositoryFromDependencies(dependencies, database)
  const now = dependencies.now ?? Date.now

  const created = database.withTransaction(() => {
    try {
      return shopTableRepository.create(createShopTableInput(input, now()))
    } catch (error) {
      return mapCreateError(error)
    }
  })

  return {
    ok: true,
    shop: created.document,
  }
}

export const saveShopTableUseCase = (
  input: SaveShopTableUseCaseInput,
  dependencies: ShopTableMutationDependencies = {},
): SaveShopTableUseCaseResult => {
  requireGmRole(input.role)

  const slug = normalizeShopSlug(input.slug)
  const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
  const document = expectShopDocumentRecord(input.document)
  const payloadSlug = optionalDocumentSlug(document)
  if (payloadSlug !== undefined && payloadSlug !== slug) {
    throw new ShopTableMutationUseCaseError(
      400,
      `document.slug "${payloadSlug}" must match request slug "${slug}"`,
    )
  }

  const database = databaseFromDependencies(dependencies)
  const shopTableRepository = repositoryFromDependencies(dependencies, database)
  const now = dependencies.now ?? Date.now

  const result = database.withTransaction(() => shopTableRepository.replaceSetupShop({
    slug,
    expectedRevision,
    document,
    now: now(),
  }))

  if (result.stale) {
    if (!result.current) throw new ShopTableMutationUseCaseError(404, `Shop ${slug} not found`)
    throw new ShopTableMutationUseCaseError(
      409,
      `Shop ${slug} has changed (current revision is ${result.current.revision}); reload before saving.`,
    )
  }

  return {
    ok: true,
    changed: result.changed,
    shop: result.document,
  }
}

export const deleteShopTableUseCase = (
  input: DeleteShopTableUseCaseInput,
  dependencies: ShopTableMutationDependencies = {},
): DeleteShopTableUseCaseResult => {
  requireGmRole(input.role)

  const slug = normalizeShopSlug(input.slug)
  const expectedRevision = normalizeOptionalExpectedRevision(input.expectedRevision)
  const database = databaseFromDependencies(dependencies)
  const shopTableRepository = repositoryFromDependencies(dependencies, database)

  const deleted = database.withTransaction(() => {
    const current = shopTableRepository.get(slug)
    if (!current) throw new ShopTableMutationUseCaseError(404, `Shop ${slug} not found`)
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new ShopTableMutationUseCaseError(
        409,
        `Shop ${slug} has changed (current revision is ${current.revision}); reload before deleting.`,
      )
    }

    const result = shopTableRepository.deleteDocument(slug)
    if (!result) throw new ShopTableMutationUseCaseError(404, `Shop ${slug} not found`)
    return result.document
  })

  return {
    ok: true,
    shop: deleted,
  }
}
