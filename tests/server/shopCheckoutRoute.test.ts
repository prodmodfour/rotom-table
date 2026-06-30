import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import { PLAYER_PROFILE_SCHEMA_VERSION, type PlayerProfile } from '#shared/playerProfiles'
import { GROUP_INVENTORY_SECTION_KEYS } from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteSheetRepository, type PersistedSheet } from '~~/server/storage/sheetRepository'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'

const mocks = vi.hoisted(() => ({
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return {
    ...actual,
    resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
  }
})

const checkoutRoute = (await import('../../server/api/shops/checkout.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>
type TestRole = 'gm' | 'player'

type CheckoutRouteAcceptedResponse = ShopCheckoutCommandAccepted & {
  readonly shop?: ShopTableDocument
  readonly trainerSheets?: readonly TrainerSheet[]
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
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-shop-checkout-route-'))
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

const emptyInventory = (): TrainerInventory => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as TrainerInventory

const shopEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'potion-row',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 200,
  stock: 5,
  ...overrides,
})

const shopDocument = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 0,
  updatedAt: 100,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [shopEntry()],
  ...overrides,
})

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  money: 1_000,
  inventory: emptyInventory(),
  ...overrides,
})

const seedShop = (
  document: ShopTableDocument = shopDocument(),
): ShopTableDocument => createSqliteShopTableRepository(getRotomDatabase()).create({
  slug: document.slug,
  now: document.updatedAt,
  document,
}).document

const seedTrainer = (
  document: TrainerSheet = trainerSheet(),
  revision = document.revision ?? 0,
  updatedAt = 200,
): PersistedSheet => {
  const repository = createSqliteSheetRepository<Record<string, unknown>>(getRotomDatabase())
  repository.save({
    kind: 'trainer',
    slug: document.slug,
    revision,
    updatedAt,
    document: {
      ...document,
      revision,
      updatedAt,
    },
  })
  const persisted = repository.getByRef('trainer', document.slug)
  if (!persisted) throw new Error(`Trainer ${document.slug} was not persisted`)
  return persisted
}

const storedShop = (slug = 'viridian-mart'): ShopTableDocument => {
  const stored = createSqliteShopTableRepository(getRotomDatabase()).get(slug)
  if (!stored) throw new Error(`Shop ${slug} was not persisted`)
  return stored.document
}

const storedTrainer = (slug = 'ash'): TrainerSheet => {
  const stored = createSqliteSheetRepository<Record<string, unknown>>(getRotomDatabase()).getByRef('trainer', slug)
  if (!stored) throw new Error(`Trainer ${slug} was not persisted`)
  return stored.sheet as unknown as TrainerSheet
}

const trainerCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> & Record<string, unknown> = {},
): ShopCheckoutLivePlayCommand & Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopcheckout_route_gm',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 0,
    paymentSource: { kind: 'trainer', slug: 'ash', revision: 0 },
    deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 0 },
    lines: [{ entryId: 'potion-row', quantity: 2 }],
    origin: { kind: 'shopPage' },
  },
  ...overrides,
})

const playerProfile = (linkedTrainerSlugs: readonly string[] = ['ash']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfile['id'],
  displayName: 'Ash' as PlayerProfile['displayName'],
  linkedCharacters: linkedTrainerSlugs.map((slug) => ({ sheetKind: 'trainer', sheetSlug: slug })),
})

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
  vi.clearAllMocks()
  useFreshTestDatabase()
})

afterEach(() => {
  cleanupTestDatabase()
})

describe('shop checkout API route', () => {
  it('rejects plain non-command checkout payloads', async () => {
    await expect(invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: {
        shopSlug: 'viridian-mart',
        shopRevision: 0,
        lines: [{ entryId: 'potion-row', quantity: 1 }],
      },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'request body must be a SHOP_CHECKOUT live-play command envelope',
    })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
  })

  it('allows GMs to checkout through the live-play command route', async () => {
    seedShop()
    seedTrainer()
    const command = {
      ...trainerCommand({ opId: 'op_shopcheckout_route_gm' }),
      clientId: 'gm-client',
    }

    const response = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: command,
    }) as CheckoutRouteAcceptedResponse

    expect(response).toMatchObject({
      ok: true,
      opId: 'op_shopcheckout_route_gm',
      shopSlug: 'viridian-mart',
      previousShopRevision: 0,
      shopRevision: 1,
      totalPrice: 400,
      documents: {
        shop: { slug: 'viridian-mart', revision: 1 },
        trainerSheets: [{ slug: 'ash', revision: 1, money: 600 }],
      },
      shop: { slug: 'viridian-mart', revision: 1 },
      trainerSheets: [{ slug: 'ash', revision: 1, money: 600 }],
    })
    expect(response.lines).toEqual([
      {
        entryId: 'potion-row',
        itemName: 'Potion',
        section: 'medicalKit',
        quantity: 2,
        unitPrice: 200,
        lineTotal: 400,
        stock: 3,
      },
    ])
    expect(storedShop().entries[0]?.stock).toBe(3)
    expect(storedTrainer().money).toBe(600)
    expect(storedTrainer().inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
  })

  it('allows authorized players to checkout through the live-play command route', async () => {
    seedShop()
    seedTrainer()
    mocks.resolvePlayerProfileForPolicy.mockReturnValueOnce(playerProfile(['ash']))
    const command = {
      ...trainerCommand({ opId: 'op_shopcheckout_route_player' }),
      clientId: 'player-client',
      profileId: 'profile_ash00000',
    }

    const response = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'player',
      body: command,
    }) as CheckoutRouteAcceptedResponse

    expect(response).toMatchObject({
      ok: true,
      opId: 'op_shopcheckout_route_player',
      shopSlug: 'viridian-mart',
      shopRevision: 1,
      shop: { revision: 1, entries: [{ stock: 3 }] },
      trainerSheets: [{ slug: 'ash', revision: 1, money: 600 }],
    })
    expect(storedTrainer().inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
  })

  it('matches use-case idempotency for duplicate operation retries', async () => {
    seedShop()
    seedTrainer()
    const command = trainerCommand({ opId: 'op_shopcheckout_route_dupe' })

    const first = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: command,
    })
    const duplicate = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: command,
    })

    expect(duplicate).toEqual(first)
    expect(storedShop().entries[0]?.stock).toBe(3)
    expect(storedTrainer().money).toBe(600)
    expect(storedTrainer().inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
  })

  it('returns terminal invalid, conflict, and not-found checkout results', async () => {
    const invalid = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: {
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        opId: 'op_shopcheckout_route_invalid',
        type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
        scopes: [],
        payload: {},
      },
    })
    expect(invalid).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_route_invalid',
      reason: 'invalid',
    })

    const notFound = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: trainerCommand({ opId: 'op_shopcheckout_route_missing' }),
    })
    expect(notFound).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_route_missing',
      shopSlug: 'viridian-mart',
      reason: 'not-found',
    })

    seedShop()
    seedTrainer(trainerSheet({ money: 100 }))
    const conflict = await invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: trainerCommand({ opId: 'op_shopcheckout_route_conflict' }),
    })
    expect(conflict).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_route_conflict',
      shopSlug: 'viridian-mart',
      reason: 'conflict',
      message: expect.stringContaining('money'),
    })
    expect(storedShop().entries[0]?.stock).toBe(5)
    expect(storedTrainer().money).toBe(100)
  })

  it('maps route-level forbidden and not-found HTTP errors cleanly', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'gm',
      body: trainerCommand({ opId: 'op_shopcheckout_route_hosted' }),
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })

    process.env.NODE_ENV = originalNodeEnv
    process.env.ROTOM_ENABLE_HOSTED_WRITES = '1'
    mocks.resolvePlayerProfileForPolicy.mockImplementationOnce(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing not found')
    })

    await expect(invokePostRoute(checkoutRoute, SHOP_API_PATHS.checkout, {
      role: 'player',
      body: {
        ...trainerCommand({ opId: 'op_shopcheckout_route_missing_profile' }),
        profileId: 'profile_missing',
      },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing not found',
    })
  })
})
