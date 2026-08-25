import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-atomic-commit.v1.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-080 atomic encounter-settlement commit contract', () => {
  it('is versioned and hash-bound to every composed runtime authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-080',
      status: 'current-semantics',
      contract: 'encounter-settlement-atomic-commit-v1',
      storageSchemaVersion: 42,
    })
    const sources = {
      atomicCommitModelSha256: 'server/domain/encounterSettlement/atomicCommit.ts',
      atomicCommandModelSha256: 'shared/encounterSettlement/atomicCommit.ts',
      atomicRepositorySha256: 'server/storage/encounterSettlementRepository.ts',
      atomicUseCaseSha256: 'server/useCases/commitEncounterSettlement.ts',
      storageMigrationsSha256: 'server/storage/migrations.ts',
      settlementDocumentModelSha256: 'shared/encounterSettlement/document.ts',
      experienceAllocationSha256: 'server/domain/encounterSettlement/experienceAllocation.ts',
      lootAllocationSha256: 'server/domain/encounterSettlement/lootAllocation.ts',
      captureSettlementSha256: 'server/domain/encounterSettlement/captureSettlement.ts',
      outcomeSettlementSha256: 'server/domain/encounterSettlement/outcomeSettlement.ts',
      temporaryCleanupSha256: 'server/domain/encounterSettlement/temporaryCleanup.ts',
    } as const
    expect(Object.keys(contract.sourceEvidence)).toEqual(Object.keys(sources))
    for (const [key, path] of Object.entries(sources)) {
      expect(acceptedSuccessorHead(path, contract.sourceEvidence[key as keyof typeof sources]), path).toBe(sha256(path))
    }
  })

  it('requires every provider, fresh complete authority, and deterministic conflict-free aggregation', () => {
    expect(contract.completePlan.providers).toEqual([
      'batch Experience allocation',
      'money and item loot allocation',
      'capture settlement',
      'structured outcomes and campaign consequences',
      'temporary-state cleanup and encounter lifecycle',
    ])
    expect(contract.completePlan.rewardRevalidation).toContain('complete P8-074 reward validator')
    expect(contract.completePlan.eligibilityRevalidation).toContain('P8-072')
    expect(contract.aggregateWrites.sheetMerge).toContain('three-way JSON merge')
    expect(contract.aggregateWrites.sheetMerge).toContain('divergent writes')
    expect(contract.lockedAuthority.rule).toContain('BEGIN IMMEDIATE')
    expect(contract.lockedAuthority.staleRule).toContain('rejects the whole command')
  })

  it('puts every successor, history fact, and attention source in one synchronous transaction', () => {
    expect(contract.transaction.writeOrder).toEqual([
      'Encounter Document successor',
      'map successor when changed',
      'one merged successor per changed sheet',
      'one successor per changed group inventory',
      'terminal settlement successor',
      'accepted operation evidence',
      'immutable history facts',
      'open attention sources',
    ])
    expect(contract.transaction.rollback).toContain('rolls back every prior successor')
    expect(contract.transaction.noAsyncGap).toContain('synchronous')
    expect(contract.tests.rollback).toContain('every generated write boundary')
  })

  it('guarantees exact principal-bound replay across restart without rerunning mechanics', () => {
    expect(contract.terminalReplay.lookupOrder).toContain('before current authority')
    expect(contract.terminalReplay.exactness).toContain('byte-for-byte')
    expect(contract.terminalReplay.restart).toContain('survives process restart')
    expect(contract.terminalReplay.identityReuse).toContain('fails closed')
    expect(contract.tests.restartReplay).toContain('closes and reopens')
  })

  it('keeps operation evidence private and seeds authority-only continuation sources', () => {
    expect(contract.durableEvidence.privacy).toContain('server-private')
    expect(contract.attentionAndHistory.levelThreshold).toContain('exact committed sheet revision')
    expect(contract.attentionAndHistory.authorityOnly).toContain('do not copy mutable character data')
    expect(contract.commandBoundary.authorization).toContain('Only the GM')
  })
})
