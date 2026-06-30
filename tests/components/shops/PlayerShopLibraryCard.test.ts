/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlayerShopLibraryCard from '~/components/shops/PlayerShopLibraryCard.vue'
import type { ShopTableDocument } from '~/types/shop'
import { shopfrontPath } from '~/utils/shopRoutes'

const makeShop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'mart-counter',
  revision: 3,
  updatedAt: 1_000,
  name: 'Mart Counter',
  description: 'A friendly counter stocked for nearby trainers.',
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

const mountCard = (shop: ShopTableDocument) => mount(PlayerShopLibraryCard, {
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

describe('PlayerShopLibraryCard', () => {
  it('renders public shop details and links to the player shopfront', () => {
    const wrapper = mountCard(makeShop())

    expect(wrapper.text()).toContain('Mart Counter')
    expect(wrapper.text()).toContain('A friendly counter stocked for nearby trainers.')
    expect(wrapper.text()).toContain('Open now')
    expect(wrapper.text()).toContain('2 entries')
    expect(wrapper.text()).toContain('1970-01-01 00:00:01 UTC')
    expect(wrapper.find('time').attributes('datetime')).toBe('1970-01-01T00:00:01.000Z')
    expect(wrapper.get('[data-testid="nuxt-link"]').attributes('href')).toBe(shopfrontPath('mart-counter'))
  })

  it('does not expose GM-only edit controls or closed/hidden disabled states', () => {
    const wrapper = mountCard(makeShop({ open: false, playerVisible: false }))

    expect(wrapper.text()).toContain('Browse shop')
    expect(wrapper.text()).not.toContain('Edit shop')
    expect(wrapper.text()).not.toContain('Closed')
    expect(wrapper.text()).not.toContain('Hidden')
  })
})
