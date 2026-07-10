import { describe, expect, it } from 'vitest'
import type { EncounterSideDirectory } from '#shared/moveAutomation/encounterState'
import {
  MoveAutomationTargetPredicateError,
  evaluateMoveAutomationTargetPredicates,
  type MoveAutomationTargetPredicateDeclaration,
  type MoveAutomationTargetWillingnessDeclaration,
} from '~~/server/domain/moveAutomation/predicates/target'
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
} = {}) => evaluateMoveAutomationTargetPredicates({
  actorPlacementId: 'actor',
  authoritativeCandidatePlacementIds: options.candidates ?? ALL_CANDIDATES,
  requestedCandidatePlacementIds: options.requested ?? ALL_CANDIDATES,
  predicate: options.predicate ?? predicate(),
  relationships: options.relationshipResolver ?? relationships(),
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
