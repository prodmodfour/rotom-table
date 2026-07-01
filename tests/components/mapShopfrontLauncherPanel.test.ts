/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapShopfrontLauncherPanel from '~/components/map/MapShopfrontLauncherPanel.vue'
import type { MapShopfrontLauncherEntry } from '~/composables/map-editor/useMapShopfrontLauncher'
import type { MapShopInterface } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
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
  position: { x: 1, y: 0, z: 2 },
  interactionRangeMeters: 4,
  ...overrides,
})

const entryFixture = (overrides: Partial<MapShopfrontLauncherEntry> = {}): MapShopfrontLauncherEntry => {
  const shopInterface = overrides.shopInterface ?? interfaceFixture()
  const shop = overrides.shop ?? shopFixture({ slug: shopInterface.shopSlug })
  const origin = overrides.origin ?? {
    kind: 'mapInterface' as const,
    mapSlug: 'market-map',
    interfaceId: shopInterface.id,
    actorPlacementId: 'placement-1',
  }
  return {
    shopInterface,
    shop,
    origin,
    to: overrides.to ?? mapShopfrontPath({
      shopSlug: shop.slug,
      mapSlug: origin.mapSlug,
      interfaceId: origin.interfaceId,
      actorPlacementId: origin.actorPlacementId,
    }),
  }
}

const mountPanel = (entries: readonly MapShopfrontLauncherEntry[], props: Record<string, unknown> = {}) => mount(MapShopfrontLauncherPanel, {
  props: {
    entries,
    status: entries.length > 0 ? 'ready' : 'empty',
    ...props,
  },
  global: {
    stubs: {
      NuxtLink: {
        props: ['to'],
        template: '<a data-testid="nuxt-link" :href="to"><slot /></a>',
      },
    },
  },
})

describe('MapShopfrontLauncherPanel', () => {
  it('renders mapped shopfront links with map-origin route targets', () => {
    const entry = entryFixture()
    const wrapper = mountPanel([entry])

    expect(wrapper.text()).toContain('Potion Counter')
    expect(wrapper.text()).toContain('Viridian Mart')
    expect(wrapper.text()).toContain('Open · Player-visible')
    expect(wrapper.text()).toContain('Position 1, 0, 2')
    expect(wrapper.text()).toContain('Range 4m')
    expect(wrapper.text()).toContain('Actor placement-1')
    expect(wrapper.get('[data-testid="map-shopfront-open"]').attributes('href')).toBe(entry.to)
  })

  it('shows loading, empty, and error states and emits reload', async () => {
    const loading = mountPanel([], { status: 'loading' })
    expect(loading.text()).toContain('Loading mapped shopfronts')
    expect(loading.get('.map-shopfront-launcher__reload').attributes('disabled')).toBeDefined()

    const empty = mountPanel([], { status: 'empty' })
    expect(empty.text()).toContain('No open mapped shops are available')

    const error = mountPanel([], { status: 'error', errorMessage: 'Shop list offline.' })
    expect(error.text()).toContain('Shop list offline.')
    await error.get('.map-shopfront-launcher__reload').trigger('click')
    expect(error.emitted('reload')).toHaveLength(1)
  })
})
