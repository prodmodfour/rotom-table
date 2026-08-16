/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import InventoryItemTable from '../../src/components/inventory/InventoryItemTable.vue'
import type { InventoryEntry } from '../../src/types/trainerSheet'

const rows: InventoryEntry[] = Array.from({ length: 160 }, (_, index) => ({
  id: `accessible-row-${index}`,
  name: `Accessible Item ${index + 1}`,
  qty: 1,
  cost: '$100',
  description: 'Accessible bounded row.',
}))

afterEach(() => document.body.replaceChildren())

describe('P8-096 paged semantic inventory accessibility', () => {
  it('announces the complete row count and retains global row indices on each bounded page', async () => {
    const wrapper = mount(InventoryItemTable, {
      attachTo: document.body,
      props: {
        sectionKey: 'medicalKit',
        title: 'Medical Kit',
        items: rows,
        namePlaceholder: 'Item',
        variant: 'standard',
        readOnly: true,
      },
    })

    const table = wrapper.get('table')
    expect(table.attributes('aria-rowcount')).toBe('161')
    expect(wrapper.get('[data-inventory-row="0"]').attributes('aria-rowindex')).toBe('2')
    expect(wrapper.get('[data-inventory-row="79"]').attributes('aria-rowindex')).toBe('81')
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Medical Kit rows')
    expect(wrapper.get('nav [aria-live="polite"]').text()).toBe('Rows 1–80 of 160')

    const next = wrapper.get('nav button:last-of-type')
    next.element.focus()
    expect(document.activeElement).toBe(next.element)
    await next.trigger('click')

    expect(document.activeElement).toBe(next.element)
    expect(wrapper.get('nav [aria-live="polite"]').text()).toBe('Rows 81–160 of 160')
    expect(wrapper.get('[data-inventory-row="80"]').attributes('aria-rowindex')).toBe('82')
    expect(wrapper.get('[data-inventory-row="159"]').attributes('aria-rowindex')).toBe('161')
    expect(wrapper.find('[data-inventory-row="0"]').exists()).toBe(false)
  })

  it('moves a selected exact source into view without changing its stable global row index', async () => {
    const wrapper = mount(InventoryItemTable, {
      attachTo: document.body,
      props: {
        sectionKey: 'medicalKit',
        title: 'Medical Kit',
        items: rows,
        namePlaceholder: 'Item',
        variant: 'standard',
        readOnly: true,
        selectedRowIndex: null,
      },
    })

    await wrapper.setProps({ selectedRowIndex: 120 })

    const selected = wrapper.get('[data-inventory-row="120"]')
    expect(selected.attributes('aria-current')).toBe('true')
    expect(selected.attributes('aria-rowindex')).toBe('122')
    expect(selected.text()).toContain('Selected source')
    expect(wrapper.get('nav [aria-live="polite"]').text()).toBe('Rows 81–160 of 160')
  })
})
