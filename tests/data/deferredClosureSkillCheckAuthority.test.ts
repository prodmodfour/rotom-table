import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-authority-certification.v1.json'
import contract from '../../data/deferred-closure/skill-check-contract.v1.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256')
  .update(readFileSync(path))
  .digest('hex')

describe('P11-046 Skill Check server-authority certification', () => {
  it('binds every accepted authority and scenario to exact reviewed bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-authority-v1',
      ticket: 'P11-046',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(sha256(certification.sourceContract.path)).toBe(certification.sourceContract.sha256)
    for (const authority of certification.authorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id).toBe(sha256(authority.path))
      expect(authority.guarantees.length, authority.id).toBeGreaterThan(0)
    }
    expect(sha256(certification.evidence.path)).toBe(certification.evidence.sha256)
    expect(new Set(certification.evidence.scenarioIds)).toEqual(new Set(certification.requiredScenarioIds))
  })

  it('certifies server-only randomness, strict payloads, exact retry, and both reviewed comparisons', () => {
    expect(certification.acceptance).toEqual({
      comparisonKinds: ['dc', 'opposed'],
      subjectKinds: ['trainer', 'pokemon'],
      serverRandomnessOnly: true,
      clientResolvedAuthorityAccepted: false,
      exactRetryReturnsOriginalJournals: true,
      allWritesAtomic: true,
    })
    expect(contract.document.modifierResolution).toMatchObject({
      sheetDice: 'resolve-current-authoritative-sheet-at-commit',
      sheetRevision: 'exact-read-set',
      automationModifiers: 'server-provider-registry-only',
      clientRolls: 'forbidden',
      clientResolvedModifiers: 'forbidden',
    })
    expect(contract.document.journal.opposedTieBreakEncoding).toContain('d6 journal')
    expect(contract.document.journal.opposedTieBreakEncoding).toContain('fair coin by parity')
    expect(contract.operations.resolve.payload).toBe('no-rolls-no-modifiers')
  })
})
