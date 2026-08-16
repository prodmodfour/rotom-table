/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import InventoryItemTable from '~/components/inventory/InventoryItemTable.vue'
import TrainerInventoryItemTable from '~/components/sheets/TrainerInventoryItemTable.vue'
import type { InventoryEntry } from '~/types/trainerSheet'

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
    accessibleLabel: { type: String, default: '' },
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
      :data-accessible-label="accessibleLabel"
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

describe('InventoryItemTable', () => {
  it('renders rows with shared controls and delegates item-name commits', async () => {
    const items: InventoryEntry[] = [{ name: 'Custom Brew', qty: 2, cost: '$10', description: 'Home made.' }]
    const wrapper = mount(InventoryItemTable, {
      props: {
        sectionKey: 'medicalKit',
        title: 'Medical Kit',
        items,
        namePlaceholder: 'Item',
        variant: 'standard',
        itemNameOptions: [{ value: 'Potion', label: 'Medicine' }],
        selectedRowIndex: 0,
      },
      global: mountGlobal,
    })

    expect(wrapper.find('.block-title').text()).toContain('Medical Kit')
    expect(wrapper.get('tbody tr').classes()).toContain('is-source-selected')
    expect(wrapper.get('tbody tr').attributes('aria-current')).toBe('true')
    expect(wrapper.get('.inventory-selected-source-label').text()).toBe('Selected source')
    expect(wrapper.get('table').attributes('aria-labelledby')).toBe(wrapper.get('.block-title h2').attributes('id'))
    expect(wrapper.findAll('thead th').every(heading => heading.attributes('scope') === 'col')).toBe(true)
    expect(wrapper.get('tbody th').attributes('scope')).toBe('row')
    expect(wrapper.findAll('tbody [data-label]').map(cell => cell.attributes('data-label'))).toEqual([
      'Name', 'Qty', 'Cost', 'Description', 'Actions',
    ])
    expect(wrapper.find('.name-cell-stub').attributes('data-options-count')).toBe('1')
    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Qty',
      'Cost',
      'Description',
      'Actions',
    ])

    await wrapper.find('.name-cell-stub').trigger('click')
    await wrapper.find('.editable-cell-stub').trigger('click')
    await wrapper.find('.row-add').trigger('click')
    await wrapper.find('.row-remove').trigger('click')

    expect(wrapper.findAll('.editable-cell-stub').map(cell => cell.attributes('data-accessible-label'))).toEqual([
      'quantity for Custom Brew',
      'cost for Custom Brew',
      'description for Custom Brew',
    ])
    expect(items[0]?.qty).toBe(7)
    expect(wrapper.emitted('setItemName')).toEqual([[items[0], 'Potion']])
    expect(wrapper.emitted('addItem')).toEqual([['medicalKit']])
    expect(wrapper.emitted('removeItem')).toEqual([['medicalKit', 0]])
  })

  it('renders serialized custody as one locked whole item without an unsafe remove action', async () => {
    const items: InventoryEntry[] = [{
      name: 'First Aid Kit',
      serializedEquipment: {
        schemaVersion: 1,
        instanceId: `equipped-item:v1:${'a'.repeat(32)}`,
        revision: 2,
        canonicalItemId: 'First Aid Kit',
        canonicalRecordSha256: 'b'.repeat(64),
        equipmentDefinitionSha256: null,
        configuration: null,
        state: { charges: 3 },
      },
    }]
    const wrapper = mount(InventoryItemTable, {
      props: {
        sectionKey: 'medicalKit', title: 'Medical Kit', items,
        namePlaceholder: 'Item', variant: 'standard',
      },
      global: mountGlobal,
    })
    expect(wrapper.text()).toContain('First Aid Kit')
    expect(wrapper.text()).toContain('Whole item')
    expect(wrapper.find('.name-cell-stub').exists()).toBe(false)
    expect(wrapper.find('tbody td').text()).toContain('1')
    const remove = wrapper.get('.row-remove')
    expect(remove.attributes('disabled')).toBeDefined()
    expect(remove.attributes('title')).toContain('authoritative equipment or transfer action')
    await remove.trigger('click')
    expect(wrapper.emitted('removeItem')).toBeUndefined()
  })

  it('renders read-only rows without trainer editing controls or row actions', () => {
    const items: InventoryEntry[] = [{ name: 'Custom Brew', qty: 2, cost: '$10', description: 'Home made.' }]
    const wrapper = mount(InventoryItemTable, {
      props: {
        sectionKey: 'medicalKit',
        title: 'Medical Kit',
        items,
        namePlaceholder: 'Item',
        variant: 'standard',
        readOnly: true,
      },
      global: mountGlobal,
    })

    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Qty',
      'Cost',
      'Description',
    ])
    expect(wrapper.find('.row-add').exists()).toBe(false)
    expect(wrapper.find('.row-remove').exists()).toBe(false)
    expect(wrapper.find('.name-cell-stub').exists()).toBe(false)
    expect(wrapper.find('.editable-cell-stub').exists()).toBe(false)
    expect(wrapper.find('tbody').text()).toContain('Custom Brew')
    expect(wrapper.find('tbody').text()).toContain('2')
    expect(wrapper.find('tbody').text()).toContain('$10')
    expect(wrapper.find('tbody').text()).toContain('Home made.')
  })

  it('keeps variant-specific editable columns for Poké Balls and equipment', () => {
    const pokeBallRows: InventoryEntry[] = [{ name: 'Basic Ball', qty: 1, cost: '$250', mod: '+0', description: 'Capture.' }]
    const pokeBalls = mount(InventoryItemTable, {
      props: {
        sectionKey: 'pokeBalls',
        title: 'Poké Balls & Accessories',
        items: pokeBallRows,
        namePlaceholder: 'Poké Ball',
        variant: 'pokeBalls',
      },
      global: mountGlobal,
    })

    expect(pokeBalls.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Qty',
      'Cost',
      'Mod',
      'Description',
      'Actions',
    ])
    expect(pokeBalls.findAll('.editable-cell-stub').map((cell) => cell.attributes('data-type'))).toEqual([
      'number',
      'text',
      'text',
      'textarea',
    ])

    const equipment = mount(InventoryItemTable, {
      props: {
        sectionKey: 'equipment',
        title: 'Equipment',
        items: [{ name: 'Safety Goggles', slot: 'Head', cost: '$1000', description: 'Blocks weather.' }],
        namePlaceholder: 'Equipment',
        variant: 'equipment',
      },
      global: mountGlobal,
    })

    expect(equipment.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Name',
      'Slot',
      'Cost',
      'Description',
      'Actions',
    ])
    expect(equipment.findAll('.editable-cell-stub').map((cell) => cell.attributes('data-placeholder'))).toEqual([
      'Body',
      '—',
      '—',
    ])
  })

  it('keeps the empty row colspan for each table variant', () => {
    const standard = mount(InventoryItemTable, {
      props: {
        sectionKey: 'keyItems',
        title: 'Key Items',
        items: [],
        namePlaceholder: 'Item',
        variant: 'standard',
      },
      global: mountGlobal,
    })
    const pokeBalls = mount(InventoryItemTable, {
      props: {
        sectionKey: 'pokeBalls',
        title: 'Poké Balls & Accessories',
        items: [],
        namePlaceholder: 'Poké Ball',
        variant: 'pokeBalls',
      },
      global: mountGlobal,
    })

    const readonlyEquipment = mount(InventoryItemTable, {
      props: {
        sectionKey: 'equipment',
        title: 'Equipment',
        items: [],
        namePlaceholder: 'Equipment',
        variant: 'equipment',
        readOnly: true,
      },
      global: mountGlobal,
    })

    expect(standard.find('tbody td').attributes('colspan')).toBe('5')
    expect(pokeBalls.find('tbody td').attributes('colspan')).toBe('6')
    expect(readonlyEquipment.find('tbody td').attributes('colspan')).toBe('4')
  })
})

describe('TrainerInventoryItemTable', () => {
  it('preserves trainer item options, autofill behavior, and row actions', async () => {
    const items: InventoryEntry[] = [{ name: '' }]
    const wrapper = mount(TrainerInventoryItemTable, {
      props: {
        sectionKey: 'medicalKit',
        title: 'Medical Kit',
        items,
        namePlaceholder: 'Item',
        variant: 'standard',
      },
      global: mountGlobal,
    })

    expect(Number(wrapper.find('.name-cell-stub').attributes('data-options-count'))).toBeGreaterThan(0)

    await wrapper.find('.name-cell-stub').trigger('click')
    await wrapper.find('.row-add').trigger('click')
    await wrapper.find('.row-remove').trigger('click')

    expect(items[0]).toMatchObject({
      name: 'Potion',
      qty: 1,
      cost: '$200',
      description: 'Heals 20 Hit Points',
    })
    expect(wrapper.emitted('addItem')).toEqual([['medicalKit']])
    expect(wrapper.emitted('removeItem')).toEqual([['medicalKit', 0]])
  })
})
