/**
 * @vitest-environment happy-dom
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ShopEntryTable from '~/components/shops/ShopEntryTable.vue'
import { SHOP_DEFAULT_ENTRY_SECTION, SHOP_TABLE_ROW_ID_PREFIX, type ShopEntry } from '~/types/shop'

const IconStub = defineComponent({
  template: '<span aria-hidden="true" />',
})

const NameCellStub = defineComponent({
  name: 'TrainerInventoryItemNameCell',
  props: {
    modelValue: { type: String, default: '' },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: '' },
  },
  emits: ['commit'],
  template: `
    <button
      type="button"
      data-testid="shop-entry-item-name"
      :data-value="modelValue"
      :data-options-count="options.length"
      :data-placeholder="placeholder"
      @click="$emit('commit', ' Potion ')"
    >
      {{ modelValue || placeholder }}
    </button>
  `,
})

const mountGlobal = {
  stubs: {
    TrainerInventoryItemNameCell: NameCellStub,
    PhPlus: IconStub,
    PhX: IconStub,
  },
}

const makeEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'row-1',
  itemName: 'Antidote',
  section: 'medicalKit',
  price: 150,
  stock: null,
  ...overrides,
})

const mountTable = (entries: ShopEntry[]) => mount(ShopEntryTable, {
  props: { entries },
  global: mountGlobal,
})

const latestEntries = (wrapper: VueWrapper): ShopEntry[] => {
  const emitted = wrapper.emitted('update:entries') as [ShopEntry[]][] | undefined
  const latest = emitted?.at(-1)?.[0]
  expect(latest).toBeDefined()
  return latest ?? []
}

describe('ShopEntryTable', () => {
  it('adds a normalized blank row without mutating the passed entries', async () => {
    const original = [makeEntry({ id: `${SHOP_TABLE_ROW_ID_PREFIX}-1`, tags: ['medicine'] })]
    const wrapper = mountTable(original)

    await wrapper.get('[data-testid="shop-entry-add"]').trigger('click')

    const nextEntries = latestEntries(wrapper)
    expect(original).toHaveLength(1)
    expect(original[0]?.tags).toEqual(['medicine'])
    expect(nextEntries).toHaveLength(2)
    expect(nextEntries[1]).toMatchObject({
      id: `${SHOP_TABLE_ROW_ID_PREFIX}-2`,
      itemName: '',
      section: SHOP_DEFAULT_ENTRY_SECTION,
      price: 0,
      stock: null,
    })
  })

  it('removes a selected row by emitting the remaining entry list', async () => {
    const wrapper = mountTable([
      makeEntry({ id: 'row-1', itemName: 'Potion' }),
      makeEntry({ id: 'row-2', itemName: 'Escape Rope', section: 'equipment' }),
    ])

    await wrapper.findAll('[data-testid="shop-entry-remove"]')[1]?.trigger('click')

    expect(latestEntries(wrapper).map((entry) => entry.itemName)).toEqual(['Potion'])
  })

  it('edits item names, prices, tags, and optional GM/player text through explicit update events', async () => {
    const wrapper = mountTable([makeEntry({ id: 'row-1', itemName: '', price: 0 })])

    await wrapper.get('[data-testid="shop-entry-item-name"]').trigger('click')
    let nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.itemName).toBe('Potion')
    await wrapper.setProps({ entries: nextEntries })

    await wrapper.get('[data-testid="shop-entry-price"]').setValue('450.8')
    nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.price).toBe(450)
    await wrapper.setProps({ entries: nextEntries })

    await wrapper.get('[data-testid="shop-entry-tags"]').setValue('healing, rare, healing')
    nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.tags).toEqual(['healing', 'rare'])
    await wrapper.setProps({ entries: nextEntries })

    await wrapper.get('[data-testid="shop-entry-player-description"]').setValue('  Restores HP.  ')
    nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.playerDescription).toBe('Restores HP.')
    await wrapper.setProps({ entries: nextEntries })

    await wrapper.get('[data-testid="shop-entry-gm-notes"]').setValue('  Starter discount.  ')
    nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.gmNotes).toBe('Starter discount.')
  })

  it('switches finite stock to unlimited stock', async () => {
    const wrapper = mountTable([makeEntry({ stock: 6 })])

    await wrapper.get('[data-testid="shop-entry-stock-mode"]').setValue('unlimited')

    expect(latestEntries(wrapper)[0]?.stock).toBeNull()
  })

  it('switches unlimited stock to finite stock and edits the finite stock count', async () => {
    const wrapper = mountTable([makeEntry({ stock: null })])

    await wrapper.get('[data-testid="shop-entry-stock-mode"]').setValue('finite')
    let nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.stock).toBe(0)
    await wrapper.setProps({ entries: nextEntries })

    await wrapper.get('[data-testid="shop-entry-stock-count"]').setValue('12.9')
    nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.stock).toBe(12)
  })

  it('edits max-per-purchase and inventory section while refreshing section item options', async () => {
    const wrapper = mountTable([makeEntry({ section: 'keyItems' })])

    await wrapper.get('[data-testid="shop-entry-max-per-purchase"]').setValue('3.8')
    let nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.maxPerPurchase).toBe(3)
    await wrapper.setProps({ entries: nextEntries })

    await wrapper.get('[data-testid="shop-entry-section"]').setValue('pokeBalls')
    nextEntries = latestEntries(wrapper)
    expect(nextEntries[0]?.section).toBe('pokeBalls')
    await wrapper.setProps({ entries: nextEntries })

    const nameCell = wrapper.get('[data-testid="shop-entry-item-name"]')
    expect(nameCell.attributes('data-placeholder')).toBe('Poké Ball')
    expect(Number(nameCell.attributes('data-options-count'))).toBeGreaterThan(0)
  })
})
