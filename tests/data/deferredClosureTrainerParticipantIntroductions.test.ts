import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/trainer-participant-introduction-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-056 Trainer Participant introduction certification', () => {
  it('binds document, dice, engine, recovery, projection, operator, and test authority to accepted bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, certificationId: 'deferred-closure-trainer-participant-introductions-v1', ticket: 'P11-056', status: 'certified', runtimeProseParsing: false })
    expect(sha256(certification.predecessor.path)).toBe(certification.predecessor.sha256)
    expect(acceptedSuccessorHead(certification.canonicalVariantAuthority.path, certification.canonicalVariantAuthority.sha256)).toBe(sha256(certification.canonicalVariantAuthority.path))
    expect(new Set(certification.authorities.map(authority => authority.path)).size).toBe(certification.authorities.length)
    for (const authority of certification.authorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id).toBe(sha256(authority.path))
      expect(authority.guarantees.length, authority.id).toBeGreaterThan(0)
      expect(new Set(authority.guarantees).size, authority.id).toBe(authority.guarantees.length)
    }
    for (const evidence of certification.evidence) {
      expect(acceptedSuccessorHead(evidence.path, evidence.sha256), evidence.path).toBe(sha256(evidence.path))
      expect(evidence.scenarioIds.length, evidence.path).toBeGreaterThan(0)
      expect(new Set(evidence.scenarioIds).size, evidence.path).toBe(evidence.scenarioIds.length)
    }
  })

  it('certifies one exact Trainer introduction with shared-pool and role-safe base-stage parity', () => {
    expect(contests.introduction.skillIds).toEqual(certification.canonicalVariantAuthority.introductionSkillIds)
    expect(certification.acceptance).toEqual({
      introductionsPerEntry: 1,
      participantIntroductionActorKind: 'trainer',
      canonicalSkillCount: 5,
      clientAuthoredDiceAccepted: false,
      serverJournaledRolls: true,
      ordinaryBaseIntroductionPipelineReused: true,
      nonRotationTrainerPoolWrites: 0,
      nonRotationPokemonSharedPoolWrites: 1,
      rotationPerformerPoolWrites: 0,
      rotationTeamPoolWrites: 1,
      lettersAssignedByExistingAuthority: true,
      publicExactActorOrRollEvidence: false,
      ownerOtherEntryEvidence: false,
      restartRetainsSupersededJournals: true,
      duplicateRollsOnExactRetry: 0,
      staleRevisionRolls: 0,
      trainerParticipantPerformanceEnabled: false,
      nextTicket: 'P11-057',
    })
  })
})
