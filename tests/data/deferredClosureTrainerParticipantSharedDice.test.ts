import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/trainer-participant-shared-dice-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-054 Trainer Participant shared dice certification', () => {
  it('binds canonical, document, runtime, recovery, operator, and test authority to accepted bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-trainer-participant-shared-dice-v1',
      ticket: 'P11-054',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(sha256(certification.predecessor.path)).toBe(certification.predecessor.sha256)
    expect(sha256(certification.canonicalVariantAuthority.path)).toBe(certification.canonicalVariantAuthority.sha256)
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

  it('certifies one referenced preparation pool, pair-wide spend, journaled allocation, and no lifecycle activation', () => {
    const row = contests.variants.find(variant => variant.id === 'trainer-participant')
    expect(row).toMatchObject({
      completionState: 'structured',
      sharedContestDicePool: certification.canonicalVariantAuthority.sharedContestDicePool,
      featurePolicy: {
        coordinatorMayTarget: ['trainer', 'pokemon'],
        similarTrainerFeaturesMayTarget: ['trainer', 'pokemon'],
      },
    })
    expect(certification.acceptance).toEqual({
      storageModel: 'pokemon-preparation-authority-shared-by-reference',
      trainerPoolCopiesPerEntry: 0,
      nonRotationTeamPoolCopiesPerEntry: 0,
      activeTrainerMaySpendPairedPool: true,
      activePokemonMaySpendPairedPool: true,
      coordinatorStyleTargetKinds: ['trainer', 'pokemon'],
      maximumDicePerAppeal: 3,
      depletionScope: 'contest',
      rotationAllocationOrder: ['team-introduction-pool', 'active-pokemon-preparation-pool'],
      receiptPerAcceptedNonzeroSpend: 1,
      duplicateSpendOnExactRetry: 0,
      changedInputReuseAccepted: false,
      clientAuthoredPoolAccepted: false,
      orphanReceiptAccepted: false,
      trainerParticipantLifecycleEnabled: false,
      nextTicket: 'P11-055',
    })
  })
})
