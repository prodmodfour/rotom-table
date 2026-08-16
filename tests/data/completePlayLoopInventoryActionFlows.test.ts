import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contract = JSON.parse(readFileSync('data/complete-play-loop/inventory-action-flows.v1.json', 'utf8')) as any

describe('P8-063 unified inventory action flow certificate', () => {
  it('binds all visible flows to existing owning handoffs and exact current authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-063',
      status: 'current-semantics',
      projection: {
        endpoint: 'GET /api/inventory/actions',
        actions: ['use', 'equip', 'give', 'transfer', 'inspect'],
      },
      replayAndRecovery: {
        journal: 'inventory_action_operations',
        schemaMigration: 40,
        principalBound: true,
        exactDeclarationHashBound: true,
        transferReceiptAtomicWithBothInventoryMutations: true,
        bothTransferDirectionsJournaled: true,
        equipmentAndConfigurationDefinitionHashBound: true,
        clientAuthoredConfigurationRejected: true,
        processRestartRecovery: true,
        manualRepairRequired: false,
      },
    })
    expect(contract.flows.map((flow: any) => flow.action)).toEqual(['use', 'equip', 'give', 'transfer', 'inspect'])
    expect(contract.flows.find((flow: any) => flow.action === 'use').behavior).toMatch(/no parallel item mechanics path/i)
    expect(contract.flows.find((flow: any) => flow.action === 'equip').behavior).toMatch(/server-issued compatible Trainer slot and reviewed configuration/i)
    expect(contract.commitAuthority.declaration).toMatch(/exactly match one current server-issued offer/i)
    expect(contract.commitAuthority.responses).toMatch(/authoritative affected sheet and group documents replace local state/i)
  })

  it('keeps private custody and replay evidence outside the visible projection', () => {
    expect(contract.projection.forbiddenFields).toEqual(expect.arrayContaining([
      'inventory row ID',
      'serialized equipment instance ID',
      'downstream operation ID',
      'Profile ID',
      'command or definition hash',
      'ownership evidence',
      'raw provenance',
    ]))
    expect(contract.interaction).toMatchObject({
      selectedMockup: '.pi/artifacts/ui-mockups/unified-inventory-action-flows/v002.png',
      selectedMockupScore: '10/10',
    })
    expect(contract.interaction.uncertainBoundary).toMatch(/exact retry is the only enabled decision/i)
    expect(contract.evidence.tests).toHaveLength(14)
  })
})
