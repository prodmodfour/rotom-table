import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/trainer-participant-document-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-053 Trainer Participant document certification', () => {
  it('binds canonical, runtime, documentation, generated, and test authority to exact accepted bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-trainer-participant-document-v1',
      ticket: 'P11-053',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(acceptedSuccessorHead(certification.canonicalVariantAuthority.path, certification.canonicalVariantAuthority.sha256)).toBe(sha256(certification.canonicalVariantAuthority.path))
    for (const authority of certification.authorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id).toBe(sha256(authority.path))
      expect(authority.guarantees.length, authority.id).toBeGreaterThan(0)
    }
    for (const evidence of certification.evidence) {
      expect(acceptedSuccessorHead(evidence.path, evidence.sha256), evidence.path).toBe(sha256(evidence.path))
      expect(evidence.scenarioIds.length, evidence.path).toBeGreaterThan(0)
      expect(new Set(evidence.scenarioIds).size, evidence.path).toBe(evidence.scenarioIds.length)
    }
    expect(acceptedSuccessorHead(certification.generatedRegression.generatorPath, certification.generatedRegression.generatorSha256)).toBe(sha256(certification.generatedRegression.generatorPath))
    expect(acceptedSuccessorHead(certification.generatedRegression.fixturePath, certification.generatedRegression.fixtureSha256)).toBe(sha256(certification.generatedRegression.fixturePath))
  })

  it('preserves the historical enrollment certificate under the accepted native activation successor', () => {
    const row = contests.variants.find(variant => variant.id === 'trainer-participant')
    expect(row).toMatchObject({
      completionState: 'native',
      structuredSemanticsVersion: 1,
      compatibleBaseVariantIds: ['standard', 'supercontest', 'festival', 'rotation'],
      performerPolicy: {
        performersPerEntry: ['trainer', 'pokemon'],
        moveAuthority: 'authoritative-performer-move-list',
        missingContestIdentityPolicy: 'reject',
      },
    })
    expect(certification.acceptance).toEqual({
      participantFormatModel: 'additive-over-canonical-base-variant',
      trainerPerformersPerEntry: 1,
      ordinaryPokemonPerformersPerEntry: 1,
      rotationPokemonPerformersMinimum: 3,
      rotationPokemonPerformersMaximum: 5,
      parallelTrainerSheetAuthority: false,
      parallelTrainerControllerAuthority: false,
      parallelTrainerDiceAuthority: false,
      clientAuthoredSheetRevisionAccepted: false,
      exactRetryCanDuplicateEnrollment: false,
      trainerAppealExecutionEnabled: false,
      nextTicket: 'P11-054',
    })
    expect(certification.generatedRegression.ordinaryContestOutcomeDrift).toBe(false)
  })
})
