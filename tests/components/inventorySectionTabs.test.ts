/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
import TrainerInventoryPanel from '~/components/sheets/TrainerInventoryPanel.vue'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerSheet } from '~/types/trainerSheet'

const TrainerEquippedGearPanelStub = defineComponent({
  name: 'TrainerEquippedGearPanel',
  template: '<aside class="equipped-gear-stub" />',
})

const TrainerInventoryItemTableStub = defineComponent({
  name: 'TrainerInventoryItemTable',
  props: {
    sectionKey: { type: String, required: true },
    title: { type: String, required: true },
  },
  emits: ['addItem', 'removeItem'],
  template: `
    <section class="inventory-table-stub" :data-section-key="sectionKey">
      <h2>{{ title }}</h2>
      <button type="button" class="stub-add" @click="$emit('addItem', sectionKey)">Add</button>
      <button type="button" class="stub-remove" @click="$emit('removeItem', sectionKey, 0)">Remove</button>
    </section>
  `,
})

const completeTrainerSheet = (): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  equipmentSlots: {},
  inventory: {
    keyItems: [{ name: 'Town Map' }],
    pokemonItems: [],
    medicalKit: [{ name: 'Potion' }],
    pokeBalls: [],
    foodStuff: [],
    equipment: [{ name: 'Safety Goggles' }, { name: 'Running Shoes' }],
  },
})

describe('InventorySectionTabs', () => {
  it('renders trainer inventory sections with counts and active state', () => {
    const wrapper = mount(InventorySectionTabs, {
      props: {
        activeSectionKey: 'pokemonItems',
        counts: {
          keyItems: 2,
          pokemonItems: 4,
        },
      },
    })

    expect(wrapper.find('nav').attributes('aria-label')).toBe('Inventory sections')
    expect(wrapper.findAll('.inventory-subtab').map((button) => button.text().replace(/\s+/g, ' ').trim())).toEqual(
      TRAINER_INVENTORY_SECTIONS.map((section) => `${section.title}${section.key === 'keyItems' ? 2 : section.key === 'pokemonItems' ? 4 : 0}`),
    )
    expect(wrapper.findAll('.inventory-subtab')[1]?.classes()).toContain('is-active')
    expect(wrapper.findAll('.inventory-subtab')[1]?.attributes('aria-pressed')).toBe('true')
  })

  it('emits the selected section key when a tab is clicked', async () => {
    const wrapper = mount(InventorySectionTabs, {
      props: {
        activeSectionKey: 'keyItems',
        counts: {},
      },
    })

    await wrapper.findAll('.inventory-subtab')[5]?.trigger('click')

    expect(wrapper.emitted('update:activeSectionKey')).toEqual([['equipment']])
  })
})

describe('TrainerInventoryPanel inventory section tabs', () => {
  it('preserves counts, active-section switching, and row-action forwarding', async () => {
    const wrapper = mount(TrainerInventoryPanel, {
      props: {
        sheet: completeTrainerSheet(),
      },
      global: {
        stubs: {
          TrainerEquippedGearPanel: TrainerEquippedGearPanelStub,
          TrainerInventoryItemTable: TrainerInventoryItemTableStub,
        },
      },
    })

    expect(wrapper.findAll('.inventory-subtab-count').map((count) => count.text())).toEqual(['1', '0', '1', '0', '0', '2'])
    expect(wrapper.find('.inventory-table-stub').attributes('data-section-key')).toBe('keyItems')
    expect(wrapper.find('.inventory-table-stub h2').text()).toBe('Key Items')

    await wrapper.findAll('.inventory-subtab')[2]?.trigger('click')

    expect(wrapper.findAll('.inventory-subtab')[2]?.classes()).toContain('is-active')
    expect(wrapper.findAll('.inventory-subtab')[2]?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.inventory-table-stub').attributes('data-section-key')).toBe('medicalKit')
    expect(wrapper.find('.inventory-table-stub h2').text()).toBe('Medical Kit')

    await wrapper.find('.stub-add').trigger('click')
    await wrapper.find('.stub-remove').trigger('click')

    expect(wrapper.emitted('addItem')).toEqual([['medicalKit']])
    expect(wrapper.emitted('removeItem')).toEqual([['medicalKit', 0]])
  })
})
