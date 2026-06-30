/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ShopLibraryCard from '~/components/shops/ShopLibraryCard.vue'
import type { ShopTableDocument } from '~/types/shop'
import { shopEditorPath } from '~/utils/shopRoutes'

const makeShop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'mart-counter',
  revision: 3,
  updatedAt: 1_000,
  name: 'Mart Counter',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [
    { id: 'potion', itemName: 'Potion', section: 'medicalKit', price: 300, stock: 5 },
    { id: 'rope', itemName: 'Escape Rope', section: 'equipment', price: 550, stock: null },
  ],
  ...overrides,
})

const mountCard = (shop: ShopTableDocument) => mount(ShopLibraryCard, {
  props: { shop },
  global: {
    stubs: {
      NuxtLink: {
        props: ['to'],
        template: '<a data-testid="nuxt-link" :href="to"><slot /></a>',
      },
    },
  },
})

describe('ShopLibraryCard', () => {
  it('renders shop name, slug, badges, entry count, updated time, and editor link', () => {
    const wrapper = mountCard(makeShop())

    expect(wrapper.text()).toContain('Mart Counter')
    expect(wrapper.text()).toContain('mart-counter')
    expect(wrapper.text()).toContain('Open')
    expect(wrapper.text()).toContain('Player visible')
    expect(wrapper.text()).toContain('2 entries')
    expect(wrapper.text()).toContain('1970-01-01 00:00:01 UTC')
    expect(wrapper.find('time').attributes('datetime')).toBe('1970-01-01T00:00:01.000Z')
    expect(wrapper.get('[data-testid="nuxt-link"]').attributes('href')).toBe(shopEditorPath('mart-counter'))
  })

  it('renders closed and hidden badges for private setup shops', () => {
    const wrapper = mountCard(makeShop({ open: false, playerVisible: false, entries: [] }))

    expect(wrapper.text()).toContain('Closed')
    expect(wrapper.text()).toContain('Hidden')
    expect(wrapper.text()).toContain('0 entries')
  })
})
