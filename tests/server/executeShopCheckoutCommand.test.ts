import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteSheetRepository, type PersistedSheet } from '~~/server/storage/sheetRepository'
import { createSqliteShopCheckoutOperationRepository } from '~~/server/storage/shopCheckoutOperationRepository'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'
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
    seedShop(database)
    seedTrainer(database)
    const command = trainerCommand({ opId: 'op_shopcheckout_duplicate' })

    const first = executeShopCheckoutCommandUseCase({ role: 'gm', command }, { database, now: () => 1_000 })
    const duplicate = executeShopCheckoutCommandUseCase({ role: 'gm', command }, { database, now: () => 2_000 })

    expect(duplicate.result).toEqual(first.result)
    expect(storedShop(database)).toMatchObject({ revision: 1, updatedAt: 1_000 })
    expect(storedShop(database).entries[0]?.stock).toBe(3)
    expect(storedTrainer(database)).toMatchObject({ revision: 1, updatedAt: 1_000, money: 600 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ name: 'Potion', qty: 2, cost: 200 }])
    expect(operationCount(database)).toBe(1)
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
