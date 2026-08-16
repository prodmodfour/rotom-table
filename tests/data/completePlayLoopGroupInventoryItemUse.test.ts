import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/group-inventory-item-use.v1.json'

describe('P8-065 group inventory item-use contract', () => {
  it('locks existing mechanics reuse, delegated actors, exact reservations, recovery, privacy, and interaction boundaries', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-065',
      status: 'current-semantics',
      scope: { newParallelMechanicsPath: false },
      actorPolicy: { reauthorization: ['projection', 'declaration', 'execution', 'pending resume', 'pending abandonment'] },
      projection: {
        endpoint: 'GET /api/items/group-actions',
        declarationEndpoint: 'POST /api/items/group-actions/declare',
        executionEndpoint: 'POST /api/items/use',
        maximumActors: 64,
        maximumOffers: 256,
        maximumTargetsPerOffer: 64,
      },
      reservation: {
        atomicRaceProtection: ['use', 'group-to-Trainer transfer', 'split', 'merge', 'discard'],
        unrelatedRows: expect.stringContaining('remain mutable'),
        processRestart: true,
        manualRepairRequired: false,
      },
      interaction: { minimumControlHeightPx: 44, optimisticMutation: false },
    })
    expect(contract.projection.safeFields).toContain('shared container, section, presentation-row, item and available-quantity labels')
    expect(contract.projection.forbiddenFields).toEqual(expect.arrayContaining([
      'group inventory row ID',
      'inventory instance ID',
      'operation, request or reservation ID',
      'Profile ID',
      'definition or command hash',
      'private ownership evidence',
      'raw provenance',
    ]))
    expect(contract.commitAuthority.atomicity).toContain('commit together or roll back')
    expect(contract.interaction.uncertainBoundary).toContain('exact retry is the only mutation path')
    expect(contract.evidence.tests).toEqual(expect.arrayContaining([
      'tests/server/groupInventoryItemActions.test.ts',
      'tests/integration/groupInventoryItemReservationRecovery.test.ts',
      'tests/e2e/group-inventory-item-use.spec.ts',
    ]))
  })
})
