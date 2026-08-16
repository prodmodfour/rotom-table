import { describe, expect, it } from 'vitest'
import {
  parseShopCheckoutContinuationReceipt,
  parseShopPostCheckoutActionProjection,
  parseShopPostCheckoutActionRequest,
  ShopPostCheckoutValidationError,
} from '../../shared/shopPostCheckout'

const continuation = {
  continuationId: 'shop-continuation:v1:11111111111111111111111111111111',
  itemLabel: 'Potion',
  quantity: 2,
  source: {
    locationKind: 'trainer-inventory',
    containerLabel: 'Ash inventory',
    section: 'medicalKit',
    sectionLabel: 'Medical Kit',
    rowLabel: 'Row 3',
  },
}

describe('shop post-checkout contracts', () => {
  it('strictly parses safe exact-delivery receipts and bounded action projections', () => {
    const receipt = parseShopCheckoutContinuationReceipt({ schemaVersion: 1, continuations: [continuation] })
    expect(receipt.continuations[0]).toEqual(continuation)
    const projection = parseShopPostCheckoutActionProjection({
      schemaVersion: 1,
      generatedAt: 12,
      items: [{
        ...continuation,
        destinationSummary: 'Ash · Body available',
        actions: [{
          actionId: 'shop-post-action:v1:22222222222222222222222222222222',
          kind: 'use',
          label: 'Use now',
          enabled: true,
          unavailableReason: null,
          href: '/sheets/trainers/ash?inventoryAction=use&inventorySource=inventory-source%3Av1%3A33333333333333333333333333333333',
        }],
      }],
    })
    expect(projection.items[0]?.actions[0]).toMatchObject({ kind: 'use', enabled: true })
    expect(Object.isFrozen(projection.items[0]?.actions)).toBe(true)
  })

  it('rejects private identity expansion, malformed availability, and unsupported navigation', () => {
    expect(() => parseShopCheckoutContinuationReceipt({
      schemaVersion: 1,
      continuations: [{ ...continuation, rowId: 'private-row' }],
    })).toThrow(ShopPostCheckoutValidationError)
    expect(() => parseShopPostCheckoutActionProjection({
      schemaVersion: 1,
      generatedAt: 12,
      items: [{
        ...continuation,
        destinationSummary: null,
        actions: [{
          actionId: 'shop-post-action:v1:22222222222222222222222222222222',
          kind: 'use', label: 'Use now', enabled: false,
          unavailableReason: null, href: null,
        }],
      }],
    })).toThrow('must pair enabled state')
    expect(() => parseShopPostCheckoutActionProjection({
      schemaVersion: 1,
      generatedAt: 12,
      items: [{
        ...continuation,
        destinationSummary: null,
        actions: [{
          actionId: 'shop-post-action:v1:22222222222222222222222222222222',
          kind: 'use', label: 'Use now', enabled: true,
          unavailableReason: null, href: 'https://example.invalid',
        }],
      }],
    })).toThrow('app-relative')
  })

  it('binds action loading to one accepted checkout and unique opaque continuations', () => {
    expect(parseShopPostCheckoutActionRequest({
      schemaVersion: 1,
      shopSlug: 'viridian-mart',
      checkoutOperationId: 'op_post_checkout_12345678',
      continuationIds: [continuation.continuationId],
    })).toMatchObject({ shopSlug: 'viridian-mart', continuationIds: [continuation.continuationId] })
    expect(() => parseShopPostCheckoutActionRequest({
      schemaVersion: 1,
      shopSlug: 'viridian-mart',
      checkoutOperationId: 'op_post_checkout_12345678',
      continuationIds: [continuation.continuationId, continuation.continuationId],
    })).toThrow('unique continuation identities')
  })
})
