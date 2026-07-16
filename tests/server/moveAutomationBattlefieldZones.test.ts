import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone, type EncounterZone } from '#shared/moveAutomation/encounterZones'
import type { TabletopMap } from '~/types/map'
import {
  BattlefieldZoneQueryError,
  adaptLegacyMapStateToBattlefieldZones,
  projectBattlefieldZones,
  queryBattlefieldZoneContributions,
  queryBattlefieldZones,
} from '../../server/domain/moveAutomation/battlefieldZones'

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'zone-arena',
  name: 'Zone Arena',
  dimensions: { x: 10, y: 4, z: 10 },
  voxels: [],
  placements: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      allies: { id: 'allies', label: 'Allies', status: 'active' },
      enemies: { id: 'enemies', label: 'Enemies', status: 'active' },
    },
  },
  ...overrides,
})

const zone = (value: Record<string, unknown>): EncounterZone => parseEncounterZone({
  id: 'zone.base',
  kind: 'smoke',
  source: {
    kind: 'operation',
    operationId: 'op.zone',
    moveId: 'test-zone',
    placementId: 'actor-token',
  },
  sideId: null,
  geometry: { kind: 'cells', cells: [{ x: 2, y: 0, z: 2 }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'independent', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['test-zone'],
  payload: { smokeId: 'test-smoke' },
  ...value,
})

const nativeZones = (): readonly EncounterZone[] => [
  zone({
    id: 'zone.weather.rain',
    kind: 'weather',
    geometry: { kind: 'battlefield' },
    payload: { weatherId: 'rainy' },
  }),
  zone({
    id: 'zone.smoke.center',
    sideId: 'allies',
    geometry: { kind: 'cells', cells: [{ x: 2, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }] },
    hooks: {
      entry: [{ id: 'smoke.enter', handlerId: 'zone.smoke.enter', oncePerMovement: true }],
      exit: [{ id: 'smoke.exit', handlerId: 'zone.smoke.exit', oncePerMovement: true }],
    },
    modifiers: {
      targeting: [{
        id: 'smoke.accuracy',
        attribute: 'accuracy',
        operation: 'add',
        value: -2,
        reasonCode: 'zone.smoke.accuracy',
      }],
      damage: [],
      movement: [],
    },
  }),
  zone({
    id: 'zone.terrain.local',
    kind: 'terrain',
    geometry: { kind: 'cells', cells: [{ x: 4, y: 0, z: 4 }] },
    payload: { terrainId: 'grassy' },
  }),
  zone({
    id: 'zone.pledge.swamp',
    kind: 'pledge',
    geometry: { kind: 'cells', cells: [{ x: 4, y: 0, z: 4 }] },
    payload: { pledgeId: 'swamp' },
  }),
  zone({
    id: 'zone.barrier.wall',
    kind: 'barrier',
    geometry: { kind: 'cells', cells: [{ x: 4, y: 0, z: 4 }] },
    payload: { barrierId: 'wall' },
  }),
  zone({
    id: 'zone.vortex.target',
    kind: 'vortex',
    geometry: { kind: 'placement', placementId: 'target-token' },
    modifiers: {
      targeting: [],
      damage: [],
      movement: [{
        id: 'vortex.block',
        attribute: 'traversal',
        operation: 'block',
        value: null,
        reasonCode: 'zone.vortex.trapped',
      }],
    },
    payload: { vortexId: 'sand-tomb' },
  }),
  zone({
    id: 'zone.side.reflect',
    kind: 'side-condition',
    sideId: 'allies',
    geometry: { kind: 'side', sideId: 'allies' },
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
  }),
]

describe('generalized battlefield zone queries', () => {
  it('adapts legacy hazards and global fields with bounded deterministic identities', () => {
    const map = mapFixture({
      hazards: [
        { kind: 'toxic-spikes', x: 1, y: 0, z: 1, layer: 1, owner: 'Team Heroes' },
        { kind: 'toxic-spikes', x: 1, y: 0, z: 1, layer: 2, owner: 'Different label' },
        { kind: 'spikes', x: -1, y: 0, z: 0 },
        { kind: 'fire', x: 9, y: 0, z: 9 },
      ],
      fieldEffects: {
        weather: [{ kind: 'rainy', rounds: 2, source: 'Rain Dance' }],
        terrains: [
          { kind: 'grassy', scope: 'field', rounds: null },
          { kind: 'misty', scope: 'area', rounds: 3 },
        ],
        rooms: [{ kind: 'trick', rounds: 4, startsNextRound: true }],
      },
    })

    const adapted = adaptLegacyMapStateToBattlefieldZones(map)

    expect(adapted.map(item => item.id)).toEqual([
      'legacy.hazards.toxic-spikes.1.0.1',
      'legacy.hazards.fire.9.0.9',
      'legacy.weather.rainy',
      'legacy.terrain.grassy',
      'legacy.room.trick',
    ])
    expect(adapted[0]).toMatchObject({
      kind: 'hazard',
      sideId: null,
      layer: 2,
      source: {
        kind: 'legacy-map',
        lane: 'hazards',
        key: 'toxic-spikes.1.0.1',
      },
      stacking: { kind: 'add-layer', maxLayers: 2 },
      payload: { hazardId: 'toxic-spikes' },
    })
    expect(adapted[2]?.duration).toEqual({ kind: 'rounds', boundary: 'end', remaining: 2 })
    expect(adapted[3]?.duration).toEqual({ kind: 'permanent', remaining: null })
    expect(adapted[4]?.payload).toEqual({ roomId: 'trick', startsNextRound: true })
    expect(adapted.every(item => item.hooks.entry.length === 0)).toBe(true)
    expect(Object.isFrozen(adapted)).toBe(true)
  })

  it('lets a deterministic migrated native zone shadow its legacy source exactly once', () => {
    const legacyMap = mapFixture({
      fieldEffects: {
        weather: [{ kind: 'rainy', rounds: 2 }],
        terrains: [{ kind: 'grassy', rounds: 3 }],
        rooms: [],
      },
    })
    const adaptedRain = adaptLegacyMapStateToBattlefieldZones(legacyMap)
      .find(item => item.id === 'legacy.weather.rainy')!
    const migratedRain = parseEncounterZone({
      ...adaptedRain,
      modifiers: {
        ...adaptedRain.modifiers,
        damage: [{
          id: 'rain.damage',
          attribute: 'damage',
          operation: 'multiply',
          value: 1.5,
          reasonCode: 'zone.rain.damage',
        }],
      },
    })
    const map = mapFixture({
      ...legacyMap,
      encounterState: {
        ...legacyMap.encounterState!,
        zones: [migratedRain],
      },
    })

    const projection = projectBattlefieldZones(map)

    expect(projection.nativeZoneCount).toBe(1)
    expect(projection.adaptedLegacyZoneCount).toBe(1)
    expect(projection.shadowedLegacyZoneIds).toEqual(['legacy.weather.rainy'])
    expect(projection.zones.map(item => item.id)).toEqual([
      'legacy.weather.rainy',
      'legacy.terrain.grassy',
    ])
    expect(projection.zones[0]?.modifiers.damage).toHaveLength(1)
  })

  it('queries battlefield, cell, placement, and side geometry without inferring allegiance', () => {
    const map = mapFixture({
      encounterState: {
        ...mapFixture().encounterState!,
        zones: nativeZones(),
      },
    })

    expect(queryBattlefieldZones(map, { kind: 'battlefield' }).map(item => item.id))
      .toEqual(['zone.weather.rain'])
    expect(queryBattlefieldZones(map, {
      kind: 'cell',
      cell: { x: 2, y: 0, z: 2 },
    }).map(item => item.id)).toEqual(['zone.weather.rain', 'zone.smoke.center'])
    expect(queryBattlefieldZones(map, {
      kind: 'cell',
      cell: { x: 4, y: 0, z: 4 },
    }).map(item => item.id)).toEqual([
      'zone.weather.rain',
      'zone.terrain.local',
      'zone.pledge.swamp',
      'zone.barrier.wall',
    ])
    expect(queryBattlefieldZones(map, {
      kind: 'placement',
      placementId: 'ally-token',
      sideId: 'allies',
      occupiedCells: [{ x: 3, y: 0, z: 2 }],
    }).map(item => item.id)).toEqual([
      'zone.weather.rain',
      'zone.smoke.center',
      'zone.side.reflect',
    ])
    expect(queryBattlefieldZones(map, {
      kind: 'placement',
      placementId: 'target-token',
      sideId: null,
      occupiedCells: [{ x: 8, y: 0, z: 8 }],
    }).map(item => item.id)).toEqual(['zone.weather.rain', 'zone.vortex.target'])
    expect(queryBattlefieldZones(map, { kind: 'side', sideId: 'enemies' }).map(item => item.id))
      .toEqual(['zone.weather.rain'])
    expect(queryBattlefieldZones(
      map,
      { kind: 'all' },
      { kinds: ['vortex', 'side-condition'] },
    ).map(item => item.id)).toEqual(['zone.vortex.target', 'zone.side.reflect'])
  })

  it('projects typed hooks and modifiers with their owning zone provenance', () => {
    const map = mapFixture({
      encounterState: {
        ...mapFixture().encounterState!,
        zones: nativeZones(),
      },
    })
    const contributions = queryBattlefieldZoneContributions(map, {
      kind: 'placement',
      placementId: 'ally-token',
      sideId: 'allies',
      occupiedCells: [{ x: 2, y: 0, z: 2 }],
    })

    expect(contributions.hooks.entry).toEqual([
      expect.objectContaining({
        zoneId: 'zone.smoke.center',
        zoneKind: 'smoke',
        value: expect.objectContaining({ handlerId: 'zone.smoke.enter' }),
      }),
    ])
    expect(contributions.hooks.exit).toHaveLength(1)
    expect(contributions.modifiers.targeting).toEqual([
      expect.objectContaining({
        zoneId: 'zone.smoke.center',
        value: expect.objectContaining({ attribute: 'accuracy', value: -2 }),
      }),
    ])
    expect(contributions.modifiers.damage).toEqual([
      expect.objectContaining({
        zoneId: 'zone.side.reflect',
        value: expect.objectContaining({ attribute: 'damage-reduction', value: 0.5 }),
      }),
    ])
    expect(contributions.modifiers.movement).toEqual([])
    expect(Object.isFrozen(contributions)).toBe(true)
    expect(Object.isFrozen(contributions.modifiers.targeting[0]?.value)).toBe(true)
  })

  it('rejects malformed query subjects rather than broadening their match', () => {
    const map = mapFixture()

    expect(() => queryBattlefieldZones(map, {
      kind: 'placement',
      placementId: 'actor',
      sideId: null,
      occupiedCells: [{ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
    })).toThrowError(BattlefieldZoneQueryError)
    expect(() => queryBattlefieldZones(map, { kind: 'side', sideId: 'Unknown Side' as never }))
      .toThrow('query side is invalid')
    expect(() => queryBattlefieldZones(map, { kind: 'all' }, { kinds: ['script' as never] }))
      .toThrow('kind filter is invalid')
  })
})
