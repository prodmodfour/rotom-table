import { describe, expect, it } from 'vitest'
import type {
  EncounterSettlementAuthorityRef,
  EncounterSettlementDocument,
  EncounterSettlementParticipant,
} from '../../shared/encounterSettlement/document'
import { createEncounterSettlementDocument, parseEncounterSettlementDocument } from '../../shared/encounterSettlement/document'
import {
  EncounterSettlementEligibilityError,
  evaluateEncounterSettlementEligibility,
  type EncounterSettlementBlockingFact,
  type EncounterSettlementEligibilityAuthoritySnapshot,
} from '../../server/domain/encounterSettlement/eligibility'

const encounter = {
  encounterId: 'encounter-a',
  encounterRevision: 12,
  linkedMapSlug: 'arena-a',
  linkedMapRevision: 20,
  campaignMinute: 480,
} as const

const participant = (overrides: Partial<EncounterSettlementParticipant> = {}): EncounterSettlementParticipant => ({
  participantId: 'placement-a',
  sourceAuthority: { kind: 'map', id: 'arena-a', revision: 20 },
  sheetKind: 'pokemon',
  sheetSlug: 'pokemon-a',
  sheetRevision: 7,
  sideId: 'heroes',
  ownerParticipantId: null,
  settlementRole: 'combatant',
  disposition: 'active',
  ...overrides,
})

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000072',
    rewardPackageId: 'reward-package-a',
    encounter,
  })
  return parseEncounterSettlementDocument({
    ...created,
    participants: [participant()],
    ...overrides,
  })
}

const authority = (
  overrides: Partial<EncounterSettlementEligibilityAuthoritySnapshot> = {},
): EncounterSettlementEligibilityAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  encounter,
  participants: [participant()],
  blockingFacts: [],
  ...overrides,
})

const ref = (
  kind: EncounterSettlementAuthorityRef['kind'] = 'encounter-document',
  id = 'encounter-a',
  revision = 12,
): EncounterSettlementAuthorityRef => ({ kind, id, revision })

const fact = (
  kind: EncounterSettlementBlockingFact['kind'],
  factId: string,
  resolutionKinds: EncounterSettlementBlockingFact['resolutionKinds'],
  overrides: Partial<EncounterSettlementBlockingFact> = {},
): EncounterSettlementBlockingFact => ({
  factId,
  kind,
  audience: 'gm',
  authorityRefs: [ref()],
  participantIds: ['placement-a'],
  resolutionKinds,
  ...overrides,
})

describe('encounter settlement eligibility', () => {
  it('marks one exact current draft ready without inventing a mechanics authority', () => {
    const result = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority(),
    })

    expect(result).toEqual({
      outcome: 'eligible',
      eligible: true,
      nextStatus: 'ready',
      unresolvedGates: [],
      resolvedByRecordedGmCorrectionGateIds: [],
    })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('derives required reaction, resolution, uncertain-command, and private-choice gates from complete current facts', () => {
    const blockingFacts = [
      fact('pending-reaction', 'reaction-a', ['choose']),
      fact('pending-resolution', 'resolution-a', ['retry-exact', 'choose']),
      fact('uncertain-command', 'uncertain-a', ['retry-exact', 'refresh']),
      fact('private-choice', 'choice-a', ['choose'], { audience: 'participant-owner' }),
    ]
    const result = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ blockingFacts }),
    })

    expect(result.outcome).toBe('blocked')
    expect(result.nextStatus).toBe('blocked')
    expect(result.unresolvedGates.map(gate => gate.kind).sort()).toEqual([
      'pending-reaction', 'pending-resolution', 'private-choice', 'uncertain-command',
    ])
    expect(result.unresolvedGates.every(gate => gate.blocking)).toBe(true)
    expect(result.unresolvedGates.find(gate => gate.kind === 'private-choice')?.audience).toBe('participant-owner')
  })

  it('fails closed on revision rollback, stale advances, missing participants, and contradictory participant identity', () => {
    const rollback = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({
        encounter: { ...encounter, encounterRevision: 11 },
      }),
    })
    expect(rollback.unresolvedGates.map(gate => gate.kind)).toContain('revision-conflict')

    const stale = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({
        encounter: { ...encounter, linkedMapRevision: 21 },
        participants: [participant({ sourceAuthority: { kind: 'map', id: 'arena-a', revision: 21 } })],
      }),
    })
    expect(stale.unresolvedGates.filter(gate => gate.kind === 'stale-snapshot')).toHaveLength(2)

    const missing = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ participants: [] }),
    })
    expect(missing.unresolvedGates).toEqual([
      expect.objectContaining({ kind: 'invalid-participant', participantIds: ['placement-a'] }),
    ])

    const identity = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ participants: [participant({ sheetSlug: 'pokemon-b' })] }),
    })
    expect(identity.unresolvedGates).toEqual([
      expect.objectContaining({ kind: 'invalid-participant', resolutionKinds: ['refresh', 'correct', 'exclude'] }),
    ])
  })

  it('blocks pending rewards, captures, cleanup decisions, and consequence decisions', () => {
    const current = settlement({
      persistentConsequences: [{
        consequenceId: 'consequence-a',
        participantId: 'placement-a',
        kind: 'conditions',
        authority: ref('sheet', 'pokemon-a', 7),
        field: 'conditions',
        behavior: 'require-decision',
        snapshot: { kind: 'text-list', before: ['Burned'], after: null },
        state: 'proposed',
        decisionId: 'decision-consequence-a',
        receiptId: null,
      }],
      rewardPackage: {
        rewardPackageId: 'reward-package-a',
        status: 'ready',
        lines: [{
          rewardId: 'reward-money-a',
          visibility: 'public',
          sourceAuthority: ref(),
          disposition: 'pending',
          payload: { kind: 'money', amount: 100 },
        }, {
          rewardId: 'reward-capture-a',
          visibility: 'destination-owner',
          sourceAuthority: ref('capture-operation', 'capture-a', 0),
          disposition: 'pending',
          payload: { kind: 'capture', captureOperationId: 'capture-a', pokemonSheetSlug: 'pokemon-captured-a' },
        }],
      },
      temporaryCleanup: [{
        cleanupId: 'cleanup-a',
        kind: 'ground-items',
        authority: ref('map', 'arena-a', 20),
        participantIds: ['placement-a'],
        sourceIds: ['ground-item-a'],
        behavior: 'require-decision',
        state: 'proposed',
        decisionId: 'decision-cleanup-a',
        receiptId: null,
      }],
      decisions: [{
        decisionId: 'decision-consequence-a',
        kind: 'consequence',
        audience: 'participant-owner',
        status: 'open',
        subjects: [{ kind: 'consequence', id: 'consequence-a' }],
        options: [{ optionId: 'preserve-a', effect: 'accept', valueId: 'preserve', authority: ref('sheet', 'pokemon-a', 7) }],
        selectedOptionId: null,
        decidedBy: null,
        decidedAtCampaignMinute: null,
      }, {
        decisionId: 'decision-cleanup-a',
        kind: 'cleanup',
        audience: 'gm',
        status: 'open',
        subjects: [{ kind: 'cleanup', id: 'cleanup-a' }],
        options: [{ optionId: 'expire-a', effect: 'transform', valueId: 'expire', authority: ref('map', 'arena-a', 20) }],
        selectedOptionId: null,
        decidedBy: null,
        decidedAtCampaignMinute: null,
      }],
    })

    const result = evaluateEncounterSettlementEligibility({ settlement: current, authority: authority() })
    expect(new Set(result.unresolvedGates.map(gate => gate.kind))).toEqual(new Set([
      'private-choice', 'unallocated-reward', 'capture-destination', 'cleanup-decision',
    ]))
    expect(result.unresolvedGates.filter(gate => gate.kind === 'private-choice')).toHaveLength(1)
  })

  it('allows only an exact GM-authored, authority-bound decision receipt to adjudicate a gm-adjudication gate', () => {
    const blockingFact = fact('gm-adjudication', 'adjudication-a', ['adjudicate', 'correct', 'exclude'])
    const first = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ blockingFacts: [blockingFact] }),
    })
    const gate = first.unresolvedGates[0]!

    const decision = {
      decisionId: 'decision-adjudication-a',
      kind: 'gm-correction' as const,
      audience: 'gm' as const,
      status: 'accepted' as const,
      subjects: [{ kind: 'gate' as const, id: gate.gateId }],
      options: [{
        optionId: 'waive-adjudication-a',
        effect: 'waive' as const,
        valueId: 'adjudicate',
        authority: ref(),
      }],
      selectedOptionId: 'waive-adjudication-a',
      decidedBy: { kind: 'gm' as const, principalId: 'gm-a' },
      decidedAtCampaignMinute: 480,
    }
    const withoutReceipt = settlement({ decisions: [decision] })
    const stillBlocked = evaluateEncounterSettlementEligibility({
      settlement: withoutReceipt,
      authority: authority({ blockingFacts: [blockingFact] }),
    })
    expect(stillBlocked.unresolvedGates.map(candidate => candidate.gateId)).toContain(gate.gateId)

    const accepted = settlement({
      decisions: [decision],
      receipts: [{
        receiptId: 'receipt-adjudication-a',
        kind: 'decision',
        audience: 'gm',
        operationId: 'operation-adjudication-a',
        result: 'accepted',
        subjects: [
          { kind: 'decision', id: decision.decisionId },
          { kind: 'gate', id: gate.gateId },
        ],
        sourceReceiptId: null,
        acceptedAtCampaignMinute: 480,
      }],
    })
    const cleared = evaluateEncounterSettlementEligibility({
      settlement: accepted,
      authority: authority({ blockingFacts: [blockingFact] }),
    })
    expect(cleared).toMatchObject({
      outcome: 'eligible',
      eligible: true,
      unresolvedGates: [],
      resolvedByRecordedGmCorrectionGateIds: [gate.gateId],
    })

    const changedAuthorityFact = { ...blockingFact, authorityRefs: [ref('encounter-document', 'encounter-a', 13)] }
    const changedAuthority = evaluateEncounterSettlementEligibility({
      settlement: accepted,
      authority: authority({ blockingFacts: [changedAuthorityFact] }),
    })
    expect(changedAuthority.unresolvedGates.map(candidate => candidate.gateId)).toContain(gate.gateId)
  })

  it('never lets the GM correction path bypass a required reaction gate', () => {
    const reaction = fact('pending-reaction', 'reaction-protected-a', ['choose'])
    const first = evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ blockingFacts: [reaction] }),
    })
    const gate = first.unresolvedGates[0]!
    const attemptedBypass = settlement({
      decisions: [{
        decisionId: 'decision-reaction-bypass-a',
        kind: 'gm-correction',
        audience: 'gm',
        status: 'accepted',
        subjects: [{ kind: 'gate', id: gate.gateId }],
        options: [{ optionId: 'exclude-a', effect: 'exclude', valueId: 'exclude', authority: ref() }],
        selectedOptionId: 'exclude-a',
        decidedBy: { kind: 'gm', principalId: 'gm-a' },
        decidedAtCampaignMinute: 480,
      }],
      receipts: [{
        receiptId: 'receipt-reaction-bypass-a',
        kind: 'decision',
        audience: 'gm',
        operationId: 'operation-reaction-bypass-a',
        result: 'accepted',
        subjects: [
          { kind: 'decision', id: 'decision-reaction-bypass-a' },
          { kind: 'gate', id: gate.gateId },
        ],
        sourceReceiptId: null,
        acceptedAtCampaignMinute: 480,
      }],
    })

    const result = evaluateEncounterSettlementEligibility({
      settlement: attemptedBypass,
      authority: authority({ blockingFacts: [reaction] }),
    })
    expect(result.unresolvedGates).toEqual([
      expect.objectContaining({ gateId: gate.gateId, kind: 'pending-reaction' }),
    ])
  })

  it('rejects incomplete reads, duplicate facts, unsupported resolutions, and malformed current participants', () => {
    expect(() => evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: { ...authority(), completeness: 'partial' } as any,
    })).toThrowError(EncounterSettlementEligibilityError)

    const duplicate = fact('pending-resolution', 'duplicate-a', ['choose'])
    expect(() => evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ blockingFacts: [duplicate, duplicate] }),
    })).toThrow(/duplicate fact identities/)

    expect(() => evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ blockingFacts: [fact('pending-reaction', 'reaction-a', ['correct'])] }),
    })).toThrow(/not owned by pending-reaction/)

    expect(() => evaluateEncounterSettlementEligibility({
      settlement: settlement(),
      authority: authority({ participants: [participant({ sheetRevision: -1 })] }),
    })).toThrow(/complete current participant authority snapshot/)
  })
})
