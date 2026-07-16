/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PendingMoveHazardCellOverlay from '~/components/isometric/PendingMoveHazardCellOverlay.vue'

const exactSelection = () => ({
  reference: {
    resolutionId: 'resolution-hazard-1',
    windowId: 'hazard.select-cells',
  },
  canonicalMoveId: 'Spikes',
  count: { kind: 'exact' as const, count: 2 },
  options: [{
    id: 'hazard.cell.1234abcd.1.0.1',
    cell: { x: 1, y: 0, z: 1 },
    left: 120,
    top: 80,
  }, {
    id: 'hazard.cell.1234abcd.2.0.1',
    cell: { x: 2, y: 0, z: 1 },
    left: 180,
    top: 80,
  }, {
    id: 'hazard.cell.1234abcd.3.0.1',
    cell: { x: 3, y: 0, z: 1 },
    left: 240,
    top: 80,
  }],
  disabled: false,
})

describe('PendingMoveHazardCellOverlay', () => {
  it('supports exact selection and emits only canonical durable IDs', async () => {
    const wrapper = mount(PendingMoveHazardCellOverlay, {
      props: { selections: [exactSelection()] },
    })

    expect(wrapper.get('.pending-hazard-cell-hud').text()).toContain(
      'Select exactly 2 server-approved hazard cells for Spikes.',
    )
    const cells = wrapper.findAll('.pending-hazard-cell-button')
    expect(cells).toHaveLength(3)
    expect(cells[0]!.attributes('style')).toContain('left: 120px')
    expect(cells[0]!.attributes('aria-label')).toBe(
      'Select hazard cell (1, 0, 1) for Spikes',
    )
    expect(wrapper.get('.pending-hazard-cell-confirm').attributes('disabled')).toBeDefined()

    await cells[1]!.trigger('click')
    await cells[0]!.trigger('click')
    expect(wrapper.get('.pending-hazard-cell-hud').text()).toContain('2 / 2 selected')
    expect(wrapper.get('.pending-hazard-cell-confirm').attributes('disabled')).toBeUndefined()

    await cells[2]!.trigger('click')
    expect(cells[2]!.attributes('aria-pressed')).toBe('false')
    await wrapper.get('.pending-hazard-cell-confirm').trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[
      {
        resolutionId: 'resolution-hazard-1',
        windowId: 'hazard.select-cells',
        optionIds: [
          'hazard.cell.1234abcd.1.0.1',
          'hazard.cell.1234abcd.2.0.1',
        ],
      },
    ]])
    const payload = wrapper.emitted('confirm')?.[0]?.[0]
    expect(payload).not.toHaveProperty('cells')
    expect(payload).not.toHaveProperty('range')
    expect(payload).not.toHaveProperty('geometry')
  })

  it('supports a zero-minimum up-to choice and restores only still-authorized options', async () => {
    const selection = {
      ...exactSelection(),
      count: { kind: 'up-to' as const, minimum: 0, maximum: 3 },
    }
    const wrapper = mount(PendingMoveHazardCellOverlay, {
      props: { selections: [selection] },
    })

    expect(wrapper.get('.pending-hazard-cell-confirm').attributes('disabled')).toBeUndefined()
    await wrapper.get('.pending-hazard-cell-confirm').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[
      {
        resolutionId: 'resolution-hazard-1',
        windowId: 'hazard.select-cells',
        optionIds: [],
      },
    ]])

    const cells = wrapper.findAll('.pending-hazard-cell-button')
    await cells[0]!.trigger('click')
    await cells[1]!.trigger('click')
    await wrapper.setProps({
      selections: [{
        ...selection,
        options: selection.options.slice(1),
      }],
    })
    expect(wrapper.get('.pending-hazard-cell-hud').text()).toContain('1 selected')
    await wrapper.get('.pending-hazard-cell-confirm').trigger('click')
    expect(wrapper.emitted('confirm')?.at(-1)).toEqual([{
      resolutionId: 'resolution-hazard-1',
      windowId: 'hazard.select-cells',
      optionIds: ['hazard.cell.1234abcd.2.0.1'],
    }])
  })

  it('disables selection and confirmation while the journaled response is pending', async () => {
    const wrapper = mount(PendingMoveHazardCellOverlay, {
      props: { selections: [{ ...exactSelection(), disabled: true }] },
    })

    const cells = wrapper.findAll('.pending-hazard-cell-button')
    expect(cells.every(button => button.attributes('disabled') !== undefined)).toBe(true)
    await cells[0]!.trigger('click')
    await wrapper.get('.pending-hazard-cell-confirm').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
