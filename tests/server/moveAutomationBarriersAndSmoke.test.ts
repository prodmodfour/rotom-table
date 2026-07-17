import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseEncounterZone,
  type EncounterBarrierZone,
  type EncounterSmokeZone,
} from '#shared/moveAutomation/encounterZones'
import {
  MOVE_AUTOMATION_BARRIER_DAMAGE_REDUCTION,
  MOVE_AUTOMATION_BARRIER_HEIGHT,
  MOVE_AUTOMATION_BARRIER_HIT_POINTS,
  MOVE_AUTOMATION_BARRIER_TYPE_ID,
  MOVE_AUTOMATION_SMOKESCREEN_ACCURACY_PENALTY,
  MoveAutomationBarriersAndSmokeError,
  createMoveAutomationBarriersAndSmokeResolver,
} from '~~/server/domain/moveAutomation/barriersAndSmoke'
import type { TabletopMap } from '~/types/map'

const source = (operationId: string, placementId = 'actor') => ({
  kind: 'operation' as const,
  operationId,
  moveId: operationId.includes('smoke') ? 'smokescreen' : 'barrier',
  placementId,
})

const smokeZone = (options: {
  readonly id: string
  readonly cells: readonly { readonly x: number; readonly y: number; readonly z: number }[]
  readonly sideId?: string | null
}): EncounterSmokeZone => parseEncounterZone({
  id: options.id,
  kind: 'smoke',
  source: source(`operation.${options.id}`),
  sideId: options.sideId ?? null,
  geometry: { kind: 'cells', cells: options.cells },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'refresh', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['smoke', 'smokescreen'],
  payload: { smokeId: 'smokescreen' },
}) as EncounterSmokeZone

const barrierZone = (overrides: Record<string, unknown> = {}): EncounterBarrierZone => parseEncounterZone({
  id: 'zone.barrier.segment-one',
  kind: 'barrier',
  source: source('operation.barrier'),
  sideId: 'red',
  geometry: { kind: 'cells', cells: [{ x: 3, y: 0, z: 1 }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'independent', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['barrier', 'blocking-terrain'],
  payload: {
    barrierId: 'barrier',
    currentHitPoints: MOVE_AUTOMATION_BARRIER_HIT_POINTS,
    maximumHitPoints: MOVE_AUTOMATION_BARRIER_HIT_POINTS,
    damageReduction: MOVE_AUTOMATION_BARRIER_DAMAGE_REDUCTION,
    height: MOVE_AUTOMATION_BARRIER_HEIGHT,
    typeIds: [MOVE_AUTOMATION_BARRIER_TYPE_ID],
  },
  ...overrides,
}) as EncounterBarrierZone

const mapFixture = (zones: readonly (EncounterSmokeZone | EncounterBarrierZone)[]): TabletopMap => ({
  schemaVersion: 2,
  slug: 'obscuration-arena',
  name: 'Obscuration Arena',
  revision: 4,
  dimensions: { x: 10, y: 4, z: 6 },
  groundLevelY: 0,
  voxels: [],
  placements: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      red: { id: 'red', label: 'Red', status: 'active' },
      blue: { id: 'blue', label: 'Blue', status: 'active' },
    },
    zones,
  },
})

const placements = () => [
  { id: 'actor', sideId: 'red', position: { x: 1, y: 0, z: 1 }, base: 1 },
  { id: 'target', sideId: 'blue', position: { x: 5, y: 0, z: 1 }, base: 1 },
  { id: 'outside', sideId: 'blue', position: { x: 8, y: 0, z: 1 }, base: 1 },
]

const resolver = (zones: readonly (EncounterSmokeZone | EncounterBarrierZone)[]) => (
  createMoveAutomationBarriersAndSmokeResolver({ map: mapFixture(zones), placements: placements() })
)

describe('authoritative barriers and smoke', () => {
  it('applies Smokescreen once when attacking from or into exact smoke geometry', () => {
    const fromSmoke = smokeZone({
      id: 'zone.smoke.actor',
      cells: [{ x: 1, y: 0, z: 1 }],
      sideId: 'red',
    })
    const intoSmoke = smokeZone({
      id: 'zone.smoke.target',
      cells: [{ x: 5, y: 0, z: 1 }],
      sideId: 'blue',
    })
    const query = resolver([fromSmoke, intoSmoke])

    const result = query.accuracy({
      sourcePlacementId: 'actor',
      target: { kind: 'placement', placementId: 'target' },
      baseValue: 2,
    })

    expect(result).toMatchObject({
      baseValue: 2,
      value: -1,
      modifierTotal: MOVE_AUTOMATION_SMOKESCREEN_ACCURACY_PENALTY,
      affectingZoneIds: ['zone.smoke.actor', 'zone.smoke.target'],
      modifiers: [{
        sourceId: 'zone.smoke.actor',
        reason: 'zone.smokescreen.accuracy-penalty',
        value: -3,
      }],
    })
    expect(result.trace).toEqual([
      expect.objectContaining({
        zoneId: 'zone.smoke.actor',
        sideId: 'red',
        sourceInside: true,
        targetInside: false,
        outcome: 'applied',
      }),
      expect.objectContaining({
        zoneId: 'zone.smoke.target',
        sideId: 'blue',
        sourceInside: false,
        targetInside: true,
        outcome: 'superseded',
        reasonCode: 'zone.smoke.modifier-non-stacking',
      }),
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.trace[0]?.source)).toBe(true)
  })

  it('uses the same server-owned smoke rule for area cells without widening geometry', () => {
    const smoke = smokeZone({
      id: 'zone.smoke.blast',
      cells: [{ x: 6, y: 0, z: 2 }, { x: 6, y: 0, z: 3 }],
    })
    const query = resolver([smoke])

    expect(query.accuracy({
      sourcePlacementId: 'actor',
      target: { kind: 'area', cells: [{ x: 6, y: 0, z: 3 }] },
      baseValue: 0,
    })).toMatchObject({
      value: -3,
      affectingZoneIds: ['zone.smoke.blast'],
      trace: [expect.objectContaining({ targetKind: 'area', targetInside: true })],
    })
    expect(query.accuracy({
      sourcePlacementId: 'actor',
      target: { kind: 'area', cells: [{ x: 7, y: 0, z: 3 }] },
      baseValue: 0,
    })).toMatchObject({
      value: 0,
      affectingZoneIds: [],
      trace: [expect.objectContaining({ outcome: 'outside-zone' })],
    })
    expect(() => query.accuracy({
      sourcePlacementId: 'actor',
      target: { kind: 'area', cells: [{ x: 10, y: 0, z: 3 }] },
      baseValue: 0,
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationBarriersAndSmokeError.name,
      code: 'invalid-area-cells',
    }))
  })

  it('projects each Barrier segment as exact two-metre Blocking Terrain', () => {
    const query = resolver([barrierZone()])

    expect(query.barriers()).toEqual([expect.objectContaining({
      zoneId: 'zone.barrier.segment-one',
      sideId: 'red',
      cell: { x: 3, y: 0, z: 1 },
      occupiedCells: [
        { x: 3, y: 0, z: 1 },
        { x: 3, y: 1, z: 1 },
      ],
      currentHitPoints: 20,
      maximumHitPoints: 20,
      damageReduction: 15,
      typeIds: ['psychic'],
    })])
    expect(query.barrierSightCells()).toEqual([
      expect.objectContaining({ zoneId: 'zone.barrier.segment-one', cell: { x: 3, y: 0, z: 1 } }),
      expect.objectContaining({ zoneId: 'zone.barrier.segment-one', cell: { x: 3, y: 1, z: 1 } }),
    ])
    expect(Object.isFrozen(query.barrierSightCells())).toBe(true)
  })

  it('applies Barrier DR before type effectiveness and emits exact destruction removal identity', () => {
    const zone = barrierZone()
    const query = resolver([zone])
    const damaged = query.damageBarrier({
      zoneId: zone.id,
      incomingDamage: 20,
      moveType: 'Dark',
    })

    expect(damaged).toMatchObject({
      moveType: 'Dark',
      defenderTypes: ['Psychic'],
      incomingDamage: 20,
      damageReduction: 15,
      damageAfterReduction: 5,
      effectivenessMultiplier: 1.5,
      hitPointLoss: 7,
      damagePipeline: {
        preTypeDamage: 5,
        typeScaledDamage: 7,
        hpLoss: 7,
      },
      previousHitPoints: 20,
      currentHitPoints: 13,
      outcome: 'damaged',
      removalTarget: null,
      updatedZone: { payload: { currentHitPoints: 13 } },
    })
    expect(damaged.damagePipeline.stages.find(stage => (
      stage.stage === 'pre-type-modifiers'
    ))?.modifiers.map(modifier => modifier.reasonCode)).toEqual([
      'barrier.damage-reduction',
      'barrier.nonnegative-damage',
      'barrier.minimum-damage',
    ])
    expect(zone.payload.currentHitPoints).toBe(20)
    expect(query.damageBarrier({
      zoneId: zone.id,
      incomingDamage: 0,
      moveType: 'Normal',
    })).toMatchObject({ outcome: 'no-damage', hitPointLoss: 0, currentHitPoints: 20 })

    const destroyed = query.damageBarrier({
      zoneId: zone.id,
      incomingDamage: 50,
      moveType: 'Dark',
    })
    expect(destroyed).toMatchObject({
      outcome: 'destroyed',
      currentHitPoints: 0,
      removalTarget: { kind: 'zone-id', zoneId: zone.id },
      updatedZone: null,
    })
    expect(Object.isFrozen(destroyed)).toBe(true)
  })
})
