import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  LivePlayCommandRejectionError,
} from '~~/server/livePlay/commandExecutor'
import {
  parseShopCheckoutLivePlayCommand,
} from '~~/server/livePlay/shopCheckoutCommandParser'

const trainerToGroupCommand = (
  overrides: Partial<ShopCheckoutLivePlayCommand> = {},
): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopparse001',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
    { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 7,
    paymentSource: { kind: 'trainer', slug: 'ash', revision: 3 },
    deliveryTarget: { kind: 'groupInventory', slug: 'party-bag', revision: 5 },
    lines: [{ entryId: 'potion-row', quantity: 2 }],
    origin: { kind: 'shopPage' },
  },
  ...overrides,
})

const groupToTrainerCommand = (): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_shopparse002',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'groupInventory', slug: 'party-funds', field: 'money' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart',
    shopRevision: 7,
    paymentSource: { kind: 'groupInventory', slug: 'party-funds', revision: 4 },
    deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 3 },
    lines: [{ entryId: 'potion-row', quantity: 1 }],
    origin: {
      kind: 'mapInterface',
      mapSlug: 'route-1',
      interfaceId: 'counter-1',
      actorPlacementId: 'ash-token',
    },
  },
})

const expectInvalidCheckoutCommand = (candidate: unknown, message: string): void => {
  try {
    parseShopCheckoutLivePlayCommand(candidate)
  } catch (error) {
    expect(error).toBeInstanceOf(LivePlayCommandRejectionError)
    expect((error as LivePlayCommandRejectionError).reason).toBe('invalid')
    expect((error as LivePlayCommandRejectionError).message).toContain(message)
    return
  }

  throw new Error('Expected shop checkout command validation to reject the candidate')
}

describe('shop checkout live-play command parser', () => {
  it('accepts valid checkout commands and their expected payment and delivery scopes', () => {
    const trainerPaymentGroupDelivery = trainerToGroupCommand()
    const groupPaymentTrainerDelivery = groupToTrainerCommand()

    expect(parseShopCheckoutLivePlayCommand(trainerPaymentGroupDelivery)).toBe(trainerPaymentGroupDelivery)
    expect(parseShopCheckoutLivePlayCommand(groupPaymentTrainerDelivery)).toBe(groupPaymentTrainerDelivery)
  })

  it('rejects commands missing the required shop stock or purchase scope', () => {
    const missingStockScope = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
        { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
      ],
    })
    const missingPurchaseScope = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
        { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
      ],
    })

    expectInvalidCheckoutCommand(missingStockScope, 'shop:viridian-mart:stock')
    expectInvalidCheckoutCommand(missingPurchaseScope, 'shop:viridian-mart:purchase')
  })

  it('rejects commands missing the required payment source scope', () => {
    const command = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
        { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
      ],
    })

    expectInvalidCheckoutCommand(command, 'sheet:trainer:ash:money')
  })

  it('rejects commands missing the required delivery target scope', () => {
    const command = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
      ],
    })

    expectInvalidCheckoutCommand(command, 'groupInventory:party-bag:inventory')
  })

  it('rejects extra validly-shaped scopes that do not match the payload resources', () => {
    const wrongTrainerScope = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
        { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'misty', field: 'money' },
      ],
    })
    const wrongShopScope = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'other-shop', field: 'purchase' },
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
        { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
      ],
    })

    expectInvalidCheckoutCommand(wrongTrainerScope, 'sheet:trainer:misty:money does not match this checkout payload')
    expectInvalidCheckoutCommand(wrongShopScope, 'shop:other-shop:purchase does not match this checkout payload')
  })

  it('rejects malformed envelope scopes before checkout-specific validation', () => {
    const command = trainerToGroupCommand({
      scopes: [
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
        { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
        { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
        { kind: 'map', lane: 'metadata' } as unknown as ShopCheckoutLivePlayCommand['scopes'][number],
      ],
    })

    expectInvalidCheckoutCommand(command, 'Invalid shop checkout live-play command envelope')
  })

  it('rejects invalid checkout line quantities', () => {
    const command = trainerToGroupCommand({
      payload: {
        ...trainerToGroupCommand().payload,
        lines: [{ entryId: 'potion-row', quantity: 0 }],
      },
    })

    expectInvalidCheckoutCommand(command, 'payload.lines[0].quantity')
  })

  it('rejects invalid checkout line entry IDs', () => {
    const command = trainerToGroupCommand({
      payload: {
        ...trainerToGroupCommand().payload,
        lines: [{ entryId: '   ', quantity: 1 }],
      },
    })

    expectInvalidCheckoutCommand(command, 'payload.lines[0].entryId')
  })

  it('rejects malformed checkout origins', () => {
    const command = trainerToGroupCommand({
      payload: {
        ...trainerToGroupCommand().payload,
        origin: { kind: 'mapInterface', mapSlug: 'route-1' } as unknown as ShopCheckoutLivePlayCommand['payload']['origin'],
      },
    })

    expectInvalidCheckoutCommand(command, 'payload.origin.interfaceId')
  })
})
