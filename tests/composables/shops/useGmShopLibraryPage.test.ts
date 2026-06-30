import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useGmShopLibraryPage } from '~/composables/shops/useGmShopLibraryPage'
import type { ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { shopEditorPath } from '~/utils/shopRoutes'

const makeShop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'open-shop',
  revision: 0,
  updatedAt: 1_000,
  name: 'Open Shop',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [],
  ...overrides,
})

const makeApiClient = ({
  shops = [],
  createdShop = makeShop({ slug: 'created-shop', name: 'Created Shop' }),
  listError,
  createError,
}: {
  shops?: readonly ShopTableDocument[]
  createdShop?: ShopTableDocument
  listError?: unknown
  createError?: unknown
} = {}): Pick<ApiClient, 'getJson' | 'postJson'> & {
  getJson: ReturnType<typeof vi.fn>
  postJson: ReturnType<typeof vi.fn>
} => {
  const getJson = vi.fn(async (request: string) => {
    expect(request).toBe(SHOP_API_PATHS.list)
    if (listError !== undefined) throw listError
    return { shops }
  })
  const postJson = vi.fn(async (request: string) => {
    expect(request).toBe(SHOP_API_PATHS.create)
    if (createError !== undefined) throw createError
    return { ok: true, shop: createdShop }
  })

  return {
    getJson: getJson as unknown as ApiClient['getJson'] & ReturnType<typeof vi.fn>,
    postJson: postJson as unknown as ApiClient['postJson'] & ReturnType<typeof vi.fn>,
  }
}

describe('useGmShopLibraryPage', () => {
  it('loads an empty GM shop library without exposing an error', async () => {
    const apiClient = makeApiClient({ shops: [] })
    const library = useGmShopLibraryPage({
      isGm: ref(true),
      apiClient,
      clientId: 'client-a',
      pushRoute: vi.fn(),
      autoLoadOnMounted: false,
    })

    await expect(library.loadGmShops()).resolves.toEqual([])

    expect(apiClient.getJson).toHaveBeenCalledTimes(1)
    expect(library.shops.value).toEqual([])
    expect(library.status.value).toBe('empty')
    expect(library.loadErrorMessage.value).toBeNull()
  })

  it('loads every GM shop returned by the API, including closed and hidden shops', async () => {
    const openShop = makeShop({ slug: 'open-shop', open: true, playerVisible: true })
    const hiddenShop = makeShop({ slug: 'hidden-shop', open: true, playerVisible: false })
    const closedShop = makeShop({ slug: 'closed-shop', open: false, playerVisible: true })
    const apiClient = makeApiClient({ shops: [closedShop, hiddenShop, openShop] })
    const library = useGmShopLibraryPage({
      isGm: ref(true),
      apiClient,
      clientId: 'client-a',
      pushRoute: vi.fn(),
      autoLoadOnMounted: false,
    })

    await library.loadGmShops()

    expect(library.status.value).toBe('ready')
    expect(library.shops.value.map((shop) => shop.slug)).toEqual([
      'closed-shop',
      'hidden-shop',
      'open-shop',
    ])
  })

  it('creates a normalized shop through the create route and navigates to the GM editor', async () => {
    const createdShop = makeShop({ slug: 'new-shop', name: 'New Shop', open: false, playerVisible: false })
    const apiClient = makeApiClient({ createdShop })
    const pushRoute = vi.fn()
    const library = useGmShopLibraryPage({
      isGm: ref(true),
      apiClient,
      clientId: 'client-a',
      pushRoute,
      autoLoadOnMounted: false,
    })

    await expect(library.createShop()).resolves.toEqual(createdShop)

    expect(apiClient.postJson).toHaveBeenCalledWith(SHOP_API_PATHS.create, {
      baseSlug: 'shop',
      name: 'New Shop',
      clientId: 'client-a',
    })
    expect(library.shops.value[0]).toEqual(createdShop)
    expect(library.status.value).toBe('ready')
    expect(pushRoute).toHaveBeenCalledWith(shopEditorPath('new-shop'))
    expect(library.createErrorMessage.value).toBeNull()
    expect(library.createStatus.value).toBe('idle')
  })

  it('normalizes create errors and leaves the GM on the library page', async () => {
    const apiClient = makeApiClient({
      createError: { data: { statusMessage: 'Cannot create shop.' } },
    })
    const pushRoute = vi.fn()
    const library = useGmShopLibraryPage({
      isGm: ref(true),
      apiClient,
      clientId: 'client-a',
      pushRoute,
      autoLoadOnMounted: false,
    })

    await expect(library.createShop()).resolves.toBeNull()

    expect(apiClient.postJson).toHaveBeenCalledTimes(1)
    expect(pushRoute).not.toHaveBeenCalled()
    expect(library.createErrorMessage.value).toBe('Cannot create shop.')
    expect(library.createStatus.value).toBe('idle')
  })

  it('does not load or create shops for non-GM users', async () => {
    const apiClient = makeApiClient({ shops: [makeShop()] })
    const library = useGmShopLibraryPage({
      isGm: ref(false),
      apiClient,
      clientId: 'client-a',
      pushRoute: vi.fn(),
      autoLoadOnMounted: false,
    })

    await expect(library.loadGmShops()).resolves.toEqual([])
    await expect(library.createShop()).resolves.toBeNull()

    expect(apiClient.getJson).not.toHaveBeenCalled()
    expect(apiClient.postJson).not.toHaveBeenCalled()
    expect(library.status.value).toBe('empty')
  })
})
