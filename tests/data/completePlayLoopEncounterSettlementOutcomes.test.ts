import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-outcomes.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-078 encounter settlement outcome contract', () => {
  it('is versioned and hash-bound to Encounter Document and settlement authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-078',
      status: 'current-semantics',
      contract: 'encounter-settlement-outcomes-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      outcomeSettlementModelSha256: sha256('server/domain/encounterSettlement/outcomeSettlement.ts'),
      encounterDocumentModelSha256: sha256('shared/encounterDocuments/model.ts'),
      encounterDirectorCommandsSha256: sha256('shared/encounterDocuments/commands.ts'),
      consequenceSnapshotModelSha256: sha256('server/domain/encounterSettlement/consequenceSnapshot.ts'),
      rewardPackageContractSha256: sha256('data/complete-play-loop/encounter-settlement-reward-package.v1.json'),
    })
  })

  it('uses only closed objective, clock, phase, and stake outcomes', () => {
    expect(contract.closedOutcomes.objective).toEqual(['completed', 'failed'])
    expect(contract.closedOutcomes.clock).toEqual(['paused at bounded progress', 'completed exactly at maximum'])
    expect(contract.closedOutcomes.phase).toEqual(['completed with optional bounded summary'])
    expect(contract.closedOutcomes.stake).toEqual(['realized', 'avoided', 'changed'])
    expect(contract.closedOutcomes.preservation).toContain('never re-authored')
  })

  it('forbids hidden mechanics in GM-authored narrative consequences', () => {
    expect(contract.campaignConsequences.mechanicalEffectLiteral).toBe('none')
    expect(contract.campaignConsequences.rule).toContain('narrative facts only')
    expect(contract.campaignConsequences.maximum).toBe(128)
  })

  it('keeps omitted subjects pending and application all-or-nothing', () => {
    expect(contract.completion.pending).toContain('visible audience-scoped decision')
    expect(contract.writePlan.beforeAfterEvidence).toContain('SHA-256')
    expect(contract.writePlan.staleRule).toContain('complete authority hash')
    expect(contract.writePlan.atomicRule).toContain('no applicable write')
  })

  it('structurally separates public and GM outcome facts', () => {
    expect(contract.facts.privacy).toContain('GM-only')
    expect(contract.privacy.serverPrivate).toEqual(expect.arrayContaining([
      'GM authorization and denial reason',
      'GM stakes source text',
      'GM-only outcome summaries',
    ]))
  })
})
