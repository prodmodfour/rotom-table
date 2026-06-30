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
      class="name-cell-stub"
      :data-options-count="options.length"
      :data-placeholder="placeholder"
      @click="$emit('commit', 'Potion')"
    >
      {{ modelValue || placeholder }}
    </button>
  `,
})

const EditableCellStub = defineComponent({
  name: 'EditableCell',
  props: {
    modelValue: { type: [String, Number], default: undefined },
    type: { type: String, default: 'text' },
    min: { type: Number, default: undefined },
    placeholder: { type: String, default: '' },
    multiline: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  template: `
    <button
      type="button"
      class="editable-cell-stub"
      :data-type="type"
      :data-min="min ?? ''"
      :data-placeholder="placeholder"
      :data-multiline="multiline ? 'true' : 'false'"
      @click="$emit('update:modelValue', 7)"
    >
      {{ modelValue ?? placeholder ?? '—' }}
    </button>
  `,
})

const mountGlobal = {
  stubs: {
    EditableCell: EditableCellStub,
    TrainerInventoryItemNameCell: NameCellStub,
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
    expect(wrapper.find('.name-cell-stub').exists()).toBe(false)
    expect(wrapper.find('.editable-cell-stub').exists()).toBe(false)
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

  it('lets GMs edit money and manage rows before emitting a save request', async () => {
    const document = groupInventoryFixture()
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document,
        canEdit: true,
        isDirty: true,
        saveStatus: 'idle',
      },
      global: mountGlobal,
    })

    expect(wrapper.text()).toContain('Edit the authoritative campaign inventory document')
    expect(wrapper.find('[aria-label="Shared inventory save controls"]').exists()).toBe(true)
    const moneyInput = wrapper.find('.group-inventory-panel__money-editor input')
    expect((moneyInput.element as HTMLInputElement).value).toBe('1250')

    await moneyInput.setValue('1500')
    expect(document.money).toBe(1500)

    await wrapper.find('.row-add').trigger('click')
    expect(document.inventory.keyItems).toHaveLength(2)
    expect(document.inventory.keyItems?.[1]).toMatchObject({ name: '', qty: 1 })
    expect(document.inventory.keyItems?.[1]?.id).toMatch(/^group-item-/)

    const nameCells = wrapper.findAll('.name-cell-stub')
    await nameCells[nameCells.length - 1]?.trigger('click')
    expect(document.inventory.keyItems?.[1]).toMatchObject({
      name: 'Potion',
      qty: 1,
      cost: '$200',
    })

    const removeButtons = wrapper.findAll('.row-remove')
    await removeButtons[removeButtons.length - 1]?.trigger('click')
    expect(document.inventory.keyItems).toHaveLength(1)

    await wrapper.find('.group-inventory-panel__save-button').trigger('click')
    expect(wrapper.emitted('save')).toEqual([[]])
  })

  it('shows conflict feedback with an explicit reload action', async () => {
    const wrapper = mount(GroupInventoryPanel, {
      props: {
        document: groupInventoryFixture(),
        canEdit: true,
        isDirty: true,
        saveStatus: 'conflict',
        saveError: 'Group inventory main has changed; reload before saving.',
      },
      global: mountGlobal,
    })

    expect(wrapper.find('[role="alert"]').text()).toContain('reload before saving')
    await wrapper.find('.group-inventory-panel__reload-button').trigger('click')
    expect(wrapper.emitted('reloadAfterConflict')).toEqual([[]])
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
