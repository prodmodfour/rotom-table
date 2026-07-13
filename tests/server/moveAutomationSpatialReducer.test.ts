import { describe, expect, it, vi } from 'vitest'
import {
  parseMoveEffectOperation,
  type MoveMovementDisplacement,
  type MoveMovementDistance,
} from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { footprintsOverlap } from '~/utils/gridGeometry'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  MoveSpatialEffectReductionError,
  reduceMoveSpatialEffects,
  type MoveResolvedSpatialEffectOperation,
  type MoveSpatialEffectOperation,
} from '~~/server/domain/moveAutomation/reducers/spatial'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  z: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z },
})

const pokemonSheet = (
  slug: string,
  species: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species,
  level: 20,
  revision: slug === 'actor' ? 3 : 4,
  movelist: slug === 'actor' ? [{ name: 'Scratch' }] : [],
  capabilities: { overland: 6 },
  combat: { currentHp: 50 },
  ...overrides,
})

const mapFixture = (
  placements: readonly SheetPlacement[] = [
    placement('actor-token', 'actor', 1, 1),
    placement('target-token', 'target', 3, 2),
  ],
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'spatial-reducer-arena',
  name: 'Spatial Reducer Arena',
  revision: 8,
  dimensions: { x: 12, y: 4, z: 12 },
  groundLevelY: 0,
  voxels: [],
  placements: [...placements],
})

const buildContext = (options: {
  readonly map?: TabletopMap
  readonly targetSheet?: CharacterSheet
  readonly selectedPlacementIds?: readonly string[]
} = {}) => buildAuthoritativeMoveRulesContext({
  map: options.map ?? mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', 'Snorlax')],
    ['target', options.targetSheet ?? pokemonSheet('target', 'Pikachu', {
      capabilities: { overland: 6, weight: 4 },
    })],
    ['second', pokemonSheet('second', 'Pikachu', {
      capabilities: { overland: 6, weight: 2 },
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: 1,
    placementId: 'actor-token',
    moveName: 'Scratch',
    selection: {
      kind: 'single-target',
      targetPlacementId: options.selectedPlacementIds?.[0] ?? 'target-token',
    },
  },
  candidatePlacementIds: options.map?.placements.map(({ id }) => id)
    ?? ['actor-token', 'target-token'],
  selectedPlacementIds: options.selectedPlacementIds ?? ['target-token'],
  random: () => { throw new Error('spatial reduction must not draw randomness') },
  time: 1_000,
})

const dynamicRecipients = (overrides: Partial<{
  attackedTargetIds: readonly string[]
  hitTargetIds: readonly string[]
  missedTargetIds: readonly string[]
  damagedTargetIds: readonly string[]
  faintedTargetIds: readonly string[]
}> = {}) => ({
  attackedTargetIds: ['target-token'],
  hitTargetIds: ['target-token'],
  missedTargetIds: [],
  damagedTargetIds: ['target-token'],
  faintedTargetIds: [],
  ...overrides,
})

const operation = (options: {
  readonly id?: string
  readonly recipients?: 'actor' | 'hit-targets'
  readonly mode?: 'forced' | 'voluntary'
  readonly distance?: MoveMovementDistance
  readonly displacement?: MoveMovementDisplacement
} = {}): MoveSpatialEffectOperation => parseMoveEffectOperation({
  id: options.id ?? 'operation.spatial',
  kind: 'movement-request',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: options.recipients ?? 'hit-targets' },
  phase: 'movement',
  reasonCode: 'move.scratch.spatial',
  payload: {
    requestId: `request.${options.id?.split('.').at(-1) ?? 'spatial'}`,
    mode: options.mode ?? 'forced',
    distance: options.distance ?? 2,
    destinationSetId: null,
    displacement: options.displacement ?? {
      vector: { kind: 'away', source: { kind: 'actor' } },
      distancePolicy: 'up-to-distance',
      opportunityAttacks: 'ignore',
    },
  },
}) as MoveSpatialEffectOperation

const emission = (
  value: MoveSpatialEffectOperation,
  recipientIds: readonly string[] = ['target-token'],
): MoveResolvedSpatialEffectOperation => ({ operation: value, recipientIds })

const expectSpatialError = (
  run: () => unknown,
  code: MoveSpatialEffectReductionError['code'],
): void => {
  expect(run).toThrowError(expect.objectContaining({
    name: 'MoveSpatialEffectReductionError',
    code,
  }))
}

describe('MoveSpec spatial effect reducer', () => {
  it('derives an away vector from complete footprints and evaluates target Weight Class', () => {
    const context = buildContext()
    const originalMap = structuredClone(context.map)
    const weightedDistance: MoveMovementDistance = {
      kind: 'expression',
      expression: {
        kind: 'arithmetic',
        operator: 'subtract',
        operands: [
          { kind: 'constant', value: 6 },
          {
            kind: 'weight',
            subject: { kind: 'current-target' },
            metric: 'weight-class',
          },
        ],
      },
      minimum: 0,
      maximum: 6,
      rounding: 'floor',
    }

    const result = reduceMoveSpatialEffects({
      context,
      operations: [emission(operation({ distance: weightedDistance }))],
      dynamicRecipients: dynamicRecipients(),
    })

    expect(result.movements).toEqual([{
      operationId: 'operation.spatial',
      recipientPlacementId: 'target-token',
      mode: 'forced',
      distancePolicy: 'up-to-distance',
      opportunityAttackPolicy: 'ignore',
      provokesOpportunityAttacks: false,
      vector: {
        kind: 'away',
        x: 1,
        y: 0,
        z: 0,
        sourcePlacementId: 'actor-token',
        direction: null,
      },
      distance: {
        rawValue: 2,
        value: 2,
        minimum: 0,
        maximum: 6,
        rounding: 'floor',
        trace: [
          expect.objectContaining({ expressionKind: 'constant', value: 6 }),
          expect.objectContaining({ expressionKind: 'weight', value: 4 }),
          expect.objectContaining({ expressionKind: 'arithmetic', value: 2 }),
        ],
      },
      origin: { x: 3, y: 0, z: 2 },
      destination: { x: 5, y: 0, z: 2 },
      path: [
        { x: 3, y: 0, z: 2 },
        { x: 4, y: 0, z: 2 },
        { x: 5, y: 0, z: 2 },
      ],
      resolvedDistance: 2,
      shortened: false,
      shorteningReason: 'none',
      obstruction: null,
    }])
    expect(result.operationResults).toEqual([{
      operationId: 'operation.spatial',
      recipientIds: ['target-token'],
      outcome: 'applied',
      movements: result.movements,
      details: {
        mode: 'forced',
        distancePolicy: 'up-to-distance',
        opportunityAttackPolicy: 'ignore',
        movementCount: 1,
        movedCount: 1,
        shortenedCount: 0,
      },
    }])
    // Snorlax occupies x=1..2 and z=1..2. The target begins directly east
    // despite its center also being south of Snorlax's center.
    expect(context.actor.token.base).toBe(2)
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(context.map).toEqual(originalMap)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.movements[0]?.path)).toBe(true)
    expect(Object.isFrozen(result.movements[0]?.distance.trace)).toBe(true)
  })

  it('derives toward and cardinal vectors while keeping mode and AoO policy independent', () => {
    const context = buildContext({
      map: mapFixture([
        placement('actor-token', 'actor', 1, 1),
        placement('target-token', 'target', 4, 2),
      ]),
    })
    const result = reduceMoveSpatialEffects({
      context,
      operations: [
        emission(operation({
          id: 'operation.pull',
          distance: 1,
          displacement: {
            vector: { kind: 'toward', source: { kind: 'actor' } },
            distancePolicy: 'up-to-distance',
            opportunityAttacks: 'ignore',
          },
        })),
        emission(operation({
          id: 'operation.shift',
          recipients: 'actor',
          mode: 'voluntary',
          distance: 2,
          displacement: {
            vector: { kind: 'cardinal', direction: 'south' },
            distancePolicy: 'up-to-distance',
            opportunityAttacks: 'provoke',
          },
        }), ['actor-token']),
      ],
      dynamicRecipients: dynamicRecipients(),
    })

    expect(result.movements).toEqual([
      expect.objectContaining({
        operationId: 'operation.pull',
        recipientPlacementId: 'target-token',
        mode: 'forced',
        provokesOpportunityAttacks: false,
        vector: expect.objectContaining({ kind: 'toward', x: -1, y: 0, z: 0 }),
        path: [
          { x: 4, y: 0, z: 2 },
          { x: 3, y: 0, z: 2 },
        ],
      }),
      expect.objectContaining({
        operationId: 'operation.shift',
        recipientPlacementId: 'actor-token',
        mode: 'voluntary',
        opportunityAttackPolicy: 'provoke',
        provokesOpportunityAttacks: true,
        vector: {
          kind: 'cardinal',
          x: 0,
          y: 0,
          z: 1,
          sourcePlacementId: null,
          direction: 'south',
        },
        path: [
          { x: 1, y: 0, z: 1 },
          { x: 1, y: 0, z: 2 },
          { x: 1, y: 0, z: 3 },
        ],
      }),
    ])
  })

  it('uses only a server-owned chosen direction and records grid quantization', () => {
    const resolve = vi.fn(() => 'north-east' as const)
    const result = reduceMoveSpatialEffects({
      context: buildContext(),
      operations: [emission(operation({
        distance: 2,
        displacement: {
          vector: { kind: 'chosen', directionSetId: 'directions.psychic' },
          distancePolicy: 'up-to-distance',
          opportunityAttacks: 'ignore',
        },
      }))],
      dynamicRecipients: dynamicRecipients(),
      chosenDirections: { resolve },
    })

    expect(resolve).toHaveBeenCalledWith({
      operationId: 'operation.spatial',
      directionSetId: 'directions.psychic',
      recipientPlacementId: 'target-token',
    })
    expect(result.movements[0]).toMatchObject({
      vector: {
        kind: 'chosen',
        x: 1,
        y: 0,
        z: -1,
        direction: 'north-east',
      },
      distance: { value: 2 },
      path: [
        { x: 3, y: 0, z: 2 },
        { x: 4, y: 0, z: 1 },
      ],
      resolvedDistance: 1,
      shortened: true,
      shorteningReason: 'grid-distance-quantized',
    })
  })

  it('returns a traced no-op when a bounded Weight Class expression clamps to zero', () => {
    const result = reduceMoveSpatialEffects({
      context: buildContext({
        targetSheet: pokemonSheet('target', 'Pikachu', {
          capabilities: { overland: 6, weight: 7 },
        }),
      }),
      operations: [emission(operation({
        distance: {
          kind: 'expression',
          expression: {
            kind: 'arithmetic',
            operator: 'subtract',
            operands: [
              { kind: 'constant', value: 6 },
              {
                kind: 'weight',
                subject: { kind: 'current-target' },
                metric: 'weight-class',
              },
            ],
          },
          minimum: 0,
          maximum: 6,
          rounding: 'floor',
        },
      }))],
      dynamicRecipients: dynamicRecipients(),
    })

    expect(result.movements[0]).toMatchObject({
      distance: { rawValue: -1, value: 0 },
      path: [{ x: 3, y: 0, z: 2 }],
      destination: { x: 3, y: 0, z: 2 },
      resolvedDistance: 0,
      shortened: false,
      shorteningReason: 'none',
    })
    expect(result.operationResults[0]?.outcome).toBe('no-op')
  })

  it('shortens up-to displacement at occupied footprints and rejects full-distance displacement', () => {
    const arena = mapFixture([
      placement('actor-token', 'actor', 1, 1),
      placement('target-token', 'target', 3, 2),
      placement('second-token', 'second', 5, 2),
    ])
    const upToContext = buildContext({ map: arena })
    const upTo = reduceMoveSpatialEffects({
      context: upToContext,
      operations: [emission(operation({ distance: 4 }))],
      dynamicRecipients: dynamicRecipients(),
    })

    expect(upTo.movements[0]).toMatchObject({
      origin: { x: 3, y: 0, z: 2 },
      destination: { x: 4, y: 0, z: 2 },
      path: [
        { x: 3, y: 0, z: 2 },
        { x: 4, y: 0, z: 2 },
      ],
      resolvedDistance: 1,
      shortened: true,
      shorteningReason: 'occupied-footprint',
      obstruction: {
        at: { x: 5, y: 0, z: 2 },
        collision: {
          kind: 'placement',
          placementIds: ['second-token'],
        },
      },
    })
    expect(upTo.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'second', revision: 4 },
    ])
    expect(upTo.operationResults[0]).toMatchObject({
      outcome: 'applied',
      details: { movedCount: 1, shortenedCount: 1 },
    })

    expectSpatialError(() => reduceMoveSpatialEffects({
      context: buildContext({ map: arena }),
      operations: [emission(operation({
        distance: 4,
        displacement: {
          vector: { kind: 'away', source: { kind: 'actor' } },
          distancePolicy: 'full-distance-required',
          opportunityAttacks: 'ignore',
        },
      }))],
      dynamicRecipients: dynamicRecipients(),
    }), 'full-distance-unavailable')
  })

  it('reserves ordered destinations so one reduction cannot overlap recipients', () => {
    const arena = mapFixture([
      placement('actor-token', 'actor', 0, 0),
      placement('target-token', 'target', 3, 0),
      placement('second-token', 'second', 5, 0),
    ])
    const recipients = ['target-token', 'second-token']
    const result = reduceMoveSpatialEffects({
      context: buildContext({ map: arena, selectedPlacementIds: recipients }),
      operations: [emission(operation({
        distance: 3,
        displacement: {
          vector: { kind: 'cardinal', direction: 'east' },
          distancePolicy: 'up-to-distance',
          opportunityAttacks: 'ignore',
        },
      }), recipients)],
      dynamicRecipients: dynamicRecipients({
        attackedTargetIds: recipients,
        hitTargetIds: recipients,
        damagedTargetIds: recipients,
      }),
    })

    expect(result.movements.map(movement => ({
      id: movement.recipientPlacementId,
      destination: movement.destination,
      reason: movement.shorteningReason,
    }))).toEqual([
      {
        id: 'target-token',
        destination: { x: 4, y: 0, z: 0 },
        reason: 'occupied-footprint',
      },
      {
        id: 'second-token',
        destination: { x: 8, y: 0, z: 0 },
        reason: 'none',
      },
    ])
    expect(footprintsOverlap(
      result.movements[0]!.destination,
      1,
      1,
      result.movements[1]!.destination,
      1,
      1,
    )).toBe(false)
  })

  it('fails closed for overlapping relative footprints, missing choices, and recipient drift', () => {
    const overlapContext = buildContext({
      map: mapFixture([
        placement('actor-token', 'actor', 1, 1),
        placement('target-token', 'target', 2, 2),
      ]),
    })
    expectSpatialError(() => reduceMoveSpatialEffects({
      context: overlapContext,
      operations: [emission(operation())],
      dynamicRecipients: dynamicRecipients(),
    }), 'vector-unavailable')

    expectSpatialError(() => reduceMoveSpatialEffects({
      context: buildContext(),
      operations: [emission(operation({
        displacement: {
          vector: { kind: 'chosen', directionSetId: 'directions.missing' },
          distancePolicy: 'up-to-distance',
          opportunityAttacks: 'ignore',
        },
      }))],
      dynamicRecipients: dynamicRecipients(),
    }), 'chosen-direction-unavailable')

    expectSpatialError(() => reduceMoveSpatialEffects({
      context: buildContext(),
      operations: [emission(operation(), ['actor-token'])],
      dynamicRecipients: dynamicRecipients(),
    }), 'recipient-set-mismatch')
  })
})
