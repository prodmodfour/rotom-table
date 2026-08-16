/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
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

afterEach(() => document.body.replaceChildren())

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
        idPrefix: 'test-inventory',
        panelId: 'test-inventory-panel',
      },
    })

    expect(wrapper.find('nav').attributes()).toMatchObject({
      'aria-label': 'Inventory sections',
      role: 'tablist',
    })
    expect(wrapper.findAll('.inventory-subtab').map((button) => button.text().replace(/\s+/g, ' ').trim())).toEqual(
      TRAINER_INVENTORY_SECTIONS.map((section) => `${section.title}${section.key === 'keyItems' ? 2 : section.key === 'pokemonItems' ? 4 : 0}`),
    )
    const tabs = wrapper.findAll('.inventory-subtab')
    expect(tabs.every(tab => tab.attributes('role') === 'tab')).toBe(true)
    expect(tabs[1]?.classes()).toContain('is-active')
    expect(tabs[1]?.attributes()).toMatchObject({
      id: 'test-inventory-tab-pokemonItems',
      'aria-controls': 'test-inventory-panel',
      'aria-selected': 'true',
      tabindex: '0',
    })
    expect(tabs[0]?.attributes('tabindex')).toBe('-1')
  })

  it('moves and activates tab focus with arrow, Home, and End keys', async () => {
    const wrapper = mount(InventorySectionTabs, {
      attachTo: document.body,
      props: {
        activeSectionKey: 'keyItems',
        counts: {},
      },
    })
    const tabs = wrapper.findAll<HTMLButtonElement>('.inventory-subtab')
    tabs[0]!.element.focus()

    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:activeSectionKey')?.at(-1)).toEqual(['pokemonItems'])
    expect(document.activeElement).toBe(tabs[1]!.element)

    await tabs[1]!.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:activeSectionKey')?.at(-1)).toEqual(['equipment'])
    expect(document.activeElement).toBe(tabs[5]!.element)

    await tabs[5]!.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:activeSectionKey')?.at(-1)).toEqual(['keyItems'])
    expect(document.activeElement).toBe(tabs[0]!.element)
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
    expect(wrapper.findAll('.inventory-subtab')[2]?.attributes('aria-selected')).toBe('true')
    expect(wrapper.get('#trainer-inventory-section-panel').attributes()).toMatchObject({
      role: 'tabpanel',
      'aria-labelledby': 'trainer-inventory-tab-medicalKit',
    })
    expect(wrapper.find('.inventory-table-stub').attributes('data-section-key')).toBe('medicalKit')
    expect(wrapper.find('.inventory-table-stub h2').text()).toBe('Medical Kit')

    await wrapper.find('.stub-add').trigger('click')
    await wrapper.find('.stub-remove').trigger('click')

    expect(wrapper.emitted('addItem')).toEqual([['medicalKit']])
    expect(wrapper.emitted('removeItem')).toEqual([['medicalKit', 0]])
  })
})
