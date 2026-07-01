/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ShopfrontEntryList from '~/components/shops/ShopfrontEntryList.vue'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'

const makeEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'potion',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 300,
  stock: 5,
  maxPerPurchase: 2,
  playerDescription: 'Restores a small amount of HP.',
  gmNotes: 'Do not show this GM-only margin note.',
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
  entries: [
    makeEntry(),
    makeEntry({
      id: 'escape-rope',
      itemName: 'Escape Rope',
      section: 'equipment',
      price: 550,
      stock: null,
      maxPerPurchase: undefined,
      playerDescription: 'A reliable way out of deep caves.',
      gmNotes: 'Hidden cave logistics note.',
    }),
  ],
  gmNotes: 'Private shop setup note.',
  ...overrides,
})

const mountList = (shop: ShopTableDocument) => mount(ShopfrontEntryList, {
  props: { shop },
})

describe('ShopfrontEntryList', () => {
  it('renders player-visible shop entries with price, stock, max-per-purchase, and quantity selectors', async () => {
    const wrapper = mount(ShopfrontEntryList, {
      props: {
        shop: makeShop(),
        quantities: { potion: 1 },
      },
    })
    const text = wrapper.text()

    expect(text).toContain('Items for sale')
    expect(text).toContain('2 entries')
    expect(text).toContain('Potion')
    expect(text).toContain('Medical Kit')
    expect(text).toContain('$300')
    expect(text).toContain('5 in stock')
    expect(text).toContain('2 per purchase')
    expect(text).toContain('Restores a small amount of HP.')
    expect(text).toContain('Escape Rope')
    expect(text).toContain('Equipment')
    expect(text).toContain('$550')
    expect(text).toContain('Unlimited')
    expect(text).toContain('No limit')
    expect(text).toContain('A reliable way out of deep caves.')

    const inputs = wrapper.findAll<HTMLInputElement>('[data-testid="shopfront-entry-quantity"]')
    expect(inputs).toHaveLength(2)
    expect(inputs[0]!.element.value).toBe('1')
    expect(inputs[0]!.attributes('max')).toBe('2')
    expect(inputs[1]!.attributes('max')).toBeUndefined()

    await inputs[0]!.setValue('9')
    expect(wrapper.emitted('update-quantity')?.at(-1)).toEqual(['potion', 2])
  })

  it('redacts shop and entry GM notes from the player-facing catalog', () => {
    const wrapper = mountList(makeShop())
    const text = wrapper.text()

    expect(text).not.toContain('Private shop setup note.')
    expect(text).not.toContain('Do not show this GM-only margin note.')
    expect(text).not.toContain('Hidden cave logistics note.')
  })

  it('shows a read-only empty state when a shop has no entries', () => {
    const wrapper = mountList(makeShop({ entries: [] }))

    expect(wrapper.text()).toContain('0 entries')
    expect(wrapper.text()).toContain('This shop does not list any items yet.')
    expect(wrapper.find('[data-testid="shopfront-entry-quantity"]').exists()).toBe(false)
  })
})
