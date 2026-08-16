/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InventoryHistoryPanel from '~/components/inventory/InventoryHistoryPanel.vue'
import { parseInventoryHistoryProjection } from '#shared/itemAutomation/inventoryHistory'

const projection = parseInventoryHistoryProjection({
  schemaVersion: 1,
  generatedAt: Date.UTC(2026, 5, 1, 12),
  scope: { kind: 'trainer', label: 'Ash inventory' },
  facts: [{
    kind: 'purchase',
    occurredAt: Date.UTC(2026, 5, 1, 11),
    headline: 'Potion ×2',
    item: { label: 'Potion', quantity: 2 },
    custody: { sourceLabel: 'Shop', destinationLabel: 'Trainer inventory' },
    details: ['Purchase accepted for $600.', 'Delivered to Trainer inventory.'],
  }, {
    kind: 'discard',
    occurredAt: Date.UTC(2026, 4, 31, 20),
    headline: 'Old Rod discarded',
    item: { label: 'Old Rod', quantity: 1 },
    custody: null,
    details: ['Permanently removed from Trainer inventory.'],
  }],
  truncated: true,
})

describe('InventoryHistoryPanel', () => {
  it('presents icon-and-text receipt categories, readable timestamps, consequences, and a 44px refresh control', async () => {
    const wrapper = mount(InventoryHistoryPanel, {
      props: { projection, status: 'ready' },
    })
    expect(wrapper.get('section').attributes('aria-busy')).toBe('false')
    expect(wrapper.text()).toContain('Inventory activity')
    expect(wrapper.text()).toContain('Only player-readable results appear here.')
    expect(wrapper.text()).toContain('Purchase')
    expect(wrapper.text()).toContain('Potion ×2')
    expect(wrapper.text()).toContain('Purchase accepted for $600.')
    expect(wrapper.text()).toContain('Discarded')
    expect(wrapper.text()).toContain('Permanently removed from Trainer inventory.')
    expect(wrapper.text()).toContain('Showing the 2 most recent accepted receipts.')
    expect(wrapper.findAll('time')).toHaveLength(2)
    expect(wrapper.findAll('.inventory-history__icon')).toHaveLength(2)
    expect(wrapper.get('.inventory-history__refresh').attributes('disabled')).toBeUndefined()
    await wrapper.get('.inventory-history__refresh').trigger('click')
    expect(wrapper.emitted('refresh')).toEqual([[]])
  })

  it('retains accepted receipts during refresh and exposes clear loading and error states', async () => {
    const wrapper = mount(InventoryHistoryPanel, {
      props: { projection, status: 'loading' },
    })
    expect(wrapper.get('section').attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).toContain('Potion ×2')
    expect(wrapper.text()).toContain('Checking for newer accepted receipts')
    expect(wrapper.get('.inventory-history__refresh').attributes()).toHaveProperty('disabled')

    await wrapper.setProps({ status: 'error', error: 'History is temporarily unavailable.' })
    expect(wrapper.get('[role="alert"]').text()).toContain('History is temporarily unavailable.')
    expect(wrapper.text()).toContain('Potion ×2')
  })

  it('distinguishes initial loading, retryable failure, and accepted-empty history', async () => {
    const wrapper = mount(InventoryHistoryPanel, { props: { status: 'loading' } })
    expect(wrapper.text()).toContain('Loading accepted inventory receipts')
    await wrapper.setProps({ status: 'error', error: 'Could not load.' })
    expect(wrapper.text()).toContain('Retry to load player-readable inventory activity.')
    await wrapper.setProps({ status: 'ready', error: null })
    expect(wrapper.text()).toContain('No accepted inventory receipts yet.')
  })
})
