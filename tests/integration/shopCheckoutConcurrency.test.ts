import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import { groupInventoryChannel, sheetChannel, sheetsChannel, shopChannel, shopsChannel } from '#shared/realtime'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteShopCheckoutOperationRepository } from '~~/server/storage/shopCheckoutOperationRepository'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { executeShopCheckoutCommandUseCase } from '~~/server/useCases/executeShopCheckoutCommand'

interface FileBackedHarness {
  readonly database: RotomDatabase
  readonly root: string
}

interface TrainerCheckoutCommandOptions {
  readonly opId: string
  readonly trainerSlug?: string
  readonly shopRevision?: number
  readonly trainerRevision?: number
  readonly quantity?: number
}

interface GroupCheckoutCommandOptions {
  readonly opId: string
  readonly shopRevision?: number
  readonly groupRevision?: number
  readonly quantity?: number
}

const openHarnesses: FileBackedHarness[] = []

const openHarness = (): FileBackedHarness => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-shop-checkout-concurrency-'))
  const database = openRotomDatabase({ path: join(root, 'campaign.sqlite') })
  const harness = { database, root }
  openHarnesses.push(harness)
  return harness
}

const emptyInventory = (): TrainerInventory => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as TrainerInventory

const shopEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'potion-row',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 200,
  stock: 1,
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
  updatedAt: 200,
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
  updatedAt = 300,
): TrainerSheet => {
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
  return storedTrainer(database, document.slug)
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

const storedShop = (database: RotomDatabase): ShopTableDocument => {
  const stored = createSqliteShopTableRepository(database).get('viridian-mart')
  if (!stored) throw new Error('Expected viridian-mart to be stored')
  return stored.document
}

const storedTrainer = (database: RotomDatabase, slug = 'ash'): TrainerSheet => {
  const stored = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', slug)
  if (!stored) throw new Error(`Expected trainer ${slug} to be stored`)
  return stored.sheet as unknown as TrainerSheet
}

const storedGroupInventory = (database: RotomDatabase): GroupInventoryDocument => {
  const stored = createSqliteGroupInventoryRepository(database).get(GROUP_INVENTORY_MAIN_SLUG)
  if (!stored) throw new Error(`Expected group inventory ${GROUP_INVENTORY_MAIN_SLUG} to be stored`)
  return stored.document
}

const operationRepository = (database: RotomDatabase) => createSqliteShopCheckoutOperationRepository({ database })

const operationCount = (database: RotomDatabase): number => {
  const row = database.connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get() as { readonly count?: unknown }
  return typeof row.count === 'number' ? row.count : 0
}

const realtimeEvents = (database: RotomDatabase): readonly PersistedRealtimeEvent[] => (
  createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 50 }).events
)

const stateChangingEvents = (events: readonly PersistedRealtimeEvent[]): readonly PersistedRealtimeEvent[] => (
  events.filter((event) => event.event.type === 'updated')
)

const acceptedCommandEvents = (events: readonly PersistedRealtimeEvent[]): readonly PersistedRealtimeEvent[] => (
  events.filter((event) => event.event.type === 'live-play-command-accepted')
)

const rejectedCommandEvents = (events: readonly PersistedRealtimeEvent[]): readonly PersistedRealtimeEvent[] => (
  events.filter((event) => event.event.type === 'live-play-command-rejected')
)

const trainerCheckoutCommand = ({
  opId,
  trainerSlug = 'ash',
  shopRevision = 0,
  trainerRevision = 0,
  quantity = 1,
}: TrainerCheckoutCommandOptions): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: trainerSlug, field: 'money' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: trainerSlug, field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision,
    paymentSource: { kind: 'trainer', slug: trainerSlug, revision: trainerRevision },
    deliveryTarget: { kind: 'trainer', slug: trainerSlug, revision: trainerRevision },
    lines: [{ entryId: 'potion-row', quantity }],
    origin: { kind: 'shopPage' },
  },
})

const groupCheckoutCommand = ({
  opId,
  shopRevision = 0,
  groupRevision = 0,
  quantity = 1,
}: GroupCheckoutCommandOptions): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, field: 'money' },
    { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision,
    paymentSource: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: groupRevision },
    deliveryTarget: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: groupRevision },
    lines: [{ entryId: 'potion-row', quantity }],
    origin: { kind: 'shopPage' },
  },
})

afterEach(() => {
  while (openHarnesses.length > 0) {
    const harness = openHarnesses.pop()
    harness?.database.close()
    if (harness) rmSync(harness.root, { recursive: true, force: true })
  }
})

describe('shop checkout concurrency and conflict integration', () => {
  it('allows only one client to buy the last finite-stock item', () => {
    const { database } = openHarness()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_000 })
    const published: PersistedRealtimeEvent[] = []
    seedShop(database)
    seedTrainer(database, trainerSheet({ slug: 'ash', name: 'Ash' }))
    seedTrainer(database, trainerSheet({ slug: 'misty', name: 'Misty' }))

    const firstCommand = trainerCheckoutCommand({ opId: 'op_shopcheckout_laststock_a', trainerSlug: 'ash' })
    const secondCommand = trainerCheckoutCommand({ opId: 'op_shopcheckout_laststock_b', trainerSlug: 'misty' })

    const first = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: firstCommand,
      clientId: 'client-a',
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 900,
    })
    const second = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: secondCommand,
      clientId: 'client-b',
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 950,
    })

    expect([first.result, second.result].filter((result) => result.ok === true)).toHaveLength(1)
    expect(first.result).toMatchObject({ ok: true, opId: 'op_shopcheckout_laststock_a', shopRevision: 1 })
    expect(second.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_laststock_b',
      reason: 'stale-revision',
      currentShopRevision: 1,
    })
    expect(storedShop(database)).toMatchObject({ revision: 1, updatedAt: 900 })
    expect(storedShop(database).entries[0]?.stock).toBe(0)
    expect(storedShop(database).purchaseLog?.map((entry) => entry.opId)).toEqual(['op_shopcheckout_laststock_a'])
    expect(storedTrainer(database, 'ash')).toMatchObject({ revision: 1, updatedAt: 900, money: 800 })
    expect(storedTrainer(database, 'ash').inventory?.medicalKit).toEqual([expect.objectContaining({ id: expect.any(String), name: 'Potion', qty: 1, cost: 200 })])
    expect(storedTrainer(database, 'misty')).toMatchObject({ revision: 0, updatedAt: 300, money: 1_000 })
    expect(storedTrainer(database, 'misty').inventory?.medicalKit).toEqual([])

    const operations = operationRepository(database)
    expect(operationCount(database)).toBe(2)
    expect(operations.getOperationResult('viridian-mart', firstCommand.opId)).toEqual(first.result)
    expect(operations.getOperationResult('viridian-mart', secondCommand.opId)).toEqual(second.result)

    const events = realtimeEvents(database)
    expect(published).toEqual(events)
    expect(stateChangingEvents(events).map((event) => event.event.channel)).toEqual([
      shopChannel('viridian-mart'),
      shopsChannel,
      sheetChannel('trainer', 'ash'),
      sheetsChannel,
    ])
    expect(acceptedCommandEvents(events).map((event) => event.event.opId)).toEqual(['op_shopcheckout_laststock_a'])
    expect(rejectedCommandEvents(events).map((event) => event.event.opId)).toEqual(['op_shopcheckout_laststock_b'])
    expect(events.every((event) => event.event.opId !== 'op_shopcheckout_laststock_b' || event.event.type === 'live-play-command-rejected')).toBe(true)
  })

  it('stores stale shop conflicts deterministically without state-changing realtime', () => {
    const { database } = openHarness()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_100 })
    seedShop(database)
    seedTrainer(database)

    const command = trainerCheckoutCommand({ opId: 'op_shopcheckout_stale_shop_integration', shopRevision: 9 })
    const first = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'stale-shop-client',
    }, { database, realtimeEventRepository: realtime })
    const retry = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'stale-shop-client',
    }, { database, realtimeEventRepository: realtime })

    expect(first.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_stale_shop_integration',
      reason: 'stale-revision',
      currentShopRevision: 0,
    })
    expect(retry.result).toEqual(first.result)
    expect(operationCount(database)).toBe(1)
    expect(operationRepository(database).getOperationResult('viridian-mart', command.opId)).toEqual(first.result)
    expect(storedShop(database).entries[0]?.stock).toBe(1)
    expect(storedTrainer(database)).toMatchObject({ revision: 0, money: 1_000 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
    const events = realtimeEvents(database)
    expect(stateChangingEvents(events)).toEqual([])
    expect(acceptedCommandEvents(events)).toEqual([])
    expect(rejectedCommandEvents(events).map((event) => event.event.opId)).toEqual(['op_shopcheckout_stale_shop_integration'])
  })

  it('rejects stale group inventory revisions without charging funds or delivering items', () => {
    const { database } = openHarness()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_200 })
    seedShop(database)
    seedGroupInventory(database)

    const command = groupCheckoutCommand({ opId: 'op_shopcheckout_stale_group_integration', groupRevision: 9 })
    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'stale-group-client',
    }, { database, realtimeEventRepository: realtime })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_stale_group_integration',
      reason: 'stale-revision',
    })
    expect(operationCount(database)).toBe(1)
    expect(operationRepository(database).getOperationResult('viridian-mart', command.opId)).toEqual(response.result)
    expect(storedShop(database)).toMatchObject({ revision: 0, updatedAt: 100 })
    expect(storedShop(database).entries[0]?.stock).toBe(1)
    expect(storedGroupInventory(database)).toMatchObject({ revision: 0, money: 1_000 })
    expect(storedGroupInventory(database).inventory.medicalKit).toEqual([])
    const events = realtimeEvents(database)
    expect(stateChangingEvents(events)).toEqual([])
    expect(acceptedCommandEvents(events)).toEqual([])
    expect(rejectedCommandEvents(events).map((event) => event.event.channel)).toEqual([shopChannel('viridian-mart')])
    expect(events.map((event) => event.event.channel)).not.toContain(groupInventoryChannel(GROUP_INVENTORY_MAIN_SLUG))
  })

  it('rejects stale trainer sheet revisions without charging money or delivering items', () => {
    const { database } = openHarness()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_300 })
    seedShop(database)
    seedTrainer(database)

    const command = trainerCheckoutCommand({ opId: 'op_shopcheckout_stale_trainer_integration', trainerRevision: 9 })
    const response = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'stale-trainer-client',
    }, { database, realtimeEventRepository: realtime })

    expect(response.result).toMatchObject({
      ok: false,
      opId: 'op_shopcheckout_stale_trainer_integration',
      reason: 'stale-revision',
    })
    expect(operationCount(database)).toBe(1)
    expect(operationRepository(database).getOperationResult('viridian-mart', command.opId)).toEqual(response.result)
    expect(storedShop(database)).toMatchObject({ revision: 0, updatedAt: 100 })
    expect(storedShop(database).entries[0]?.stock).toBe(1)
    expect(storedTrainer(database)).toMatchObject({ revision: 0, money: 1_000 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([])
    const events = realtimeEvents(database)
    expect(stateChangingEvents(events)).toEqual([])
    expect(acceptedCommandEvents(events)).toEqual([])
    expect(rejectedCommandEvents(events).map((event) => event.event.channel)).toEqual([shopChannel('viridian-mart')])
    expect(events.map((event) => event.event.channel)).not.toContain(sheetChannel('trainer', 'ash'))
  })

  it('returns the stored terminal result for a duplicate operation retry without republishing realtime', () => {
    const { database } = openHarness()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_400 })
    const published: PersistedRealtimeEvent[] = []
    seedShop(database, shopDocument({ entries: [shopEntry({ stock: 2 })] }))
    seedTrainer(database)
    const command = trainerCheckoutCommand({ opId: 'op_shopcheckout_duplicate_retry_integration' })

    const first = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'duplicate-client',
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 1_000,
    })
    const sequenceAfterFirst = realtime.cursorState().latestSequence
    published.length = 0
    const duplicate = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'duplicate-client',
    }, {
      database,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: (event) => published.push(event),
      now: () => 2_000,
    })

    expect(first.result).toMatchObject({ ok: true, opId: 'op_shopcheckout_duplicate_retry_integration', shopRevision: 1 })
    expect(duplicate.result).toEqual(first.result)
    expect(realtime.cursorState().latestSequence).toBe(sequenceAfterFirst)
    expect(published).toEqual([])
    expect(operationCount(database)).toBe(1)
    expect(operationRepository(database).getOperationResult('viridian-mart', command.opId)).toEqual(first.result)
    expect(storedShop(database)).toMatchObject({ revision: 1, updatedAt: 1_000 })
    expect(storedShop(database).entries[0]?.stock).toBe(1)
    expect(storedShop(database).purchaseLog?.map((entry) => entry.opId)).toEqual(['op_shopcheckout_duplicate_retry_integration'])
    expect(storedTrainer(database)).toMatchObject({ revision: 1, updatedAt: 1_000, money: 800 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([expect.objectContaining({ id: expect.any(String), name: 'Potion', qty: 1, cost: 200 })])
  })

  it('rejects a different command with the same operation ID without replacing the recorded result', () => {
    const { database } = openHarness()
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_500 })
    seedShop(database, shopDocument({ entries: [shopEntry({ stock: 3 })] }))
    seedTrainer(database)
    const command = trainerCheckoutCommand({ opId: 'op_shopcheckout_same_id_changed_integration', quantity: 1 })

    const first = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command,
      clientId: 'changed-id-client',
    }, { database, realtimeEventRepository: realtime, now: () => 1_000 })
    const sequenceAfterFirst = realtime.cursorState().latestSequence
    const changedCommand = trainerCheckoutCommand({
      opId: command.opId,
      shopRevision: 1,
      trainerRevision: 1,
      quantity: 2,
    })
    const changed = executeShopCheckoutCommandUseCase({
      role: 'gm',
      command: changedCommand,
      clientId: 'changed-id-client',
    }, { database, realtimeEventRepository: realtime, now: () => 2_000 })

    expect(first.result).toMatchObject({ ok: true, opId: command.opId, shopRevision: 1, totalPrice: 200 })
    expect(changed.result).toMatchObject({
      ok: false,
      opId: command.opId,
      reason: 'conflict',
      message: expect.stringContaining('already recorded for a different command envelope'),
      currentShopRevision: 1,
    })
    expect(realtime.cursorState().latestSequence).toBe(sequenceAfterFirst)
    expect(operationCount(database)).toBe(1)
    expect(operationRepository(database).getOperationResult('viridian-mart', command.opId)).toEqual(first.result)
    expect(storedShop(database)).toMatchObject({ revision: 1, updatedAt: 1_000 })
    expect(storedShop(database).entries[0]?.stock).toBe(2)
    expect(storedShop(database).purchaseLog?.map((entry) => entry.opId)).toEqual([command.opId])
    expect(storedTrainer(database)).toMatchObject({ revision: 1, updatedAt: 1_000, money: 800 })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([expect.objectContaining({ id: expect.any(String), name: 'Potion', qty: 1, cost: 200 })])
  })
})
