import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMapShopfrontLauncher } from '~/composables/map-editor/useMapShopfrontLauncher'
import type { MapShopInterface } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import { mapShopfrontPath } from '~/utils/shopRoutes'

const shopFixture = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 1,
  updatedAt: 1_000,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [],
  ...overrides,
})

const interfaceFixture = (overrides: Partial<MapShopInterface> = {}): MapShopInterface => ({
  id: 'counter-a',
  shopSlug: 'viridian-mart',
  label: 'Potion Counter',
  playerVisible: true,
  ...overrides,
})

const apiClientFor = (shops: readonly ShopTableDocument[]): Pick<ApiClient, 'getJson'> & {
  readonly getJson: ReturnType<typeof vi.fn>
} => ({
  getJson: vi.fn(async (path: string) => {
    expect(path).toBe(SHOP_API_PATHS.list)
    return { shops }
  }) as unknown as ApiClient['getJson'] & ReturnType<typeof vi.fn>,
})

describe('useMapShopfrontLauncher', () => {
  it('offers players only map-visible interfaces that reference open player-visible shops', async () => {
    const apiClient = apiClientFor([
      shopFixture({ slug: 'viridian-mart', name: 'Viridian Mart', open: true, playerVisible: true }),
      shopFixture({ slug: 'closed-shop', name: 'Closed Shop', open: false, playerVisible: true }),
      shopFixture({ slug: 'hidden-shop', name: 'Hidden Shop', open: true, playerVisible: false }),
    ])
    const launcher = useMapShopfrontLauncher({
      mapSlug: ref('market-map'),
      shopInterfaces: ref([
        interfaceFixture({ id: 'counter-a', shopSlug: 'viridian-mart', label: 'Potion Counter', playerVisible: true }),
        interfaceFixture({ id: 'counter-b', shopSlug: 'closed-shop', label: 'Closed Counter', playerVisible: true }),
        interfaceFixture({ id: 'counter-c', shopSlug: 'hidden-shop', label: 'Hidden Counter', playerVisible: true }),
        interfaceFixture({ id: 'counter-d', shopSlug: 'viridian-mart', label: 'Private Counter', playerVisible: false }),
      ]),
      isGm: ref(false),
      isPlayer: ref(true),
      actorPlacementId: ref('placement-1'),
      apiClient,
      autoLoadOnMounted: false,
    })

    await launcher.loadShopfrontOptions()

    expect(launcher.status.value).toBe('ready')
    expect(launcher.entries.value).toHaveLength(1)
    expect(launcher.entries.value[0]).toMatchObject({
      shopInterface: { id: 'counter-a', label: 'Potion Counter' },
      shop: { slug: 'viridian-mart' },
      origin: {
        kind: 'mapInterface',
        mapSlug: 'market-map',
        interfaceId: 'counter-a',
        actorPlacementId: 'placement-1',
      },
      to: mapShopfrontPath({
        shopSlug: 'viridian-mart',
        mapSlug: 'market-map',
        interfaceId: 'counter-a',
        actorPlacementId: 'placement-1',
      }),
    })
  })

  it('lets GMs preview mapped shop interfaces regardless of shop open or player visibility state', async () => {
    const apiClient = apiClientFor([
      shopFixture({ slug: 'closed-shop', name: 'Closed Shop', open: false, playerVisible: false }),
      shopFixture({ slug: 'hidden-shop', name: 'Hidden Shop', open: true, playerVisible: false }),
    ])
    const launcher = useMapShopfrontLauncher({
      mapSlug: ref('market-map'),
      shopInterfaces: ref([
        interfaceFixture({ id: 'closed-counter', shopSlug: 'closed-shop', label: 'Closed Counter', playerVisible: false }),
        interfaceFixture({ id: 'hidden-counter', shopSlug: 'hidden-shop', label: 'Hidden Counter', playerVisible: false }),
      ]),
      isGm: ref(true),
      isPlayer: ref(false),
      apiClient,
      autoLoadOnMounted: false,
    })

    await launcher.loadShopfrontOptions()

    expect(launcher.status.value).toBe('ready')
    expect(launcher.entries.value.map((entry) => entry.shopInterface.id)).toEqual(['closed-counter', 'hidden-counter'])
    expect(launcher.entries.value[0]?.to).toBe(mapShopfrontPath({
      shopSlug: 'closed-shop',
      mapSlug: 'market-map',
      interfaceId: 'closed-counter',
    }))
  })

  it('stays idle for guests and reports load failures clearly', async () => {
    const guestApiClient = apiClientFor([shopFixture()])
    const guestLauncher = useMapShopfrontLauncher({
      mapSlug: ref('market-map'),
      shopInterfaces: ref([interfaceFixture()]),
      isGm: ref(false),
      isPlayer: ref(false),
      apiClient: guestApiClient,
      autoLoadOnMounted: false,
    })

    await guestLauncher.loadShopfrontOptions()

    expect(guestApiClient.getJson).not.toHaveBeenCalled()
    expect(guestLauncher.status.value).toBe('idle')
    expect(guestLauncher.entries.value).toEqual([])

    const failingApiClient: Pick<ApiClient, 'getJson'> = {
      getJson: vi.fn(async () => { throw new Error('shop list offline') }) as unknown as ApiClient['getJson'],
    }
    const playerLauncher = useMapShopfrontLauncher({
      mapSlug: ref('market-map'),
      shopInterfaces: ref([interfaceFixture()]),
      isGm: ref(false),
      isPlayer: ref(true),
      apiClient: failingApiClient,
      autoLoadOnMounted: false,
    })

    await playerLauncher.loadShopfrontOptions()

    expect(playerLauncher.status.value).toBe('error')
    expect(playerLauncher.errorMessage.value).toBe('shop list offline')
    expect(playerLauncher.entries.value).toEqual([])
  })
})
