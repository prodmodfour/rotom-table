/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ShopPurchaseAuditLog from '~/components/shops/ShopPurchaseAuditLog.vue'
import type { ShopPurchaseAuditEntry } from '~/types/shop'

const purchaseEntry = (overrides: Partial<ShopPurchaseAuditEntry> = {}): ShopPurchaseAuditEntry => ({
  opId: 'op_shopcheckout_audit',
  purchasedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  actor: {
    role: 'player',
    profileId: 'profile_ash00000',
    profileName: 'Ash',
  },
  paymentSource: { kind: 'trainer', slug: 'ash' },
  deliveryTarget: { kind: 'groupInventory', slug: 'main' },
  lines: [
    {
      entryId: 'potion-row',
      itemName: 'Potion',
      section: 'medicalKit',
      quantity: 2,
      unitPrice: 200,
      lineTotal: 400,
    },
  ],
  total: 400,
  ...overrides,
})

describe('ShopPurchaseAuditLog', () => {
  it('renders recent purchase audit details for GMs', () => {
    const wrapper = mount(ShopPurchaseAuditLog, {
      props: { entries: [purchaseEntry()] },
    })
    const text = wrapper.text()

    expect(text).toContain('Recent purchases')
    expect(text).toContain('2026-01-02 03:04:05 UTC')
    expect(text).toContain('Player Ash (profile_ash00000)')
    expect(text).toContain('$400 total')
    expect(text).toContain('Trainer ash')
    expect(text).toContain('Group inventory main')
    expect(text).toContain('op_shopcheckout_audit')
    expect(text).toContain('2 × Potion ($400)')
    expect(wrapper.findAll('[data-testid="shop-purchase-audit-entry"]')).toHaveLength(1)
  })

  it('renders an empty state when no purchases have been recorded', () => {
    const wrapper = mount(ShopPurchaseAuditLog, {
      props: { entries: [] },
    })

    expect(wrapper.get('[data-testid="shop-purchase-audit-empty"]').text()).toContain('No purchases have been recorded')
    expect(wrapper.find('[data-testid="shop-purchase-audit-list"]').exists()).toBe(false)
  })

  it('renders GM checkouts without a profile summary', () => {
    const wrapper = mount(ShopPurchaseAuditLog, {
      props: {
        entries: [purchaseEntry({
          actor: { role: 'gm' },
          paymentSource: { kind: 'groupInventory', slug: 'main' },
          deliveryTarget: { kind: 'trainer', slug: 'brock' },
        })],
      },
    })
    const text = wrapper.text()

    expect(text).toContain('GM checkout')
    expect(text).toContain('Group inventory main')
    expect(text).toContain('Trainer brock')
  })
})
