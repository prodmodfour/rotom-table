import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/trainer-participant-method-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-055 Trainer Participant method certification', () => {
  it('binds canonical, scheduler, persistence, convergence, presentation, and test authority to accepted bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, certificationId: 'deferred-closure-trainer-participant-methods-v1', ticket: 'P11-055', status: 'certified', runtimeProseParsing: false })
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

  it('certifies both exact schedules without inventing a legacy choice or activating later stages', () => {
    const row = contests.variants.find(variant => variant.id === 'trainer-participant')
    expect(row?.methods).toEqual([
      expect.objectContaining({ id: 'simultaneous', appealsPerEntryPerRound: 2, voltageScope: 'per-performer' }),
      expect.objectContaining({ id: 'alternating', appealsPerEntryPerRound: 1, voltageScope: 'shared-entry' }),
    ])
    expect(certification.acceptance).toEqual({
      methodIds: ['simultaneous', 'alternating'],
      simultaneousAppealsPerEntryPerRound: 2,
      simultaneousFirstChoiceKinds: ['trainer', 'pokemon'],
      simultaneousVoltageScope: 'per-performer',
      alternatingAppealsPerEntryPerRound: 1,
      alternatingFirstChoiceKindsWithoutPredecessor: ['trainer', 'pokemon'],
      alternatingRequiresOppositePriorKind: true,
      alternatingVoltageScope: 'shared-entry',
      unknownMethodAccepted: false,
      ordinaryContestMethodAccepted: false,
      legacyMethodInvented: false,
      methodChoicePublic: true,
      methodChoiceGmOnly: true,
      duplicateSelectionOnExactRetry: 0,
      trainerParticipantLifecycleEnabled: false,
      mockupRequired: false,
      mockupSkipReason: 'exact-mechanical-extension-of-existing-workshop-fieldset-and-button-primitives',
      nextTicket: 'P11-056',
    })
  })
})
