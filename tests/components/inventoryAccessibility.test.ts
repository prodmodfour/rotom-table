/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import EditableCell from '~/components/EditableCell.vue'
import EditableCellDisplay from '~/components/EditableCellDisplay.vue'
import EditableCellEditor from '~/components/EditableCellEditor.vue'
import TrainerInventoryItemNameCell from '~/components/sheets/TrainerInventoryItemNameCell.vue'
import SheetTabNav from '~/components/sheets/SheetTabNav.vue'

const editableCellGlobal = {
  components: { EditableCellDisplay, EditableCellEditor },
}

const ItemSpriteStub = defineComponent({
  name: 'ItemSprite',
  template: '<span class="item-sprite-stub" aria-hidden="true" />',
})

afterEach(() => document.body.replaceChildren())

const settleFocus = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('inventory keyboard editing accessibility', () => {
  it('keeps sheet-level inventory navigation 44-pixel ready and arrow-key operable', async () => {
    const wrapper = mount(SheetTabNav, {
      attachTo: document.body,
      props: {
        tabs: [
          { key: 'stats', label: 'Stats' },
          { key: 'combat', label: 'Combat' },
          { key: 'inventory', label: 'Inventory' },
        ],
        activeKey: 'stats',
      },
    })
    const tabs = wrapper.findAll<HTMLButtonElement>('.tab-btn')
    expect(tabs.map(tab => tab.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
    tabs[0]!.element.focus()
    await tabs[0]!.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:activeKey')?.at(-1)).toEqual(['inventory'])
    expect(document.activeElement).toBe(tabs[2]!.element)
  })

  it('opens an editable value with Enter and restores focus after keyboard commit', async () => {
    const wrapper = mount(EditableCell, {
      attachTo: document.body,
      props: {
        modelValue: 3,
        type: 'number',
        accessibleLabel: 'quantity for Potion',
      },
      global: editableCellGlobal,
    })
    const trigger = wrapper.get<HTMLElement>('.editable-cell')
    expect(trigger.attributes()).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Edit quantity for Potion: 3',
    })

    trigger.element.focus()
    await trigger.trigger('keydown', { key: 'Enter' })
    const input = wrapper.get<HTMLInputElement>('input')
    expect(input.attributes('aria-label')).toBe('quantity for Potion')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('4')
    expect(wrapper.getComponent(EditableCellEditor).props('draft')).toBe('4')
    await input.trigger('keydown', { key: 'Enter' })
    await settleFocus()

    expect(wrapper.emitted('commit')?.at(-1)).toEqual([4])
    expect(document.activeElement).toBe(wrapper.get('.editable-cell').element)
  })

  it('opens with Space and restores the original value and focus after Escape', async () => {
    const wrapper = mount(EditableCell, {
      attachTo: document.body,
      props: {
        modelValue: 'Potion',
        accessibleLabel: 'item note',
      },
      global: editableCellGlobal,
    })
    const trigger = wrapper.get<HTMLElement>('.editable-cell')
    trigger.element.focus()
    await trigger.trigger('keydown', { key: ' ' })
    const input = wrapper.get<HTMLInputElement>('input')
    await input.setValue('Changed')
    await input.trigger('keydown', { key: 'Escape' })
    await settleFocus()

    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.get('.editable-cell').text()).toBe('Potion')
    expect(document.activeElement).toBe(wrapper.get('.editable-cell').element)
  })

  it('labels item-name editing and restores focus on Enter and Escape', async () => {
    const wrapper = mount(TrainerInventoryItemNameCell, {
      attachTo: document.body,
      props: {
        modelValue: 'Potion',
        options: [],
      },
      global: { stubs: { ItemSprite: ItemSpriteStub } },
    })
    const display = wrapper.get<HTMLButtonElement>('.inventory-name-cell__display')
    expect(display.attributes('aria-label')).toBe('Edit item name: Potion')

    await display.trigger('click')
    let input = wrapper.get<HTMLInputElement>('input')
    expect(input.attributes('aria-label')).toBe('Item name, current value Potion')
    await input.setValue('Super Potion')
    await input.trigger('keydown', { key: 'Enter' })
    await settleFocus()
    expect(wrapper.emitted('commit')?.at(-1)).toEqual(['Super Potion'])
    expect(document.activeElement).toBe(wrapper.get('.inventory-name-cell__display').element)

    await wrapper.get('.inventory-name-cell__display').trigger('click')
    input = wrapper.get<HTMLInputElement>('input')
    await input.setValue('Discarded draft')
    await input.trigger('keydown', { key: 'Escape' })
    await settleFocus()
    expect(wrapper.emitted('commit')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('.inventory-name-cell__display').element)
  })
})
