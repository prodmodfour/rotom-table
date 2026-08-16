import { describe, expect, it } from 'vitest'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
  type EncounterSettlementParticipant,
} from '../../shared/encounterSettlement/document'
import {
  buildEncounterSettlementConsequenceSnapshot,
  ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS,
  EncounterSettlementConsequenceSnapshotError,
  type EncounterSettlementConsequenceAuthoritySnapshot,
  type EncounterSettlementPersistentConsequenceFact,
  type EncounterSettlementSnapshotCoverage,
  type EncounterSettlementSnapshotCoverageDomain,
  type EncounterSettlementTemporaryCleanupFact,
} from '../../server/domain/encounterSettlement/consequenceSnapshot'

const encounter = {
  encounterId: 'encounter-a',
  encounterRevision: 12,
  linkedMapSlug: 'arena-a',
  linkedMapRevision: 20,
  campaignMinute: 480,
} as const

const participant: EncounterSettlementParticipant = {
  participantId: 'placement-a',
  sourceAuthority: { kind: 'map', id: 'arena-a', revision: 20 },
  sheetKind: 'pokemon',
  sheetSlug: 'pokemon-a',
  sheetRevision: 7,
  sideId: 'heroes',
  ownerParticipantId: null,
  settlementRole: 'combatant',
  disposition: 'active',
}

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000073',
    rewardPackageId: 'reward-package-a',
    encounter,
  })
  return parseEncounterSettlementDocument({
    ...created,
    participants: [participant],
    ...overrides,
  })
}

const authorityForDomain = (
  domain: EncounterSettlementSnapshotCoverageDomain,
  revisionOverride?: number,
): EncounterSettlementAuthorityRef => {
  if (domain === 'consequence:capture') return { kind: 'capture-operation', id: 'capture-a', revision: revisionOverride ?? 1 }
  if (domain === 'consequence:objective') return { kind: 'objective', id: 'objective-a', revision: revisionOverride ?? 3 }
  if (domain === 'consequence:clock') return { kind: 'clock', id: 'clock-a', revision: revisionOverride ?? 4 }
  if (domain === 'consequence:phase') return { kind: 'phase', id: 'phase-a', revision: revisionOverride ?? 2 }
  if (domain === 'consequence:effect') return { kind: 'effect', id: 'effect-directory-a', revision: revisionOverride ?? 20 }
  if (domain === 'consequence:resource' || domain === 'consequence:usage') {
    return { kind: 'resource', id: 'resource-directory-a', revision: revisionOverride ?? 20 }
  }
  if (domain === 'consequence:inventory') return { kind: 'group-inventory', id: 'group-a', revision: revisionOverride ?? 5 }
  if (domain.startsWith('cleanup:')) return { kind: 'map', id: 'arena-a', revision: revisionOverride ?? 20 }
  if (domain === 'consequence:accepted-event') {
    return { kind: 'encounter-document', id: 'encounter-a', revision: revisionOverride ?? 12 }
  }
  return { kind: 'sheet', id: 'pokemon-a', revision: revisionOverride ?? 7 }
}

const coverage = (
  overrides: Partial<Record<EncounterSettlementSnapshotCoverageDomain, Partial<EncounterSettlementSnapshotCoverage>>> = {},
): EncounterSettlementSnapshotCoverage[] => ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS.map(domain => ({
  domain,
  disposition: 'complete',
  authorityRefs: [authorityForDomain(domain)],
  ...overrides[domain],
}))

const decision = (
  authority: EncounterSettlementAuthorityRef,
  valueId: string,
  effect: 'accept' | 'exclude' | 'transform' = 'transform',
) => ({
  audience: 'gm' as const,
  options: [{
    optionId: `option-${valueId}`,
    effect,
    valueId,
    authority,
  }],
})

const persistentFacts = (): EncounterSettlementPersistentConsequenceFact[] => [{
  sourceFactId: 'fact-hp-a',
  participantId: 'placement-a',
  kind: 'hp',
  authority: authorityForDomain('consequence:hp'),
  field: 'combat.currentHp',
  behavior: 'preserve',
  snapshot: { kind: 'integer', before: 8, after: 8 },
  decision: null,
}, {
  sourceFactId: 'fact-injuries-a',
  participantId: 'placement-a',
  kind: 'injuries',
  authority: authorityForDomain('consequence:injuries'),
  field: 'combat.injuries',
  behavior: 'preserve',
  snapshot: { kind: 'integer', before: 2, after: 2 },
  decision: null,
}, {
  sourceFactId: 'fact-conditions-a',
  participantId: 'placement-a',
  kind: 'conditions',
  authority: authorityForDomain('consequence:conditions'),
  field: 'combat.conditions',
  behavior: 'require-decision',
  snapshot: { kind: 'text-list', before: ['Burned'], after: null },
  decision: decision(authorityForDomain('consequence:conditions'), 'preserve-condition'),
}, {
  sourceFactId: 'fact-capture-a',
  participantId: 'placement-a',
  kind: 'capture',
  authority: authorityForDomain('consequence:capture'),
  field: 'capture.accepted',
  behavior: 'preserve',
  snapshot: { kind: 'reference', before: 'capture-a', after: 'capture-a' },
  decision: null,
}, {
  sourceFactId: 'fact-resource-a',
  participantId: 'placement-a',
  kind: 'resource',
  authority: authorityForDomain('consequence:resource'),
  field: 'resource.actionPoints',
  behavior: 'preserve',
  snapshot: { kind: 'integer', before: 3, after: 3 },
  decision: null,
}, {
  sourceFactId: 'fact-usage-a',
  participantId: 'placement-a',
  kind: 'usage',
  authority: authorityForDomain('consequence:usage'),
  field: 'usage.sceneMove',
  behavior: 'preserve',
  snapshot: { kind: 'boolean', before: true, after: true },
  decision: null,
}, {
  sourceFactId: 'fact-equipment-a',
  participantId: 'placement-a',
  kind: 'equipment',
  authority: authorityForDomain('consequence:equipment'),
  field: 'equipment.state',
  behavior: 'preserve',
  snapshot: { kind: 'reference', before: 'equipment-state-a', after: 'equipment-state-a' },
  decision: null,
}, {
  sourceFactId: 'fact-effect-a',
  participantId: 'placement-a',
  kind: 'effect',
  authority: authorityForDomain('consequence:effect'),
  field: 'effect.persistent',
  behavior: 'preserve',
  snapshot: { kind: 'reference', before: 'effect-a', after: 'effect-a' },
  decision: null,
}, {
  sourceFactId: 'fact-objective-a',
  participantId: null,
  kind: 'objective',
  authority: authorityForDomain('consequence:objective'),
  field: 'objective.outcome',
  behavior: 'preserve',
  snapshot: { kind: 'text', before: 'completed', after: 'completed' },
  decision: null,
}, {
  sourceFactId: 'fact-clock-a',
  participantId: null,
  kind: 'clock',
  authority: authorityForDomain('consequence:clock'),
  field: 'clock.segments',
  behavior: 'preserve',
  snapshot: { kind: 'integer', before: 3, after: 3 },
  decision: null,
}, {
  sourceFactId: 'fact-phase-a',
  participantId: null,
  kind: 'phase',
  authority: authorityForDomain('consequence:phase'),
  field: 'phase.current',
  behavior: 'preserve',
  snapshot: { kind: 'text', before: 'aftermath', after: 'aftermath' },
  decision: null,
}, {
  sourceFactId: 'fact-event-a',
  participantId: null,
  kind: 'accepted-event',
  authority: authorityForDomain('consequence:accepted-event'),
  field: 'event.accepted',
  behavior: 'preserve',
  snapshot: { kind: 'reference', before: 'encounter-event-a', after: 'encounter-event-a' },
  decision: null,
}]

const cleanupFacts = (): EncounterSettlementTemporaryCleanupFact[] => [{
  sourceFactId: 'cleanup-stages-a',
  kind: 'combat-stages',
  authority: authorityForDomain('cleanup:combat-stages'),
  participantIds: ['placement-a'],
  sourceIds: ['placement-a:combat-stages'],
  behavior: 'reset',
  decision: null,
}, {
  sourceFactId: 'cleanup-effects-a',
  kind: 'temporary-effects',
  authority: authorityForDomain('cleanup:temporary-effects'),
  participantIds: ['placement-a'],
  sourceIds: ['effect-temporary-a'],
  behavior: 'expire',
  decision: null,
}, {
  sourceFactId: 'cleanup-resources-a',
  kind: 'encounter-resources',
  authority: authorityForDomain('cleanup:encounter-resources'),
  participantIds: ['placement-a'],
  sourceIds: ['resource-encounter-a'],
  behavior: 'reset',
  decision: null,
}, {
  sourceFactId: 'cleanup-reservations-a',
  kind: 'reservations',
  authority: authorityForDomain('cleanup:reservations'),
  participantIds: ['placement-a'],
  sourceIds: ['reservation-a'],
  behavior: 'expire',
  decision: null,
}, {
  sourceFactId: 'cleanup-zones-a',
  kind: 'zones',
  authority: authorityForDomain('cleanup:zones'),
  participantIds: [],
  sourceIds: ['zone-a'],
  behavior: 'expire',
  decision: null,
}, {
  sourceFactId: 'cleanup-ground-a',
  kind: 'ground-items',
  authority: authorityForDomain('cleanup:ground-items'),
  participantIds: [],
  sourceIds: ['ground-item-a'],
  behavior: 'require-decision',
  decision: decision(authorityForDomain('cleanup:ground-items'), 'leave-on-map', 'accept'),
}, {
  sourceFactId: 'cleanup-duration-a',
  kind: 'duration-effects',
  authority: authorityForDomain('cleanup:duration-effects'),
  participantIds: ['placement-a'],
  sourceIds: ['duration-a'],
  behavior: 'expire',
  decision: null,
}, {
  sourceFactId: 'cleanup-items-a',
  kind: 'encounter-items',
  authority: authorityForDomain('cleanup:encounter-items'),
  participantIds: ['placement-a'],
  sourceIds: ['encounter-item-a'],
  behavior: 'expire',
  decision: null,
}, {
  sourceFactId: 'cleanup-initiative-a',
  kind: 'initiative',
  authority: authorityForDomain('cleanup:initiative'),
  participantIds: ['placement-a'],
  sourceIds: ['initiative-a'],
  behavior: 'reset',
  decision: null,
}]

const source = (
  overrides: Partial<EncounterSettlementConsequenceAuthoritySnapshot> = {},
): EncounterSettlementConsequenceAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  coverage: coverage(),
  persistentConsequences: persistentFacts(),
  temporaryCleanup: cleanupFacts(),
  ...overrides,
})

describe('encounter settlement consequence snapshot', () => {
  it('builds a complete authority-backed persistent-versus-temporary snapshot', () => {
    const result = buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source(),
    })

    expect(result.persistentConsequences.map(entry => entry.kind)).toEqual(expect.arrayContaining([
      'hp', 'injuries', 'conditions', 'capture', 'resource', 'usage', 'equipment',
      'effect', 'objective', 'phase', 'clock', 'accepted-event',
    ]))
    expect(result.temporaryCleanup.map(entry => entry.kind)).toEqual(expect.arrayContaining([
      'combat-stages', 'temporary-effects', 'encounter-resources', 'reservations',
      'zones', 'ground-items', 'duration-effects', 'encounter-items', 'initiative',
    ]))
    expect(result.persistentConsequences.find(entry => entry.kind === 'hp')).toMatchObject({
      authority: { kind: 'sheet', id: 'pokemon-a', revision: 7 },
      behavior: 'preserve',
      snapshot: { before: 8, after: 8 },
      state: 'ready',
    })
    expect(result.persistentConsequences.find(entry => entry.kind === 'conditions')).toMatchObject({
      behavior: 'require-decision',
      state: 'proposed',
      decisionId: expect.stringMatching(/^settlement-snapshot-decision:v1:/),
    })
    expect(result.temporaryCleanup.find(entry => entry.kind === 'ground-items')).toMatchObject({
      behavior: 'require-decision',
      state: 'proposed',
    })
    expect(result.snapshotDecisions).toHaveLength(2)
    expect(result.coverage.map(entry => entry.domain)).toEqual(ENCOUNTER_SETTLEMENT_SNAPSHOT_COVERAGE_DOMAINS)
    expect(Object.isFrozen(result.document)).toBe(true)
  })

  it('adopts an exact accepted bounded decision without trusting freeform values', () => {
    const initial = buildEncounterSettlementConsequenceSnapshot({ settlement: settlement(), authority: source() })
    const conditionDecision = initial.snapshotDecisions.find(entry => entry.kind === 'consequence')!
    const acceptedDecision = {
      ...conditionDecision,
      status: 'accepted',
      selectedOptionId: conditionDecision.options[0]!.optionId,
      decidedBy: { kind: 'gm', principalId: 'gm-a' },
      decidedAtCampaignMinute: 480,
    }
    const accepted = parseEncounterSettlementDocument({
      ...initial.document,
      decisions: initial.document.decisions.map(entry => (
        entry.decisionId === acceptedDecision.decisionId ? acceptedDecision : entry
      )),
    })

    const refreshed = buildEncounterSettlementConsequenceSnapshot({ settlement: accepted, authority: source() })
    expect(refreshed.persistentConsequences.find(entry => entry.kind === 'conditions')?.state).toBe('ready')
    expect(refreshed.snapshotDecisions.find(entry => entry.decisionId === acceptedDecision.decisionId)?.status).toBe('accepted')
  })

  it('requires exact exhaustive coverage and rejects facts under not-applicable or mismatched authority', () => {
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ coverage: coverage().slice(1) }),
    })).toThrowError(EncounterSettlementConsequenceSnapshotError)

    const notApplicable = coverage({
      'consequence:hp': { disposition: 'not-applicable' },
    })
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ coverage: notApplicable }),
    })).toThrow(/cannot contain facts while marked not-applicable/)

    const wrongAuthority = persistentFacts()
    wrongAuthority[0] = { ...wrongAuthority[0]!, authority: { kind: 'sheet', id: 'pokemon-a', revision: 8 } }
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ persistentConsequences: wrongAuthority }),
    })).toThrow(/exact current authority declared by consequence:hp/)

    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({
        persistentConsequences: persistentFacts().filter(entry => entry.kind !== 'hp'),
      }),
    })).toThrow(/current hp evidence for participant placement-a/)
  })

  it('enforces persistent-versus-temporary behavior ownership and participant identity', () => {
    const invalidHp = persistentFacts()
    invalidHp[0] = { ...invalidHp[0]!, behavior: 'transform' }
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ persistentConsequences: invalidHp }),
    })).toThrow(/hp cannot use transform/)

    const invalidStages = cleanupFacts()
    invalidStages[0] = { ...invalidStages[0]!, behavior: 'expire' }
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ temporaryCleanup: invalidStages }),
    })).toThrow(/combat-stages cannot use expire/)

    const unknownParticipant = cleanupFacts()
    unknownParticipant[0] = { ...unknownParticipant[0]!, participantIds: ['placement-missing'] }
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ temporaryCleanup: unknownParticipant }),
    })).toThrow(/outside this settlement/)
  })

  it('rejects duplicate facts, rewritten accepted choices, and changed applied evidence', () => {
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: settlement(),
      authority: source({ persistentConsequences: [...persistentFacts(), persistentFacts()[0]!] }),
    })).toThrow(/globally unique stable source-fact identity/)

    const initial = buildEncounterSettlementConsequenceSnapshot({ settlement: settlement(), authority: source() })
    const conditionDecision = initial.snapshotDecisions.find(entry => entry.kind === 'consequence')!
    const accepted = parseEncounterSettlementDocument({
      ...initial.document,
      decisions: initial.document.decisions.map(entry => entry.decisionId === conditionDecision.decisionId
        ? {
            ...entry,
            status: 'accepted',
            selectedOptionId: entry.options[0]!.optionId,
            decidedBy: { kind: 'gm', principalId: 'gm-a' },
            decidedAtCampaignMinute: 480,
          }
        : entry),
    })
    const changedFacts = persistentFacts()
    const conditions = changedFacts.find(entry => entry.kind === 'conditions')!
    const changedAuthority = { kind: 'sheet' as const, id: 'pokemon-a', revision: 8 }
    changedFacts[changedFacts.indexOf(conditions)] = {
      ...conditions,
      authority: changedAuthority,
      decision: decision(changedAuthority, 'different-option'),
    }
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: accepted,
      authority: source({
        coverage: coverage({ 'consequence:conditions': { authorityRefs: [changedAuthority] } }),
        persistentConsequences: changedFacts,
      }),
    })).toThrow(/accepted bounded decision cannot be rewritten/)

    const hp = initial.document.persistentConsequences.find(entry => entry.kind === 'hp')!
    const withReceipt = parseEncounterSettlementDocument({
      ...initial.document,
      persistentConsequences: initial.document.persistentConsequences.map(entry => entry.consequenceId === hp.consequenceId
        ? { ...entry, state: 'applied', receiptId: 'receipt-hp-a' }
        : entry),
      receipts: [{
        receiptId: 'receipt-hp-a',
        kind: 'consequence',
        audience: 'participant-owner',
        operationId: 'operation-hp-a',
        result: 'accepted',
        subjects: [{ kind: 'consequence', id: hp.consequenceId }],
        sourceReceiptId: null,
        acceptedAtCampaignMinute: 480,
      }],
    })
    const changedHp = persistentFacts()
    changedHp[0] = { ...changedHp[0]!, snapshot: { kind: 'integer', before: 7, after: 7 } }
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: withReceipt,
      authority: source({ persistentConsequences: changedHp }),
    })).toThrow(/cannot rewrite an applied consequence/)
  })

  it('does not rebuild committing or terminal settlement evidence', () => {
    const committing = settlement({ status: 'committing' })
    expect(() => buildEncounterSettlementConsequenceSnapshot({
      settlement: committing,
      authority: source(),
    })).toThrow(/cannot rebuild consequence authority after commit has begun/)
  })
})
