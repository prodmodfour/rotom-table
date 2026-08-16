import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/inventory-history.v1.json'

describe('P8-067 inventory history contract', () => {
  it('locks all required categories to terminal authoritative journals without creating mutation authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-067',
      status: 'current-semantics',
      contract: 'inventory-history-v1',
      authority: {
        model: expect.stringContaining('terminal authoritative operation journals'),
        mutationAuthority: false,
        malformedOrConflictingSource: expect.stringContaining('fail closed'),
      },
      projection: {
        endpoint: 'GET /api/inventory/history',
        defaultLimit: 20,
        maximumFacts: 50,
        maximumDetailsPerFact: 8,
      },
    })
    expect(contract.categories).toEqual([
      'purchase', 'transfer', 'item-use', 'equipment-change',
      'guided-outcome', 'settlement-award', 'discard', 'gm-correction',
    ])
    expect(contract.authority.retryDeduplication).toContain('private source key')
    expect(contract.authority.delegatedDeduplication).toMatchObject({
      inventoryActionToEquipmentOperation: expect.stringContaining('only visible equipment fact'),
      guidedRequestToItemOperation: expect.stringContaining('not emitted separately'),
      multiDocumentTransfer: expect.stringContaining('one transfer fact'),
    })
  })

  it('locks default-safe fields, Profile authorization, bounded activity, and the accepted visual hierarchy', () => {
    expect(contract.projection.forbiddenVisibleFields).toEqual(expect.arrayContaining([
      'operation or request ID',
      'stable inventory row ID',
      'inventory or equipment instance ID',
      'Profile ID',
      'revision',
      'command or definition hash',
      'private notes or configuration JSON',
      'private ownership or delegation evidence',
      'GM-only receipt facts in player projections',
    ]))
    expect(contract.projection.trainerAuthorization).toContain('exact selected Profile')
    expect(contract.projection.sharedAuthorization).toContain('audience-filtered')
    expect(contract.interaction).toMatchObject({
      selectedMockup: '.pi/artifacts/ui-mockups/inventory-receipts-history/v005.png',
      selectedMockupScore: '10/10',
      minimumControlHeightPx: 44,
      optimisticMutation: false,
    })
    expect(contract.interaction.hierarchy).toMatch(/60 percent.*40 percent/u)
    expect(contract.interaction.responsive).toContain('one-column reflow')
    expect(contract.evidence.tests).toEqual(expect.arrayContaining([
      'tests/server/loadInventoryHistory.test.ts',
      'tests/components/inventoryHistoryPanel.test.ts',
      'tests/e2e/inventory-history.spec.ts',
    ]))
  })
})
