import { describe, expect, it } from 'vitest'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
  type EncounterSettlementRewardLine,
} from '../../shared/encounterSettlement/document'
import {
  EncounterSettlementRewardPackageError,
  planEncounterSettlementRewardPackage,
  type EncounterSettlementRewardAuthoritySnapshot,
  type EncounterSettlementRewardDestinationAuthority,
} from '../../server/domain/encounterSettlement/rewardPackage'

const encounter = {
  encounterId: 'encounter-a',
  encounterRevision: 12,
  linkedMapSlug: 'arena-a',
  linkedMapRevision: 20,
  campaignMinute: 480,
} as const

const ref = (
  kind: EncounterSettlementAuthorityRef['kind'],
  id: string,
  revision: number,
): EncounterSettlementAuthorityRef => ({ kind, id, revision })

const lines = (): EncounterSettlementRewardLine[] => [{
  rewardId: 'reward-xp-a',
  visibility: 'public',
  sourceAuthority: ref('encounter-document', 'encounter-a', 12),
  disposition: 'pending',
  payload: { kind: 'experience', amount: 100 },
}, {
  rewardId: 'reward-money-a',
  visibility: 'public',
  sourceAuthority: ref('encounter-document', 'encounter-a', 12),
  disposition: 'pending',
  payload: { kind: 'money', amount: 500 },
}, {
  rewardId: 'reward-potions-a',
  visibility: 'participant-owner',
  sourceAuthority: ref('encounter-document', 'encounter-a', 12),
  disposition: 'pending',
  payload: {
    kind: 'item',
    canonicalItemId: 'Potion',
    quantity: 3,
    serialized: false,
    definitionAuthority: ref('item-operation', 'item-definition-potion', 1),
  },
}, {
  rewardId: 'reward-armor-a',
  visibility: 'destination-owner',
  sourceAuthority: ref('encounter-document', 'encounter-a', 12),
  disposition: 'pending',
  payload: {
    kind: 'item',
    canonicalItemId: 'Light Armor',
    quantity: 1,
    serialized: true,
    definitionAuthority: ref('equipment-operation', 'equipment-definition-light-armor', 1),
  },
}, {
  rewardId: 'reward-capture-a',
  visibility: 'destination-owner',
  sourceAuthority: ref('capture-operation', 'capture-a', 1),
  disposition: 'pending',
  payload: { kind: 'capture', captureOperationId: 'capture-a', pokemonSheetSlug: 'captured-a' },
}, {
  rewardId: 'reward-story-a',
  visibility: 'public',
  sourceAuthority: ref('objective', 'objective-a', 3),
  disposition: 'pending',
  payload: { kind: 'narrative', factId: 'fact-story-a', note: 'The rescue objective was completed.' },
}, {
  rewardId: 'reward-gm-note-a',
  visibility: 'gm',
  sourceAuthority: ref('objective', 'objective-private-a', 2),
  disposition: 'pending',
  payload: { kind: 'narrative', factId: 'fact-gm-note-a', note: 'The rival now owes the party a private favour.' },
}]

const allocations = (): EncounterSettlementAllocation[] => [{
  allocationId: 'allocation-xp-side-a',
  rewardId: 'reward-xp-a',
  destination: { kind: 'side', id: 'heroes', revision: 12 },
  method: 'weighted',
  amount: 100,
  weight: 1,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}, {
  allocationId: 'allocation-money-group-a',
  rewardId: 'reward-money-a',
  destination: { kind: 'group', id: 'party-a', revision: 12 },
  method: 'fixed',
  amount: 500,
  weight: null,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}, {
  allocationId: 'allocation-potions-participant-a',
  rewardId: 'reward-potions-a',
  destination: { kind: 'participant', id: 'trainer-placement-a', revision: 7 },
  method: 'fixed',
  amount: 3,
  weight: null,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}, {
  allocationId: 'allocation-armor-group-inventory-a',
  rewardId: 'reward-armor-a',
  destination: { kind: 'group-inventory', id: 'main', revision: 5 },
  method: 'whole',
  amount: 1,
  weight: null,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}, {
  allocationId: 'allocation-capture-profile-a',
  rewardId: 'reward-capture-a',
  destination: { kind: 'profile', id: 'profile-a', revision: 2 },
  method: 'whole',
  amount: 1,
  weight: null,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}, {
  allocationId: 'allocation-story-group-a',
  rewardId: 'reward-story-a',
  destination: { kind: 'group', id: 'party-a', revision: 12 },
  method: 'whole',
  amount: 1,
  weight: null,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}, {
  allocationId: 'allocation-note-profile-a',
  rewardId: 'reward-gm-note-a',
  destination: { kind: 'profile', id: 'gm-profile-a', revision: 1 },
  method: 'whole',
  amount: 1,
  weight: null,
  state: 'proposed',
  decisionId: null,
  receiptId: null,
}]

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000074',
    rewardPackageId: 'reward-package-a',
    encounter,
  })
  return parseEncounterSettlementDocument({
    ...created,
    participants: [{
      participantId: 'pokemon-placement-a',
      sourceAuthority: ref('map', 'arena-a', 20),
      sheetKind: 'pokemon',
      sheetSlug: 'pokemon-a',
      sheetRevision: 7,
      sideId: 'heroes',
      ownerParticipantId: 'trainer-placement-a',
      settlementRole: 'combatant',
      disposition: 'active',
    }, {
      participantId: 'trainer-placement-a',
      sourceAuthority: ref('map', 'arena-a', 20),
      sheetKind: 'trainer',
      sheetSlug: 'trainer-a',
      sheetRevision: 7,
      sideId: 'heroes',
      ownerParticipantId: null,
      settlementRole: 'support',
      disposition: 'active',
    }],
    rewardPackage: { rewardPackageId: 'reward-package-a', status: 'ready', lines: lines() },
    allocations: allocations(),
    ...overrides,
  })
}

const allowed = (authority: EncounterSettlementAuthorityRef) => ({
  status: 'allowed' as const,
  authority,
  reasonId: null,
})

const destinations = (): EncounterSettlementRewardDestinationAuthority[] => [{
  destination: { kind: 'side', id: 'heroes', revision: 12 },
  permission: allowed(ref('encounter-document', 'encounter-a', 12)),
  capacity: { metric: 'unbounded', limit: null, used: null },
  writes: [{
    sourceWriteId: 'write-xp-pokemon-a',
    allocationId: 'allocation-xp-side-a',
    targetAuthority: ref('sheet', 'pokemon-a', 7),
    field: 'experience',
    amount: 100,
    countsTowardAllocation: true,
    capacityCost: 0,
  }, {
    sourceWriteId: 'write-xp-related-lifecycle-a',
    allocationId: 'allocation-xp-side-a',
    targetAuthority: ref('sheet', 'related-pokemon-a', 4),
    field: 'experience',
    amount: 0,
    countsTowardAllocation: false,
    capacityCost: 0,
  }],
}, {
  destination: { kind: 'group', id: 'party-a', revision: 12 },
  permission: allowed(ref('encounter-document', 'encounter-a', 12)),
  capacity: { metric: 'fact-slots', limit: 20, used: 3 },
  writes: [{
    sourceWriteId: 'write-money-group-a',
    allocationId: 'allocation-money-group-a',
    targetAuthority: ref('group-inventory', 'main', 5),
    field: 'money',
    amount: 500,
    countsTowardAllocation: true,
    capacityCost: 0,
  }, {
    sourceWriteId: 'write-story-group-a',
    allocationId: 'allocation-story-group-a',
    targetAuthority: ref('encounter-document', 'encounter-a', 12),
    field: 'narrative-fact',
    amount: 1,
    countsTowardAllocation: true,
    capacityCost: 1,
  }],
}, {
  destination: { kind: 'participant', id: 'trainer-placement-a', revision: 7 },
  permission: allowed(ref('sheet', 'trainer-a', 7)),
  capacity: { metric: 'quantity', limit: 99, used: 95 },
  writes: [{
    sourceWriteId: 'write-potions-trainer-a',
    allocationId: 'allocation-potions-participant-a',
    targetAuthority: ref('sheet', 'trainer-a', 7),
    field: 'inventory-stack',
    amount: 3,
    countsTowardAllocation: true,
    capacityCost: 3,
  }],
}, {
  destination: { kind: 'group-inventory', id: 'main', revision: 5 },
  permission: allowed(ref('group-inventory', 'main', 5)),
  capacity: { metric: 'slots', limit: 20, used: 19 },
  writes: [{
    sourceWriteId: 'write-armor-group-a',
    allocationId: 'allocation-armor-group-inventory-a',
    targetAuthority: ref('group-inventory', 'main', 5),
    field: 'serialized-equipment',
    amount: 1,
    countsTowardAllocation: true,
    capacityCost: 1,
  }],
}, {
  destination: { kind: 'profile', id: 'profile-a', revision: 2 },
  permission: allowed(ref('capture-operation', 'capture-a', 1)),
  capacity: { metric: 'team-slots', limit: 6, used: 5 },
  writes: [{
    sourceWriteId: 'write-capture-profile-a',
    allocationId: 'allocation-capture-profile-a',
    targetAuthority: ref('capture-operation', 'capture-a', 1),
    field: 'capture-destination',
    amount: 1,
    countsTowardAllocation: true,
    capacityCost: 1,
  }],
}, {
  destination: { kind: 'profile', id: 'gm-profile-a', revision: 1 },
  permission: allowed(ref('objective', 'objective-private-a', 2)),
  capacity: { metric: 'fact-slots', limit: 20, used: 0 },
  writes: [{
    sourceWriteId: 'write-note-profile-a',
    allocationId: 'allocation-note-profile-a',
    targetAuthority: ref('objective', 'objective-private-a', 2),
    field: 'narrative-fact',
    amount: 1,
    countsTowardAllocation: true,
    capacityCost: 1,
  }],
}]

const authority = (
  overrides: Partial<EncounterSettlementRewardAuthoritySnapshot> = {},
): EncounterSettlementRewardAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  destinations: destinations(),
  ...overrides,
})

describe('encounter settlement reward package planning', () => {
  it('models and previews XP, money, stacks, serialized equipment, capture, narrative, and GM-note writes', () => {
    const plan = planEncounterSettlementRewardPackage({
      settlement: settlement(),
      authority: authority(),
    })

    expect(plan.eligible).toBe(true)
    expect(plan.issues).toEqual([])
    expect(plan.rewardPackage.status).toBe('allocated')
    expect(plan.rewardPackage.lines.every(line => line.disposition === 'allocated')).toBe(true)
    expect(plan.allocations.every(allocation => allocation.state === 'ready')).toBe(true)
    expect(plan.writePreviews.map(preview => preview.field)).toEqual(expect.arrayContaining([
      'experience', 'money', 'inventory-stack', 'serialized-equipment',
      'capture-destination', 'narrative-fact',
    ]))
    expect(plan.writePreviews.find(preview => preview.field === 'serialized-equipment')).toMatchObject({
      amount: 1,
      capacityCost: 1,
      nextRevision: 6,
    })
    expect(plan.writePreviews.find(preview => !preview.countsTowardAllocation)).toMatchObject({
      field: 'experience',
      amount: 0,
      nextRevision: 5,
    })
    expect(plan.rewardPackage.lines.find(line => line.rewardId === 'reward-gm-note-a')).toMatchObject({
      visibility: 'gm',
      payload: { kind: 'narrative', factId: 'fact-gm-note-a' },
    })
    expect(plan.allocations.map(allocation => allocation.destination.kind)).toEqual(expect.arrayContaining([
      'group', 'side', 'participant', 'profile',
    ]))
    expect(Object.isFrozen(plan.document)).toBe(true)
  })

  it('keeps missing writes and unallocated rewards visibly pending', () => {
    const current = settlement({
      allocations: allocations().filter(allocation => allocation.rewardId !== 'reward-gm-note-a'),
    })
    const currentDestinations = destinations()
      .filter(destination => destination.destination.id !== 'gm-profile-a')
      .map(destination => destination.destination.id === 'main'
        ? { ...destination, writes: destination.writes.filter(write => write.allocationId !== 'allocation-armor-group-inventory-a') }
        : destination)

    const plan = planEncounterSettlementRewardPackage({
      settlement: current,
      authority: authority({ destinations: currentDestinations }),
    })
    expect(plan.eligible).toBe(false)
    expect(plan.issues.map(issue => issue.kind)).toEqual(expect.arrayContaining([
      'unallocated', 'missing-write-preview',
    ]))
    expect(plan.rewardPackage.lines.find(line => line.rewardId === 'reward-gm-note-a')?.disposition).toBe('pending')
    expect(plan.allocations.find(allocation => allocation.rewardId === 'reward-armor-a')?.state).toBe('proposed')
  })

  it('rejects unsupported destination and method declarations without treating them as writes', () => {
    const invalidAllocations = allocations()
    invalidAllocations[0] = {
      ...invalidAllocations[0]!,
      destination: { kind: 'profile', id: 'profile-xp-a', revision: 1 },
      method: 'whole',
      weight: null,
    }
    const invalidDestination: EncounterSettlementRewardDestinationAuthority = {
      destination: { kind: 'profile', id: 'profile-xp-a', revision: 1 },
      permission: allowed(ref('sheet', 'pokemon-a', 7)),
      capacity: { metric: 'unbounded', limit: null, used: null },
      writes: [{
        sourceWriteId: 'write-xp-profile-a',
        allocationId: 'allocation-xp-side-a',
        targetAuthority: ref('sheet', 'pokemon-a', 7),
        field: 'experience',
        amount: 100,
        countsTowardAllocation: true,
        capacityCost: 0,
      }],
    }
    const plan = planEncounterSettlementRewardPackage({
      settlement: settlement({ allocations: invalidAllocations }),
      authority: authority({
        destinations: [...destinations().filter(entry => entry.destination.kind !== 'side'), invalidDestination],
      }),
    })
    expect(plan.eligible).toBe(false)
    expect(plan.issues.map(issue => issue.kind)).toEqual(expect.arrayContaining([
      'unsupported-destination', 'unsupported-method',
    ]))
    expect(plan.allocations[0]?.state).toBe('proposed')
  })

  it('blocks stale, denied, and aggregate-over-capacity destinations before commit', () => {
    const constrained = destinations().map((destination) => {
      if (destination.destination.kind === 'participant') {
        return {
          ...destination,
          destination: { ...destination.destination, revision: 8 },
          permission: {
            status: 'denied' as const,
            authority: ref('sheet', 'trainer-a', 8),
            reasonId: 'profile-does-not-control-destination',
          },
          capacity: { metric: 'quantity' as const, limit: 97, used: 95 },
        }
      }
      return destination
    })
    const plan = planEncounterSettlementRewardPackage({
      settlement: settlement(),
      authority: authority({ destinations: constrained }),
    })

    const potionIssues = plan.issues.filter(issue => issue.rewardId === 'reward-potions-a').map(issue => issue.kind)
    expect(potionIssues).toEqual(expect.arrayContaining([
      'stale-destination', 'permission-denied', 'capacity-exceeded',
    ]))
    expect(plan.rewardPackage.lines.find(line => line.rewardId === 'reward-potions-a')?.disposition).toBe('pending')
  })

  it('requires exact whole serialized and capture previews and exact allocation totals', () => {
    const invalid = destinations().map(destination => destination.destination.kind === 'group-inventory'
      ? {
          ...destination,
          writes: [{ ...destination.writes[0]!, amount: 2, capacityCost: 0 }],
        }
      : destination.destination.id === 'profile-a'
        ? {
            ...destination,
            writes: [{
              ...destination.writes[0]!,
              targetAuthority: ref('objective', 'objective-a', 3),
              field: 'narrative-fact' as const,
            }],
          }
        : destination)
    const invalidAllocations = allocations()
    invalidAllocations[1] = { ...invalidAllocations[1]!, amount: 499 }
    const plan = planEncounterSettlementRewardPackage({
      settlement: settlement({ allocations: invalidAllocations }),
      authority: authority({ destinations: invalid }),
    })

    expect(plan.issues.map(issue => issue.kind)).toEqual(expect.arrayContaining([
      'write-preview-mismatch', 'amount-mismatch',
    ]))
    expect(plan.eligible).toBe(false)
  })

  it('fails closed for partial, duplicate, foreign, malformed, or terminal authority', () => {
    expect(() => planEncounterSettlementRewardPackage({
      settlement: settlement(),
      authority: { ...authority(), completeness: 'partial' } as any,
    })).toThrowError(EncounterSettlementRewardPackageError)

    expect(() => planEncounterSettlementRewardPackage({
      settlement: settlement(),
      authority: authority({ destinations: [...destinations(), destinations()[0]!] }),
    })).toThrow(/only one current authority per destination identity/)

    expect(() => planEncounterSettlementRewardPackage({
      settlement: settlement(),
      authority: authority({
        destinations: [...destinations(), {
          destination: { kind: 'group', id: 'foreign-a', revision: 1 },
          permission: allowed(ref('encounter-document', 'encounter-a', 12)),
          capacity: { metric: 'unbounded', limit: null, used: null },
          writes: [],
        }],
      }),
    })).toThrow(/undeclared allocation destination/)

    const malformed = destinations()
    malformed[0] = { ...malformed[0]!, writes: [{ ...malformed[0]!.writes[0]!, amount: 0 }] }
    expect(() => planEncounterSettlementRewardPackage({
      settlement: settlement(),
      authority: authority({ destinations: malformed }),
    })).toThrow(/positive allocation amount or zero related-write amount/)

    expect(() => planEncounterSettlementRewardPackage({
      settlement: settlement({ status: 'committing' }),
      authority: authority(),
    })).toThrow(/cannot re-plan rewards/)
  })
})
