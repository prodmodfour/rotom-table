import { describe, expect, it } from 'vitest'
import type { EncounterSideDirectory } from '#shared/moveAutomation/encounterState'
import {
  MoveAutomationTargetPredicateError,
  evaluateMoveAutomationTargetPredicates,
  type MoveAutomationTargetPredicateDeclaration,
  type MoveAutomationTargetWillingnessDeclaration,
} from '~~/server/domain/moveAutomation/predicates/target'
import {
  MoveAutomationTargetStatePredicateError,
  type MoveAutomationTargetStatePredicate,
} from '~~/server/domain/moveAutomation/predicates/targetState'
import type {
  MoveAutomationTargetState,
  MoveAutomationTargetStateResolver,
} from '~~/server/domain/moveAutomation/targetState'
import {
  createMoveAutomationRelationshipResolver,
  type MoveAutomationRelationshipResolver,
} from '~~/server/domain/moveAutomation/relationships'

const SIDES: EncounterSideDirectory = {
  red: { id: 'red', label: 'Red', status: 'active' },
  blue: { id: 'blue', label: 'Blue', status: 'active' },
}

const relationships = (): MoveAutomationRelationshipResolver => (
  createMoveAutomationRelationshipResolver({
    sides: SIDES,
    placements: [
      { id: 'actor', sideId: 'red' },
      { id: 'ally', sideId: 'red' },
      { id: 'enemy', sideId: 'blue' },
      { id: 'unaffiliated' },
      { id: 'outside', sideId: 'blue' },
    ],
  })
)

const ALL_CANDIDATES = ['actor', 'ally', 'enemy', 'unaffiliated'] as const

const predicate = (
  overrides: Partial<MoveAutomationTargetPredicateDeclaration> = {},
): MoveAutomationTargetPredicateDeclaration => ({
  relationship: 'any',
  willingness: 'any',
  excludeActor: false,
  ...overrides,
})

const evaluate = (options: {
  readonly predicate?: MoveAutomationTargetPredicateDeclaration
  readonly candidates?: readonly string[]
  readonly requested?: readonly string[]
  readonly willingness?: readonly MoveAutomationTargetWillingnessDeclaration[]
  readonly relationshipResolver?: MoveAutomationRelationshipResolver
  readonly stateResolver?: MoveAutomationTargetStateResolver
} = {}) => evaluateMoveAutomationTargetPredicates({
  actorPlacementId: 'actor',
  authoritativeCandidatePlacementIds: options.candidates ?? ALL_CANDIDATES,
  requestedCandidatePlacementIds: options.requested ?? ALL_CANDIDATES,
  predicate: options.predicate ?? predicate(),
  relationships: options.relationshipResolver ?? relationships(),
  states: options.stateResolver,
  willingnessDeclarations: options.willingness,
})

const exclusionReason = (
  result: ReturnType<typeof evaluate>,
  targetPlacementId: string,
): string | undefined => result.legalTargetEvaluations
  .find(evaluation => evaluation.targetPlacementId === targetPlacementId)
  ?.reasonCode

describe('authoritative relationship target predicates', () => {
  it('derives self, other, ally, enemy, same-side, and any sets from placement identity and sides', () => {
    const expected: Record<MoveAutomationTargetPredicateDeclaration['relationship'], readonly string[]> = {
      self: ['actor'],
      other: ['ally', 'enemy', 'unaffiliated'],
      ally: ['ally'],
      enemy: ['enemy'],
      'same-side': ['actor', 'ally'],
      any: ['actor', 'ally', 'enemy', 'unaffiliated'],
    }

    for (const [relationship, targetIds] of Object.entries(expected)) {
      const result = evaluate({
        predicate: predicate({
          relationship: relationship as MoveAutomationTargetPredicateDeclaration['relationship'],
        }),
      })
      expect(result.legalTargetPlacementIds, relationship).toEqual(targetIds)
      expect(result.eligibleTargetPlacementIds, relationship).toEqual(targetIds)
    }

    const allyOnly = evaluate({ predicate: predicate({ relationship: 'ally' }) })
    expect(exclusionReason(allyOnly, 'actor')).toBe('target-excluded-not-ally')
    expect(exclusionReason(allyOnly, 'enemy')).toBe('target-excluded-not-ally')
    expect(exclusionReason(allyOnly, 'unaffiliated')).toBe('target-excluded-unknown-side')
    expect(allyOnly.legalTargetEvaluations.find(({ targetPlacementId }) => (
      targetPlacementId === 'ally'
    ))).toMatchObject({
      outcome: 'included',
      reasonCode: 'target-included',
      relationship: 'ally',
      relationshipReasonCode: 'relationship-ally',
    })
  })

  it('applies explicit actor exclusion independently of broad and same-side relationships', () => {
    const anyOther = evaluate({
      predicate: predicate({ relationship: 'any', excludeActor: true }),
    })
    expect(anyOther.legalTargetPlacementIds).toEqual(['ally', 'enemy', 'unaffiliated'])
    expect(exclusionReason(anyOther, 'actor')).toBe('target-excluded-actor')

    const sameSideOther = evaluate({
      predicate: predicate({ relationship: 'same-side', excludeActor: true }),
    })
    expect(sameSideOther.legalTargetPlacementIds).toEqual(['ally'])
    expect(exclusionReason(sameSideOther, 'actor')).toBe('target-excluded-actor')
  })

  it('requires server-owned willing or unwilling declarations and fails undeclared targets closed', () => {
    const willingness: readonly MoveAutomationTargetWillingnessDeclaration[] = [
      { targetPlacementId: 'actor', willingness: 'willing' },
      { targetPlacementId: 'ally', willingness: 'willing' },
      { targetPlacementId: 'enemy', willingness: 'unwilling' },
    ]
    const willing = evaluate({
      predicate: predicate({ willingness: 'willing' }),
      willingness,
    })
    expect(willing.legalTargetPlacementIds).toEqual(['actor', 'ally'])
    expect(exclusionReason(willing, 'enemy')).toBe('target-excluded-not-willing')
    expect(exclusionReason(willing, 'unaffiliated'))
      .toBe('target-excluded-willingness-undeclared')

    const unwilling = evaluate({
      predicate: predicate({ willingness: 'unwilling' }),
      willingness,
    })
    expect(unwilling.legalTargetPlacementIds).toEqual(['enemy'])
    expect(exclusionReason(unwilling, 'actor')).toBe('target-excluded-not-unwilling')
    expect(exclusionReason(unwilling, 'unaffiliated'))
      .toBe('target-excluded-willingness-undeclared')

    const unrestricted = evaluate({ willingness })
    expect(unrestricted.legalTargetPlacementIds).toEqual(ALL_CANDIDATES)
  })

  it('treats client IDs only as distinct requests within the server-derived candidate set', () => {
    const result = evaluate({
      candidates: ['actor', 'ally'],
      requested: ['outside', 'ally', 'ally', 'missing', 'actor'],
      predicate: predicate({ excludeActor: true }),
    })

    expect(result.legalTargetPlacementIds).toEqual(['ally'])
    expect(result.eligibleTargetPlacementIds).toEqual(['ally'])
    expect(result.requestedTargetEvaluations.map(evaluation => ({
      id: evaluation.targetPlacementId,
      outcome: evaluation.outcome,
      reasonCode: evaluation.reasonCode,
    }))).toEqual([
      {
        id: 'outside',
        outcome: 'excluded',
        reasonCode: 'target-excluded-not-authoritative-candidate',
      },
      { id: 'ally', outcome: 'included', reasonCode: 'target-included' },
      { id: 'ally', outcome: 'excluded', reasonCode: 'target-excluded-duplicate' },
      { id: 'missing', outcome: 'excluded', reasonCode: 'target-excluded-placement-missing' },
      { id: 'actor', outcome: 'excluded', reasonCode: 'target-excluded-actor' },
    ])
  })

  it('uses authoritative ordering and returns detached immutable evidence', () => {
    const candidates = ['actor', 'ally', 'enemy']
    const requested = ['enemy', 'actor', 'ally']
    const declaration = {
      relationship: 'any' as const,
      willingness: 'any' as const,
      excludeActor: false,
    }
    const willingness = [{
      targetPlacementId: 'ally',
      willingness: 'willing' as MoveAutomationTargetWillingnessDeclaration['willingness'],
    }]
    const result = evaluate({
      candidates,
      requested,
      predicate: declaration,
      willingness,
    })

    candidates.reverse()
    requested.length = 0
    declaration.excludeActor = true
    willingness[0]!.willingness = 'unwilling'

    expect(result.eligibleTargetPlacementIds).toEqual(['actor', 'ally', 'enemy'])
    expect(result.predicate).toEqual({
      relationship: 'any',
      willingness: 'any',
      excludeActor: false,
    })
    expect(result.legalTargetEvaluations[1]).toMatchObject({
      targetPlacementId: 'ally',
      willingness: 'willing',
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.predicate)).toBe(true)
    expect(Object.isFrozen(result.eligibleTargetPlacementIds)).toBe(true)
    expect(Object.isFrozen(result.legalTargetEvaluations)).toBe(true)
    expect(Object.isFrozen(result.legalTargetEvaluations[0])).toBe(true)
  })

  it('rejects malformed authoritative inputs before evaluating mechanics', () => {
    expect(() => evaluate({ candidates: ['ally', 'ally'] })).toThrowError(
      expect.objectContaining({
        name: MoveAutomationTargetPredicateError.name,
        code: 'duplicate-authoritative-candidate',
      }),
    )
    expect(() => evaluate({
      willingness: [
        { targetPlacementId: 'ally', willingness: 'willing' },
        { targetPlacementId: 'ally', willingness: 'unwilling' },
      ],
    })).toThrowError(expect.objectContaining({ code: 'duplicate-willingness-declaration' }))
    expect(() => evaluate({
      requested: Array.from({ length: 33 }, (_, index) => `target-${index}`),
    })).toThrowError(expect.objectContaining({ code: 'too-many-requested-targets' }))

    const missingActor = createMoveAutomationRelationshipResolver({
      sides: SIDES,
      placements: [{ id: 'ally', sideId: 'red' }],
    })
    expect(() => evaluate({ relationshipResolver: missingActor }))
      .toThrowError(expect.objectContaining({ code: 'actor-placement-missing' }))
  })
})

const targetState = (
  targetPlacementId: string,
  overrides: Partial<MoveAutomationTargetState> = {},
): MoveAutomationTargetState => ({
  targetPlacementId,
  vitality: 'conscious',
  grounding: 'grounded',
  semiInvulnerable: 'none',
  switchedThisScene: false,
  actedThisTurn: false,
  actedThisRound: false,
  damagedThisTurn: false,
  damagedThisRound: false,
  conditionIds: [],
  typeIds: [],
  capabilityIds: [],
  immunityTagIds: [],
  size: 'medium',
  weightClass: 2,
  sheetKind: 'pokemon',
  itemIds: [],
  ...overrides,
  gender: overrides.gender ?? 'unknown',
})

const TARGET_STATES = new Map<string, MoveAutomationTargetState>([
  ['actor', targetState('actor', {
    actedThisTurn: true,
    actedThisRound: true,
    typeIds: ['electric', 'grass'],
    size: 'small',
    weightClass: 1,
    gender: 'male',
    itemIds: ['light-ball'],
  })],
  ['ally', targetState('ally', {
    grounding: 'airborne',
    switchedThisScene: true,
    damagedThisTurn: true,
    damagedThisRound: true,
    conditionIds: ['burned'],
    typeIds: ['grass', 'flying'],
    capabilityIds: ['capability.magnetic'],
    immunityTagIds: ['groundsource', 'powder'],
    size: 'large',
    weightClass: 4,
    gender: 'female',
    itemIds: ['sitrus-berry'],
  })],
  ['enemy', targetState('enemy', {
    vitality: 'fainted',
    actedThisTurn: true,
    actedThisRound: true,
    damagedThisRound: true,
    conditionIds: ['poisoned'],
    immunityTagIds: ['sonic'],
    size: null,
    weightClass: null,
    sheetKind: 'trainer',
    itemIds: ['protective-gear'],
  })],
  ['unaffiliated', targetState('unaffiliated', { typeIds: ['normal'] })],
])

const stateResolver = (
  states: ReadonlyMap<string, MoveAutomationTargetState> = TARGET_STATES,
): MoveAutomationTargetStateResolver => Object.freeze({
  resolve: (targetPlacementId: string) => states.get(targetPlacementId) ?? null,
})

const withState = (
  ...statePredicates: readonly MoveAutomationTargetStatePredicate[]
): MoveAutomationTargetPredicateDeclaration => predicate({ statePredicates })

describe('authoritative target state predicates', () => {
  it('evaluates every supported state, history, identity, and item predicate', () => {
    const cases: readonly [
      string,
      MoveAutomationTargetStatePredicate,
      readonly string[],
    ][] = [
      ['vitality', { kind: 'vitality', value: 'fainted' }, ['enemy']],
      ['grounding', { kind: 'grounding', value: 'airborne' }, ['ally']],
      ['switched', { kind: 'switched', value: true }, ['ally']],
      ['acted', { kind: 'acted', window: 'turn', value: false }, ['ally', 'unaffiliated']],
      ['damaged', { kind: 'damaged', window: 'round', value: true }, ['ally', 'enemy']],
      ['condition', { kind: 'condition', conditionIds: ['burned'], match: 'any' }, ['ally']],
      ['type', { kind: 'type', typeIds: ['grass', 'flying'], match: 'all' }, ['ally']],
      ['shares type', { kind: 'shares-type-with-actor' }, ['actor', 'ally']],
      [
        'type or capability',
        {
          kind: 'type-or-capability',
          typeIds: ['electric'],
          capabilityIds: ['capability.magnetic'],
        },
        ['actor', 'ally'],
      ],
      [
        'immunity tag',
        { kind: 'immunity-tag', immunityTagIds: ['groundsource', 'powder'], match: 'all' },
        ['ally'],
      ],
      ['size', { kind: 'size', sizes: ['large'] }, ['ally']],
      ['weight class', { kind: 'weight-class', minimum: 3, maximum: 5 }, ['ally']],
      ['opposite gender', { kind: 'opposite-gender' }, ['ally']],
      ['sheet kind', { kind: 'sheet-kind', sheetKinds: ['trainer'] }, ['enemy']],
      [
        'required item',
        { kind: 'required-item', itemIds: ['sitrus-berry'], match: 'any' },
        ['ally'],
      ],
    ]

    for (const [label, statePredicate, expected] of cases) {
      const result = evaluate({
        predicate: withState(statePredicate),
        stateResolver: stateResolver(),
      })
      expect(result.legalTargetPlacementIds, label).toEqual(expected)
      expect(result.eligibleTargetPlacementIds, label).toEqual(expected)
    }
  })

  it('supports explicit any, all, and none set matching without reading prose', () => {
    expect(evaluate({
      predicate: withState({
        kind: 'type',
        typeIds: ['electric', 'grass'],
        match: 'any',
      }),
      stateResolver: stateResolver(),
    }).legalTargetPlacementIds).toEqual(['actor', 'ally'])

    expect(evaluate({
      predicate: withState({
        kind: 'condition',
        conditionIds: ['burned', 'poisoned'],
        match: 'none',
      }),
      stateResolver: stateResolver(),
    }).legalTargetPlacementIds).toEqual(['actor', 'unaffiliated'])

    expect(evaluate({
      predicate: withState({
        kind: 'required-item',
        itemIds: ['light-ball', 'potion'],
        match: 'all',
      }),
      stateResolver: stateResolver(),
    }).legalTargetPlacementIds).toEqual([])
  })

  it('applies state clauses after relationship and willingness gates with first-failure reasons', () => {
    const result = evaluate({
      predicate: withState(
        { kind: 'vitality', value: 'conscious' },
        { kind: 'grounding', value: 'grounded' },
      ),
      stateResolver: stateResolver(),
    })

    expect(result.legalTargetPlacementIds).toEqual(['actor', 'unaffiliated'])
    expect(exclusionReason(result, 'ally')).toBe('target-excluded-not-grounded')
    expect(exclusionReason(result, 'enemy')).toBe('target-excluded-not-conscious')

    const stateReads: string[] = []
    const enemyOnly = evaluate({
      predicate: predicate({
        relationship: 'enemy',
        statePredicates: [{ kind: 'vitality', value: 'fainted' }],
      }),
      stateResolver: {
        resolve: (targetPlacementId) => {
          stateReads.push(targetPlacementId)
          return TARGET_STATES.get(targetPlacementId) ?? null
        },
      },
    })
    expect(enemyOnly.legalTargetPlacementIds).toEqual(['enemy'])
    expect(exclusionReason(enemyOnly, 'ally')).toBe('target-excluded-not-enemy')
    expect(stateReads).toEqual(['enemy'])
  })

  it('consults actor state only for reviewed cross-subject predicates', () => {
    const stateReads: string[] = []
    const result = evaluate({
      predicate: withState({ kind: 'opposite-gender' }),
      stateResolver: {
        resolve: (targetPlacementId) => {
          stateReads.push(targetPlacementId)
          return TARGET_STATES.get(targetPlacementId) ?? null
        },
      },
    })

    expect(result.legalTargetPlacementIds).toEqual(['ally'])
    expect(exclusionReason(result, 'enemy')).toBe('target-excluded-gender')
    expect(exclusionReason(result, 'unaffiliated')).toBe('target-excluded-gender')
    expect(stateReads.filter(id => id === 'actor')).toHaveLength(5)
  })

  it('fails unavailable target facts closed and requires the server-owned query seam', () => {
    expect(() => evaluate({
      predicate: withState({ kind: 'vitality', value: 'conscious' }),
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationTargetPredicateError.name,
      code: 'target-state-resolver-missing',
    }))

    const states = new Map(TARGET_STATES)
    states.delete('unaffiliated')
    const result = evaluate({
      predicate: withState({ kind: 'vitality', value: 'conscious' }),
      stateResolver: stateResolver(states),
    })
    expect(exclusionReason(result, 'unaffiliated')).toBe('target-excluded-state-unavailable')
  })

  it('strictly validates bounded state declarations and freezes detached evidence', () => {
    expect(() => evaluate({
      predicate: predicate({
        statePredicates: [{ kind: 'weight-class', minimum: 5, maximum: 2 }],
      }),
      stateResolver: stateResolver(),
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationTargetStatePredicateError.name,
      code: 'invalid-target-state-predicate',
    }))
    expect(() => evaluate({
      predicate: predicate({
        statePredicates: [
          { kind: 'vitality', value: 'conscious' },
          { kind: 'vitality', value: 'fainted' },
        ],
      }),
      stateResolver: stateResolver(),
    })).toThrowError(expect.objectContaining({ code: 'duplicate-predicate-kind' }))
    expect(() => evaluate({
      predicate: predicate({
        statePredicates: [{
          kind: 'condition',
          conditionIds: ['burned', 'burned'],
          match: 'all',
        }],
      }),
      stateResolver: stateResolver(),
    })).toThrowError(expect.objectContaining({ code: 'duplicate-id' }))
    expect(() => evaluate({
      predicate: predicate({
        statePredicates: [{ kind: 'type', typeIds: ['unknown'], match: 'any' }],
      }),
      stateResolver: stateResolver(),
    })).toThrowError(expect.objectContaining({ code: 'invalid-target-state-predicate' }))
    expect(() => evaluate({
      predicate: {
        ...predicate(),
        statePredicates: [{ kind: 'vitality', value: 'conscious', script: 'forged' }],
      } as unknown as MoveAutomationTargetPredicateDeclaration,
      stateResolver: stateResolver(),
    })).toThrowError(expect.objectContaining({ code: 'invalid-target-state-predicate' }))

    const mutableTypePredicate = {
      kind: 'type' as const,
      typeIds: ['grass'],
      match: 'any' as const,
    }
    const statePredicates: MoveAutomationTargetStatePredicate[] = [mutableTypePredicate]
    const result = evaluate({
      predicate: predicate({ statePredicates }),
      stateResolver: stateResolver(),
    })
    mutableTypePredicate.typeIds.push('electric')

    expect(result.predicate.statePredicates).toEqual([{
      kind: 'type',
      typeIds: ['grass'],
      match: 'any',
    }])
    expect(Object.isFrozen(result.predicate.statePredicates)).toBe(true)
    expect(Object.isFrozen(result.predicate.statePredicates?.[0])).toBe(true)
  })
})
