import { describe, expect, it } from 'vitest'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import {
  encounterSettlementDestinationProjectionKey,
  type EncounterSettlementProjectionContext,
} from '#shared/encounterSettlement/projection'
import {
  gmEncounterSettlementProjectionContext,
  projectEncounterSettlement,
  projectEncounterSettlementHistory,
  publicEncounterSettlementProjectionContext,
} from '../../server/domain/encounterSettlement/projection'
import { encounterSettlementRealtimeAppendInputs } from '../../server/realtime/encounterSettlementRealtime'
import { filterRealtimeEventsForPrincipal } from '../../server/realtime/realtimeEventAccessPolicy'

const settlement = (): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:projection-a',
    rewardPackageId: 'reward-package-projection-a',
    encounter: {
      encounterId: 'encounter-projection-a', encounterRevision: 7,
      linkedMapSlug: 'projection-arena', linkedMapRevision: 9, campaignMinute: 500,
    },
  })
  return parseEncounterSettlementDocument({
    ...created,
    revision: 1,
    status: 'ready',
    participants: [{
      participantId: 'participant-owned-a',
      sourceAuthority: { kind: 'map', id: 'projection-arena', revision: 9 },
      sheetKind: 'pokemon', sheetSlug: 'owned-mon', sheetRevision: 4,
      sideId: 'heroes', ownerParticipantId: null, settlementRole: 'combatant', disposition: 'active',
    }, {
      participantId: 'participant-other-a',
      sourceAuthority: { kind: 'map', id: 'projection-arena', revision: 9 },
      sheetKind: 'pokemon', sheetSlug: 'other-mon', sheetRevision: 3,
      sideId: 'heroes', ownerParticipantId: null, settlementRole: 'combatant', disposition: 'active',
    }],
    unresolvedGates: [{
      gateId: 'gate-public-a', kind: 'unallocated-reward', blocking: true, audience: 'public',
      authorityRefs: [{ kind: 'encounter-document', id: 'encounter-projection-a', revision: 7 }],
      participantIds: [], resolutionKinds: ['allocate'], openedAtSettlementRevision: 1,
    }, {
      gateId: 'gate-gm-secret-a', kind: 'gm-adjudication', blocking: true, audience: 'gm',
      authorityRefs: [{ kind: 'encounter-document', id: 'encounter-projection-a', revision: 7 }],
      participantIds: ['participant-other-a'], resolutionKinds: ['adjudicate'], openedAtSettlementRevision: 1,
    }],
    persistentConsequences: [{
      consequenceId: 'consequence-owned-hp-a', participantId: 'participant-owned-a', kind: 'hp',
      authority: { kind: 'sheet', id: 'owned-mon', revision: 4 }, field: 'combat.currentHp',
      behavior: 'preserve', snapshot: { kind: 'integer', before: 8, after: 8 },
      state: 'ready', decisionId: null, receiptId: null,
    }, {
      consequenceId: 'consequence-other-injury-a', participantId: 'participant-other-a', kind: 'injuries',
      authority: { kind: 'sheet', id: 'other-mon', revision: 3 }, field: 'combat.injuries',
      behavior: 'preserve', snapshot: { kind: 'integer', before: 2, after: 2 },
      state: 'ready', decisionId: null, receiptId: null,
    }],
    rewardPackage: {
      rewardPackageId: 'reward-package-projection-a', status: 'ready',
      lines: [{
        rewardId: 'reward-public-xp-a', visibility: 'public',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-projection-a', revision: 7 },
        disposition: 'pending', payload: { kind: 'experience', amount: 50 },
      }, {
        rewardId: 'reward-owner-money-a', visibility: 'destination-owner',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-projection-a', revision: 7 },
        disposition: 'pending', payload: { kind: 'money', amount: 125 },
      }, {
        rewardId: 'reward-gm-note-a', visibility: 'gm',
        sourceAuthority: { kind: 'objective', id: 'private-objective-a', revision: 2 },
        disposition: 'pending',
        payload: { kind: 'narrative', factId: 'fact-private-note-a', note: 'SECRET GM NOTE: rival betrayal.' },
      }],
    },
    allocations: [{
      allocationId: 'allocation-public-xp-a', rewardId: 'reward-public-xp-a',
      destination: { kind: 'participant', id: 'participant-owned-a', revision: 4 },
      method: 'fixed', amount: 50, weight: null, state: 'proposed', decisionId: null, receiptId: null,
    }, {
      allocationId: 'allocation-owner-money-a', rewardId: 'reward-owner-money-a',
      destination: { kind: 'pokemon-sheet', id: 'owned-mon', revision: 4 },
      method: 'fixed', amount: 125, weight: null, state: 'proposed', decisionId: null, receiptId: null,
    }],
    temporaryCleanup: [{
      cleanupId: 'cleanup-private-source-a', kind: 'combat-stages',
      authority: { kind: 'map', id: 'projection-arena', revision: 9 },
      participantIds: ['participant-owned-a'], sourceIds: ['private-source-id-a'],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }],
    updatedAtCampaignMinute: 500,
  })
}

const ownerContext = (): EncounterSettlementProjectionContext => ({
  audience: 'owner',
  ownedParticipantIds: new Set(['participant-owned-a']),
  ownedDestinationKeys: new Set([
    encounterSettlementDestinationProjectionKey('participant', 'participant-owned-a'),
    encounterSettlementDestinationProjectionKey('pokemon-sheet', 'owned-mon'),
  ]),
  ownedHistorySubjectIds: new Set(['owned-mon', 'pokemon-sheet:owned-mon']),
})

const history = () => [{
  factId: 'history-public-a', kind: 'completion' as const, audience: 'public' as const,
  subjectKind: 'settlement' as const, subjectId: 'internal-settlement-id', resultCode: 'settlement-completed',
  payload: { schemaVersion: 1 }, createdAtCampaignMinute: 501,
}, {
  factId: 'history-owner-a', kind: 'loot-award' as const, audience: 'destination-owner' as const,
  subjectKind: 'inventory' as const, subjectId: 'pokemon-sheet:owned-mon', resultCode: 'money-committed',
  payload: { rewardId: 'private-reward-row', amount: 125 }, createdAtCampaignMinute: 500,
}, {
  factId: 'history-gm-a', kind: 'outcome' as const, audience: 'gm' as const,
  subjectKind: 'outcome' as const, subjectId: 'private-outcome-id', resultCode: 'private-outcome',
  payload: { kind: 'narrative', summary: 'SECRET GM HISTORY', mechanicalEffect: 'none' },
  createdAtCampaignMinute: 500,
}]

describe('encounter settlement privacy projections', () => {
  it('shows public, owner, and GM rewards and consequences without internal identities', () => {
    const document = settlement()
    const publicProjection = projectEncounterSettlement({
      settlement: document, context: publicEncounterSettlementProjectionContext(),
    })
    const ownerProjection = projectEncounterSettlement({ settlement: document, context: ownerContext() })
    const gmProjection = projectEncounterSettlement({
      settlement: document, context: gmEncounterSettlementProjectionContext(),
    })

    expect(publicProjection.rewards).toEqual([
      { kind: 'experience', amount: 50, disposition: 'pending' },
    ])
    expect(publicProjection.unresolvedGates).toEqual([{ kind: 'unallocated-reward', resolutionKinds: ['allocate'] }])
    expect(publicProjection.consequences).toEqual([])
    expect(ownerProjection.rewards).toEqual([
      { kind: 'experience', amount: 50, disposition: 'pending' },
      { kind: 'money', amount: 125, disposition: 'pending' },
    ])
    expect(ownerProjection.consequences).toEqual([
      { kind: 'hp', behavior: 'preserve', state: 'ready' },
    ])
    expect(gmProjection.rewards.at(-1)).toEqual({
      kind: 'narrative', summary: 'SECRET GM NOTE: rival betrayal.', disposition: 'pending',
    })
    expect(gmProjection.consequences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hp', field: 'combat.currentHp', before: 8, after: 8 }),
      expect.objectContaining({ kind: 'injuries', field: 'combat.injuries', before: 2, after: 2 }),
    ]))

    const publicJson = JSON.stringify(publicProjection)
    const ownerJson = JSON.stringify(ownerProjection)
    for (const serialized of [publicJson, ownerJson]) {
      expect(serialized).not.toContain('SECRET GM')
      expect(serialized).not.toContain('reward-')
      expect(serialized).not.toContain('allocation-')
      expect(serialized).not.toContain('private-source-id')
      expect(serialized).not.toContain('operationId')
      expect(serialized).not.toContain('receiptId')
      expect(serialized).not.toContain('Sha256')
    }
  })

  it('filters and sanitizes history without fact, reward, operation, or private subject identities', () => {
    const publicFacts = projectEncounterSettlementHistory({
      facts: history(), context: publicEncounterSettlementProjectionContext(),
    })
    const ownerFacts = projectEncounterSettlementHistory({ facts: history(), context: ownerContext() })
    const gmFacts = projectEncounterSettlementHistory({
      facts: history(), context: gmEncounterSettlementProjectionContext(),
    })

    expect(publicFacts).toEqual([
      { kind: 'completion', resultCode: 'settlement-completed', detail: {}, createdAtCampaignMinute: 501 },
    ])
    expect(ownerFacts).toEqual([
      { kind: 'completion', resultCode: 'settlement-completed', detail: {}, createdAtCampaignMinute: 501 },
      { kind: 'loot-award', resultCode: 'money-committed', detail: { amount: 125 }, createdAtCampaignMinute: 500 },
    ])
    expect(gmFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'outcome', detail: expect.objectContaining({ summary: 'SECRET GM HISTORY' }) }),
    ]))
    expect(JSON.stringify(ownerFacts)).not.toMatch(/history-|private-reward-row|internal-settlement-id|private-outcome-id/)
    expect(() => projectEncounterSettlementHistory({
      facts: history(), context: ownerContext(), limit: 51,
    })).toThrow('Encounter settlement history limit must be from 1 through 50.')
  })

  it('journals separate public, GM, and authority-gated owner realtime projections', () => {
    const events = encounterSettlementRealtimeAppendInputs({
      settlement: settlement(), history: history(), kind: 'updated', timestamp: 1_000,
    })
    const publicEvent = events.find(row => row.access.kind === 'map-access')!
    const gmEvent = events.find(row => row.access.kind === 'gm-only')!
    const ownerEvent = events.find(row => row.access.kind === 'sheet-access'
      && row.access.sheetSlug === 'owned-mon')!

    expect(events).toHaveLength(4)
    expect(publicEvent.event.type).toBe('encounter-settlement-updated')
    expect(gmEvent.event.type).toBe('encounter-settlement-updated')
    expect(JSON.stringify(publicEvent.event)).not.toContain('SECRET GM')
    expect(JSON.stringify(ownerEvent.event)).not.toContain('SECRET GM')
    expect(JSON.stringify(gmEvent.event)).toContain('SECRET GM NOTE')
    expect(JSON.stringify(events)).not.toContain('settlement-operation')
    expect(new Set(events.map(row => row.dedupeKey)).size).toBe(events.length)

    const deliveredToGm = filterRealtimeEventsForPrincipal({
      events: events.map((row, index) => ({
        sequence: index + 1,
        access: row.access,
        event: { ...row.event, sequence: index + 1, timestamp: 1_000 },
      })),
      principal: { role: 'gm' },
      dependencies: {
        getMap: () => null,
        getSheet: () => null,
        getGroupInventory: () => null,
        listTrainerSheets: () => [],
        playerVisibleMapSheetAccessKeys: () => new Set(),
      },
    })
    expect(deliveredToGm.allowed).toHaveLength(1)
    expect((deliveredToGm.allowed[0]!.event.data as { settlement: { audience: string } }).settlement.audience)
      .toBe('gm')
    expect(deliveredToGm.denied).toHaveLength(events.length - 1)
  })
})
