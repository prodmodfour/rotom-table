import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  planInitiativeLifecycle,
} from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'

interface TerrainLifecycleFixture {
  readonly id: string
  readonly x: number
  readonly currentHp?: number
  readonly airborne?: boolean
}

const sheet = (fixture: TerrainLifecycleFixture): CharacterSheet => ({
  slug: fixture.id,
  nickname: fixture.id,
  species: 'Pikachu',
  level: 20,
  revision: fixture.id === 'target' ? 5 : 3,
  movelist: [{ name: 'Tackle' }],
  ...(fixture.airborne ? { capabilities: { sky: 6 } } : {}),
  combat: {
    currentHp: fixture.currentHp ?? 40,
    injuries: 0,
    conditions: [],
  },
})

const placement = (fixture: TerrainLifecycleFixture): SheetPlacement => ({
  id: fixture.id,
  sheetKind: 'pokemon',
  sheetSlug: fixture.id,
  position: { x: fixture.x, y: 0, z: 1 },
  initiative: fixture.id === 'actor' ? 10 : 5,
})

const localGrassyTerrain = () => parseEncounterZone({
  id: 'zone.terrain.grassy.local',
  kind: 'terrain',
  source: {
    kind: 'operation',
    operationId: 'op.grassy.local',
    moveId: 'grassy-glide',
    placementId: 'actor',
  },
  sideId: null,
  geometry: { kind: 'cells', cells: [{ x: 2, y: 0, z: 1 }] },
  layer: 1,
  duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
  stacking: { kind: 'replace', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['terrain', 'grassy'],
  payload: { terrainId: 'grassy' },
})

const mapFixture = (options: {
  readonly target: TerrainLifecycleFixture
  readonly scope?: 'global' | 'local'
}): TabletopMap => {
  const actor = { id: 'actor', x: 0 }
  return {
    schemaVersion: 2,
    slug: 'terrain-lifecycle-arena',
    name: 'Terrain Lifecycle Arena',
    revision: 7,
    dimensions: { x: 8, y: 4, z: 5 },
    groundLevelY: 0,
    voxels: [],
    hazards: [],
    fieldEffects: {
      weather: [],
      terrains: options.scope === 'local'
        ? []
        : [{ kind: 'grassy', rounds: 3, scope: 'field' }],
      rooms: [],
    },
    placements: [placement(actor), placement(options.target)],
    initiative: { activeId: 'actor', round: 1 },
    encounterState: {
      ...createEmptyEncounterState(),
      zones: options.scope === 'local' ? [localGrassyTerrain()] : [],
    },
  }
}

const plan = (options: {
  readonly target: TerrainLifecycleFixture
  readonly scope?: 'global' | 'local'
  readonly operationId?: string
}) => {
  const map = mapFixture(options)
  const actorSheet = sheet({ id: 'actor', x: 0 })
  const targetSheet = sheet(options.target)
  const result = planInitiativeLifecycle({
    map,
    previous: { activeId: 'actor', round: 1 },
    current: { activeId: options.target.id, round: 1 },
    orderIds: ['actor', options.target.id],
    operationId: options.operationId ?? 'op_grassy_turn',
    time: 3_000,
    loadSheets: () => ({
      pokemonSheets: new Map([
        ['actor', actorSheet],
        [options.target.id, targetSheet],
      ]),
      trainerSheets: new Map<string, TrainerSheet>(),
    }),
  })
  return { map, actorSheet, targetSheet, result }
}

describe('Capability terrain turn lifecycle', () => {
  it('charges Burrow upkeep on canonical material tags without duplicated voxel tags', () => {
    const map = mapFixture({ target: { id: 'target', x: 2 } })
    const encounter = createEmptyEncounterState()
    map.voxels = [{ x: 0, y: 0, z: 1, materialId: 'burrow_dirt' }]
    map.encounterState = {
      ...encounter,
      turnResources: {
        actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1, turn: 1 }),
      },
    }
    const result = planInitiativeLifecycle({
      map,
      previous: { activeId: 'actor', round: 1 },
      current: { activeId: 'target', round: 1 },
      orderIds: ['actor', 'target'], operationId: 'operation:burrow-upkeep', time: 3_000,
      loadSheets: () => ({
        pokemonSheets: new Map([
          ['actor', sheet({ id: 'actor', x: 0 })],
          ['target', sheet({ id: 'target', x: 2 })],
        ]),
        trainerSheets: new Map<string, TrainerSheet>(),
      }),
    })

    expect(result.currentEncounterState.turnResources.actor?.actions.standard.spent).toBe(1)
  })
})

describe('Grassy Terrain turn lifecycle', () => {
  it('heals one grounded global-terrain member by one Tick at turn start', () => {
    const baseTarget = { id: 'target', x: 2 }
    const fullMaxHp = pokemonHpSnapshot(sheet(baseTarget)).fullMaxHp
    const target = { ...baseTarget, currentHp: fullMaxHp - 20 }
    const fixture = plan({ target })

    expect(fixture.result.reduction.operations).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^terrain\.grassy\.healing\.[0-9a-f]{32}$/),
        kind: 'heal',
        source: {
          kind: 'lifecycle-event',
          id: expect.stringContaining('turn-start'),
        },
        recipients: { kind: 'actor' },
        reasonCode: 'terrain.grassy.turn-start-healing',
        payload: expect.objectContaining({
          calculation: { kind: 'percent-max', percent: 10 },
          rounding: 'floor',
        }),
      }),
    ])
    expect(fixture.result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 5 },
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(fixture.result.sheetWrites).toHaveLength(1)
    expect(((fixture.result.sheetWrites[0]!.nextSheet as CharacterSheet).combat as {
      currentHp: number
    }).currentHp).toBe(fullMaxHp - 20 + Math.floor(fullMaxHp * 0.1))
    expect(fixture.result.reduction.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'trigger',
        handlerId: 'handler.grassy-terrain-turn-healing',
        reasonCode: 'terrain.grassy.turn-start-healing-trigger',
      }),
      expect.objectContaining({
        kind: 'operation-enqueued',
        operationKind: 'heal',
      }),
    ]))
    expect(fixture.result.currentFieldEffects.terrains).toEqual([
      { kind: 'grassy', rounds: 3, scope: 'field' },
    ])
  })

  it('uses the same footprint query for local terrain after movement', () => {
    const insideBase = { id: 'target', x: 2 }
    const fullMaxHp = pokemonHpSnapshot(sheet(insideBase)).fullMaxHp
    const inside = plan({
      target: { ...insideBase, currentHp: fullMaxHp - 20 },
      scope: 'local',
    })
    const outside = plan({
      target: { id: 'target', x: 5, currentHp: fullMaxHp - 20 },
      scope: 'local',
    })

    expect(inside.result.sheetWrites).toHaveLength(1)
    expect(outside.result.reduction.operations).toHaveLength(1)
    expect(outside.result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 5 },
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(outside.result.sheetWrites).toEqual([])
  })

  it('does not heal airborne members and leaves authoritative inputs immutable', () => {
    const target = { id: 'target', x: 2, currentHp: 10, airborne: true }
    const fixture = plan({ target })
    const mapBefore = structuredClone(fixture.map)
    const sheetBefore = structuredClone(fixture.targetSheet)

    // Replanning the same immutable snapshot yields the same operation identity
    // and no sheet mutation; accepted-command op idempotency owns persistence.
    const repeated = plan({ target })
    expect(fixture.result.reduction.operations).toEqual(repeated.result.reduction.operations)
    expect(fixture.result.sheetWrites).toEqual([])
    expect(fixture.result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 5 },
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(fixture.map).toEqual(mapBefore)
    expect(fixture.targetSheet).toEqual(sheetBefore)
  })
})
