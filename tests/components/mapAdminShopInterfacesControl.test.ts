/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapAdminShopInterfacesControl from '~/components/map/MapAdminShopInterfacesControl.vue'
import type { MapShopInterface } from '~/types/map'
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

const interfaceFixture = (overrides: Partial<MapShopInterface> = {}): MapShopInterface => ({
  id: 'counter-a',
  shopSlug: 'viridian-mart',
  label: 'Potion Counter',
  playerVisible: false,
  ...overrides,
})

const shops = [
  shopFixture({ slug: 'viridian-mart', name: 'Viridian Mart', open: true, playerVisible: true }),
  shopFixture({ slug: 'pewter-market', name: 'Pewter Market', open: false, playerVisible: false }),
]

describe('MapAdminShopInterfacesControl', () => {
  it('emits add with the selected existing shop table', async () => {
    const wrapper = mount(MapAdminShopInterfacesControl, {
      props: {
        interfaces: [],
        shops,
        shopListStatus: 'ready',
      },
    })

    await wrapper.get('[data-testid="map-shop-interface-add-select"]').setValue('pewter-market')
    await wrapper.get('[data-testid="map-shop-interface-add"]').trigger('click')

    expect(wrapper.emitted('add-shop-interface')).toEqual([['pewter-market']])
  })

  it('emits remove and field edit patches for an existing interface', async () => {
    const wrapper = mount(MapAdminShopInterfacesControl, {
      props: {
        interfaces: [interfaceFixture({ position: { x: 1, y: 0, z: 2 }, interactionRangeMeters: 3 })],
        shops,
        shopListStatus: 'ready',
      },
    })

    await wrapper.get('[data-testid="map-shop-interface-shop"]').setValue('pewter-market')
    await wrapper.get('[data-testid="map-shop-interface-label"]').setValue('  Back Counter  ')
    await wrapper.get('[data-testid="map-shop-interface-visible"]').setValue(true)
    await wrapper.get('[data-testid="map-shop-interface-position-x"]').setValue('4.5')
    await wrapper.get('[data-testid="map-shop-interface-range"]').setValue('6.25')
    await wrapper.get('[data-testid="map-shop-interface-remove"]').trigger('click')

    expect(wrapper.emitted('update-shop-interface')).toEqual([
      ['counter-a', { shopSlug: 'pewter-market' }],
      ['counter-a', { label: '  Back Counter  ' }],
      ['counter-a', { playerVisible: true }],
      ['counter-a', { position: { x: 4.5, y: 0, z: 2 } }],
      ['counter-a', { interactionRangeMeters: 6.25 }],
    ])
    expect(wrapper.emitted('remove-shop-interface')).toEqual([['counter-a']])
  })

  it('clears optional position/range fields and supports reloading shop options', async () => {
    const wrapper = mount(MapAdminShopInterfacesControl, {
      props: {
        interfaces: [interfaceFixture({ position: { x: 1, y: 0, z: 2 }, interactionRangeMeters: 3 })],
        shops,
        shopListStatus: 'error',
        shopListError: 'Failed to load shops.',
      },
    })

    expect(wrapper.text()).toContain('Failed to load shops.')

    await wrapper.get('.shop-interfaces-control__reload').trigger('click')
    await wrapper.get('[data-testid="map-shop-interface-position-x"]').setValue('')
    await wrapper.get('[data-testid="map-shop-interface-range"]').setValue('')

    expect(wrapper.emitted('reload-shops')).toHaveLength(1)
    expect(wrapper.emitted('update-shop-interface')).toEqual([
      ['counter-a', { position: null }],
      ['counter-a', { interactionRangeMeters: null }],
    ])
  })

  it('disables mutation controls when the GM is not in setup/edit mode', async () => {
    const wrapper = mount(MapAdminShopInterfacesControl, {
      props: {
        interfaces: [interfaceFixture()],
        shops,
        shopListStatus: 'ready',
        disabled: true,
      },
    })

    expect(wrapper.text()).toContain('Switch to Prepare Map mode')
    expect(wrapper.get('[data-testid="map-shop-interface-add"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="map-shop-interface-shop"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="map-shop-interface-remove"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="map-shop-interface-add"]').trigger('click')
    await wrapper.get('[data-testid="map-shop-interface-remove"]').trigger('click')

    expect(wrapper.emitted('add-shop-interface')).toBeUndefined()
    expect(wrapper.emitted('remove-shop-interface')).toBeUndefined()
  })
})
