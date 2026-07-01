import { describe, expect, it } from 'vitest'
import { shopChannel, type RealtimeEvent } from '#shared/realtime'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import { applyShopRealtimeEvent } from '~/utils/shopRealtime'

const makeEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'potion',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 300,
  stock: 5,
  ...overrides,
})

const makeShop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 4,
  updatedAt: 1_700_000_000_000,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [makeEntry()],
  ...overrides,
})

const shopEvent = (shop: ShopTableDocument, overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  channel: shopChannel(shop.slug),
  type: 'updated',
  revision: shop.revision,
  timestamp: 1_700_000_000_100,
  data: { slug: shop.slug, document: shop },
  ...overrides,
})

describe('shop realtime client application', () => {
  it('adopts newer authoritative shop documents from realtime events', () => {
    const current = makeShop({ revision: 4, entries: [makeEntry({ stock: 5 })] })
    const incoming = makeShop({ revision: 5, entries: [makeEntry({ stock: 4 })] })

    expect(applyShopRealtimeEvent(shopEvent(incoming), {
      currentDocument: current,
      expectedSlug: 'viridian-mart',
    })).toEqual({ status: 'adopted', document: incoming })
  })

  it('ignores local echo events and stale revisions', () => {
    const current = makeShop({ revision: 5, entries: [makeEntry({ stock: 4 })] })
    const stale = makeShop({ revision: 4, entries: [makeEntry({ stock: 5 })] })

    expect(applyShopRealtimeEvent(shopEvent(current, { clientId: 'client-a' }), {
      currentDocument: current,
      clientId: 'client-a',
      expectedSlug: 'viridian-mart',
    })).toEqual({ status: 'ignored-echo' })

    expect(applyShopRealtimeEvent(shopEvent(stale), {
      currentDocument: current,
      expectedSlug: 'viridian-mart',
    })).toEqual({ status: 'ignored-stale' })
  })

  it('rejects divergent same-revision shop payloads', () => {
    const current = makeShop({ revision: 5, name: 'Current Mart' })
    const divergent = makeShop({ revision: 5, name: 'Different Mart' })

    expect(applyShopRealtimeEvent(shopEvent(divergent), {
      currentDocument: current,
      expectedSlug: 'viridian-mart',
    })).toEqual({
      status: 'invalid',
      message: 'Shop viridian-mart realtime update diverged at revision 5.',
    })
  })
})
