import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { shopChannel, type RealtimeEvent } from '#shared/realtime'
import { useShopfrontPage } from '~/composables/shops/useShopfrontPage'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'

const makeEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'row-1',
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
  description: 'Supplies for careful trainers.',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [makeEntry()],
  ...overrides,
})

const shopUpdatedEvent = (shop: ShopTableDocument, overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  channel: shopChannel(shop.slug),
  type: 'updated',
  revision: shop.revision,
  timestamp: 1_700_000_000_100,
  data: { slug: shop.slug, document: shop },
  ...overrides,
})

const makeApiClient = ({
  expectedSlug = 'viridian-mart',
  loadedShop = makeShop({ slug: expectedSlug }),
  loadError,
}: {
  expectedSlug?: string
  loadedShop?: ShopTableDocument
  loadError?: unknown
} = {}): Pick<ApiClient, 'getJson'> & { getJson: ReturnType<typeof vi.fn> } => {
  const getJson = vi.fn(async (request: string, options?: { params?: Record<string, unknown> }) => {
    expect(request).toBe(SHOP_API_PATHS.load)
    expect(options?.params).toEqual({ slug: expectedSlug })
    if (loadError !== undefined) throw loadError
    return {
      shop: loadedShop,
      revision: loadedShop.revision,
      updatedAt: loadedShop.updatedAt,
    }
  })

  return {
    getJson: getJson as unknown as ApiClient['getJson'] & ReturnType<typeof vi.fn>,
  }
}

describe('useShopfrontPage', () => {
  it('loads an open player-visible shopfront by slug from the shop load API', async () => {
    const loadedShop = makeShop({ revision: 8 })
    const apiClient = makeApiClient({ loadedShop })
    const shopfront = useShopfrontPage({
      slug: ref('viridian-mart'),
      apiClient,
      autoLoadOnMounted: false,
    })

    await expect(shopfront.loadShop()).resolves.toEqual(loadedShop)

    expect(apiClient.getJson).toHaveBeenCalledTimes(1)
    expect(shopfront.shop.value).toEqual(loadedShop)
    expect(shopfront.shop.value).not.toBe(loadedShop)
    expect(shopfront.loadStatus.value).toBe('ready')
    expect(shopfront.loadErrorMessage.value).toBeNull()
  })

  it('allows GM-previewable hidden or closed shops when the load API returns them', async () => {
    const gmPreviewShop = makeShop({
      open: false,
      playerVisible: false,
      name: 'After Hours Counter',
    })
    const apiClient = makeApiClient({ loadedShop: gmPreviewShop })
    const shopfront = useShopfrontPage({
      slug: ref('viridian-mart'),
      apiClient,
      autoLoadOnMounted: false,
    })

    await expect(shopfront.loadShop()).resolves.toEqual(gmPreviewShop)

    expect(shopfront.shop.value).toMatchObject({
      name: 'After Hours Counter',
      open: false,
      playerVisible: false,
    })
    expect(shopfront.loadStatus.value).toBe('ready')
  })

  it('reports closed or hidden player rejections as clear unavailable messages', async () => {
    const apiClient = makeApiClient({
      loadError: { data: { statusMessage: 'Shop is closed' } },
    })
    const shopfront = useShopfrontPage({
      slug: ref('viridian-mart'),
      apiClient,
      autoLoadOnMounted: false,
    })
    shopfront.shop.value = makeShop()

    await expect(shopfront.loadShop()).resolves.toBeNull()

    expect(shopfront.shop.value).toBeNull()
    expect(shopfront.loadStatus.value).toBe('error')
    expect(shopfront.loadErrorMessage.value).toBe('Shop is closed')
  })

  it('does not call the API when no slug is available', async () => {
    const apiClient = makeApiClient()
    const shopfront = useShopfrontPage({
      slug: ref(''),
      apiClient,
      autoLoadOnMounted: false,
    })

    await expect(shopfront.loadShop()).resolves.toBeNull()

    expect(apiClient.getJson).not.toHaveBeenCalled()
    expect(shopfront.shop.value).toBeNull()
    expect(shopfront.loadStatus.value).toBe('error')
    expect(shopfront.loadErrorMessage.value).toBe('No shop slug was provided.')
  })

  it('subscribes to the loaded shop channel and adopts newer non-echo realtime shop updates', () => {
    let subscribedHandler: ((event: RealtimeEvent) => void) | null = null
    const subscribeRealtimeChannel = vi.fn((channel: string, handler: (event: RealtimeEvent) => void) => {
      subscribedHandler = handler
      expect(channel).toBe(shopChannel('viridian-mart'))
      return vi.fn()
    })
    const shopfront = useShopfrontPage({
      slug: ref('viridian-mart'),
      apiClient: makeApiClient(),
      clientId: 'client-a',
      subscribeRealtimeChannel,
      autoLoadOnMounted: false,
    })
    const current = makeShop({ revision: 4, entries: [makeEntry({ stock: 5 })] })
    const incoming = makeShop({ revision: 5, entries: [makeEntry({ stock: 4 })] })
    const stale = makeShop({ revision: 3, entries: [makeEntry({ stock: 9 })] })

    shopfront.shop.value = current
    expect(subscribeRealtimeChannel).toHaveBeenCalledTimes(1)
    expect(subscribedHandler).not.toBeNull()

    subscribedHandler!(shopUpdatedEvent(stale))
    expect(shopfront.shop.value).toEqual(current)

    subscribedHandler!(shopUpdatedEvent(incoming, { clientId: 'client-b' }))
    expect(shopfront.shop.value).toEqual(incoming)
    expect(shopfront.loadStatus.value).toBe('ready')

    subscribedHandler!(shopUpdatedEvent(makeShop({ revision: 6, entries: [makeEntry({ stock: 1 })] }), { clientId: 'client-a' }))
    expect(shopfront.shop.value).toEqual(incoming)
  })
})
