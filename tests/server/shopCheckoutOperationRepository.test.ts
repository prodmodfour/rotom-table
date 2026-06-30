import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutCommandRejected,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import type { ShopTableDocument } from '~/types/shop'
import { createShopCheckoutCommandHash } from '~~/server/livePlay/shopCheckoutOpResult'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteShopCheckoutOperationRepository } from '~~/server/storage/shopCheckoutOperationRepository'

const openDatabases: RotomDatabase[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const shopDocument = (revision: number): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision,
  updatedAt: 1_700_000_000_000 + revision,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [
    {
      id: 'potion-row',
      itemName: 'Potion',
      section: 'medicalKit',
      price: 300,
      stock: revision >= 3 ? 4 : 5,
    },
  ],
})

const createCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopcheckout01',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 2,
    paymentSource: { kind: 'trainer', slug: 'ash', revision: 1 },
    deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 1 },
    lines: [{ entryId: 'potion-row', quantity: 1 }],
    origin: { kind: 'shopPage' },
  },
  ...overrides,
})

const createAcceptedResult = (command: ShopCheckoutLivePlayCommand): ShopCheckoutCommandAccepted => ({
  ok: true,
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  previousShopRevision: 2,
  shopRevision: 3,
  totalPrice: 300,
  lines: [
    {
      entryId: 'potion-row',
      itemName: 'Potion',
      section: 'medicalKit',
      quantity: 1,
      unitPrice: 300,
      lineTotal: 300,
      stock: 4,
    },
  ],
  documents: {
    shop: shopDocument(3),
  },
})

const createRejectedResult = (command: ShopCheckoutLivePlayCommand): ShopCheckoutCommandRejected => ({
  ok: false,
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  reason: 'stale-revision',
  message: 'Refresh the shop before buying from this stock revision.',
  currentShopRevision: 4,
})

describe('SQLite shop checkout operation repository', () => {
  it('stores the first accepted shop-page checkout result without requiring a map slug', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopCheckoutOperationRepository({
      database,
      clock: () => 1_700_000_000_500,
    })
    const command = createCommand()
    const result = createAcceptedResult(command)
    const commandHash = createShopCheckoutCommandHash(command)

    const stored = repository.saveCommandResult({
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      command,
      result,
    })

    expect(stored).toEqual({
      schemaVersion: 1,
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
      resultRevision: 3,
      createdAt: 1_700_000_000_500,
      recordedAt: new Date(1_700_000_000_500).toISOString(),
    })
    expect(stored.command).not.toHaveProperty('mapSlug')
    expect(repository.getOperationResult(command.payload.shopSlug, command.opId)).toEqual(result)
    expect(repository.getStoredOperation(command.payload.shopSlug, command.opId)).toEqual(stored)
    expect(database.connection.prepare('SELECT op_id, shop_slug, result_revision, created_at FROM shop_checkout_ops').get())
      .toEqual({
        op_id: command.opId,
        shop_slug: command.payload.shopSlug,
        result_revision: 3,
        created_at: 1_700_000_000_500,
      })
  })

  it('returns the original accepted result for a duplicate operation with the same command', () => {
    const repository = createSqliteShopCheckoutOperationRepository({ database: openMemoryDatabase() })
    const command = createCommand()
    const result = createAcceptedResult(command)

    const stored = repository.saveCommandResult({
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      command,
      result,
      recordedAt: '2026-06-01T00:00:00.000Z',
    })
    const duplicate = repository.saveCommandResult({
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      command,
      result,
    })

    expect(duplicate).toEqual(stored)
    expect(repository.getOperationResult(command.payload.shopSlug, command.opId)).toEqual(result)
  })

  it('returns the original rejected result for a duplicate operation with the same command', () => {
    const repository = createSqliteShopCheckoutOperationRepository({ database: openMemoryDatabase() })
    const command = createCommand({ opId: 'op_shopcheckout02' })
    const result = createRejectedResult(command)

    const stored = repository.saveCommandResult({
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      command,
      result,
    })
    const duplicate = repository.saveCommandResult({
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      command,
      result,
    })

    expect(duplicate).toEqual(stored)
    expect(stored.resultRevision).toBe(4)
    expect(repository.getOperationResult(command.payload.shopSlug, command.opId)).toEqual(result)
  })

  it('rejects reuse of the same operation ID with a different checkout command', () => {
    const repository = createSqliteShopCheckoutOperationRepository({ database: openMemoryDatabase() })
    const command = createCommand({ opId: 'op_shopcheckout03' })
    const result = createAcceptedResult(command)
    const changedCommand = createCommand({
      opId: command.opId,
      payload: {
        ...command.payload,
        lines: [{ entryId: 'potion-row', quantity: 2 }],
      },
    })

    repository.saveCommandResult({
      shopSlug: command.payload.shopSlug,
      opId: command.opId,
      command,
      result,
    })

    expect(() => repository.saveCommandResult({
      shopSlug: changedCommand.payload.shopSlug,
      opId: changedCommand.opId,
      command: changedCommand,
      result: {
        ...result,
        totalPrice: 600,
        lines: [{ ...result.lines[0], quantity: 2, lineTotal: 600, stock: 3 }],
      },
    })).toThrow('already recorded for a different command envelope')
    expect(repository.getOperationResult(command.payload.shopSlug, command.opId)).toEqual(result)
  })
})
