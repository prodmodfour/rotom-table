import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import { groupInventoryChannel, sheetChannel, sheetsChannel, shopChannel, shopsChannel } from '#shared/realtime'
import { PLAYER_PROFILE_SCHEMA_VERSION, type PlayerProfile } from '#shared/playerProfiles'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository, type PersistedSheet } from '~~/server/storage/sheetRepository'
import { createSqliteShopCheckoutOperationRepository } from '~~/server/storage/shopCheckoutOperationRepository'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { executeShopCheckoutCommandUseCase } from '~~/server/useCases/executeShopCheckoutCommand'

const openDatabases: RotomDatabase[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
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
  allowedPaymentSources: ['trainer', 'groupInventory'],
  allowedDeliveryTargets: ['trainer', 'groupInventory'],
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

const groupInventoryDocument = (
  overrides: Partial<GroupInventoryDocument> = {},
): GroupInventoryDocument => ({
  slug: GROUP_INVENTORY_MAIN_SLUG,
  revision: 0,
  updatedAt: 100,
  money: 1_000,
  inventory: emptyInventory() as GroupInventoryDocument['inventory'],
  ...overrides,
})

const mapDocument = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'market-map',
  name: 'Market Map',
  dimensions: { x: 10, y: 3, z: 10 },
  playerVisible: true,
  voxels: [],
  placements: [
    { id: 'ash-token', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
  ],
  shopInterfaces: [
    {
      id: 'counter-a',
      shopSlug: 'viridian-mart',
      label: 'Mart Counter',
      playerVisible: true,
      position: { x: 2, y: 0, z: 1 },
      interactionRangeMeters: 2,
    },
  ],
  ...overrides,
})

const seedShop = (
  database: RotomDatabase,
  document: ShopTableDocument = shopDocument(),
): ShopTableDocument => createSqliteShopTableRepository(database).create({
  slug: document.slug,
  now: document.updatedAt,
  document,
}).document

const seedTrainer = (
  database: RotomDatabase,
  document: TrainerSheet = trainerSheet(),
  revision = document.revision ?? 0,
  updatedAt = 200,
): PersistedSheet => {
  const repository = createSqliteSheetRepository<Record<string, unknown>>(database)
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

const seedGroupInventory = (
  database: RotomDatabase,
  document: GroupInventoryDocument = groupInventoryDocument(),
): GroupInventoryDocument => createSqliteGroupInventoryRepository(database).save({
  slug: document.slug,
  revision: document.revision,
  updatedAt: document.updatedAt,
  document,
}).document

const seedMap = (
  database: RotomDatabase,
  document: TabletopMap = mapDocument(),
): TabletopMap => createSqliteMapRepository(database).create({
  slug: document.slug,
  map: document,
  now: document.updatedAt ?? 300,
})

const storedShop = (database: RotomDatabase, slug = 'viridian-mart'): ShopTableDocument => {
  const stored = createSqliteShopTableRepository(database).get(slug)
  if (!stored) throw new Error(`Shop ${slug} was not persisted`)
  return stored.document
}

const storedTrainer = (database: RotomDatabase, slug = 'ash'): TrainerSheet => {
  const stored = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', slug)
  if (!stored) throw new Error(`Trainer ${slug} was not persisted`)
  return stored.sheet as unknown as TrainerSheet
}

const storedGroupInventory = (database: RotomDatabase, slug = GROUP_INVENTORY_MAIN_SLUG): GroupInventoryDocument => {
  const stored = createSqliteGroupInventoryRepository(database).get(slug)
  if (!stored) throw new Error(`Group inventory ${slug} was not persisted`)
  return stored.document
}

const operationCount = (database: RotomDatabase): number => {
  const row = database.connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get() as { readonly count?: unknown }
  return typeof row.count === 'number' ? row.count : 0
}

const realtimeEvents = (realtime: RealtimeEventRepository) => realtime.readAfter({ afterSequence: 0, limit: 20 }).events

const trainerCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopcheckout_success01',
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

const mapOriginTrainerCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => {
  const base = trainerCommand()
  return trainerCommand({
    opId: 'op_shopcheckout_map_origin',
    payload: {
      ...base.payload,
      origin: {
        kind: 'mapInterface',
        mapSlug: 'market-map',
        interfaceId: 'counter-a',
        actorPlacementId: 'ash-token',
      },
    },
    ...overrides,
  })
}

const groupCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopcheckout_group01',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, field: 'money' },
    { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 0,
    paymentSource: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: 0 },
    deliveryTarget: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: 0 },
    lines: [{ entryId: 'potion-row', quantity: 1 }],
    origin: { kind: 'shopPage' },
  },
  ...overrides,
})

const groupToTrainerCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopcheckout_group_trainer',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, field: 'money' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 0,
    paymentSource: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: 0 },
    deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 0 },
    lines: [{ entryId: 'potion-row', quantity: 1 }],
    origin: { kind: 'shopPage' },
  },
  ...overrides,
})

const trainerToGroupCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopcheckout_trainer_group',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
    { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 0,
    paymentSource: { kind: 'trainer', slug: 'ash', revision: 0 },
    deliveryTarget: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: 0 },
    lines: [{ entryId: 'potion-row', quantity: 1 }],
    origin: { kind: 'shopPage' },
  },
  ...overrides,
})

const playerProfile = (linkedTrainerSlugs: readonly string[] = ['ash']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_shoptest' as PlayerProfile['id'],
  displayName: 'Shop Tester' as PlayerProfile['displayName'],
  linkedCharacters: linkedTrainerSlugs.map((slug) => ({ sheetKind: 'trainer', sheetSlug: slug })),
})

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('executeShopCheckoutCommandUseCase', () => {
  it('atomically accepts GM trainer checkout and stores the terminal operation result', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: trainerCommand(),
      clientId: 'client-shop',
    }, {
      database,
      now: () => 900,
    })

    expect(response.result).toMatchObject({
      ok: true,
      opId: 'op_shopcheckout_success01',
      shopSlug: 'viridian-mart',
      previousShopRevision: 0,
      shopRevision: 1,
      totalPrice: 400,
    })
    if (response.result.ok !== true || 'duplicate' in response.result) throw new Error('Expected accepted result')
    expect(response.result.lines).toEqual([
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
    expect(response.shop?.entries[0]?.stock).toBe(3)
    expect(response.trainerSheets?.[0]).toMatchObject({ slug: 'ash', revision: 1, updatedAt: 900, money: 600 })
    expect(response.trainerSheets?.[0]?.inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(storedShop(database).entries[0]?.stock).toBe(3)
    expect(storedTrainer(database).money).toBe(600)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(createSqliteShopCheckoutOperationRepository({ database }).getOperationResult('viridian-mart', 'op_shopcheckout_success01'))
      .toEqual(response.result)
  })

  it('publishes trainer-only checkout realtime updates after the accepted transaction commits', () => {
    const database = openMemoryDatabase()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_234 })
    const published: ReturnType<typeof realtimeEvents>[number][] = []
    seedShop(database)
    seedTrainer(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: trainerCommand({ opId: 'op_shopcheckout_realtime_trainer' }),
      clientId: 'client-shop',
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 900,
    })

    expect(response.result).toMatchObject({ ok: true, opId: 'op_shopcheckout_realtime_trainer' })
    const events = realtimeEvents(realtime)
    expect(published).toEqual(events)
    expect(events.map((event) => event.event.channel)).toEqual([
      shopChannel('viridian-mart'),
      shopsChannel,
      sheetChannel('trainer', 'ash'),
      sheetsChannel,
      shopChannel('viridian-mart'),
    ])
    expect(events.map((event) => event.access)).toEqual([
      { kind: 'shop-access', shopSlug: 'viridian-mart' },
      { kind: 'shop-access', shopSlug: 'viridian-mart' },
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'ash' },
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'ash' },
      { kind: 'shop-access', shopSlug: 'viridian-mart' },
    ])
    expect(events.map((event) => event.event.clientId)).toEqual([
      'client-shop',
      'client-shop',
      'client-shop',
      'client-shop',
      'client-shop',
    ])
    expect(events[0]?.event).toMatchObject({
      type: 'updated',
      revision: 1,
      data: {
        slug: 'viridian-mart',
        document: {
          slug: 'viridian-mart',
          revision: 1,
          entries: [expect.objectContaining({ id: 'potion-row', stock: 3 })],
        },
      },
    })
    expect(events[1]?.event).toMatchObject({
      type: 'updated',
      revision: 1,
      data: {
        slug: 'viridian-mart',
        summary: expect.objectContaining({
          slug: 'viridian-mart',
          revision: 1,
          entryCount: 1,
          open: true,
          playerVisible: true,
        }),
      },
    })
    expect(events[2]?.event).toMatchObject({
      type: 'updated',
      data: {
        kind: 'trainer',
        slug: 'ash',
        sheet: expect.objectContaining({ slug: 'ash', revision: 1, money: 600 }),
      },
    })
    expect(events[4]?.event).toMatchObject({
      type: 'live-play-command-accepted',
      revision: 1,
      previousRevision: 0,
      opId: 'op_shopcheckout_realtime_trainer',
      data: {
        commandType: 'shopCheckout',
        shopSlug: 'viridian-mart',
        result: {
          ok: true,
          opId: 'op_shopcheckout_realtime_trainer',
          shopSlug: 'viridian-mart',
          documents: {
            shop: expect.objectContaining({ slug: 'viridian-mart', revision: 1 }),
          },
        },
      },
    })
    expect((events[4]?.event.data as { result?: { documents?: Record<string, unknown> } } | undefined)?.result?.documents)
      .not.toHaveProperty('trainerSheets')
  })

  it('supports GM group inventory payment and delivery in the same checkout transaction', () => {
    const database = openMemoryDatabase()
    seedShop(database, shopDocument({ entries: [shopEntry({ stock: 2 })] }))
    seedGroupInventory(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: groupCommand(),
    }, {
      database,
      now: () => 950,
      createGroupInventoryRowId: ({ section, index }) => `checkout-${section}-${index}`,
    })

    if (response.result.ok !== true || 'duplicate' in response.result) throw new Error('Expected accepted result')
    expect(response.groupInventories).toHaveLength(1)
    expect(response.groupInventories?.[0]).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 1,
      updatedAt: 950,
      money: 800,
    })
    expect(response.groupInventories?.[0]?.inventory.medicalKit).toEqual([
      { id: 'checkout-medicalKit-0', name: 'Potion', qty: 1, cost: 200 },
    ])
    expect(storedGroupInventory(database).money).toBe(800)
    expect(storedGroupInventory(database).inventory.medicalKit).toEqual([
      { id: 'checkout-medicalKit-0', name: 'Potion', qty: 1, cost: 200 },
    ])
  })

  it('publishes group checkout realtime updates for group payment and delivery', () => {
    const database = openMemoryDatabase()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_235 })
    const published: ReturnType<typeof realtimeEvents>[number][] = []
    seedShop(database, shopDocument({ entries: [shopEntry({ stock: 2 })] }))
    seedGroupInventory(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: groupCommand({ opId: 'op_shopcheckout_realtime_group' }),
      clientId: 'client-group',
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 950,
      createGroupInventoryRowId: ({ section, index }) => `checkout-${section}-${index}`,
    })

    expect(response.result).toMatchObject({ ok: true, opId: 'op_shopcheckout_realtime_group' })
    const events = realtimeEvents(realtime)
    expect(published).toEqual(events)
    expect(events.map((event) => event.event.channel)).toEqual([
      shopChannel('viridian-mart'),
      shopsChannel,
      groupInventoryChannel(GROUP_INVENTORY_MAIN_SLUG),
      shopChannel('viridian-mart'),
    ])
    expect(events.map((event) => event.access)).toEqual([
      { kind: 'shop-access', shopSlug: 'viridian-mart' },
      { kind: 'shop-access', shopSlug: 'viridian-mart' },
      { kind: 'group-inventory-access', groupSlug: GROUP_INVENTORY_MAIN_SLUG },
      { kind: 'shop-access', shopSlug: 'viridian-mart' },
    ])
    expect(events[2]?.event).toMatchObject({
      type: 'updated',
      revision: 1,
      clientId: 'client-group',
      data: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        document: expect.objectContaining({
          slug: GROUP_INVENTORY_MAIN_SLUG,
          revision: 1,
          money: 800,
        }),
      },
    })
    expect(events[3]?.event).toMatchObject({
      type: 'live-play-command-accepted',
      revision: 1,
      opId: 'op_shopcheckout_realtime_group',
      clientId: 'client-group',
    })
  })

  it('allows a player with a linked trainer to buy using trainer money into trainer inventory', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      playerProfile: playerProfile(['ash']),
      command: trainerCommand({ opId: 'op_shopcheckout_player_linked' }),
    }, {
      database,
      now: () => 990,
    })

    expect(response.result).toMatchObject({
      ok: true,
      opId: 'op_shopcheckout_player_linked',
      shopSlug: 'viridian-mart',
      previousShopRevision: 0,
      shopRevision: 1,
      totalPrice: 400,
    })
    expect(response.shop?.entries[0]?.stock).toBe(3)
    expect(response.trainerSheets?.[0]).toMatchObject({ slug: 'ash', revision: 1, updatedAt: 990, money: 600 })
    expect(storedShop(database).entries[0]?.stock).toBe(3)
    expect(storedTrainer(database).money).toBe(600)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(operationCount(database)).toBe(1)
  })

  it('allows player checkout from a valid map shop interface in range', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)
    seedMap(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      playerProfile: playerProfile(['ash']),
      command: mapOriginTrainerCommand({ opId: 'op_shopcheckout_map_valid' }),
    }, {
      database,
      now: () => 1_020,
    })

    expect(response.result).toMatchObject({
      ok: true,
      opId: 'op_shopcheckout_map_valid',
      shopSlug: 'viridian-mart',
      shopRevision: 1,
      totalPrice: 400,
    })
    expect(storedShop(database).entries[0]?.stock).toBe(3)
    expect(storedTrainer(database).money).toBe(600)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
  })

  it('rejects map-origin checkout when the interface references a different shop', () => {
    const database = openMemoryDatabase()
    seedShop(database, shopDocument({ slug: 'pewter-mart', name: 'Pewter Mart' }))
    seedTrainer(database)
    seedMap(database)
    const base = mapOriginTrainerCommand()

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      playerProfile: playerProfile(['ash']),
      command: mapOriginTrainerCommand({
        opId: 'op_shopcheckout_map_wrong_shop',
        scopes: [
          { kind: 'shop', shopSlug: 'pewter-mart', field: 'purchase' },
          { kind: 'shop', shopSlug: 'pewter-mart', field: 'stock' },
          { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
          { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
        ],
        payload: {
          ...base.payload,
          shopSlug: 'pewter-mart',
        },
      }),
    }, { database })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_map_wrong_shop',
      shopSlug: 'pewter-mart',
      reason: 'conflict',
      message: expect.stringContaining('references shop viridian-mart, not pewter-mart'),
    })
    expect(storedShop(database, 'pewter-mart').entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
  })

  it('rejects map-origin player checkout from an inaccessible map', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)
    seedMap(database, mapDocument({ playerVisible: false }))

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      playerProfile: playerProfile(['ash']),
      command: mapOriginTrainerCommand({ opId: 'op_shopcheckout_map_hidden' }),
    }, { database })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_map_hidden',
      shopSlug: 'viridian-mart',
      reason: 'unauthorized',
      message: expect.stringContaining('Map market-map is not player visible'),
    })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
  })

  it('rejects map-origin player checkout with an uncontrolled actor token', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)
    seedMap(database, mapDocument({
      placements: [
        { id: 'ash-token', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
        { id: 'misty-token', sheetKind: 'trainer', sheetSlug: 'misty', position: { x: 1, y: 0, z: 1 } },
      ],
    }))
    const base = mapOriginTrainerCommand()

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      playerProfile: playerProfile(['ash']),
      command: mapOriginTrainerCommand({
        opId: 'op_shopcheckout_map_uncontrolled',
        payload: {
          ...base.payload,
          origin: {
            kind: 'mapInterface',
            mapSlug: 'market-map',
            interfaceId: 'counter-a',
            actorPlacementId: 'misty-token',
          },
        },
      }),
    }, { database })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_map_uncontrolled',
      shopSlug: 'viridian-mart',
      reason: 'unauthorized',
      message: expect.stringContaining('not linked to the selected player profile'),
    })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
  })

  it('rejects map-origin player checkout when the controlled actor token is out of range', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)
    seedMap(database, mapDocument({
      placements: [
        { id: 'ash-token', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 8, y: 0, z: 1 } },
      ],
    }))

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      playerProfile: playerProfile(['ash']),
      command: mapOriginTrainerCommand({ opId: 'op_shopcheckout_map_range' }),
    }, { database })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_map_range',
      shopSlug: 'viridian-mart',
      reason: 'unauthorized',
      message: expect.stringContaining('out of range'),
    })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
  })

  it('rejects profileless player checkout before changing money stock or inventory', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'player',
      command: trainerCommand({ opId: 'op_shopcheckout_profileless' }),
    }, { database })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_profileless',
      shopSlug: 'viridian-mart',
      reason: 'unauthorized',
      message: expect.stringContaining('Choose a player profile'),
    })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
    expect(operationCount(database)).toBe(1)
  })

  it('rejects player checkout against trainer payment or delivery sheets outside the selected profile', () => {
    const cases = [
      {
        opId: 'op_shopcheckout_unlinked_pay',
        expectedMessage: 'payment source',
        command: trainerCommand({
          opId: 'op_shopcheckout_unlinked_pay',
          scopes: [
            { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
            { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
            { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'misty', field: 'money' },
            { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
          ],
          payload: {
            ...trainerCommand().payload,
            paymentSource: { kind: 'trainer', slug: 'misty', revision: 0 },
            deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 0 },
          },
        }),
      },
      {
        opId: 'op_shopcheckout_unlinked_delivery',
        expectedMessage: 'delivery target',
        command: trainerCommand({
          opId: 'op_shopcheckout_unlinked_delivery',
          scopes: [
            { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
            { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
            { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
            { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'misty', field: 'inventory' },
          ],
          payload: {
            ...trainerCommand().payload,
            paymentSource: { kind: 'trainer', slug: 'ash', revision: 0 },
            deliveryTarget: { kind: 'trainer', slug: 'misty', revision: 0 },
          },
        }),
      },
    ] as const

    for (const testCase of cases) {
      const database = openMemoryDatabase()
      seedShop(database)
      seedTrainer(database, trainerSheet({ slug: 'ash' }))
      seedTrainer(database, trainerSheet({ slug: 'misty', name: 'Misty' }))

      const response = executeShopCheckoutCommandUseCase({
        role: 'player',
        playerProfile: playerProfile(['ash']),
        command: testCase.command,
      }, { database })

      expect(response.result).toMatchObject({
        ok: false,
        opId: testCase.opId,
        shopSlug: 'viridian-mart',
        reason: 'unauthorized',
        message: expect.stringContaining(testCase.expectedMessage),
      })
      expect(storedShop(database).entries[0]?.stock).toBe(5)
      expect(storedTrainer(database, 'ash').money).toBe(1_000)
      expect(storedTrainer(database, 'misty').money).toBe(1_000)
      expect(storedTrainer(database, 'ash').inventory?.medicalKit).toEqual([])
      expect(storedTrainer(database, 'misty').inventory?.medicalKit).toEqual([])
      expect(operationCount(database)).toBe(1)
    }
  })

  it('rejects player checkout from closed or hidden shops', () => {
    const cases = [
      {
        opId: 'op_shopcheckout_hidden',
        shop: shopDocument({ playerVisible: false, open: true }),
        expectedMessage: 'not player visible',
      },
      {
        opId: 'op_shopcheckout_closed',
        shop: shopDocument({ playerVisible: true, open: false }),
        expectedMessage: 'closed',
      },
    ] as const

    for (const testCase of cases) {
      const database = openMemoryDatabase()
      seedShop(database, testCase.shop)
      seedTrainer(database)

      const response = executeShopCheckoutCommandUseCase({
        role: 'player',
        playerProfile: playerProfile(['ash']),
        command: trainerCommand({ opId: testCase.opId }),
      }, { database })

      expect(response.result).toMatchObject({
        ok: false,
        opId: testCase.opId,
        shopSlug: 'viridian-mart',
        reason: 'unauthorized',
        currentShopRevision: 0,
        message: expect.stringContaining(testCase.expectedMessage),
      })
      expect(response.result).not.toHaveProperty('currentState')
      expect(storedShop(database).entries[0]?.stock).toBe(5)
      expect(storedTrainer(database).money).toBe(1_000)
      expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
      expect(operationCount(database)).toBe(1)
    }
  })

  it('rejects player group payment and group delivery unless the shop allows them', () => {
    const cases = [
      {
        opId: 'op_shopcheckout_group_payment_forbidden',
        command: groupToTrainerCommand({ opId: 'op_shopcheckout_group_payment_forbidden' }),
        expectedMessage: 'group inventory funds',
      },
      {
        opId: 'op_shopcheckout_group_delivery_forbidden',
        command: trainerToGroupCommand({ opId: 'op_shopcheckout_group_delivery_forbidden' }),
        expectedMessage: 'group inventory delivery',
      },
    ] as const

    for (const testCase of cases) {
      const database = openMemoryDatabase()
      seedShop(database, shopDocument({
        allowedPaymentSources: ['trainer'],
        allowedDeliveryTargets: ['trainer'],
      }))
      seedTrainer(database)
      seedGroupInventory(database)

      const response = executeShopCheckoutCommandUseCase({
        role: 'player',
        playerProfile: playerProfile(['ash']),
        command: testCase.command,
      }, { database })

      expect(response.result).toMatchObject({
        ok: false,
        opId: testCase.opId,
        shopSlug: 'viridian-mart',
        reason: 'unauthorized',
        message: expect.stringContaining(testCase.expectedMessage),
      })
      expect(storedShop(database).entries[0]?.stock).toBe(5)
      expect(storedTrainer(database).money).toBe(1_000)
      expect(storedGroupInventory(database).money).toBe(1_000)
      expect(storedGroupInventory(database).inventory.medicalKit).toEqual([])
      expect(operationCount(database)).toBe(1)
    }
  })

  it('keeps GM checkout unrestricted by player visibility and player source configuration', () => {
    const database = openMemoryDatabase()
    seedShop(database, shopDocument({
      playerVisible: false,
      open: false,
      allowedPaymentSources: ['trainer'],
      allowedDeliveryTargets: ['trainer'],
    }))
    seedGroupInventory(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: groupCommand({ opId: 'op_shopcheckout_gm_unrestricted' }),
    }, {
      database,
      now: () => 1_010,
      createGroupInventoryRowId: ({ section, index }) => `gm-${section}-${index}`,
    })

    expect(response.result).toMatchObject({
      ok: true,
      opId: 'op_shopcheckout_gm_unrestricted',
      shopSlug: 'viridian-mart',
      shopRevision: 1,
      totalPrice: 200,
    })
    expect(storedShop(database).entries[0]?.stock).toBe(4)
    expect(storedGroupInventory(database).money).toBe(800)
    expect(storedGroupInventory(database).inventory.medicalKit).toEqual([
      { id: 'gm-medicalKit-0', name: 'Potion', qty: 1, cost: 200 },
    ])
  })

  it('publishes only a terminal rejected realtime result for failed checkout', () => {
    const database = openMemoryDatabase()
    const realtime = createSqliteRealtimeEventRepository({ database })
    const published: ReturnType<typeof realtimeEvents>[number][] = []
    seedShop(database)
    seedTrainer(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: trainerCommand({
        opId: 'op_shopcheckout_realtime_failed',
        payload: {
          ...trainerCommand().payload,
          shopRevision: 99,
        },
      }),
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(response.result).toMatchObject({ ok: false, opId: 'op_shopcheckout_realtime_failed' })
    const events = realtimeEvents(realtime)
    expect(published).toEqual(events)
    expect(events.map((event) => event.event.channel)).toEqual([shopChannel('viridian-mart')])
    expect(events[0]).toMatchObject({
      access: { kind: 'shop-access', shopSlug: 'viridian-mart' },
      event: {
        type: 'live-play-command-rejected',
        opId: 'op_shopcheckout_realtime_failed',
        data: {
          commandType: 'shopCheckout',
          shopSlug: 'viridian-mart',
          result: {
            ok: false,
            opId: 'op_shopcheckout_realtime_failed',
            reason: 'stale-revision',
            currentShopRevision: 0,
          },
        },
      },
    })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
  })

  it('rejects stale shop revisions without changing money stock or inventory', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: trainerCommand({
        opId: 'op_shopcheckout_staleshop',
        payload: {
          ...trainerCommand().payload,
          shopRevision: 99,
        },
      }),
    }, { database })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_staleshop',
      shopSlug: 'viridian-mart',
      reason: 'stale-revision',
      currentShopRevision: 0,
    })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database).money).toBe(1_000)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
    expect(operationCount(database)).toBe(1)
  })

  it('rejects stale payment and delivery revisions without changing money stock or inventory', () => {
    const staleCases = [
      {
        opId: 'op_shopcheckout_stalepay',
        paymentRevision: 9,
        deliveryRevision: 0,
      },
      {
        opId: 'op_shopcheckout_staledeliver',
        paymentRevision: 0,
        deliveryRevision: 9,
      },
    ] as const

    for (const staleCase of staleCases) {
      const database = openMemoryDatabase()
      seedShop(database)
      seedTrainer(database)

      const response = executeShopCheckoutCommandUseCase({
        role: 'gm',
        command: trainerCommand({
          opId: staleCase.opId,
          payload: {
            ...trainerCommand().payload,
            paymentSource: { kind: 'trainer', slug: 'ash', revision: staleCase.paymentRevision },
            deliveryTarget: { kind: 'trainer', slug: 'ash', revision: staleCase.deliveryRevision },
          },
        }),
      }, { database })

      expect(response.result).toMatchObject({
        ok: false,
        opId: staleCase.opId,
        reason: 'stale-revision',
      })
      expect(storedShop(database).entries[0]?.stock).toBe(5)
      expect(storedTrainer(database).money).toBe(1_000)
      expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
      expect(operationCount(database)).toBe(1)
    }
  })

  it('returns the stored result for duplicate operation IDs with the same command without double-applying', () => {
    const database = openMemoryDatabase()
    const realtime = createSqliteRealtimeEventRepository({ database })
    const published: ReturnType<typeof realtimeEvents>[number][] = []
    seedShop(database)
    seedTrainer(database)
    const command = trainerCommand({ opId: 'op_shopcheckout_duplicate' })

    const first = executeShopCheckoutCommandUseCase({ role: 'gm', command }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 1_000,
    })
    const firstRealtimeSequence = realtime.cursorState().latestSequence
    published.length = 0
    const duplicate = executeShopCheckoutCommandUseCase({ role: 'gm', command }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 2_000,
    })

    expect(duplicate.result).toEqual(first.result)
    expect(realtime.cursorState().latestSequence).toBe(firstRealtimeSequence)
    expect(published).toEqual([])
    expect(storedShop(database)).toMatchObject({ revision: 1, updatedAt: 1_000 })
    expect(storedShop(database).entries[0]?.stock).toBe(3)
    expect(storedTrainer(database)).toMatchObject({ revision: 1, updatedAt: 1_000, money: 600 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(operationCount(database)).toBe(1)
    expect(firstRealtimeSequence).toBe(5)
  })

  it('rejects duplicate operation IDs reused for a changed command without applying it', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)
    const command = trainerCommand({ opId: 'op_shopcheckout_changed' })
    executeShopCheckoutCommandUseCase({ role: 'gm', command }, { database, now: () => 1_000 })

    const changed = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: trainerCommand({
        opId: command.opId,
        payload: {
          ...command.payload,
          lines: [{ entryId: 'potion-row', quantity: 1 }],
        },
      }),
    }, { database, now: () => 2_000 })

    expect(changed.result).toMatchObject({
      ok: false,
      opId: command.opId,
      shopSlug: 'viridian-mart',
      reason: 'conflict',
      message: expect.stringContaining('already recorded for a different command envelope'),
    })
    expect(storedShop(database).entries[0]?.stock).toBe(3)
    expect(storedTrainer(database).money).toBe(600)
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(operationCount(database)).toBe(1)
  })

  it('rolls back shop stock when a later trainer sheet write fails', () => {
    const database = openMemoryDatabase()
    seedShop(database)
    seedTrainer(database)
    database.connection.exec(`
      CREATE TRIGGER fail_shop_checkout_trainer_update
      BEFORE UPDATE ON sheets
      WHEN NEW.kind = 'trainer' AND NEW.slug = 'ash'
      BEGIN
        SELECT RAISE(ABORT, 'forced trainer checkout failure');
      END;
    `)

    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: trainerCommand({ opId: 'op_shopcheckout_rollback' }),
    }, { database, now: () => 1_100 })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_rollback',
      shopSlug: 'viridian-mart',
      reason: 'stale-revision',
      message: expect.stringContaining('Trainer sheet ash changed before the checkout command could be persisted'),
    })
    expect(storedShop(database)).toMatchObject({ revision: 0, updatedAt: 100 })
    expect(storedShop(database).entries[0]?.stock).toBe(5)
    expect(storedTrainer(database)).toMatchObject({ revision: 0, updatedAt: 200, money: 1_000 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
    expect(operationCount(database)).toBe(1)
  })
})
