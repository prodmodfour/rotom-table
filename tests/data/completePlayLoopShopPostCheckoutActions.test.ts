import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/shop-post-checkout-actions.v1.json'

describe('P8-066 shop post-checkout action contract', () => {
  it('locks exact accepted-delivery continuity without item-name lookup or parallel mechanics', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-066',
      status: 'current-semantics',
      contract: 'shop-post-checkout-actions-v1',
      continuationAuthority: {
        lookupByItemName: false,
        clientAuthoredRowAuthority: false,
        overLimitReceipt: expect.stringContaining('remains accepted without a continuation receipt'),
        idempotentReplay: expect.stringContaining('same continuation receipt'),
      },
      projection: {
        endpoint: 'POST /api/shops/post-checkout-actions',
        maximumContinuations: 64,
        maximumActionsPerContinuation: 6,
        expandedOrForeignReceipt: 'fails closed before projection',
      },
      reuse: {
        newItemMechanicsPath: false,
        newEquipmentMechanicsPath: false,
        newTransferMechanicsPath: false,
      },
    })
    expect(contract.actions.map(action => action.kind)).toEqual([
      'inspect', 'use', 'equip', 'give', 'move-to-group', 'transfer-to-trainer',
    ])
    expect(contract.actions.every(action => action.commitOnNavigation === false)).toBe(true)
    expect(contract.reuse.existingAuthorities).toEqual(expect.arrayContaining([
      'shop checkout operation journal and terminal result',
      'Trainer inventory action projection',
      'delegated group item-use projection',
      'existing exact inventory decision routes',
    ]))
  })

  it('locks safe labels, textual failures, confirmation boundaries, and responsive evidence', () => {
    expect(contract.projection.forbiddenVisibleFields).toEqual(expect.arrayContaining([
      'checkout operation ID',
      'stable inventory row ID',
      'inventory instance ID',
      'Profile ID',
      'definition or command hash',
      'private delegation evidence',
      'raw provenance',
    ]))
    expect(contract.projection.freshAuthority).toMatch(/custody.*Profile delegation.*stable source row.*reservations/u)
    expect(contract.interaction).toMatchObject({
      selectedMockup: '.pi/artifacts/ui-mockups/shop-post-checkout-actions/v002.png',
      selectedMockupScore: '9.7/10',
      minimumControlHeightPx: 44,
      optimisticMutation: false,
    })
    expect(contract.interaction.confirmationBoundary).toContain('no item, equipment, or transfer mutation occurs')
    expect(contract.interaction.nonColourCues).toEqual(expect.arrayContaining([
      'Checkout accepted heading and check icon',
      'native disabled controls',
      'adjacent textual unavailable reasons',
    ]))
    expect(contract.evidence.tests).toEqual(expect.arrayContaining([
      'tests/server/shopPostCheckoutActions.test.ts',
      'tests/components/shops/ShopPostCheckoutActions.test.ts',
      'tests/e2e/shop-post-checkout-actions.spec.ts',
    ]))
  })
})
