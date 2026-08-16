import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-eligibility.v1.json'
import {
  ENCOUNTER_SETTLEMENT_BLOCKING_FACT_KINDS,
  ENCOUNTER_SETTLEMENT_FACT_RESOLUTIONS,
} from '../../server/domain/encounterSettlement/eligibility'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-072 encounter settlement eligibility contract', () => {
  it('is versioned and hash-bound to the current private document and eligibility policy', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-072',
      status: 'current-semantics',
      contract: 'encounter-settlement-eligibility-v1',
    })
    expect(contract.sourceEvidence).toEqual({
      settlementDocumentModelSha256: sha256('shared/encounterSettlement/document.ts'),
      settlementDocumentContractSha256: sha256('data/complete-play-loop/encounter-settlement-document.v1.json'),
      eligibilityModelSha256: sha256('server/domain/encounterSettlement/eligibility.ts'),
    })
  })

  it('requires a complete current server read and matches every source-owned fact resolution', () => {
    expect(contract.authoritySnapshot.completenessLiteral).toBe('authoritative-current')
    expect(contract.authoritySnapshot.rule).toContain('rejected')
    expect(Object.keys(contract.derivedGates.currentSourceFacts)).toEqual([
      ...ENCOUNTER_SETTLEMENT_BLOCKING_FACT_KINDS,
    ])
    for (const kind of ENCOUNTER_SETTLEMENT_BLOCKING_FACT_KINDS) {
      expect(contract.derivedGates.currentSourceFacts[kind]).toEqual([
        ...ENCOUNTER_SETTLEMENT_FACT_RESOLUTIONS[kind],
      ])
    }
    expect(contract.derivedGates.allBlocking).toBe(true)
    expect(contract.derivedGates.gateIdentity).toContain('SHA-256')
  })

  it('distinguishes rollback, stale authority, and participant contradiction', () => {
    expect(contract.revisionRules).toMatchObject({
      currentRevisionBelowDraft: expect.stringContaining('revision-conflict'),
      currentRevisionAboveDraft: expect.stringContaining('stale-snapshot'),
      participantMissingOrUnexpected: 'invalid-participant',
      participantSheetOwnerSideRoleOrDispositionMismatch: 'invalid-participant',
      participantRevisionBelowDraft: 'revision-conflict',
      participantRevisionAboveDraft: 'stale-snapshot',
    })
    expect(contract.revisionRules.campaignMinute).toContain('browser time has no authority')
  })

  it('permits bounded GM adjudication for only one gate kind with exact decision and receipt evidence', () => {
    expect(contract.gmAdjudication.adjudicableGateKind).toBe('gm-adjudication only')
    expect(contract.gmAdjudication.requiredDecision).toMatchObject({
      kind: 'gm-correction',
      audience: 'gm',
      status: 'accepted',
      actorKind: 'gm',
    })
    expect(contract.gmAdjudication.requiredReceipt).toMatchObject({
      kind: 'decision',
      audience: 'gm',
      result: 'accepted',
    })
    expect(contract.gmAdjudication.forbiddenBypasses).toEqual(expect.arrayContaining([
      'required reaction',
      'pending resolution',
      'uncertain command',
      'private owner choice',
      'revision conflict',
      'stale snapshot',
    ]))
    expect(contract.gmAdjudication.rule).toContain('never removes a blocker')
  })

  it('keeps terminal and committing documents closed and private evidence server-only', () => {
    expect(contract.outcomes.committing).toContain('not re-opened')
    expect(contract.outcomes.terminal).toContain('not re-opened')
    expect(contract.privacy.storage).toContain('server-private')
    expect(contract.privacy.forbiddenPublicEvidence).toEqual(expect.arrayContaining([
      'fact identity',
      'authority identity or revision',
      'operation identity',
      'Profile principal identity',
      'GM correction evidence',
    ]))
  })
})
