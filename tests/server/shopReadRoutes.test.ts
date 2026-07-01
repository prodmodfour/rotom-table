import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ShopTableDocument } from '~/types/shop'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'

const listRoute = (await import('../../server/api/shops/list.get')).default
const loadRoute = (await import('../../server/api/shops/load.get')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>
type TestRole = 'gm' | 'player'

interface ShopListResponse {
  readonly shops: readonly ShopTableDocument[]
}

interface ShopLoadResponse {
  readonly shop: ShopTableDocument
  readonly revision: number
  readonly updatedAt: number
}

const originalDatabasePath = process.env[ROTOM_DB_PATH_ENV]
let tempDirectory: string | null = null

const restoreEnvValue = (value: string | undefined): void => {
  if (value === undefined) delete process.env[ROTOM_DB_PATH_ENV]
  else process.env[ROTOM_DB_PATH_ENV] = value
}

const useFreshTestDatabase = (): void => {
  closeRotomDatabase()
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-shop-routes-'))
  process.env[ROTOM_DB_PATH_ENV] = join(tempDirectory, 'rotom-table.sqlite')
}

const cleanupTestDatabase = (): void => {
  closeRotomDatabase()
  restoreEnvValue(originalDatabasePath)
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  tempDirectory = null
}

const invokeGetRoute = async (
  handler: RouteHandler,
  path: string,
  options: { readonly role?: TestRole; readonly query?: Record<string, unknown> } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`

  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString()
  const url = `${path}${query ? `?${query}` : ''}`

  return handler({
    method: 'GET',
    path: url,
    node: {
      req: {
        url,
        headers,
      },
    },
    context: {},
  } as unknown as H3Event)
}

const seedShops = (): void => {
  const repository = createSqliteShopTableRepository(getRotomDatabase())
  repository.create({
    slug: 'open-shop',
    now: 100,
    document: {
      name: 'Open Shop',
      playerVisible: true,
      open: true,
      entries: [{ id: 'potion', itemName: 'Potion', price: 300, stock: 5, gmNotes: 'Wholesale margin' }],
      gmNotes: 'Private shop note',
      purchaseLog: [
        {
          opId: 'op_shopcheckout_secret',
          purchasedAt: 1_700_000_000_000,
          actor: { role: 'player', profileId: 'profile_secret', profileName: 'Secret Buyer' },
          paymentSource: { kind: 'trainer', slug: 'ash' },
          deliveryTarget: { kind: 'trainer', slug: 'ash' },
          lines: [{ entryId: 'potion', itemName: 'Potion', section: 'medicalKit', quantity: 1, unitPrice: 300, lineTotal: 300 }],
          total: 300,
        },
      ],
    },
  })
  repository.create({
    slug: 'hidden-shop',
    now: 200,
    document: {
      name: 'Hidden Shop',
      playerVisible: false,
      open: true,
      entries: [{ id: 'secret-key', itemName: 'Secret Key', price: 1000, stock: null }],
    },
  })
  repository.create({
    slug: 'closed-shop',
    now: 300,
    document: {
      name: 'Closed Shop',
      playerVisible: true,
      open: false,
      entries: [{ id: 'old-rod', itemName: 'Old Rod', price: 500, stock: 1 }],
    },
  })
}

beforeEach(() => {
  useFreshTestDatabase()
})

afterEach(() => {
  cleanupTestDatabase()
})

describe('shop read API routes', () => {
  it('lists and loads all shops for GMs with authoritative revisions and timestamps', async () => {
    seedShops()

    const listResponse = await invokeGetRoute(listRoute, SHOP_API_PATHS.list, { role: 'gm' }) as ShopListResponse
    expect(listResponse.shops.map((shop) => shop.slug)).toEqual([
      'closed-shop',
      'hidden-shop',
      'open-shop',
    ])
    expect(listResponse.shops.find((shop) => shop.slug === 'open-shop')).toMatchObject({
      slug: 'open-shop',
      revision: 0,
      updatedAt: 100,
      name: 'Open Shop',
      gmNotes: 'Private shop note',
      purchaseLog: [expect.objectContaining({ opId: 'op_shopcheckout_secret' })],
    })
    expect(listResponse.shops.find((shop) => shop.slug === 'closed-shop')).toMatchObject({
      slug: 'closed-shop',
      revision: 0,
      updatedAt: 300,
      open: false,
    })

    const loadResponse = await invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      role: 'gm',
      query: { slug: 'hidden-shop' },
    }) as ShopLoadResponse
    expect(loadResponse).toMatchObject({
      revision: 0,
      updatedAt: 200,
      shop: {
        slug: 'hidden-shop',
        revision: 0,
        updatedAt: 200,
        name: 'Hidden Shop',
        playerVisible: false,
        open: true,
      },
    })
  })

  it('filters player lists and loads only open player-visible shops', async () => {
    seedShops()

    const listResponse = await invokeGetRoute(listRoute, SHOP_API_PATHS.list, { role: 'player' }) as ShopListResponse
    expect(listResponse.shops.map((shop) => shop.slug)).toEqual(['open-shop'])
    expect(listResponse.shops[0]).toMatchObject({
      revision: 0,
      updatedAt: 100,
      playerVisible: true,
      open: true,
    })
    expect(listResponse.shops[0]).not.toHaveProperty('gmNotes')
    expect(listResponse.shops[0]).not.toHaveProperty('purchaseLog')
    expect(listResponse.shops[0]!.entries[0]).not.toHaveProperty('gmNotes')

    const loadResponse = await invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      role: 'player',
      query: { slug: 'open-shop' },
    }) as ShopLoadResponse
    expect(loadResponse.shop.slug).toBe('open-shop')
    expect(loadResponse.shop).not.toHaveProperty('gmNotes')
    expect(loadResponse.shop).not.toHaveProperty('purchaseLog')
    expect(loadResponse.shop.entries[0]!).not.toHaveProperty('gmNotes')
    expect(loadResponse.revision).toBe(0)
    expect(loadResponse.updatedAt).toBe(100)
  })

  it('rejects player loads for hidden shops', async () => {
    seedShops()

    await expect(invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      role: 'player',
      query: { slug: 'hidden-shop' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Shop is not player visible',
    })
  })

  it('rejects player loads for closed shops', async () => {
    seedShops()

    await expect(invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      role: 'player',
      query: { slug: 'closed-shop' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Shop is closed',
    })
  })

  it('returns not found for missing shops', async () => {
    seedShops()

    await expect(invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      role: 'gm',
      query: { slug: 'missing-shop' },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Shop missing-shop not found',
    })
  })

  it('rejects invalid shop slugs', async () => {
    seedShops()

    await expect(invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      role: 'gm',
      query: { slug: '../bad' },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'shop slug must match /^[a-z0-9-]+$/',
    })
  })

  it('requires an authenticated role for guest requests', async () => {
    seedShops()

    await expect(invokeGetRoute(listRoute, SHOP_API_PATHS.list)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
    await expect(invokeGetRoute(loadRoute, SHOP_API_PATHS.load, {
      query: { slug: 'open-shop' },
    })).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
  })
})
