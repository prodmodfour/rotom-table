import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/complete-play-loop/commerce-item-loop-certification.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-070 commerce and item-loop certification artifact', () => {
  it('is versioned and bound to every reviewed runtime contract used by the journey', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-070',
      status: 'certified',
      contract: 'commerce-item-loop-certification-v1',
      certificationTest: 'tests/e2e/commerce-item-loop-certification.spec.ts',
    })
    expect(certification.runtimeEvidence).toEqual({
      referenceItemsSha256: sha256('data/reference/items.json'),
      itemSpecsSha256: sha256('data/complete-play-loop/specs.v1.json'),
      equipmentDefinitionsSha256: sha256('data/complete-play-loop/equipment-definitions.v1.json'),
      equipmentContributionsSha256: sha256('data/complete-play-loop/equipment-contributions.v1.json'),
      unifiedInventoryActionsSha256: sha256('data/complete-play-loop/unified-inventory-actions.v1.json'),
      shopPostCheckoutActionsSha256: sha256('data/complete-play-loop/shop-post-checkout-actions.v1.json'),
      inventoryHistorySha256: sha256('data/complete-play-loop/inventory-history.v1.json'),
      inventoryAccessibilitySha256: sha256('data/complete-play-loop/inventory-accessibility.v1.json'),
    })
  })

  it('certifies the exact checkout, equip, encounter use, transfer, unequip, and history journey', () => {
    expect(certification.clients.map(client => client.role)).toEqual(['player', 'gm', 'gm'])
    expect(certification.fixtures).toMatchObject({
      desktopRestorative: 'Potion',
      mobileRestorative: 'Super Potion',
      equipment: 'Light Armor',
      equipmentContribution: '5 Damage reduction',
      purchaseQuantity: 2,
      useQuantity: 1,
      transferQuantity: 1,
      equipmentQuantity: 1,
    })
    expect(certification.journey).toHaveLength(15)
    expect(certification.journey.join('\n')).toMatch(/buy two restorative units/)
    expect(certification.journey.join('\n')).toMatch(/encounter cockpit/)
    expect(certification.journey.join('\n')).toMatch(/shared inventory/)
    expect(certification.journey.join('\n')).toMatch(/unequip Light Armor/)
    expect(certification.historyAssertions.requiredKinds).toEqual([
      'purchase', 'equipment-change', 'item-use', 'transfer',
    ])
    expect(certification.historyAssertions.equipmentChangeCount).toBe(2)
  })

  it('locks exact replay, cross-role convergence, responsive acceptance, and privacy', () => {
    expect(certification.authorityAssertions).toMatchObject({
      checkoutAcceptedResultDrivesContinuation: true,
      equipmentContributionAppearsAndWithdraws: true,
      encounterHpAndInventorySettleTogether: true,
      trainerAndGroupTransferSettleTogether: true,
      allAffectedRevisionsConverge: true,
      manualRefreshRequired: false,
    })
    expect(Object.values(certification.replayAssertions)).not.toContain(false)
    expect(certification.replayAssertions.duplicateMutationCount).toBe(0)
    expect(Object.values(certification.convergenceAssertions)).not.toContain(false)
    expect(certification.accessibilityAssertions).toMatchObject({
      projects: ['chromium', 'mobile-chromium'],
      scopedAxeViolations: 0,
      maximumHorizontalPageOverflowPx: 1,
      consoleWarningsErrorsOrPageErrors: 0,
    })
    expect(certification.privacyAssertions.forbiddenVisibleFields).toEqual(expect.arrayContaining([
      'Profile ID',
      'inventory operation or source identity',
      'equipment operation or instance identity',
      'stable inventory row identity',
      'definition or source hash',
    ]))
    expect(Object.values(certification.runtimeHydrationAssertions)).not.toContain(false)
    expect(certification.evidence.productionLiveplay).toBe(true)
  })
})
