import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ShopTableDocument } from '~/types/shop'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

const createRoute = (await import('../../server/api/shops/create.post')).default
const saveRoute = (await import('../../server/api/shops/save.post')).default
const deleteRoute = (await import('../../server/api/shops/delete.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>
type TestRole = 'gm' | 'player'

interface ShopMutationResponse {
  readonly ok: true
  readonly changed?: boolean
  readonly shop: ShopTableDocument
}

const originalDatabasePath = process.env[ROTOM_DB_PATH_ENV]
const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES
let tempDirectory: string | null = null

const restoreEnvValue = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const useFreshTestDatabase = (): void => {
  closeRotomDatabase()
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-shop-mutations-'))
  process.env[ROTOM_DB_PATH_ENV] = join(tempDirectory, 'rotom-table.sqlite')
}

const cleanupTestDatabase = (): void => {
  closeRotomDatabase()
  restoreEnvValue(ROTOM_DB_PATH_ENV, originalDatabasePath)
  restoreEnvValue('NODE_ENV', originalNodeEnv)
  restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  tempDirectory = null
}

const shopRepository = () => createSqliteShopTableRepository(getRotomDatabase())

const storedShop = (slug: string): ShopTableDocument | null => shopRepository().get(slug)?.document ?? null

const seedShop = (
  slug: string,
  now: number,
  document: Record<string, unknown>,
): ShopTableDocument => shopRepository().create({ slug, now, document }).document

const invokePostRoute = async (
  handler: RouteHandler,
  path: string,
  options: { readonly role?: TestRole; readonly body?: unknown } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: 'POST',
    path,
    node: {
      req: {
        url: path,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

beforeEach(() => {
  useFreshTestDatabase()
})

afterEach(() => {
  cleanupTestDatabase()
})

describe('shop mutation API routes', () => {
  it('allows GMs to create normalized shops', async () => {
    const response = await invokePostRoute(createRoute, SHOP_API_PATHS.create, {
      role: 'gm',
      body: {
        slug: 'cerulean-mart',
        clientId: 'client-1',
        document: {
          slug: 'spoofed-slug',
          revision: 99,
          updatedAt: 999,
          name: '  Cerulean Mart  ',
          description: '  Waterside supplies.  ',
          playerVisible: 'true',
          open: 1,
          allowedPaymentSources: ['unknown-source', 'groupInventory'],
          allowedDeliveryTargets: ['groupInventory', 'trainer', 'unknown-target'],
          entries: [
            {
              id: ' potion-row ',
              itemName: '  Potion  ',
              section: 'Medicine',
              price: '300.9',
              stock: 'unlimited',
              gmNotes: '  Counter stock.  ',
            },
          ],
        },
      },
    }) as ShopMutationResponse

    expect(response.ok).toBe(true)
    expect(response.shop).toMatchObject({
      slug: 'cerulean-mart',
      revision: 0,
      name: 'Cerulean Mart',
      description: 'Waterside supplies.',
      playerVisible: true,
      open: true,
      allowedPaymentSources: ['groupInventory'],
      allowedDeliveryTargets: ['groupInventory', 'trainer'],
      entries: [
        {
          id: 'potion-row',
          itemName: 'Potion',
          section: 'medicalKit',
          price: 300,
          stock: null,
          gmNotes: 'Counter stock.',
        },
      ],
    })
    expect(response.shop.updatedAt).toEqual(expect.any(Number))
    expect(storedShop('cerulean-mart')).toEqual(response.shop)
  })

  it('returns a conflict when a GM creates a duplicate shop slug', async () => {
    seedShop('duplicate-shop', 100, { name: 'Duplicate Shop' })

    await expect(invokePostRoute(createRoute, SHOP_API_PATHS.create, {
      role: 'gm',
      body: { slug: 'duplicate-shop', document: { name: 'Duplicate Shop' } },
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Shop table duplicate-shop already exists',
    })
  })

  it('allows GMs to save changed and no-op shop documents with authoritative results', async () => {
    const current = seedShop('pewter-mart', 100, {
      name: 'Pewter Mart',
      entries: [{ id: 'poke-ball', itemName: 'Poké Ball', price: 200, stock: 10 }],
    })

    const changed = await invokePostRoute(saveRoute, SHOP_API_PATHS.save, {
      role: 'gm',
      body: {
        slug: current.slug,
        expectedRevision: current.revision,
        clientId: 'client-1',
        document: {
          ...current,
          name: '  Pewter City Mart  ',
          open: true,
          entries: [
            {
              id: 'poke-ball',
              itemName: '  Poké Ball  ',
              section: 'pokeballs',
              price: '200.9',
              stock: '8',
            },
          ],
        },
      },
    }) as ShopMutationResponse

    expect(changed).toMatchObject({
      ok: true,
      changed: true,
      shop: {
        slug: 'pewter-mart',
        revision: 1,
        name: 'Pewter City Mart',
        open: true,
        entries: [
          {
            id: 'poke-ball',
            itemName: 'Poké Ball',
            section: 'pokeBalls',
            price: 200,
            stock: 8,
          },
        ],
      },
    })
    expect(changed.shop.updatedAt).toEqual(expect.any(Number))
    expect(storedShop('pewter-mart')).toEqual(changed.shop)

    const noOp = await invokePostRoute(saveRoute, SHOP_API_PATHS.save, {
      role: 'gm',
      body: {
        slug: changed.shop.slug,
        expectedRevision: changed.shop.revision,
        document: {
          ...changed.shop,
          revision: 999,
          updatedAt: 999,
        },
      },
    }) as ShopMutationResponse

    expect(noOp).toEqual({
      ok: true,
      changed: false,
      shop: changed.shop,
    })
    expect(storedShop('pewter-mart')).toEqual(changed.shop)
  })

  it('rejects stale GM saves without changing storage', async () => {
    const current = seedShop('saffron-mart', 100, {
      name: 'Saffron Mart',
      entries: [{ id: 'great-ball', itemName: 'Great Ball', price: 600, stock: 3 }],
    })
    const changed = shopRepository().replaceSetupShop({
      slug: current.slug,
      expectedRevision: current.revision,
      now: 200,
      document: { ...current, name: 'Saffron City Mart' },
    })
    if (changed.stale) throw new Error('Expected seed update to apply')

    await expect(invokePostRoute(saveRoute, SHOP_API_PATHS.save, {
      role: 'gm',
      body: {
        slug: current.slug,
        expectedRevision: current.revision,
        document: { ...current, name: 'Stale Mart' },
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Shop saffron-mart has changed (current revision is 1); reload before saving.',
    })

    expect(storedShop('saffron-mart')).toEqual(changed.document)
  })

  it('allows GMs to delete shops and rejects stale delete revisions when supplied', async () => {
    const current = seedShop('fuchsia-mart', 100, { name: 'Fuchsia Mart' })

    await expect(invokePostRoute(deleteRoute, SHOP_API_PATHS.deleteShop, {
      role: 'gm',
      body: {
        slug: current.slug,
        expectedRevision: current.revision + 1,
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Shop fuchsia-mart has changed (current revision is 0); reload before deleting.',
    })
    expect(storedShop('fuchsia-mart')).toEqual(current)

    const response = await invokePostRoute(deleteRoute, SHOP_API_PATHS.deleteShop, {
      role: 'gm',
      body: {
        slug: current.slug,
        expectedRevision: current.revision,
        clientId: 'client-1',
      },
    }) as ShopMutationResponse

    expect(response).toEqual({ ok: true, shop: current })
    expect(storedShop('fuchsia-mart')).toBeNull()
  })

  it('rejects player and guest mutation attempts', async () => {
    const current = seedShop('auth-shop', 100, { name: 'Auth Shop' })
    const mutationAttempts: readonly [RouteHandler, string, unknown][] = [
      [createRoute, SHOP_API_PATHS.create, { slug: 'player-created-shop', document: { name: 'Nope' } }],
      [saveRoute, SHOP_API_PATHS.save, { slug: current.slug, expectedRevision: current.revision, document: current }],
      [deleteRoute, SHOP_API_PATHS.deleteShop, { slug: current.slug }],
    ]

    for (const [handler, path, body] of mutationAttempts) {
      await expect(invokePostRoute(handler, path, { role: 'player', body })).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'GM login required',
      })
      await expect(invokePostRoute(handler, path, { body })).rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'Login required',
      })
    }

    expect(storedShop('auth-shop')).toEqual(current)
    expect(storedShop('player-created-shop')).toBeNull()
  })

  it('requires writable campaign mode before mutating shops', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokePostRoute(createRoute, SHOP_API_PATHS.create, {
      role: 'gm',
      body: { slug: 'blocked-shop', document: { name: 'Blocked Shop' } },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })

    expect(storedShop('blocked-shop')).toBeNull()
  })
})
