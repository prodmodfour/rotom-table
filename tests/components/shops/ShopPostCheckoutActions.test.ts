/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ShopPostCheckoutActions from '../../../src/components/shops/ShopPostCheckoutActions.vue'

const continuation = {
  continuationId: 'shop-continuation:v1:11111111111111111111111111111111',
  itemLabel: 'Potion',
  quantity: 2,
  source: {
    locationKind: 'trainer-inventory' as const,
    containerLabel: 'Ash inventory',
    section: 'medicalKit' as const,
    sectionLabel: 'Medical Kit',
    rowLabel: 'Row 3',
  },
}
const projection = {
  schemaVersion: 1 as const,
  generatedAt: 1,
  items: [{
    ...continuation,
    destinationSummary: 'Pikachu available',
    actions: [
      {
        actionId: 'shop-post-action:v1:22222222222222222222222222222222',
        kind: 'use' as const,
        label: 'Use now',
        enabled: true,
        unavailableReason: null,
        href: '/sheets/trainers/ash?inventoryAction=use&inventorySource=inventory-source%3Av1%3A33333333333333333333333333333333',
      },
      {
        actionId: 'shop-post-action:v1:44444444444444444444444444444444',
        kind: 'equip' as const,
        label: 'Equip now',
        enabled: false,
        unavailableReason: 'This item is not equipment.',
        href: null,
      },
    ],
  }],
}
const mountPanel = (props: Record<string, unknown> = {}) => mount(ShopPostCheckoutActions, {
  props: {
    receipt: { schemaVersion: 1, continuations: [continuation] },
    projection,
    status: 'ready',
    ...props,
  },
  global: {
    stubs: {
      NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    },
  },
})

describe('ShopPostCheckoutActions', () => {
  it('renders safe accepted-delivery labels, exact handoffs, and textual unavailable reasons', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('Checkout accepted')
    expect(wrapper.text()).toContain('Potion ×2')
    expect(wrapper.text()).toContain('Ash inventory · Medical Kit · Row 3')
    expect(wrapper.get('a').attributes('href')).toContain('inventorySource=inventory-source%3Av1%3A')
    expect(wrapper.get('button[disabled]').text()).toContain('Equip now')
    expect(wrapper.text()).toContain('This item is not equipment.')
    expect(wrapper.text()).toContain('Pikachu available')
    expect(wrapper.text()).not.toMatch(/shop-continuation|shop-post-action|profile_|operation/u)
  })

  it('keeps the accepted receipt visible while action reauthorization loads or fails', () => {
    const loading = mountPanel({ projection: null, status: 'loading' })
    expect(loading.text()).toContain('Potion ×2')
    expect(loading.text()).toContain('Reauthorising this exact delivered source')
    const failed = mountPanel({ projection: null, status: 'error', error: 'The delivered source moved.' })
    expect(failed.text()).toContain('Checkout accepted')
    expect(failed.text()).toContain('The delivered source moved.')
  })

  it('emits retry and dismissal without committing an inventory mutation', async () => {
    const wrapper = mountPanel()
    await wrapper.get('button:not([disabled])').trigger('click')
    const buttons = wrapper.findAll('button').filter(button => !button.attributes('disabled'))
    await buttons.at(-1)!.trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
