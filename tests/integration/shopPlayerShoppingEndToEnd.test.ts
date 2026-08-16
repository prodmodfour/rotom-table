import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import {
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutCommandResult,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_REALTIME_EVENT_TYPES,
  shopChannel,
  type RealtimeEvent,
} from '#shared/realtime'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { AuthRole } from '#shared/auth'
import { useShopfrontPage } from '~/composables/shops/useShopfrontPage'
import { useShopfrontCheckout } from '~/composables/shops/useShopfrontCheckout'
import {
  GROUP_INVENTORY_API_PATHS,
  SHEET_API_PATHS,
  SHOP_API_PATHS,
} from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import { createLivePlayCommandOutbox } from '~/utils/livePlayCommandOutbox'
import { buildShopCheckoutCommand } from '~/utils/shopCheckoutCommandBuilder'
import { GROUP_INVENTORY_SECTION_KEYS } from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteSheetRepository, type SheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteShopTableRepository, type ShopTableRepository } from '~~/server/storage/shopTableRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { playerSheetAccessContextFromKeys } from '~~/server/useCases/authorizeSheetList'
import { listSheetsUseCase } from '~~/server/useCases/listSheets'
import { loadShopTableUseCase } from '~~/server/useCases/shopTableRead'
import { createShopTableUseCase, saveShopTableUseCase } from '~~/server/useCases/shopTableMutations'
import { executeShopCheckoutCommandUseCase } from '~~/server/useCases/executeShopCheckoutCommand'

interface ShoppingHarness {
  readonly database: RotomDatabase
  readonly shops: ShopTableRepository
  readonly sheets: SheetRepository<Record<string, unknown>>
  readonly realtime: RealtimeEventRepository
  readonly bus: InMemoryRealtimeBus
  readonly playerProfile: PlayerProfile
  readonly openedShop: ShopTableDocument
}

type GetJson = (request: string, options?: Parameters<ApiClient['getJson']>[1]) => Promise<unknown>
type PostJson = (request: string, body: unknown) => Promise<unknown>

type GetJsonMock = ReturnType<typeof vi.fn<GetJson>>
type PostJsonMock = ReturnType<typeof vi.fn<PostJson>>

interface PlayerApiHarness {
  readonly apiClient: Pick<ApiClient, 'getJson' | 'postJson'>
  readonly getJson: GetJsonMock
  readonly postJson: PostJsonMock
}

interface Deferred<TValue> {
  readonly promise: Promise<TValue>
  readonly resolve: (value: TValue | PromiseLike<TValue>) => void
  readonly reject: (reason?: unknown) => void
}

const openDatabases: RotomDatabase[] = []
let outboxSequence = 0
let realtimeClock = 10_000

class InMemoryRealtimeBus {
  readonly deliveredEvents: RealtimeEvent[] = []
  private readonly handlersByChannel = new Map<string, Set<(event: RealtimeEvent) => void>>()

  readonly subscribe = (channel: string, handler: (event: RealtimeEvent) => void): (() => void) => {
    const handlers = this.handlersByChannel.get(channel) ?? new Set<(event: RealtimeEvent) => void>()
    handlers.add(handler)
    this.handlersByChannel.set(channel, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.handlersByChannel.delete(channel)
    }
  }

  readonly publishPersisted = (event: PersistedRealtimeEvent): void => {
    this.deliveredEvents.push(event.event)
    const handlers = this.handlersByChannel.get(event.event.channel)
    if (!handlers) return
    for (const handler of [...handlers]) handler(event.event)
  }
}

const deferred = <TValue = void>(): Deferred<TValue> => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const createTestOutbox = () => {
  outboxSequence += 1
  return createLivePlayCommandOutbox({
    databaseName: `shop-player-e2e-${outboxSequence}`,
    indexedDBFactory: new FakeIDBFactory() as unknown as IDBFactory,
  })
}

const playerProfile = (trainerSlug = 'ash'): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_shopAsh01' as PlayerProfileId,
  displayName: 'Ash Player' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }],
})

const emptyInventory = (): TrainerInventory => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as TrainerInventory

const potionEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'potion-row',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 300,
  stock: 2,
  maxPerPurchase: 2,
  playerDescription: 'Restores HP.',
  ...overrides,
})

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 5,
  player: false,
  revision: 0,
  money: 1_000,
  inventory: emptyInventory(),
  ...overrides,
})

const persistedTrainer = (
  harness: ShoppingHarness,
  slug: string,
): TrainerSheet => {
  const stored = harness.sheets.getByRef('trainer', slug)
  if (!stored) throw new Error(`Expected trainer ${slug} to be stored`)
  return stored.sheet as unknown as TrainerSheet
}

const persistedShop = (harness: ShoppingHarness): ShopTableDocument => {
  const stored = harness.shops.get('viridian-mart')
  if (!stored) throw new Error('Expected viridian-mart to be stored')
  return stored.document
}

const saveTrainer = (
  harness: Pick<ShoppingHarness, 'sheets'>,
  document: TrainerSheet,
  updatedAt = 2_000,
): TrainerSheet => {
  const revision = document.revision ?? 0
  harness.sheets.save({
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
  const stored = harness.sheets.getByRef('trainer', document.slug)
  if (!stored) throw new Error(`Expected trainer ${document.slug} to be stored after save`)
  return stored.sheet as unknown as TrainerSheet
}

const seedOpenedShop = (
  database: RotomDatabase,
  shops: ShopTableRepository,
): ShopTableDocument => {
  const created = createShopTableUseCase({
    role: 'gm',
    slug: 'viridian-mart',
    document: {
      name: 'Viridian Mart',
      description: 'Supplies for careful trainers.',
      playerVisible: false,
      open: false,
      allowedPaymentSources: ['trainer'],
      allowedDeliveryTargets: ['trainer'],
      entries: [potionEntry()],
      gmNotes: 'Only visible to GMs.',
    },
  }, {
    database,
    shopTableRepository: shops,
    now: () => 1_000,
  })

  const opened = saveShopTableUseCase({
    role: 'gm',
    slug: created.shop.slug,
    expectedRevision: created.shop.revision,
    document: {
      ...created.shop,
      playerVisible: true,
      open: true,
    },
  }, {
    database,
    shopTableRepository: shops,
    now: () => 1_500,
  })

  return opened.shop
}

const createShoppingHarness = (): ShoppingHarness => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  const shops = createSqliteShopTableRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtime = createSqliteRealtimeEventRepository({
    database,
    clock: () => {
      realtimeClock += 1
      return realtimeClock
    },
  })
  const bus = new InMemoryRealtimeBus()
  const profile = playerProfile()
  const harnessBase = { database, shops, sheets, realtime, bus }
  const openedShop = seedOpenedShop(database, shops)
  const harness = { ...harnessBase, playerProfile: profile, openedShop }

  saveTrainer(harness, trainerSheet({ slug: 'ash', name: 'Ash' }))
  saveTrainer(harness, trainerSheet({ slug: 'gary', name: 'Gary' }))

  return harness
}

const checkoutOperationCount = (harness: ShoppingHarness): number => {
  const row = harness.database.connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get() as { readonly count?: unknown }
  return typeof row.count === 'number' ? row.count : 0
}

const persistedRealtimeEvents = (harness: ShoppingHarness): readonly PersistedRealtimeEvent[] => (
  harness.realtime.readAfter({ afterSequence: 0, limit: 100 }).events
)

const createPlayerApiHarness = (
  harness: ShoppingHarness,
  options: {
    readonly beforeCheckoutResponse?: (body: unknown, response: ShopCheckoutCommandResult) => Promise<void>
    readonly now?: () => number
  } = {},
): PlayerApiHarness => {
  const playerAccessContext = playerSheetAccessContextFromKeys({
    sessionAccessKeys: null,
    mapSheetAccessKeys: null,
  })

  const getJson = vi.fn<GetJson>(async (request, requestOptions) => {
    if (request === SHOP_API_PATHS.load) {
      return loadShopTableUseCase({
        role: 'player',
        slug: requestOptions?.params?.slug,
      }, {
        shopTableRepository: harness.shops,
      })
    }

    if (request === SHEET_API_PATHS.list) {
      expect(requestOptions?.params).toEqual({ profileId: harness.playerProfile.id })
      return listSheetsUseCase({
        role: 'player',
        playerProfile: harness.playerProfile,
        ...playerAccessContext,
      }, {
        sheetRepository: harness.sheets,
      })
    }

    if (request === GROUP_INVENTORY_API_PATHS.load) {
      throw new Error('Trainer-only player shopping harness should not load group inventory')
    }

    throw new Error(`Unexpected player GET ${request}`)
  })

  const postJson = vi.fn<PostJson>(async (request, body) => {
    if (request !== SHOP_API_PATHS.checkout) throw new Error(`Unexpected player POST ${request}`)
    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      command: body,
      clientId: typeof body === 'object' && body !== null && 'clientId' in body
        ? String((body as { readonly clientId?: unknown }).clientId ?? '')
        : undefined,
      playerProfile: harness.playerProfile,
    }, {
      database: harness.database,
      shopTableRepository: harness.shops,
      sheetRepository: harness.sheets,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: harness.bus.publishPersisted,
      now: options.now ?? (() => 5_000),
    })
    await options.beforeCheckoutResponse?.(body, response.result)
    return response.result
  })

  return {
    apiClient: {
      getJson: getJson as unknown as ApiClient['getJson'],
      postJson: postJson as unknown as ApiClient['postJson'],
    },
    getJson,
    postJson,
  }
}

const createPlayerShopfront = (
  harness: ShoppingHarness,
  apiClient: Pick<ApiClient, 'getJson'>,
  options: {
    readonly clientId?: string
    readonly subscribeRealtime?: boolean
  } = {},
) => useShopfrontPage({
  slug: ref('viridian-mart'),
  apiClient,
  clientId: options.clientId ?? 'client-player-shopfront',
  ...(options.subscribeRealtime === true ? { subscribeRealtimeChannel: harness.bus.subscribe } : { realtimeEnabled: false }),
  autoLoadOnMounted: false,
})

const createPlayerCheckout = (
  shop: Ref<ShopTableDocument | null>,
  apiClient: Pick<ApiClient, 'getJson' | 'postJson'>,
  profileId: PlayerProfileId,
  randomUuid: string,
) => useShopfrontCheckout({
  shop,
  authRole: ref<AuthRole>('player'),
  isGm: ref(false),
  isPlayer: ref(true),
  selectedProfileId: ref(profileId),
  apiClient,
  outbox: createTestOutbox(),
  leaseOwner: `shop-player-e2e-${randomUuid}`,
  clientId: () => 'client-player-checkout',
  randomUuid: () => randomUuid,
  realtimeEnabled: false,
  autoLoadOnMounted: false,
})

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  vi.restoreAllMocks()
})

describe('player shopping end-to-end harness', () => {
  it('buys from the player shopfront with trainer money, persists stock and inventory, and reaches another client by realtime', async () => {
    const harness = createShoppingHarness()
    const httpRelease = deferred<void>()
    const checkoutStarted = deferred<unknown>()
    const playerApi = createPlayerApiHarness(harness, {
      beforeCheckoutResponse: async (body) => {
        checkoutStarted.resolve(body)
        await httpRelease.promise
      },
      now: () => 5_000,
    })
    const playerShopfront = createPlayerShopfront(harness, playerApi.apiClient)
    const otherShopfront = createPlayerShopfront(harness, playerApi.apiClient, {
      clientId: 'client-other-shopfront',
      subscribeRealtime: true,
    })

    await expect(playerShopfront.loadShop()).resolves.toMatchObject({
      slug: 'viridian-mart',
      revision: 1,
      open: true,
      playerVisible: true,
    })
    await expect(otherShopfront.loadShop()).resolves.toMatchObject({
      slug: 'viridian-mart',
      revision: 1,
    })

    const checkout = createPlayerCheckout(
      playerShopfront.shop,
      playerApi.apiClient,
      harness.playerProfile.id,
      'e2ehappy01',
    )
    await checkout.loadCheckoutDocuments()

    expect(checkout.paymentOptions.value.map((option) => option.key)).toEqual(['trainer:ash'])
    expect(checkout.deliveryOptions.value.map((option) => option.key)).toEqual(['trainer:ash'])

    checkout.setCartQuantity('potion-row', 1)
    expect(checkout.totalPrice.value).toBe(300)
    expect(checkout.canCheckout.value).toBe(true)

    const firstClick = checkout.submitCheckout()
    const commandBody = await checkoutStarted.promise
    const secondClick = await checkout.submitCheckout()

    expect(secondClick).toEqual({
      dispatched: false,
      message: 'A shop checkout command is already in flight.',
    })
    expect(playerApi.postJson).toHaveBeenCalledTimes(1)
    expect(commandBody).toMatchObject({
      type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      opId: 'op_e2ehappy01',
      clientId: 'client-player-checkout',
      profileId: harness.playerProfile.id,
      payload: expect.objectContaining({
        shopSlug: 'viridian-mart',
        shopRevision: 1,
        paymentSource: { kind: 'trainer', slug: 'ash', revision: 0 },
        deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 0 },
        lines: [{ entryId: 'potion-row', quantity: 1 }],
      }),
    })

    expect(otherShopfront.shop.value).toMatchObject({ revision: 2 })
    expect(otherShopfront.shop.value?.entries[0]?.stock).toBe(1)
    expect(harness.bus.deliveredEvents.some((event) => (
      event.channel === shopChannel('viridian-mart')
      && event.type === 'updated'
      && event.revision === 2
    ))).toBe(true)

    httpRelease.resolve()
    await expect(firstClick).resolves.toMatchObject({
      dispatched: true,
      opId: 'op_e2ehappy01',
      response: expect.objectContaining({
        ok: true,
        shopSlug: 'viridian-mart',
        previousShopRevision: 1,
        shopRevision: 2,
        totalPrice: 300,
      }),
    })

    expect(playerShopfront.shop.value?.revision).toBe(2)
    expect(playerShopfront.shop.value?.entries[0]?.stock).toBe(1)
    expect(checkout.cartLines.value).toEqual([])

    const storedShop = persistedShop(harness)
    const storedTrainer = persistedTrainer(harness, 'ash')
    expect(storedShop).toMatchObject({ revision: 2, updatedAt: 5_000 })
    expect(storedShop.entries[0]?.stock).toBe(1)
    expect(storedShop.purchaseLog?.map((entry) => entry.opId)).toEqual(['op_e2ehappy01'])
    expect(storedTrainer).toMatchObject({ revision: 1, money: 700 })
    expect(storedTrainer.inventory?.medicalKit).toEqual([
      expect.objectContaining({ id: expect.any(String), name: 'Potion', qty: 1, cost: 300, description: 'Restores HP.' }),
    ])
    expect(checkoutOperationCount(harness)).toBe(1)
    expect(persistedRealtimeEvents(harness).filter((event) => (
      event.event.type === LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED
    )).map((event) => event.event.opId)).toEqual(['op_e2ehappy01'])
  })

  it('keeps unlinked trainer sheets out of the player checkout UI and rejects bypassed unlinked-trainer commands', async () => {
    const harness = createShoppingHarness()
    const playerApi = createPlayerApiHarness(harness, { now: () => 6_000 })
    const playerShopfront = createPlayerShopfront(harness, playerApi.apiClient)

    await playerShopfront.loadShop()
    const checkout = createPlayerCheckout(
      playerShopfront.shop,
      playerApi.apiClient,
      harness.playerProfile.id,
      'e2eunlink01',
    )
    await checkout.loadCheckoutDocuments()

    expect(checkout.paymentOptions.value.map((option) => option.slug)).toEqual(['ash'])
    expect(checkout.deliveryOptions.value.map((option) => option.slug)).toEqual(['ash'])

    checkout.setCartQuantity('potion-row', 1)
    checkout.selectPaymentOption('trainer:gary')
    checkout.selectDeliveryOption('trainer:gary')
    await expect(checkout.submitCheckout()).resolves.toEqual({
      dispatched: false,
      message: 'Choose an eligible payment source.',
    })
    expect(playerApi.postJson).not.toHaveBeenCalled()

    const bypassCommand = buildShopCheckoutCommand({
      shopSlug: 'viridian-mart',
      shopRevision: harness.openedShop.revision,
      paymentSource: { kind: 'trainer', slug: 'gary', revision: 0 },
      deliveryTarget: { kind: 'trainer', slug: 'gary', revision: 0 },
      lines: [{ entryId: 'potion-row', quantity: 1 }],
      clientId: 'client-unlinked-bypass',
      profileId: harness.playerProfile.id,
      opId: 'op_unlinked01',
    })

    await expect(playerApi.apiClient.postJson<ShopCheckoutCommandResult>(SHOP_API_PATHS.checkout, bypassCommand))
      .resolves.toMatchObject({
        ok: false,
        reason: 'unauthorized',
        message: expect.stringContaining('not linked to the selected player profile'),
      })

    expect(persistedShop(harness).entries[0]?.stock).toBe(2)
    expect(persistedShop(harness).revision).toBe(1)
    expect(persistedTrainer(harness, 'gary')).toMatchObject({ revision: 0, money: 1_000 })
    expect(persistedTrainer(harness, 'gary').inventory?.medicalKit).toEqual([])
    expect(checkoutOperationCount(harness)).toBe(1)
    expect(persistedRealtimeEvents(harness).filter((event) => (
      event.event.type === LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED
    ))).toEqual([])
  })
})
