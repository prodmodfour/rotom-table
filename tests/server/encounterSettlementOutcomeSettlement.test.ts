import { describe, expect, it } from 'vitest'
import { createEncounterDocument, parseEncounterDocument } from '../../shared/encounterDocuments/model'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
} from '../../shared/encounterSettlement/document'
import {
  applyEncounterSettlementOutcomePlan,
  EncounterSettlementOutcomeError,
  planEncounterSettlementOutcomes,
  type EncounterSettlementOutcomeAuthoritySnapshot,
  type EncounterSettlementOutcomeDeclaration,
} from '../../server/domain/encounterSettlement/outcomeSettlement'

const encounterDocument = () => {
  const base = createEncounterDocument({
    encounterId: 'encounter-outcome-a',
    name: 'Rescue at Dawn',
    linkedMapSlug: 'arena-outcome-a',
    recipe: 'trainer-duel',
    now: 1_000,
  })
  return parseEncounterDocument({
    ...base,
    revision: 12,
    lifecycle: 'active',
    objectives: [{
      objectiveId: 'rescue-hostage', label: 'Rescue the researcher', visibility: 'public',
      status: 'active', progress: 1, maximum: 1,
    }, {
      objectiveId: 'discover-traitor', label: 'Discover the traitor', visibility: 'gm',
      status: 'active', progress: null, maximum: null,
    }],
    clocks: [{
      clockId: 'reinforcements', label: 'Reinforcements arrive', visibility: 'public',
      status: 'active', progress: 2, maximum: 4,
    }],
    phases: [{
      phaseId: 'confrontation', label: 'Confrontation', visibility: 'public',
      status: 'active', summary: null,
    }],
    activePhaseId: 'confrontation',
    stakes: {
      public: 'The researcher may be rescued.',
      gm: 'The rival may reveal the hidden patron.',
    },
  })
}

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000078',
    rewardPackageId: 'outcome-rewards-a',
    encounter: {
      encounterId: 'encounter-outcome-a', encounterRevision: 12,
      linkedMapSlug: 'arena-outcome-a', linkedMapRevision: 20, campaignMinute: 480,
    },
  })
  return parseEncounterSettlementDocument({
    ...created,
    persistentConsequences: [{
      consequenceId: 'existing-hp-consequence',
      participantId: null,
      kind: 'hp',
      authority: { kind: 'sheet', id: 'pokemon-a', revision: 4 },
      field: 'combat.currentHp',
      behavior: 'preserve',
      snapshot: { kind: 'integer', before: 10, after: 10 },
      state: 'ready',
      decisionId: null,
      receiptId: null,
    }],
    ...overrides,
  })
}

const declarations = (): EncounterSettlementOutcomeDeclaration[] => [{
  kind: 'objective', subjectId: 'rescue-hostage', status: 'completed',
}, {
  kind: 'objective', subjectId: 'discover-traitor', status: 'failed',
}, {
  kind: 'clock', subjectId: 'reinforcements', status: 'paused', progress: 3,
}, {
  kind: 'phase', subjectId: 'confrontation', status: 'completed', summary: 'The rival withdrew.',
}, {
  kind: 'stake', subjectId: 'public', result: 'realized', summary: 'The researcher returned safely.',
}, {
  kind: 'stake', subjectId: 'gm', result: 'changed', summary: 'The patron now suspects the party.',
}]

const authority = (
  declarationRows: readonly EncounterSettlementOutcomeDeclaration[] = declarations(),
  overrides: Partial<EncounterSettlementOutcomeAuthoritySnapshot> = {},
): EncounterSettlementOutcomeAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  encounterDocument: encounterDocument(),
  declarations: declarationRows,
  campaignConsequencesComplete: true,
  campaignConsequences: [{
    consequenceId: 'rival-debt-a',
    visibility: 'gm',
    category: 'relationship',
    resultCode: 'rival-owes-favour',
    summary: 'The rival owes the party one favour.',
    mechanicalEffect: 'none',
  }],
  authorization: {
    status: 'allowed',
    authority: { kind: 'encounter-document', id: 'encounter-outcome-a', revision: 12 },
    reasonId: null,
  },
  writeTimestamp: 1_001,
  ...overrides,
})

describe('encounter settlement objectives, clocks, phases, and outcomes', () => {
  it('concludes closed fields and records audience-safe structured facts without hidden mechanics', () => {
    const currentAuthority = authority()
    const plan = planEncounterSettlementOutcomes({ settlement: settlement(), authority: currentAuthority })

    expect(plan.complete).toBe(true)
    expect(plan.requiredDecisions).toEqual([])
    expect(plan.deniedReasonId).toBeNull()
    expect(plan.encounterWrite).toMatchObject({ expectedRevision: 12, revision: 13 })
    expect(plan.encounterWrite?.nextDocument).toMatchObject({
      lifecycle: 'completed',
      activePhaseId: null,
      objectives: [
        expect.objectContaining({ objectiveId: 'rescue-hostage', status: 'completed' }),
        expect.objectContaining({ objectiveId: 'discover-traitor', status: 'failed' }),
      ],
      clocks: [expect.objectContaining({ clockId: 'reinforcements', status: 'paused', progress: 3 })],
      phases: [expect.objectContaining({ phaseId: 'confrontation', status: 'completed', summary: 'The rival withdrew.' })],
    })
    expect(plan.outcomeFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'objective', subjectId: 'rescue-hostage', audience: 'public', resultCode: 'completed', mechanicalEffect: 'closed-encounter-field' }),
      expect.objectContaining({ kind: 'objective', subjectId: 'discover-traitor', audience: 'gm', resultCode: 'failed' }),
      expect.objectContaining({ kind: 'stake', subjectId: 'gm', audience: 'gm', mechanicalEffect: 'none' }),
      expect.objectContaining({ kind: 'campaign-consequence', audience: 'gm', resultCode: 'rival-owes-favour', mechanicalEffect: 'none' }),
    ]))
    expect(plan.document.persistentConsequences).toEqual(expect.arrayContaining([
      expect.objectContaining({ consequenceId: 'existing-hp-consequence', kind: 'hp' }),
      expect.objectContaining({ kind: 'objective', field: 'status', behavior: 'transform' }),
      expect.objectContaining({ kind: 'clock', field: 'progress', snapshot: { kind: 'integer', before: 2, after: 3 } }),
      expect.objectContaining({ kind: 'accepted-event', field: 'stake-gm', behavior: 'preserve' }),
    ]))
    expect(applyEncounterSettlementOutcomePlan({ plan, currentAuthority })).toEqual(plan.encounterWrite)
  })

  it('keeps every omitted objective, clock, phase, and stake as a visible required decision', () => {
    const plan = planEncounterSettlementOutcomes({ settlement: settlement(), authority: authority([]) })
    expect(plan.complete).toBe(false)
    expect(plan.requiredDecisions).toEqual(expect.arrayContaining([
      { kind: 'objective', subjectId: 'rescue-hostage', audience: 'public' },
      { kind: 'objective', subjectId: 'discover-traitor', audience: 'gm' },
      { kind: 'clock', subjectId: 'reinforcements', audience: 'public' },
      { kind: 'phase', subjectId: 'confrontation', audience: 'public' },
      { kind: 'stake', subjectId: 'public', audience: 'public' },
      { kind: 'stake', subjectId: 'gm', audience: 'gm' },
    ]))
    expect(() => applyEncounterSettlementOutcomePlan({
      plan,
      currentAuthority: authority([]),
    })).toThrow(/complete outcome authority changed before application/)
  })

  it('requires exact terminal objective/clock/phase declarations and rejects freeform hidden mechanics', () => {
    expect(() => planEncounterSettlementOutcomes({
      settlement: settlement(),
      authority: authority([{ kind: 'clock', subjectId: 'reinforcements', status: 'completed', progress: 3 }]),
    })).toThrow(/complete one current clock at its maximum/)

    expect(() => planEncounterSettlementOutcomes({
      settlement: settlement(),
      authority: authority(undefined, {
        campaignConsequences: [{
          consequenceId: 'secret-damage', visibility: 'gm', category: 'other',
          resultCode: 'damage-party', summary: 'Deal hidden damage later.',
          mechanicalEffect: 'apply-damage',
        }] as any,
      }),
    })).toThrow(/mechanicalEffect none/)

    expect(() => planEncounterSettlementOutcomes({
      settlement: settlement(),
      authority: authority([...declarations(), declarations()[0]!]),
    })).toThrow(/must not duplicate an outcome subject/)
  })

  it('retains private stakes and campaign consequences as GM facts rather than public mechanics', () => {
    const plan = planEncounterSettlementOutcomes({ settlement: settlement(), authority: authority() })
    const gmFacts = plan.outcomeFacts.filter(row => row.audience === 'gm')
    expect(gmFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: 'discover-traitor' }),
      expect.objectContaining({ kind: 'stake', subjectId: 'gm' }),
      expect.objectContaining({ kind: 'campaign-consequence', subjectId: 'rival-debt-a' }),
    ]))
    expect(plan.outcomeFacts.filter(row => row.audience === 'public').map(row => row.subjectId))
      .not.toContain('rival-debt-a')
  })

  it('fails closed for stale, denied, partial, terminal, or changed apply authority', () => {
    expect(() => planEncounterSettlementOutcomes({
      settlement: settlement(),
      authority: { ...authority(), completeness: 'partial' } as any,
    })).toThrowError(EncounterSettlementOutcomeError)

    expect(() => planEncounterSettlementOutcomes({
      settlement: settlement(),
      authority: authority(undefined, {
        encounterDocument: parseEncounterDocument({ ...encounterDocument(), revision: 13 }),
      }),
    })).toThrow(/exact current linked encounter document/)

    const denied = planEncounterSettlementOutcomes({
      settlement: settlement(),
      authority: authority(undefined, {
        authorization: {
          status: 'denied',
          authority: { kind: 'encounter-document', id: 'encounter-outcome-a', revision: 12 },
          reasonId: 'gm-authorization-required',
        },
      }),
    })
    expect(denied).toMatchObject({ complete: false, deniedReasonId: 'gm-authorization-required' })

    const currentAuthority = authority()
    const plan = planEncounterSettlementOutcomes({ settlement: settlement(), authority: currentAuthority })
    expect(() => applyEncounterSettlementOutcomePlan({
      plan,
      currentAuthority: authority(undefined, { writeTimestamp: 1_002 }),
    })).toThrow(/complete outcome authority changed before application/)

    expect(() => planEncounterSettlementOutcomes({
      settlement: settlement({ status: 'committing' }), authority: authority(),
    })).toThrow(/cannot re-plan outcomes/)
  })
})
