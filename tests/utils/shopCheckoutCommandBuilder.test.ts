import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  isValidShopCheckoutCommandEnvelope,
} from '#shared/livePlayCommands'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import {
  ShopCheckoutCommandBuildError,
  buildShopCheckoutCommand,
  createShopCheckoutOpId,
  type BuildShopCheckoutCommandInput,
} from '~/utils/shopCheckoutCommandBuilder'

const baseInput = (overrides: Partial<BuildShopCheckoutCommandInput> = {}): BuildShopCheckoutCommandInput => ({
  shopSlug: 'viridian-mart',
  shopRevision: 7,
  paymentSource: { kind: 'trainer', slug: 'ash', revision: 3 },
  deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 3 },
  lines: [{ entryId: 'potion-row', quantity: 2 }],
  clientId: 'client-1',
  opId: 'op_builder001',
  ...overrides,
})

const expectBuildError = (
  action: () => unknown,
  code: ShopCheckoutCommandBuildError['code'],
): void => {
  expect(action).toThrow(ShopCheckoutCommandBuildError)
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(ShopCheckoutCommandBuildError)
    expect((error as ShopCheckoutCommandBuildError).code).toBe(code)
  }
}

describe('shop checkout command builder', () => {
  it('creates valid checkout operation IDs', () => {
    expect(createShopCheckoutOpId(() => '123e4567-e89b-12d3-a456-426614174000'))
      .toBe('op_123e4567-e89b-12d3-a456-426614174000')
  })

  it('builds group payment and group delivery scopes for a shop-page checkout command', () => {
    const command = buildShopCheckoutCommand(baseInput({
      opId: 'op_groupboth01',
      paymentSource: { kind: 'groupInventory', slug: 'party-bag', revision: 4 },
      deliveryTarget: { kind: 'groupInventory', slug: 'party-bag', revision: 5 },
      lines: [{ entryId: ' potion-row ', quantity: 1 }],
    }))

    expect(command).toMatchObject({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_groupboth01',
      type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      clientId: 'client-1',
      payload: {
        shopSlug: 'viridian-mart',
        shopRevision: 7,
        paymentSource: { kind: 'groupInventory', slug: 'party-bag', revision: 4 },
        deliveryTarget: { kind: 'groupInventory', slug: 'party-bag', revision: 5 },
        lines: [{ entryId: 'potion-row', quantity: 1 }],
        origin: { kind: 'shopPage' },
      },
    })
    expect(command.scopes).toEqual([
      { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
      { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
      { kind: 'groupInventory', slug: 'party-bag', field: 'money' },
      { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
    ])
    expect(isValidShopCheckoutCommandEnvelope(command)).toBe(true)
  })

  it('builds trainer payment and trainer delivery scopes without a player profile for GM-style checkout', () => {
    const command = buildShopCheckoutCommand(baseInput({
      opId: 'op_trainers01',
      paymentSource: { kind: 'trainer', slug: 'ash', revision: 3 },
      deliveryTarget: { kind: 'trainer', slug: 'misty', revision: 9 },
    }))

    expect(command.scopes).toEqual([
      { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
      { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
      { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
      { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'misty', field: 'inventory' },
    ])
    expect(command.profileId).toBeUndefined()
    expect(isValidShopCheckoutCommandEnvelope(command)).toBe(true)
  })

  it('builds mixed group/trainer scopes and includes the selected player profile ID', () => {
    const profileId = parsePlayerProfileId('profile_ash00000')
    const command = buildShopCheckoutCommand(baseInput({
      opId: 'op_mixedscope1',
      paymentSource: { kind: 'groupInventory', slug: 'party-bag', revision: 4 },
      deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 3 },
      profileId,
    }))

    expect(command.scopes).toEqual([
      { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
      { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
      { kind: 'groupInventory', slug: 'party-bag', field: 'money' },
      { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
    ])
    expect(command.profileId).toBe(profileId)
    expect(isValidShopCheckoutCommandEnvelope(command)).toBe(true)
  })

  it('builds map-interface origin payloads for map-launched checkout', () => {
    const command = buildShopCheckoutCommand(baseInput({
      opId: 'op_maporigin01',
      origin: {
        kind: 'mapInterface',
        mapSlug: 'market-map',
        interfaceId: 'counter-a',
        actorPlacementId: 'placement-1',
      },
    }))

    expect(command.payload.origin).toEqual({
      kind: 'mapInterface',
      mapSlug: 'market-map',
      interfaceId: 'counter-a',
      actorPlacementId: 'placement-1',
    })
    expect(isValidShopCheckoutCommandEnvelope(command)).toBe(true)
  })

  it('rejects malformed map-interface checkout origins before dispatch', () => {
    expectBuildError(() => buildShopCheckoutCommand(baseInput({
      origin: { kind: 'mapInterface', mapSlug: 'not valid', interfaceId: 'counter-a' },
    })), 'invalid-origin')
    expectBuildError(() => buildShopCheckoutCommand(baseInput({
      origin: { kind: 'mapInterface', mapSlug: 'market-map', interfaceId: '  ' },
    })), 'invalid-origin')
  })

  it('rejects an empty cart before dispatch', () => {
    expectBuildError(() => buildShopCheckoutCommand(baseInput({ lines: [] })), 'empty-cart')
  })

  it('rejects invalid cart quantities before dispatch', () => {
    expectBuildError(() => buildShopCheckoutCommand(baseInput({
      lines: [{ entryId: 'potion-row', quantity: 0 }],
    })), 'invalid-quantity')
    expectBuildError(() => buildShopCheckoutCommand(baseInput({
      lines: [{ entryId: 'potion-row', quantity: 1.5 }],
    })), 'invalid-quantity')
  })
})
