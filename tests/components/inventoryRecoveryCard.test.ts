/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InventoryRecoveryCard from '~/components/inventory/InventoryRecoveryCard.vue'

describe('InventoryRecoveryCard', () => {
  it('locks offline uncertainty behind one explicit retained-command retry', async () => {
    const wrapper = mount(InventoryRecoveryCard, {
      props: {
        state: 'uncertain',
        message: 'A previous inventory action may have reached the server.',
        online: false,
        exactRetryAvailable: true,
      },
    })

    expect(wrapper.text()).toContain('Recovery required')
    expect(wrapper.text()).toContain('Inventory result uncertain')
    expect(wrapper.text()).toContain('Inventory actions are locked until this result is resolved.')
    expect(wrapper.text()).toContain('Offline — waiting to reconnect')
    expect(wrapper.text()).toContain('The original action is retained. No new inventory action will be created.')
    expect(wrapper.text()).toContain('reuses the retained action and cannot apply it twice')
    expect(wrapper.text()).toContain('Available after reconnection.')
    expect(wrapper.text()).toContain('Retry exact action')
    expect(wrapper.text()).not.toMatch(/operation(?: id)?|profile(?: id)?|revision|row id|sha256/i)
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retryExact')).toBeUndefined()
  })

  it('enables only explicit exact retry after reconnect and never submits on the online state change', async () => {
    const wrapper = mount(InventoryRecoveryCard, {
      props: {
        state: 'uncertain', message: 'The exact action remains retained.', online: false,
      },
    })
    await wrapper.setProps({ online: true })
    expect(wrapper.text()).toContain('Online — ready for exact retry')
    expect(wrapper.text()).toContain('Retry starts only when you choose it; reconnecting never submits automatically.')
    expect(wrapper.emitted('retryExact')).toBeUndefined()
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retryExact')).toHaveLength(1)
  })

  it('turns stale, moved, or reserved conflicts into non-mutating authoritative reconciliation', async () => {
    const wrapper = mount(InventoryRecoveryCard, {
      props: {
        state: 'conflict',
        message: 'The source inventory changed. Refresh before retrying.',
        online: true,
      },
    })
    expect(wrapper.text()).toContain('Reconciliation required')
    expect(wrapper.text()).toContain('Inventory changed elsewhere')
    expect(wrapper.text()).toContain('may have moved, changed quantity, or become reserved')
    expect(wrapper.text()).toContain('Reload authoritative inventory')
    expect(wrapper.text()).toContain('Reloading does not submit an inventory mutation.')
    expect(wrapper.text()).not.toContain('Retry exact action')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('reconcile')).toHaveLength(1)
  })
})
