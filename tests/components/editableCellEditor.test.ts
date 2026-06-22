/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import EditableCellEditor from '~/components/EditableCellEditor.vue'

describe('EditableCellEditor', () => {
  it('can omit the empty placeholder option for forced selects', () => {
    const wrapper = mount(EditableCellEditor, {
      props: {
        draft: 'Male',
        type: 'select',
        options: ['Male', 'Female'],
        allowEmptyOption: false,
      },
    })

    expect(wrapper.findAll('option').map((option) => option.attributes('value'))).toEqual(['Male', 'Female'])
  })

  it('keeps an empty placeholder option by default', () => {
    const wrapper = mount(EditableCellEditor, {
      props: {
        draft: '',
        type: 'select',
        options: ['Male'],
      },
    })

    expect(wrapper.findAll('option').map((option) => option.attributes('value'))).toEqual(['', 'Male'])
  })

  it('commits the selected option when a forced select starts empty', async () => {
    const onCommit = vi.fn()
    const wrapper = mount(EditableCellEditor, {
      props: {
        draft: '',
        type: 'select',
        options: ['Male'],
        allowEmptyOption: false,
        onCommit,
      },
    })

    await wrapper.find('select').trigger('blur')

    expect(wrapper.emitted('update:draft')).toEqual([['Male']])
    expect(onCommit).toHaveBeenCalledOnce()
  })
})
