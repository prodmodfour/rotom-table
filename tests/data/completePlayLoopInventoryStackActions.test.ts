import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contract = JSON.parse(readFileSync('data/complete-play-loop/inventory-stack-actions.v1.json', 'utf8')) as any

describe('P8-064 inventory stack action certificate', () => {
  it('freezes split, merge, and discard identity and quantity semantics', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-064',
      status: 'current-semantics',
      contract: 'inventory-stack-actions-v1',
      projection: {
        endpoint: 'GET /api/inventory/actions',
        handoff: 'inventory-stack-operation',
        sourceRevisionBound: true,
        reservationAware: true,
        sameContainerMergeOnly: true,
        maximumMergeDestinations: 128,
        maximumRowsPerSection: 256,
      },
      identityAndEquipment: {
        splitSourceIdRetained: true,
        splitIdDeterministicAndCollisionChecked: true,
        mergeDestinationIdRetained: true,
        mergeSourceIdRemoved: true,
        serializedEquipmentNeverSplitOrMerged: true,
        serializedEquipmentDiscardWholeOnly: true,
        structuredShardColorPreserved: true,
        unknownOrExpandedRowMetadataRejected: true,
      },
    })
    expect(contract.actions.map((row: any) => row.action)).toEqual(['split', 'merge', 'discard'])
    expect(contract.actions.find((row: any) => row.action === 'split').quantity).toMatch(/leaves at least one unit.*reservation/i)
    expect(contract.actions.find((row: any) => row.action === 'merge').metadata).toMatch(/exact normalized item identity.*equal cost/i)
    expect(contract.actions.find((row: any) => row.action === 'discard')).toMatchObject({
      confirmation: 'one exact server-issued explicit-choice option',
      reversibility: 'irreversible',
    })
  })

  it('binds private correction evidence, atomic recovery, and the accepted interaction target', () => {
    expect(contract.commitAuthority).toMatchObject({
      privateCommand: expect.stringMatching(/source and destination before rows/i),
      atomicity: expect.stringMatching(/one transaction or roll back/i),
      responses: expect.stringMatching(/replace local state/i),
    })
    expect(contract.replayAndRecovery).toMatchObject({
      journal: 'inventory_action_operations',
      schemaMigration: 41,
      v40RowsPreserved: true,
      principalAndScopeBound: true,
      exactDeclarationHashBound: true,
      privateBeforeEvidencePersistedBeforeMutation: true,
      receiptFailureRollsBackMutation: true,
      processRestartRecovery: true,
      exactReplayCannotRepeatMutation: true,
      manualRepairRequired: false,
    })
    expect(contract.projection.forbiddenFields).toEqual(expect.arrayContaining([
      'source or destination row ID',
      'split row ID',
      'serialized equipment identity or state',
      'operation ID',
      'Profile ID',
      'reservation identity',
      'private correction evidence',
    ]))
    expect(contract.interaction).toMatchObject({
      selectedMockup: '.pi/artifacts/ui-mockups/inventory-stack-actions/v002.png',
      selectedMockupScore: '10/10',
      minimumControlHeightPx: 44,
      optimisticMutation: false,
    })
    expect(contract.interaction.nonColourCues).toEqual(expect.arrayContaining([
      'Discard label', 'warning icon', 'Irreversible heading', 'native checked checkbox',
    ]))
    expect(contract.evidence.tests).toHaveLength(14)
  })
})
