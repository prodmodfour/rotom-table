import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-consequence-snapshot.v1.json'
import {
  ENCOUNTER_SETTLEMENT_CLEANUP_KINDS,
  ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS,
} from '../../shared/encounterSettlement/document'
import {
  ENCOUNTER_SETTLEMENT_PERSISTENT_SNAPSHOT_BEHAVIORS,
  ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS,
  ENCOUNTER_SETTLEMENT_TEMPORARY_CLEANUP_BEHAVIORS,
} from '../../server/domain/encounterSettlement/consequenceSnapshot'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-073 encounter settlement consequence snapshot contract', () => {
  it('is versioned and hash-bound to the current settlement, eligibility, and snapshot models', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-073',
      status: 'current-semantics',
      contract: 'encounter-settlement-consequence-snapshot-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      settlementDocumentModelSha256: sha256('shared/encounterSettlement/document.ts'),
      settlementDocumentContractSha256: sha256('data/complete-play-loop/encounter-settlement-document.v1.json'),
      eligibilityContractSha256: sha256('data/complete-play-loop/encounter-settlement-eligibility.v1.json'),
      snapshotModelSha256: sha256('server/domain/encounterSettlement/consequenceSnapshot.ts'),
    })
  })

  it('requires exhaustive authority-backed coverage and mandatory participant vitals', () => {
    expect(contract.authority.completenessLiteral).toBe('authoritative-current')
    expect(contract.authority.coverageDispositions).toEqual(['complete', 'not-applicable'])
    expect(contract.authority.coverageRule).toContain('Exactly one authority-backed coverage row')
    expect(contract.authority.mandatoryPerParticipant).toEqual(['hp', 'injuries', 'conditions', 'equipment'])
    expect(ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS).toHaveLength(
      ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS.length + ENCOUNTER_SETTLEMENT_CLEANUP_KINDS.length,
    )
    expect(contract.authority.forbiddenDerivations).toContain('client snapshots')
  })

  it('matches every persistent and temporary domain behavior policy', () => {
    expect(contract.persistentConsequences.domains).toEqual([...ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS])
    expect(contract.temporaryCleanup.domains).toEqual([...ENCOUNTER_SETTLEMENT_CLEANUP_KINDS])
    for (const kind of ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS) {
      expect(contract.persistentConsequences.behaviors[kind]).toEqual([
        ...ENCOUNTER_SETTLEMENT_PERSISTENT_SNAPSHOT_BEHAVIORS[kind],
      ])
    }
    for (const kind of ENCOUNTER_SETTLEMENT_CLEANUP_KINDS) {
      expect(contract.temporaryCleanup.behaviors[kind]).toEqual([
        ...ENCOUNTER_SETTLEMENT_TEMPORARY_CLEANUP_BEHAVIORS[kind],
      ])
    }
    expect(contract.persistentConsequences.rule).toContain('HP and accepted-event evidence')
    expect(contract.temporaryCleanup.rule).toContain('P8-079')
  })

  it('keeps decisions bounded and refresh unable to rewrite accepted evidence', () => {
    expect(contract.boundedDecisions).toMatchObject({
      createdOnlyFor: 'require-decision behavior',
      effects: ['accept', 'exclude', 'transform'],
      freeformValues: 'forbidden',
    })
    expect(contract.boundedDecisions.authority).toContain('exact current fact authority')
    expect(contract.refreshAndAudit.appliedEvidence).toContain('cannot be rewritten')
    expect(contract.refreshAndAudit.acceptedDecision).toContain('cannot disappear')
    expect(contract.refreshAndAudit.terminalRule).toContain('committing')
  })

  it('does not claim mechanics ownership or expose private authority evidence', () => {
    expect(contract.ownership.snapshotDoesNotOwn).toEqual(expect.arrayContaining([
      'cleanup reduction',
      'settlement persistence or revision advancement',
      'terminal commit, rollback, history, realtime, or public projection',
    ]))
    expect(contract.privacy.storage).toBe('server-private')
    expect(contract.privacy.forbiddenPublicEvidence).toEqual(expect.arrayContaining([
      'source fact identity',
      'authority identity or revision',
      'decision option identity',
      'receipt or operation identity',
    ]))
  })
})
