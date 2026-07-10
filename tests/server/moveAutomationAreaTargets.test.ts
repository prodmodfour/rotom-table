import { describe, expect, it } from 'vitest'
import {
  MoveAutomationAreaTargetError,
  resolveMoveAutomationAreaTargets,
} from '~~/server/domain/moveAutomation/areaTargets'
import {
  createMoveAutomationRelationshipResolver,
} from '~~/server/domain/moveAutomation/relationships'
import type {
  MoveAutomationTargetState,
  MoveAutomationTargetStateResolver,
} from '~~/server/domain/moveAutomation/targetState'
import type {
  MoveAutomationTargetPredicateDeclaration,
} from '~~/server/domain/moveAutomation/predicates/target'

const relationships = () => createMoveAutomationRelationshipResolver({
  sides: {
    red: { id: 'red', label: 'Red', status: 'active' },
    blue: { id: 'blue', label: 'Blue', status: 'active' },
  },
  placements: [
    { id: 'actor', sideId: 'red' },
    { id: 'ally', sideId: 'red' },
    { id: 'enemy', sideId: 'blue' },
    { id: 'unknown' },
    { id: 'outside', sideId: 'blue' },
  ],
})

const predicate = (
  relationship: MoveAutomationTargetPredicateDeclaration['relationship'],
  statePredicates?: MoveAutomationTargetPredicateDeclaration['statePredicates'],
): MoveAutomationTargetPredicateDeclaration => ({
  relationship,
  willingness: 'any',
  excludeActor: true,
  ...(statePredicates ? { statePredicates } : {}),
})

const targetState = (
  targetPlacementId: string,
  vitality: MoveAutomationTargetState['vitality'] = 'conscious',
): MoveAutomationTargetState => ({
  targetPlacementId,
  vitality,
  grounding: 'grounded',
  switchedThisScene: false,
  actedThisTurn: false,
  actedThisRound: false,
  damagedThisTurn: false,
  damagedThisRound: false,
  conditionIds: [],
  typeIds: [],
  immunityTagIds: [],
  size: 'medium',
  weightClass: 2,
  sheetKind: 'pokemon',
  itemIds: [],
})

const stateResolver = (
  reads: string[],
  states: ReadonlyMap<string, MoveAutomationTargetState>,
): MoveAutomationTargetStateResolver => Object.freeze({
  resolve: (targetPlacementId: string) => {
    reads.push(targetPlacementId)
    return states.get(targetPlacementId) ?? null
  },
})

const resolve = (options: {
  readonly relationship?: MoveAutomationTargetPredicateDeclaration['relationship']
  readonly statePredicates?: MoveAutomationTargetPredicateDeclaration['statePredicates']
  readonly exclusions?: readonly string[]
  readonly geometry?: readonly string[]
  readonly states?: MoveAutomationTargetStateResolver
} = {}) => resolveMoveAutomationAreaTargets({
  actorPlacementId: 'actor',
  geometricallyAffectedPlacementIds: options.geometry ?? ['ally', 'enemy', 'unknown'],
  predicate: predicate(options.relationship ?? 'any', options.statePredicates),
  relationships: relationships(),
  states: options.states,
  requestedExcludedPlacementIds: options.exclusions,
})

describe('authoritative area target filtering', () => {
  it('derives ally-only, enemy-only, and all-target sets from geometry before mechanics', () => {
    expect(resolve({ relationship: 'ally' }).eligibleTargetPlacementIds).toEqual(['ally'])
    expect(resolve({ relationship: 'enemy' }).eligibleTargetPlacementIds).toEqual(['enemy'])
    expect(resolve({ relationship: 'any' }).eligibleTargetPlacementIds).toEqual([
      'ally',
      'enemy',
      'unknown',
    ])

    const allyOnly = resolve({ relationship: 'ally' })
    expect(allyOnly.evaluations).toEqual([
      expect.objectContaining({
        targetPlacementId: 'ally',
        outcome: 'included',
        reasonCode: 'target-included',
      }),
      expect.objectContaining({
        targetPlacementId: 'enemy',
        outcome: 'excluded',
        reasonCode: 'target-excluded-not-ally',
        relationshipReasonCode: 'relationship-enemy',
      }),
      expect.objectContaining({
        targetPlacementId: 'unknown',
        outcome: 'excluded',
        reasonCode: 'target-excluded-unknown-side',
      }),
    ])
  })

  it('evaluates state only for geometrically affected placements and records exact reasons', () => {
    const reads: string[] = []
    const states = new Map([
      ['ally', targetState('ally')],
      ['enemy', targetState('enemy', 'fainted')],
      ['unknown', targetState('unknown')],
      ['outside', targetState('outside', 'fainted')],
    ])
    const result = resolve({
      relationship: 'any',
      statePredicates: [{ kind: 'vitality', value: 'conscious' }],
      states: stateResolver(reads, states),
    })

    expect(reads).toEqual(['ally', 'enemy', 'unknown'])
    expect(result.geometricallyAffectedPlacementIds).toEqual(['ally', 'enemy', 'unknown'])
    expect(result.eligibleTargetPlacementIds).toEqual(['ally', 'unknown'])
    expect(result.evaluations[1]).toMatchObject({
      targetPlacementId: 'enemy',
      outcome: 'excluded',
      reasonCode: 'target-excluded-not-conscious',
    })
    expect(result.evaluations.some(({ targetPlacementId }) => targetPlacementId === 'outside'))
      .toBe(false)
  })

  it('applies reviewed Friendly exclusions after predicates without changing server order', () => {
    const result = resolve({
      relationship: 'any',
      exclusions: ['enemy'],
    })

    expect(result.eligibleTargetPlacementIds).toEqual(['ally', 'unknown'])
    expect(result.evaluations[1]).toMatchObject({
      targetPlacementId: 'enemy',
      outcome: 'excluded',
      reasonCode: 'requested-friendly-exclusion',
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.evaluations)).toBe(true)
    expect(Object.isFrozen(result.evaluations[0])).toBe(true)
  })

  it('rejects exclusions that attempt to widen or duplicate geometry', () => {
    expect(() => resolve({ exclusions: ['outside'] })).toThrowError(expect.objectContaining({
      name: MoveAutomationAreaTargetError.name,
      code: 'requested-exclusion-outside-geometry',
    }))
    expect(() => resolve({ exclusions: ['ally', 'ally'] })).toThrowError(expect.objectContaining({
      code: 'duplicate-requested-exclusion',
    }))
  })
})
