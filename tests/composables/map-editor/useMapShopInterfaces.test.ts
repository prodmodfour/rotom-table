import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMapShopInterfaces } from '~/composables/map-editor/useMapShopInterfaces'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import type { TabletopMap } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'

const shopFixture = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 1,
  updatedAt: 100,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [],
  ...overrides,
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 1,
  slug: 'market-map',
  name: 'Market Map',
  dimensions: { x: 8, y: 2, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  shopInterfaces: [],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  ...overrides,
})

describe('useMapShopInterfaces', () => {
  it('loads GM shop options from the shop list API', async () => {
    const shops = [shopFixture()]
    const apiClient = { getJson: vi.fn().mockResolvedValue({ shops }) }
    const composable = useMapShopInterfaces({
      map: ref(mapFixture()),
      isGm: ref(true),
      setupEditActive: ref(true),
      apiClient,
    })

    await composable.loadShopOptions()

    expect(apiClient.getJson).toHaveBeenCalledWith(SHOP_API_PATHS.list)
    expect(composable.shopOptions.value).toEqual(shops)
    expect(composable.shopListStatus.value).toBe('ready')
  })

  it('adds and removes a normalized shop interface when the GM is in setup/edit mode', async () => {
    const shops = [shopFixture({ slug: 'celadon-dept-store', name: 'Celadon Dept. Store' })]
    const map = ref(mapFixture())
    const composable = useMapShopInterfaces({
      map,
      isGm: ref(true),
      setupEditActive: ref(true),
      apiClient: { getJson: vi.fn().mockResolvedValue({ shops }) },
    })
    await composable.loadShopOptions()

    const created = composable.addShopInterface('celadon-dept-store')

    expect(created).toMatchObject({
      id: 'map-shop-interface-1',
      shopSlug: 'celadon-dept-store',
      label: 'Celadon Dept. Store',
      playerVisible: false,
    })
    expect(map.value.shopInterfaces).toEqual([created])

    composable.removeShopInterface(created!.id)

    expect(map.value.shopInterfaces).toEqual([])
  })

  it('edits the referenced shop, label, position, range, and player visibility', async () => {
    const shops = [
      shopFixture({ slug: 'viridian-mart', name: 'Viridian Mart' }),
      shopFixture({ slug: 'pewter-market', name: 'Pewter Market' }),
    ]
    const map = ref(mapFixture({
      shopInterfaces: [{ id: 'counter-a', shopSlug: 'viridian-mart', label: 'Viridian Mart' }],
    }))
    const composable = useMapShopInterfaces({
      map,
      isGm: ref(true),
      setupEditActive: ref(true),
      apiClient: { getJson: vi.fn().mockResolvedValue({ shops }) },
    })
    await composable.loadShopOptions()

    composable.updateShopInterface('counter-a', {
      shopSlug: 'pewter-market',
      label: '  Fossil Desk  ',
      position: { x: 1.5, y: 0, z: 3 },
      interactionRangeMeters: 4.25,
      playerVisible: true,
    })

    expect(map.value.shopInterfaces).toEqual([{
      id: 'counter-a',
      shopSlug: 'pewter-market',
      label: 'Fossil Desk',
      position: { x: 1.5, y: 0, z: 3 },
      interactionRangeMeters: 4.25,
      playerVisible: true,
    }])

    composable.updateShopInterface('counter-a', {
      position: null,
      interactionRangeMeters: null,
      playerVisible: false,
    })

    expect(map.value.shopInterfaces).toEqual([{
      id: 'counter-a',
      shopSlug: 'pewter-market',
      label: 'Fossil Desk',
      playerVisible: false,
    }])
  })

  it('does not mutate interfaces for player users or outside setup/edit mode', async () => {
    const shops = [shopFixture()]
    const playerMap = ref(mapFixture())
    const playerComposable = useMapShopInterfaces({
      map: playerMap,
      isGm: ref(false),
      setupEditActive: ref(true),
      apiClient: { getJson: vi.fn().mockResolvedValue({ shops }) },
    })

    await playerComposable.loadShopOptions()
    expect(playerComposable.shopOptions.value).toEqual([])
    expect(playerComposable.addShopInterface('viridian-mart')).toBeNull()
    expect(playerMap.value.shopInterfaces).toEqual([])

    const livePlayMap = ref(mapFixture({
      shopInterfaces: [{ id: 'counter-a', shopSlug: 'viridian-mart', label: 'Viridian Mart' }],
    }))
    const livePlayComposable = useMapShopInterfaces({
      map: livePlayMap,
      isGm: ref(true),
      setupEditActive: ref(false),
      apiClient: { getJson: vi.fn().mockResolvedValue({ shops }) },
    })
    await livePlayComposable.loadShopOptions()

    livePlayComposable.updateShopInterface('counter-a', { label: 'Changed' })
    livePlayComposable.removeShopInterface('counter-a')

    expect(livePlayMap.value.shopInterfaces).toEqual([
      { id: 'counter-a', shopSlug: 'viridian-mart', label: 'Viridian Mart' },
    ])
  })
})
