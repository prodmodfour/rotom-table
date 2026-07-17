import { describe, expect, it } from 'vitest'
import { MOVE_SPEC_LIMITS } from '#shared/moveAutomation/spec'
import {
  MoveAutomationAreaTargetError,
  resolveMoveAutomationAreaTargets,
} from '~~/server/domain/moveAutomation/areaTargets'
import {
  createMoveAutomationRelationshipResolver,
} from '~~/server/domain/moveAutomation/relationships'
import {
  createMoveAutomationLineOfSightResolver,
  type MoveAutomationLineOfSightResolver,
} from '~~/server/domain/moveAutomation/lineOfSight'
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
  semiInvulnerable: 'none',
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
  readonly lineOfSight?: MoveAutomationLineOfSightResolver
} = {}) => resolveMoveAutomationAreaTargets({
  actorPlacementId: 'actor',
  geometricallyAffectedPlacementIds: options.geometry ?? ['ally', 'enemy', 'unknown'],
  predicate: predicate(options.relationship ?? 'any', options.statePredicates),
  relationships: relationships(),
  states: options.states,
  lineOfSight: options.lineOfSight,
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

  it('excludes geometrically affected recipients behind authoritative Blocking Terrain', () => {
    const lineOfSight = createMoveAutomationLineOfSightResolver({
      voxels: [],
      placements: [
        { id: 'actor', position: { x: 0, y: 0, z: 0 }, base: 1 },
        { id: 'ally', position: { x: 1, y: 0, z: 0 }, base: 1 },
        { id: 'enemy', position: { x: 4, y: 0, z: 0 }, base: 1 },
        { id: 'unknown', position: { x: 0, y: 0, z: 4 }, base: 1 },
      ],
      barrierCells: [{
        zoneId: 'zone.barrier.area-cover',
        source: {
          kind: 'operation',
          operationId: 'operation.barrier',
          moveId: 'barrier',
          placementId: 'actor',
        },
        sideId: 'red',
        cell: { x: 2, y: 0, z: 0 },
      }],
    })

    const result = resolve({ lineOfSight })

    expect(result.eligibleTargetPlacementIds).toEqual(['ally', 'unknown'])
    expect(result.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetPlacementId: 'enemy',
        outcome: 'excluded',
        reasonCode: 'target-excluded-line-of-sight',
      }),
    ]))
  })

  it('preserves authoritative geometry order and applies Friendly exclusions after predicates', () => {
    const result = resolve({
      relationship: 'any',
      geometry: ['unknown', 'enemy', 'ally'],
      exclusions: ['enemy'],
    })

    expect(result.geometricallyAffectedPlacementIds).toEqual(['unknown', 'enemy', 'ally'])
    expect(result.eligibleTargetPlacementIds).toEqual(['unknown', 'ally'])
    expect(result.evaluations.map(({ targetPlacementId }) => targetPlacementId)).toEqual([
      'unknown',
      'enemy',
      'ally',
    ])
    expect(result.evaluations[1]).toMatchObject({
      targetPlacementId: 'enemy',
      outcome: 'excluded',
      reasonCode: 'requested-friendly-exclusion',
    })

    const alreadyIllegal = resolve({
      relationship: 'enemy',
      exclusions: ['ally'],
    })
    expect(alreadyIllegal.eligibleTargetPlacementIds).toEqual(['enemy'])
    expect(alreadyIllegal.evaluations[0]).toMatchObject({
      targetPlacementId: 'ally',
      outcome: 'excluded',
      reasonCode: 'target-excluded-not-enemy',
    })
  })

  it('rejects duplicate, out-of-area, and oversized geometric input or Friendly exclusions', () => {
    expect(() => resolve({ exclusions: ['outside'] })).toThrowError(expect.objectContaining({
      name: MoveAutomationAreaTargetError.name,
      code: 'requested-exclusion-outside-geometry',
    }))
    expect(() => resolve({ exclusions: ['ally', 'ally'] })).toThrowError(expect.objectContaining({
      code: 'duplicate-requested-exclusion',
    }))
    expect(() => resolve({ geometry: ['ally', 'ally'] })).toThrowError(expect.objectContaining({
      code: 'duplicate-geometric-candidate',
    }))
    expect(() => resolve({
      geometry: Array.from(
        { length: MOVE_SPEC_LIMITS.targetCount + 1 },
        (_, index) => `target-${index}`,
      ),
    })).toThrowError(expect.objectContaining({
      code: 'too-many-geometric-candidates',
    }))
  })

  it('detaches and deeply freezes geometry, predicates, exclusions, and decision results', () => {
    const geometry = ['ally', 'enemy', 'unknown']
    const exclusions = ['enemy']
    const declaration = {
      relationship: 'any' as MoveAutomationTargetPredicateDeclaration['relationship'],
      willingness: 'any' as const,
      excludeActor: true,
    }
    const result = resolveMoveAutomationAreaTargets({
      actorPlacementId: 'actor',
      geometricallyAffectedPlacementIds: geometry,
      predicate: declaration,
      relationships: relationships(),
      requestedExcludedPlacementIds: exclusions,
    })

    geometry.reverse()
    exclusions[0] = 'ally'
    declaration.relationship = 'ally'

    expect(result.predicate.relationship).toBe('any')
    expect(result.geometricallyAffectedPlacementIds).toEqual(['ally', 'enemy', 'unknown'])
    expect(result.eligibleTargetPlacementIds).toEqual(['ally', 'unknown'])
    expect(result.evaluations[1]).toMatchObject({
      targetPlacementId: 'enemy',
      reasonCode: 'requested-friendly-exclusion',
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.predicate)).toBe(true)
    expect(Object.isFrozen(result.geometricallyAffectedPlacementIds)).toBe(true)
    expect(Object.isFrozen(result.eligibleTargetPlacementIds)).toBe(true)
    expect(Object.isFrozen(result.evaluations)).toBe(true)
    expect(Object.isFrozen(result.evaluations[0])).toBe(true)
  })
})
