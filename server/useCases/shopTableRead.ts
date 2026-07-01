import type { AuthRole } from '#shared/auth'
import { validateSlug } from '#shared/paths'
import type { ShopTableDocument } from '~/types/shop'
import {
  sqliteShopTableRepository,
  type ShopTableRepository,
  type StoredShopTableDocument,
} from '../storage/shopTableRepository'
import { redactShopForPlayer } from '../utils/shopPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadShopTableUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface ListShopTablesInput {
  readonly role: AuthRole
}

export interface ListShopTablesDependencies {
  readonly shopTableRepository?: Pick<ShopTableRepository, 'list'>
}

export interface ListShopTablesResult {
  readonly shops: ShopTableDocument[]
}

export interface LoadShopTableInput {
  readonly role: AuthRole
  readonly slug?: unknown
}

export interface LoadShopTableDependencies {
  readonly shopTableRepository?: Pick<ShopTableRepository, 'get'>
}

export interface LoadShopTableResult {
  readonly shop: ShopTableDocument
  readonly revision: number
  readonly updatedAt: number
}

export const shopIsPlayerLoadable = (shop: Pick<ShopTableDocument, 'playerVisible' | 'open'>): boolean => (
  shop.playerVisible === true && shop.open === true
)

const storedShopTableToDocument = (stored: StoredShopTableDocument): ShopTableDocument => ({
  ...stored.document,
  slug: stored.slug,
  revision: stored.revision,
  updatedAt: stored.updatedAt,
})

export const normalizeLoadShopTableSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'shop slug')
  } catch {
    throw new LoadShopTableUseCaseError(400, 'shop slug must match /^[a-z0-9-]+$/')
  }
}

export const listShopTablesUseCase = (
  input: ListShopTablesInput,
  dependencies: ListShopTablesDependencies = {},
): ListShopTablesResult => {
  const shopTableRepository = dependencies.shopTableRepository ?? sqliteShopTableRepository
  const shops = shopTableRepository.list().map(storedShopTableToDocument)

  if (input.role === 'gm') return { shops }
  return { shops: shops.filter(shopIsPlayerLoadable).map(redactShopForPlayer) }
}

export const loadShopTableUseCase = (
  input: LoadShopTableInput,
  dependencies: LoadShopTableDependencies = {},
): LoadShopTableResult => {
  const shopTableRepository = dependencies.shopTableRepository ?? sqliteShopTableRepository
  const slug = normalizeLoadShopTableSlug(input.slug)
  const stored = shopTableRepository.get(slug)
  if (!stored) throw new LoadShopTableUseCaseError(404, `Shop ${slug} not found`)

  const shop = storedShopTableToDocument(stored)
  if (input.role === 'player') {
    if (shop.playerVisible !== true) throw new LoadShopTableUseCaseError(403, 'Shop is not player visible')
    if (shop.open !== true) throw new LoadShopTableUseCaseError(403, 'Shop is closed')
  }

  const responseShop = input.role === 'player' ? redactShopForPlayer(shop) : shop

  return {
    shop: responseShop,
    revision: responseShop.revision,
    updatedAt: responseShop.updatedAt,
  }
}
