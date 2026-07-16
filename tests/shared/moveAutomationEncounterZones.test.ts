import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_ZONE_LIMITS,
  EncounterZoneValidationError,
  legacyEncounterZoneId,
  parseEncounterZone,
  parseEncounterZones,
} from '#shared/moveAutomation/encounterZones'

const baseZone = () => ({
  id: 'zone.smoke.1',
  kind: 'smoke',
  source: {
    kind: 'operation',
    operationId: 'op.zone.1',
    moveId: 'smokescreen',
    placementId: 'actor-token',
  },
  sideId: 'allies',
  geometry: {
    kind: 'cells',
    cells: [{ x: 2, y: 0, z: 3 }],
  },
  layer: 1,
  duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
  stacking: { kind: 'refresh', maxLayers: null },
  hooks: {
    entry: [{ id: 'smoke.enter', handlerId: 'zone.smoke.enter', oncePerMovement: true }],
    exit: [{ id: 'smoke.exit', handlerId: 'zone.smoke.exit', oncePerMovement: true }],
  },
  modifiers: {
    targeting: [
      {
        id: 'smoke.accuracy',
        attribute: 'accuracy',
        operation: 'add',
        value: -2,
        reasonCode: 'zone.smoke.accuracy',
      },
    ],
    damage: [],
    movement: [],
  },
  tags: ['smoke', 'visibility'],
  payload: { smokeId: 'dense-smoke' },
})

const representativeZones = () => [
  baseZone(),
  {
    ...baseZone(),
    id: 'zone.terrain.1',
    kind: 'terrain',
    geometry: { kind: 'cells', cells: [{ x: 3, y: 0, z: 3 }] },
    hooks: { entry: [], exit: [] },
    modifiers: {
      targeting: [],
      damage: [],
      movement: [{
        id: 'terrain.slow',
        attribute: 'cost',
        operation: 'multiply',
        value: 2,
        reasonCode: 'zone.terrain.slow',
      }],
    },
    payload: { terrainId: 'grassy' },
  },
  {
    ...baseZone(),
    id: 'zone.pledge.1',
    kind: 'pledge',
    sideId: null,
    geometry: { kind: 'cells', cells: [{ x: 4, y: 0, z: 3 }] },
    hooks: { entry: [], exit: [] },
    modifiers: {
      targeting: [],
      damage: [{
        id: 'pledge.damage',
        attribute: 'damage',
        operation: 'multiply',
        value: 1.5,
        reasonCode: 'zone.pledge.damage',
      }],
      movement: [],
    },
    payload: { pledgeId: 'sea-of-fire' },
  },
  {
    ...baseZone(),
    id: 'zone.barrier.1',
    kind: 'barrier',
    geometry: { kind: 'cells', cells: [{ x: 5, y: 0, z: 3 }] },
    hooks: { entry: [], exit: [] },
    modifiers: {
      targeting: [{
        id: 'barrier.los',
        attribute: 'line-of-sight',
        operation: 'block',
        value: null,
        reasonCode: 'zone.barrier.los',
      }],
      damage: [],
      movement: [{
        id: 'barrier.traversal',
        attribute: 'traversal',
        operation: 'block',
        value: null,
        reasonCode: 'zone.barrier.traversal',
      }],
    },
    payload: { barrierId: 'solid-wall' },
  },
  {
    ...baseZone(),
    id: 'zone.vortex.1',
    kind: 'vortex',
    geometry: { kind: 'placement', placementId: 'target-token' },
    hooks: { entry: [], exit: [] },
    modifiers: {
      targeting: [],
      damage: [],
      movement: [{
        id: 'vortex.traversal',
        attribute: 'traversal',
        operation: 'block',
        value: null,
        reasonCode: 'zone.vortex.trapped',
      }],
    },
    payload: { vortexId: 'sand-tomb' },
  },
  {
    ...baseZone(),
    id: 'zone.side.reflect',
    kind: 'side-condition',
    sideId: 'allies',
    geometry: { kind: 'side', sideId: 'allies' },
    hooks: { entry: [], exit: [] },
    modifiers: {
      targeting: [],
      damage: [{
        id: 'reflect.reduction',
        attribute: 'damage-reduction',
        operation: 'multiply',
        value: 0.5,
        reasonCode: 'zone.reflect.reduction',
      }],
      movement: [],
    },
    payload: { conditionId: 'reflect' },
  },
]

describe('move automation encounter zones', () => {
  it('round-trips typed smoke, terrain, pledge, barrier, vortex, and side-condition shapes', () => {
    const source = representativeZones()
    const parsed = parseEncounterZones(JSON.parse(JSON.stringify(source)))

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(parsed[0]?.geometry).not.toBe(source[0]?.geometry)
    expect(parsed[0]?.hooks.entry).not.toBe(source[0]?.hooks.entry)
    expect(parsed[0]?.modifiers.targeting).not.toBe(source[0]?.modifiers.targeting)
    expect(parsed.map(zone => zone.kind)).toEqual([
      'smoke',
      'terrain',
      'pledge',
      'barrier',
      'vortex',
      'side-condition',
    ])
  })

  it('models global weather and room zones and deterministic legacy identities', () => {
    const weatherId = legacyEncounterZoneId('weather', 'rainy')
    const weather = parseEncounterZone({
      ...baseZone(),
      id: weatherId,
      kind: 'weather',
      source: { kind: 'legacy-map', lane: 'weather', key: 'rainy' },
      sideId: null,
      geometry: { kind: 'battlefield' },
      hooks: { entry: [], exit: [] },
      modifiers: { targeting: [], damage: [], movement: [] },
      tags: ['legacy-map', 'weather'],
      payload: { weatherId: 'rainy' },
    })
    const room = parseEncounterZone({
      ...baseZone(),
      id: 'zone.room.trick',
      kind: 'room',
      sideId: null,
      geometry: { kind: 'battlefield' },
      hooks: { entry: [], exit: [] },
      modifiers: { targeting: [], damage: [], movement: [] },
      payload: { roomId: 'trick', startsNextRound: true },
    })

    expect(weather).toMatchObject({ id: 'legacy.weather.rainy', payload: { weatherId: 'rainy' } })
    expect(room).toMatchObject({ kind: 'room', payload: { roomId: 'trick', startsNextRound: true } })
    expect(() => parseEncounterZone({ ...weather, id: 'legacy.weather.sunny' }))
      .toThrow('must be legacy.weather.rainy for its legacy map source')
    expect(() => parseEncounterZone({
      ...baseZone(),
      id: 'legacy.hazards.fake',
    })).toThrow('legacy namespace is reserved')
  })

  it('rejects unknown fields, payloads, geometry, duplicate component identities, and invalid layers', () => {
    expect(() => parseEncounterZone({ ...baseZone(), script: 'run()' }))
      .toThrow('unknown script')
    expect(() => parseEncounterZone({ ...baseZone(), payload: { terrainId: 'grassy' } }))
      .toThrow('missing smokeId; unknown terrainId')
    expect(() => parseEncounterZone({
      ...baseZone(),
      geometry: { kind: 'placement', placementId: 'target-token' },
    })).toThrow('smoke zones require cells geometry')
    expect(() => parseEncounterZone({
      ...baseZone(),
      geometry: { kind: 'cells', cells: [{ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }] },
    })).toThrow('must not contain duplicate identities')
    expect(() => parseEncounterZone({
      ...baseZone(),
      hooks: {
        entry: [{ id: 'duplicate', handlerId: 'entry', oncePerMovement: true }],
        exit: [{ id: 'duplicate', handlerId: 'exit', oncePerMovement: true }],
      },
    })).toThrow('must not contain duplicate identities')
    expect(() => parseEncounterZone({
      ...baseZone(),
      layer: 3,
      stacking: { kind: 'add-layer', maxLayers: 2 },
    })).toThrow('layer 3 exceeds maxLayers 2')
    expect(() => parseEncounterZone({
      ...baseZone(),
      modifiers: {
        targeting: [{
          id: 'bad-block',
          attribute: 'accuracy',
          operation: 'block',
          value: null,
          reasonCode: 'bad-block',
        }],
        damage: [],
        movement: [],
      },
    })).toThrow('targeting block is supported only for line-of-sight')
  })

  it('enforces collection and coordinate bounds with typed validation errors', () => {
    expect(() => parseEncounterZone({
      ...baseZone(),
      geometry: {
        kind: 'cells',
        cells: [{ x: ENCOUNTER_ZONE_LIMITS.coordinate + 1, y: 0, z: 0 }],
      },
    })).toThrowError(EncounterZoneValidationError)

    const oversized = Array.from(
      { length: ENCOUNTER_ZONE_LIMITS.count + 1 },
      (_, index) => ({ ...baseZone(), id: `zone.smoke.${index}` }),
    )
    expect(() => parseEncounterZones(oversized))
      .toThrow(`must contain at most ${ENCOUNTER_ZONE_LIMITS.count} entries`)

    try {
      parseEncounterZone({
        ...baseZone(),
        modifiers: {
          targeting: [],
          damage: [{
            id: 'huge',
            attribute: 'damage',
            operation: 'add',
            value: ENCOUNTER_ZONE_LIMITS.numericMagnitude + 1,
            reasonCode: 'huge',
          }],
          movement: [],
        },
      })
    }
    catch (error) {
      expect(error).toMatchObject({ code: 'limit-exceeded' })
    }
  })
})
