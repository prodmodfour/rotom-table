/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InventorySourceSelector from '~/components/inventory/InventorySourceSelector.vue'
import type { InventorySourceSelectionV1 } from '#shared/itemAutomation/inventorySourceSelection'

const sourceId = (character: string): string => `inventory-source:v1:${character.repeat(32)}`

const selection: InventorySourceSelectionV1 = {
  schemaVersion: 1,
  canonicalItemId: 'Super Potion',
  totalQuantity: 3,
  options: [
    {
      schemaVersion: 1, sourceSelectionId: sourceId('1'), offerId: 'offer:first',
      containerKind: 'trainer', containerLabel: 'Trainer inventory', section: 'medicalKit', sectionLabel: 'Medical Kit',
      rowIndex: 0, rowLabel: 'Row 1', itemLabel: 'Super Potion', quantity: 2, selected: true,
    },
    {
      schemaVersion: 1, sourceSelectionId: sourceId('2'), offerId: 'offer:second',
      containerKind: 'trainer', containerLabel: 'Trainer inventory', section: 'medicalKit', sectionLabel: 'Medical Kit',
      rowIndex: 3, rowLabel: 'Row 4', itemLabel: 'Super Potion', quantity: 1, selected: false,
    },
  ],
}

describe('InventorySourceSelector', () => {
  it('renders exact safe provenance with semantic radio state and emits one opaque choice', async () => {
    const wrapper = mount(InventorySourceSelector, { props: { selection, busy: false } })
    expect(wrapper.get('h3').text()).toBe('Choose source')
    expect(wrapper.text()).toContain('2 matching sources')
    expect(wrapper.text()).toContain('Trainer inventory · Medical Kit · Row 1')
    expect(wrapper.text()).toContain('Trainer inventory · Medical Kit · Row 4')
    expect(wrapper.text()).toContain('Selection and revision are rechecked when submitted.')
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios.map(radio => radio.attributes('aria-checked'))).toEqual(['true', 'false'])
    expect(radios.map(radio => radio.attributes('tabindex'))).toEqual(['0', '-1'])
    expect(wrapper.html()).not.toMatch(/offer:first|profile|row-id|instance|sha256|provenance/u)

    await radios[1]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[sourceId('2')]])
  })

  it('supports arrow-key selection and blocks choices while busy', async () => {
    const wrapper = mount(InventorySourceSelector, {
      attachTo: document.body,
      props: { selection, busy: false },
    })
    const radios = wrapper.findAll<HTMLButtonElement>('[role="radio"]')
    await radios[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('select')).toEqual([[sourceId('2')]])
    expect(document.activeElement).toBe(radios[1]!.element)
    await radios[1]!.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('select')?.at(-1)).toEqual([sourceId('1')])
    expect(document.activeElement).toBe(radios[0]!.element)
    await wrapper.setProps({ busy: true })
    expect(wrapper.findAll('button').every(button => Object.hasOwn(button.attributes(), 'disabled'))).toBe(true)
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(2)
    wrapper.unmount()
  })
})
