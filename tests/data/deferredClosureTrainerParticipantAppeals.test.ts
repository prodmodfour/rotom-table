import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/trainer-participant-appeal-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { CAPABILITY_WEAPON_MOVES } from '../../shared/capabilityAutomation/weaponMoves'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-057 Trainer Participant appeal certification', () => {
  it('binds canonical data, runtime authority, recovery, operator, and evidence bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, certificationId: 'deferred-closure-trainer-participant-appeals-v1', ticket: 'P11-057', status: 'certified', runtimeProseParsing: false })
    expect(sha256(certification.predecessor.path)).toBe(certification.predecessor.sha256)
    for (const canonical of certification.canonicalAuthorities) expect(acceptedSuccessorHead(canonical.path, canonical.sha256), canonical.rowId).toBe(sha256(canonical.path))
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

  it('certifies real Move, scoring, alternation, shared-spend, recovery, and deliberate successor gates', () => {
    const variant = contests.variants.find(row => row.id === 'trainer-participant')!
    expect(variant.performerPolicy).toMatchObject({ trainerMayAppeal: true, moveAuthority: 'authoritative-performer-move-list', missingContestIdentityPolicy: 'reject' })
    expect(Object.values(CAPABILITY_WEAPON_MOVES)).toHaveLength(certification.acceptance.sourceBoundWeaponMoveCount)
    expect(Object.values(CAPABILITY_WEAPON_MOVES).every(move => move.contestEligibility.status === 'unavailable' && move.contestEligibility.reasonCode === 'weapon-move-no-canonical-contest-identity')).toBe(true)
    expect(certification.acceptance).toEqual({
      trainerAppealsEnabled: true,
      alternatingPerformanceEnabled: true,
      simultaneousPerformanceEnabled: false,
      realTrainerMoveListRequired: true,
      canonicalMoveIdentityRequired: true,
      sourceBoundWeaponMoveCount: 12,
      weaponMovesContestAvailable: false,
      unknownMovesContestAvailable: false,
      clientAuthoredRollsAccepted: false,
      ordinaryAppealAssemblyAndScoringReused: true,
      exactAlternationRequired: true,
      getReadyMayBeConsumedByPartner: false,
      trainerParallelDicePoolWrites: 0,
      rotationTeamPoolSpentFirst: true,
      duplicateRollsOnExactRetry: 0,
      rollsOnWrongControllerOrStaleAuthority: 0,
      trainerParticipantInterventionsEnabled: false,
      trainerParticipantRewardSettlementEnabled: false,
      nextTicket: 'P11-058',
    })
  })
})
