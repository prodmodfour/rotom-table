import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES, type ShopCheckoutLivePlayCommand } from '#shared/livePlayCommands'
import { parseShopPostCheckoutActionRequest } from '#shared/shopPostCheckout'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteShopTableRepository } from '../../server/storage/shopTableRepository'
import { executeShopCheckoutCommandUseCase } from '../../server/useCases/executeShopCheckoutCommand'
import { loadShopPostCheckoutActionsUseCase } from '../../server/useCases/loadShopPostCheckoutActions'
import { createDefaultGroupInventoryDocument } from '../../src/types/groupInventory'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { ShopTableDocument } from '../../src/types/shop'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const profile = (linked = true): PlayerProfile => ({
  schemaVersion: 1,
  id: linked ? 'profile_post_checkout_01' : 'profile_post_checkout_02',
  displayName: 'Shop Player',
  linkedCharacters: linked ? [{ sheetKind: 'trainer', sheetSlug: 'ash' }] : [],
})
const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, money: 2_000,
  currentTeam: ['pikachu'], inventory: {},
})
const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
})
const shop = (): ShopTableDocument => ({
  slug: 'mart', revision: 0, updatedAt: 1, name: 'Mart', playerVisible: true, open: true,
  allowedPaymentSources: ['trainer', 'groupInventory'],
  allowedDeliveryTargets: ['trainer', 'groupInventory'],
  entries: [{ id: 'potion-sale', itemName: 'Potion', section: 'medicalKit', price: 200, stock: 10 }],
})
const seed = (database: RotomDatabase): void => {
  createSqliteShopTableRepository(database).create({ slug: 'mart', document: shop(), now: 1 })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 1, document: trainer() as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 1, document: pokemon() as unknown as Record<string, unknown> })
  const group = createDefaultGroupInventoryDocument({ slug: 'main', now: 1 })
  group.revision = 4
  group.money = 2_000
  createSqliteGroupInventoryRepository(database).save({ slug: 'main', revision: 4, updatedAt: 1, document: group })
}
const command = (target: 'trainer' | 'groupInventory'): ShopCheckoutLivePlayCommand => {
  const source = target === 'trainer'
    ? { kind: 'trainer' as const, slug: 'ash', revision: 3 }
    : { kind: 'groupInventory' as const, slug: 'main', revision: 4 }
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: target === 'trainer' ? 'op_post_checkout_trainer_01' : 'op_post_checkout_group_001',
    type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
    scopes: [
      { kind: 'shop', shopSlug: 'mart', field: 'purchase' },
      { kind: 'shop', shopSlug: 'mart', field: 'stock' },
      ...(target === 'trainer'
        ? [
            { kind: 'sheet' as const, sheetKind: 'trainer' as const, sheetSlug: 'ash', field: 'money' as const },
            { kind: 'sheet' as const, sheetKind: 'trainer' as const, sheetSlug: 'ash', field: 'inventory' as const },
          ]
        : [
            { kind: 'groupInventory' as const, slug: 'main', field: 'money' as const },
            { kind: 'groupInventory' as const, slug: 'main', field: 'inventory' as const },
          ]),
    ],
    payload: {
      shopSlug: 'mart', shopRevision: 0,
      paymentSource: source,
      deliveryTarget: source,
      lines: [{ entryId: 'potion-sale', quantity: 2 }],
      origin: { kind: 'shopPage' },
    },
  }
}
const actionRequest = (result: ReturnType<typeof executeShopCheckoutCommandUseCase>['result']) => {
  if (!result.ok || 'duplicate' in result || !result.postCheckout) throw new Error('Expected accepted continuation receipt')
  return parseShopPostCheckoutActionRequest({
    schemaVersion: 1,
    shopSlug: result.shopSlug,
    checkoutOperationId: result.opId,
    continuationIds: result.postCheckout.continuations.map(row => row.continuationId),
  })
}

describe('shop post-checkout actions', () => {
  it('reauthorizes an exact Trainer delivery and offers safe inspect, legal use, and move-to-group handoffs', () => {
    const database = open()
    seed(database)
    const checkout = executeShopCheckoutCommandUseCase({
      role: 'player', playerProfile: profile(), command: command('trainer'),
    }, { database, now: () => 100 })
    const projection = loadShopPostCheckoutActionsUseCase({
      role: 'player', playerProfile: profile(), request: actionRequest(checkout.result),
    }, { database, now: () => 101 })

    expect(projection).toMatchObject({ schemaVersion: 1, generatedAt: 101 })
    expect(projection.items).toHaveLength(1)
    expect(projection.items[0]).toMatchObject({
      itemLabel: 'Potion', quantity: 2,
      source: { containerLabel: 'Ash inventory', sectionLabel: 'Medical Kit', rowLabel: 'Row 1' },
    })
    expect(projection.items[0]?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'inspect', enabled: true, href: '/items/Potion' }),
      expect.objectContaining({ kind: 'use', enabled: true, href: expect.stringContaining('inventoryAction=use') }),
      expect.objectContaining({ kind: 'equip', enabled: false, unavailableReason: 'This item is not equipment.' }),
      expect.objectContaining({ kind: 'move-to-group', enabled: true, href: expect.stringContaining('inventoryAction=transfer') }),
    ]))
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toMatch(/potion-sale|profile_post|item-instance|definitionSha256/u)
    expect(serialized).not.toContain(
      createSqliteSheetRepository<Record<string, unknown>>(database)
        .getByRef('trainer', 'ash')!.sheet.inventory.medicalKit[0].id,
    )

    expect(() => loadShopPostCheckoutActionsUseCase({
      role: 'player', playerProfile: profile(false), request: actionRequest(checkout.result),
    }, { database })).toThrow()
  })

  it('offers shared use through an authorised actor and transfer only to current eligible Trainers', () => {
    const database = open()
    seed(database)
    const checkout = executeShopCheckoutCommandUseCase({
      role: 'player', playerProfile: profile(), command: command('groupInventory'),
    }, { database, now: () => 200 })
    const projection = loadShopPostCheckoutActionsUseCase({
      role: 'player', playerProfile: profile(), request: actionRequest(checkout.result),
    }, { database, now: () => 201 })
    expect(projection.items[0]?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'use', enabled: true, href: expect.stringContaining('itemActor=group-item-actor%3Av1%3A') }),
      expect.objectContaining({ kind: 'equip', enabled: false, unavailableReason: expect.stringContaining('Transfer this item') }),
      expect.objectContaining({ kind: 'transfer-to-trainer', enabled: true, href: expect.stringContaining('inventoryAction=transfer') }),
    ]))
    expect(projection.items[0]?.destinationSummary).toContain('Ash')
  })

  it('keeps the accepted receipt but disables handoffs when the exact delivered row has moved', () => {
    const database = open()
    seed(database)
    const checkout = executeShopCheckoutCommandUseCase({ role: 'gm', command: command('trainer') }, { database, now: () => 300 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const stored = sheets.getByRef('trainer', 'ash')!
    sheets.save({
      kind: 'trainer', slug: 'ash', revision: 5, updatedAt: 301,
      document: {
        ...stored.sheet,
        revision: 5,
        updatedAt: 301,
        inventory: { ...stored.sheet.inventory, medicalKit: [] },
      },
    })
    const projection = loadShopPostCheckoutActionsUseCase({
      role: 'gm', request: actionRequest(checkout.result),
    }, { database, now: () => 302 })
    expect(projection.items[0]?.actions.every(action => !action.enabled)).toBe(true)
    expect(projection.items[0]?.actions.find(action => action.kind === 'use')?.unavailableReason)
      .toBe('No current legal use is available.')
  })

  it('does not retarget an accepted continuation when the stable row is repurposed for another item', () => {
    const database = open()
    seed(database)
    const checkout = executeShopCheckoutCommandUseCase({ role: 'gm', command: command('trainer') }, { database, now: () => 350 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const stored = sheets.getByRef('trainer', 'ash')!
    const acceptedRow = (stored.sheet.inventory as TrainerSheet['inventory'])?.medicalKit[0]
    sheets.save({
      kind: 'trainer', slug: 'ash', revision: 5, updatedAt: 351,
      document: {
        ...stored.sheet,
        revision: 5,
        updatedAt: 351,
        inventory: {
          ...stored.sheet.inventory,
          medicalKit: [{ ...acceptedRow, name: 'Antidote' }],
        },
      },
    })
    const projection = loadShopPostCheckoutActionsUseCase({
      role: 'gm', request: actionRequest(checkout.result),
    }, { database, now: () => 352 })
    expect(projection.items[0]?.itemLabel).toBe('Potion')
    expect(projection.items[0]?.actions.every(action => !action.enabled)).toBe(true)
    expect(JSON.stringify(projection)).not.toContain('/items/Antidote')
  })

  it('rejects receipt expansion and older receipts without exact continuation authority', () => {
    const database = open()
    seed(database)
    const checkout = executeShopCheckoutCommandUseCase({ role: 'gm', command: command('trainer') }, { database, now: () => 400 })
    const request = actionRequest(checkout.result)
    expect(() => loadShopPostCheckoutActionsUseCase({
      role: 'gm',
      request: { ...request, continuationIds: ['shop-continuation:v1:ffffffffffffffffffffffffffffffff'] },
    }, { database })).toThrow('does not belong to this accepted receipt')

    if (!checkout.result.ok || 'duplicate' in checkout.result) throw new Error('Expected accepted checkout')
    const historicalResult: Record<string, unknown> = { ...checkout.result }
    delete historicalResult.postCheckout
    database.connection.prepare('UPDATE shop_checkout_ops SET result_json = ? WHERE op_id = ?').run(
      JSON.stringify(historicalResult),
      checkout.result.opId,
    )
    expect(() => loadShopPostCheckoutActionsUseCase({ role: 'gm', request }, { database }))
      .toThrow('older checkout receipt has no exact post-checkout continuation authority')
  })
})
