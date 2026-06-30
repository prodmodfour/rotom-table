import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePlayerShopLibraryPage } from '~/composables/shops/usePlayerShopLibraryPage'
import type { ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'

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
  listError,
}: {
  shops?: readonly ShopTableDocument[]
  listError?: unknown
} = {}): Pick<ApiClient, 'getJson'> & { getJson: ReturnType<typeof vi.fn> } => {
  const getJson = vi.fn(async (request: string) => {
    expect(request).toBe(SHOP_API_PATHS.list)
    if (listError !== undefined) throw listError
    return { shops }
  })

  return {
    getJson: getJson as unknown as ApiClient['getJson'] & ReturnType<typeof vi.fn>,
  }
}

describe('usePlayerShopLibraryPage', () => {
  it('loads only open player-visible shops from the player list response', async () => {
    const openShop = makeShop({ slug: 'open-shop', open: true, playerVisible: true })
    const hiddenShop = makeShop({ slug: 'hidden-shop', open: true, playerVisible: false })
    const closedShop = makeShop({ slug: 'closed-shop', open: false, playerVisible: true })
    const privateShop = makeShop({ slug: 'private-shop', open: false, playerVisible: false })
    const apiClient = makeApiClient({ shops: [hiddenShop, openShop, closedShop, privateShop] })
    const library = usePlayerShopLibraryPage({
      isEnabled: ref(true),
      apiClient,
      autoLoadOnMounted: false,
    })

    await expect(library.loadPlayerShops()).resolves.toEqual([openShop])

    expect(apiClient.getJson).toHaveBeenCalledTimes(1)
    expect(library.status.value).toBe('ready')
    expect(library.shops.value.map((shop) => shop.slug)).toEqual(['open-shop'])
    expect(library.loadErrorMessage.value).toBeNull()
  })

  it('shows the empty state when no open player-visible shops are returned', async () => {
    const apiClient = makeApiClient({
      shops: [
        makeShop({ slug: 'hidden-shop', open: true, playerVisible: false }),
        makeShop({ slug: 'closed-shop', open: false, playerVisible: true }),
      ],
    })
    const library = usePlayerShopLibraryPage({
      isEnabled: ref(true),
      apiClient,
      autoLoadOnMounted: false,
    })

    await expect(library.loadPlayerShops()).resolves.toEqual([])

    expect(library.shops.value).toEqual([])
    expect(library.status.value).toBe('empty')
    expect(library.loadErrorMessage.value).toBeNull()
  })

  it('normalizes list errors and clears stale player shop results', async () => {
    const apiClient = makeApiClient({ listError: { data: { statusMessage: 'Cannot load shops.' } } })
    const library = usePlayerShopLibraryPage({
      isEnabled: ref(true),
      apiClient,
      autoLoadOnMounted: false,
    })
    library.shops.value = [makeShop()]

    await expect(library.loadPlayerShops()).resolves.toEqual([])

    expect(library.shops.value).toEqual([])
    expect(library.status.value).toBe('error')
    expect(library.loadErrorMessage.value).toBe('Cannot load shops.')
  })

  it('does not request the player shop list while the player library is disabled', async () => {
    const apiClient = makeApiClient({ shops: [makeShop()] })
    const library = usePlayerShopLibraryPage({
      isEnabled: ref(false),
      apiClient,
      autoLoadOnMounted: false,
    })

    await expect(library.loadPlayerShops()).resolves.toEqual([])

    expect(apiClient.getJson).not.toHaveBeenCalled()
    expect(library.shops.value).toEqual([])
    expect(library.status.value).toBe('empty')
    expect(library.loadErrorMessage.value).toBeNull()
  })
})
