/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import GroupInventoryPanel from '~/components/inventory/GroupInventoryPanel.vue'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { GroupInventoryDocument } from '~/types/groupInventory'

const IconStub = defineComponent({
  template: '<span aria-hidden="true" />',
})

const mountGlobal = {
  stubs: {
    PhPlus: IconStub,
    PhX: IconStub,
  },
}

const groupInventoryFixture = (): GroupInventoryDocument => {
  const document = createDefaultGroupInventoryDocument({ now: 1_700_000_000_000 })
  return {
    ...document,
    revision: 3,
    money: 1250,
    notes: 'Shared supplies are kept at the lodge.',
    inventory: {
      ...document.inventory,
      keyItems: [
        { id: 'map-row', name: 'Town Map', description: 'Shows the local trails.' },
      ],
      pokemonItems: [
        { id: 'potion-row', name: 'Potion', qty: 2, cost: '$200', description: 'Heals 20 Hit Points' },
      ],
      equipment: [
        { id: 'boots-row', name: 'Heavy Boots', slot: 'Feet', cost: '$500', description: 'Trail gear.' },
      ],
    },
  }
}

describe('GroupInventoryPanel', () => {
  it('renders money, revision, section counts, and read-only rows from the authoritative document', async () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
      },
      global: mountGlobal,
    })

    expect(wrapper.find('h2').text()).toBe('Shared party inventory')
    expect(wrapper.find('[aria-label="Group inventory summary"]').text()).toContain('$1,250')
    expect(wrapper.find('[aria-label="Group inventory summary"]').text()).toContain('3')
    expect(wrapper.findAll('.inventory-subtab-count').map((count) => count.text())).toEqual(['1', '1', '0', '0', '0', '1'])
    expect(wrapper.find('.row-add').exists()).toBe(false)
    expect(wrapper.find('.row-remove').exists()).toBe(false)
    expect(wrapper.text()).toContain('Town Map')
    expect(wrapper.text()).toContain('Shared supplies are kept at the lodge.')

    await wrapper.findAll('.inventory-subtab')[1]?.trigger('click')

    expect(wrapper.find('.block-title').text()).toContain('Pokémon Items')
    expect(wrapper.text()).toContain('Potion')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Qty',
      'Cost',
      'Description',
    ])

    await wrapper.findAll('.inventory-subtab')[5]?.trigger('click')

    expect(wrapper.find('.block-title').text()).toContain('Equipment')
    expect(wrapper.text()).toContain('Heavy Boots')
    expect(wrapper.text()).toContain('Feet')
    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Slot',
      'Cost',
      'Description',
    ])
  })

  it('announces an accessible empty state when every section is empty', () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: createDefaultGroupInventoryDocument({ now: 1_700_000_000_000 }),
      },
      global: mountGlobal,
    })

    const emptyState = wrapper.find('[role="status"]')
    expect(emptyState.exists()).toBe(true)
    expect(emptyState.text()).toContain('No shared inventory rows yet.')
    expect(wrapper.findAll('.inventory-subtab-count').map((count) => count.text())).toEqual(['0', '0', '0', '0', '0', '0'])
  })
})
