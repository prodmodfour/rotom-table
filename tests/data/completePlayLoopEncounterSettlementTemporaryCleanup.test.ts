import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-temporary-cleanup.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-079 encounter settlement temporary-cleanup contract', () => {
  it('is versioned and hash-bound to settlement and existing lifecycle authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-079',
      status: 'current-semantics',
      contract: 'encounter-settlement-temporary-cleanup-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      temporaryCleanupModelSha256: sha256('server/domain/encounterSettlement/temporaryCleanup.ts'),
      encounterLifecyclePlannerSha256: sha256('server/domain/moveAutomation/planInitiativeLifecycle.ts'),
      durationLifecycleSha256: sha256('server/domain/moveAutomation/durationLifecycle.ts'),
      effectLifecycleSha256: sha256('server/domain/moveAutomation/effectLifecycle.ts'),
      encounterResourceReducerSha256: sha256('server/domain/moveAutomation/reduceEncounterResources.ts'),
      settlementDocumentModelSha256: sha256('shared/encounterSettlement/document.ts'),
      encounterStateModelSha256: sha256('shared/moveAutomation/encounterState.ts'),
    })
  })

  it('requires exact complete source coverage and source-owned behavior', () => {
    expect(contract.sourceCoverage.sourceKinds).toEqual([
      'effect', 'zone', 'ground-item', 'combat-stage-sheet', 'encounter-resources',
      'initiative', 'reservation', 'encounter-item',
    ])
    expect(contract.sourceCoverage.extraOrMissing).toContain('fail')
    expect(contract.owningContracts.temporaryEffects).toContain('encounter-end effect lifecycle')
    expect(contract.owningContracts.initiative).toContain('clears encounter-scoped placement scores')
    expect(contract.owningContracts.sceneState).toContain('remain untouched')
  })

  it('never uses cleanup to silently abandon pending reservation authority', () => {
    expect(contract.owningContracts.reservations).toContain('remains a blocker')
    expect(contract.authority.forbidden).toContain('silent reservation abandonment')
    expect(contract.writePlan.atomicRule).toContain('expose no applicable writes')
  })

  it('binds typed transforms and every write to exact before/after evidence', () => {
    expect(contract.transformations.supportedKinds).toEqual(['effect', 'zone', 'ground-item'])
    expect(contract.transformations.identityRule).toContain('retains the exact source identity')
    expect(contract.writePlan.map).toContain('SHA-256')
    expect(contract.writePlan.staleRule).toContain('complete authority hash')
  })

  it('keeps preview semantics deterministic and explainable', () => {
    expect(contract.preview.fields).toContain('reset, expire, preserve, transform, exclude, or pending action')
    expect(contract.preview.explainability).toContain('one deterministic action row')
    expect(contract.replay.planning).toContain('byte-equivalent')
  })
})
