import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/trainer-participant-voltage-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-058 Trainer Participant paired Voltage certification', () => {
  it('binds method, document, engine, projection, recovery, fixture, operator, and evidence bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, certificationId: 'deferred-closure-trainer-participant-voltage-v1', ticket: 'P11-058', status: 'certified', runtimeProseParsing: false })
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

  it('certifies method-specific Voltage, one entry position, paired adjacency, and explicit cross-performer choices', () => {
    const variant = contests.variants.find(row => row.id === 'trainer-participant')!
    const simultaneous = variant.methods.find(row => row.id === 'simultaneous')!, alternating = variant.methods.find(row => row.id === 'alternating')!
    expect(simultaneous).toMatchObject({ appealsPerEntryPerRound: certification.acceptance.simultaneousAppealsPerEntryTurn, voltageScope: certification.acceptance.simultaneousVoltageScope, adjacentEffectScope: certification.canonicalVariantAuthority.simultaneousAdjacentScope })
    expect(alternating).toMatchObject({ voltageScope: certification.acceptance.alternatingVoltageScope })
    expect(simultaneous.crossPerformerEffectPolicy).toEqual(['get-ready-may-apply-to-partner-same-round', 'attention-grabber-may-transfer-between-pair'])
    expect(certification.acceptance).toEqual({
      alternatingVoltageScope: 'shared-entry',
      simultaneousVoltageScope: 'per-performer',
      simultaneousAppealsPerEntryTurn: 2,
      simultaneousEntryPositionsPerChartCursor: 1,
      simultaneousSharedCompatibilityVoltage: 0,
      adjacentSimultaneousMembersAffectedPerEntry: 2,
      rotationInactiveMembersAffected: 0,
      controllerChoosesFirstMember: true,
      exactPartnerRequiredSecond: true,
      getReadyPartnerTransferExplicit: true,
      getReadyDuplicateMultiplierApplications: 0,
      attentionGrabberPartnerTransferExplicit: true,
      clientAuthoredVoltageAccepted: false,
      duplicateRollsOnExactRetry: 0,
      ambiguousVoltageCorrectionsAccepted: false,
      trainerParticipantInterventionsEnabled: false,
      trainerParticipantRewardSettlementEnabled: false,
      nextTicket: 'P11-059',
    })
  })
})
