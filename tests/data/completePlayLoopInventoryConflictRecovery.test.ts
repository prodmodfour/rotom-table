import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/inventory-conflict-recovery.v1.json'

describe('P8-068 inventory conflict and recovery contract', () => {
  it('locks uncertainty to one durable Profile-bound exact retry with no automatic mechanical replay', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-068',
      status: 'current-semantics',
      contract: 'inventory-conflict-recovery-v1',
      authority: {
        serverOwnedMutation: true,
        optimisticInventoryMutation: false,
        automaticMechanicalReplay: false,
        reconnectBehavior: expect.stringContaining('explicitly choose exact retry'),
      },
      recoveryStorage: {
        profileBound: true,
        crossTab: expect.stringContaining('scope lock'),
        browserRestart: expect.stringContaining('durable origin-local storage'),
        clearBy: expect.stringContaining('matching operation identity only'),
      },
    })
    expect(contract.coveredFlows).toEqual(expect.arrayContaining([
      expect.stringContaining('Trainer inventory'),
      expect.stringContaining('shared inventory'),
      expect.stringContaining('item use'),
      expect.stringContaining('equipment'),
    ]))
    expect(contract.recoveryStorage.forbiddenVisibleFields).toEqual(expect.arrayContaining([
      'operation or request ID',
      'Profile ID',
      'stable inventory row or source-instance ID',
      'raw command, declaration, lock, or ownership evidence',
    ]))
  })

  it('requires explicit authoritative reconciliation for stale, moved, reserved, and cross-tab state', () => {
    expect(contract.states.uncertain).toMatchObject({
      mutationLock: true,
      permittedMutation: 'explicit exact retry only',
      crossTabTerminalSignal: expect.stringContaining('authoritative reload'),
    })
    expect(contract.states.conflict.causes).toEqual(expect.arrayContaining([
      'stale source or destination revision',
      'moved or removed row',
      'pending reservation or reusable-item lock',
      'another tab resolved the retained command',
    ]))
    expect(contract.states.conflict.permittedAction).toContain('without submitting a mutation')
    expect(contract.reservations).toMatchObject({
      presentation: expect.stringContaining('visible beside row controls'),
      clientOverride: false,
    })
  })

  it('locks the accepted System-card target and non-colour recovery cues', () => {
    expect(contract.interaction).toMatchObject({
      selectedMockup: '.pi/artifacts/ui-mockups/inventory-conflict-recovery/v002.png',
      selectedMockupScore: '10/10',
      minimumControlHeightPx: 44,
      responsive: expect.stringContaining('one column'),
    })
    expect(contract.interaction.uncertainCopy).toEqual(expect.arrayContaining([
      'Recovery required',
      'Inventory result uncertain',
      'The original action is retained. No new inventory action will be created.',
    ]))
    expect(contract.evidence.tests).toEqual(expect.arrayContaining([
      'tests/utils/inventoryRecoveryStorage.test.ts',
      'tests/components/inventoryRecoveryCard.test.ts',
      'tests/e2e/inventory-conflict-recovery.spec.ts',
    ]))
  })
})
