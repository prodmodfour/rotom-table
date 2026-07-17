import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseEncounterZone,
  type EncounterZone,
} from '#shared/moveAutomation/encounterZones'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (
  id: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  position: { x, y: 0, z: 1 },
})

const sheet = (
  id: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug: id,
  nickname: id,
  species: 'Pikachu',
  level: 20,
  revision: id === 'actor' ? 3 : 5,
  movelist: id === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 50, conditions: [] },
  ...overrides,
})

const localTerrain = (
  kind: 'electric' | 'grassy',
  cells: readonly { readonly x: number; readonly y: number; readonly z: number }[],
): EncounterZone => parseEncounterZone({
  id: `zone.terrain.${kind}.local`,
  kind: 'terrain',
  source: {
    kind: 'operation',
    operationId: `op.terrain.${kind}`,
    moveId: `${kind}-terrain`,
    placementId: 'actor',
  },
  sideId: null,
  geometry: { kind: 'cells', cells },
  layer: 1,
  duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
  stacking: { kind: 'replace', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['terrain', kind],
  payload: { terrainId: kind },
})

const mapFixture = (options: {
  readonly globalElectric?: boolean
  readonly localKinds?: readonly ('electric' | 'grassy')[]
} = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'terrain-mechanics-arena',
  name: 'Terrain Mechanics Arena',
  revision: 7,
  dimensions: { x: 10, y: 4, z: 6 },
  groundLevelY: 0,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: [],
    terrains: [
      ...(options.globalElectric === false ? [] : [{ kind: 'electric' as const }]),
      { kind: 'psychic', scope: 'field' },
    ],
    rooms: [],
  },
  placements: [
    placement('actor', 1),
    placement('outside', 5),
    placement('airborne', 1),
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    zones: (options.localKinds ?? ['grassy']).map(kind => localTerrain(kind, [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ])),
  },
})

const contextFixture = (options: Parameters<typeof mapFixture>[0] = {}) => {
  const map = mapFixture(options)
  return buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: new Map([
      ['actor', sheet('actor')],
      ['outside', sheet('outside')],
      ['airborne', sheet('airborne', { capabilities: { sky: 6 } })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'outside' },
    },
    candidatePlacementIds: ['outside', 'airborne'],
    selectedPlacementIds: ['outside'],
    random: createFiniteAuthoritativeMoveRandomStream([]),
    time: 2_000,
  })
}

describe('authoritative Electric and Grassy Terrain queries', () => {
  it('uses one grounded footprint query for global and local terrain geometry', () => {
    const context = contextFixture()
    const resolver = context.queries.terrain

    expect(resolver.active().map(terrain => [terrain.kind, terrain.zoneId])).toEqual([
      ['grassy', 'zone.terrain.grassy.local'],
      ['electric', 'legacy.terrain.electric'],
      ['psychic', 'legacy.terrain.psychic'],
    ])
    expect(resolver.membership({ placementId: 'actor' })).toMatchObject({
      grounding: 'grounded',
      terrains: [
        { kind: 'grassy', zoneId: 'zone.terrain.grassy.local' },
        { kind: 'electric', zoneId: 'legacy.terrain.electric' },
        { kind: 'psychic', zoneId: 'legacy.terrain.psychic' },
      ],
    })
    expect(resolver.membership({ placementId: 'outside' }).terrains.map(item => item.kind))
      .toEqual(['electric', 'psychic'])
    expect(resolver.membership({ placementId: 'airborne' })).toMatchObject({
      grounding: 'airborne',
      terrains: [],
      trace: expect.arrayContaining([
        expect.objectContaining({
          terrainKind: 'electric',
          outcome: 'not-grounded',
          reasonCode: 'terrain.electric.not-grounded',
        }),
        expect.objectContaining({ terrainKind: 'grassy', outcome: 'not-grounded' }),
      ]),
    })
    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'outside', revision: 5 },
      { kind: 'pokemon', slug: 'airborne', revision: 5 },
    ])
    expect(Object.isFrozen(resolver.active())).toBe(true)
    expect(Object.isFrozen(resolver.active()[0]?.geometry)).toBe(true)
  })

  it('derives local terrain entry and exit from server-owned movement positions', () => {
    const context = contextFixture()
    const result = context.queries.terrain.movement({
      placementId: 'outside',
      from: { x: 5, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })

    expect(result).toEqual({
      placementId: 'outside',
      enteredZoneIds: ['zone.terrain.grassy.local'],
      leftZoneIds: [],
      retainedZoneIds: ['legacy.terrain.electric', 'legacy.terrain.psychic'],
      trace: [
        expect.objectContaining({
          terrainKind: 'grassy',
          outcome: 'entered',
          reasonCode: 'terrain.grassy.movement-entered',
        }),
        expect.objectContaining({ terrainKind: 'electric', outcome: 'retained' }),
        expect.objectContaining({ terrainKind: 'psychic', outcome: 'retained' }),
      ],
    })
  })

  it.each([
    ['electric', 'Electric', 'legacy.terrain.electric', 'terrain.electric.electric-damage-bonus'],
    ['grassy', 'Grass', 'zone.terrain.grassy.local', 'terrain.grassy.grass-damage-bonus'],
  ] as const)(
    'applies grounded %s damage once with exact field trace attribution',
    (terrain, moveType, zoneId, reasonCode) => {
      const context = contextFixture()
      const resolution = context.queries.terrain.damage({
        placementId: 'actor',
        moveType,
      })

      expect(resolution.modifiers).toContainEqual(expect.objectContaining({
        id: `damage.terrain.${terrain}.${moveType.toLowerCase()}`,
        source: { kind: 'field', id: zoneId },
        stackingGroup: `terrain.${terrain}.damage-roll`,
        reasonCode,
        value: 10,
      }))
      expect(resolution.trace).toContainEqual(expect.objectContaining({
        terrainKind: terrain,
        zoneId,
        outcome: 'applied',
        reasonCode,
        value: 10,
      }))
    },
  )

  it('does not boost airborne, out-of-zone, unrelated, or immune damage', () => {
    const local = contextFixture({ globalElectric: false, localKinds: ['electric', 'grassy'] })

    expect(local.queries.terrain.damage({ placementId: 'airborne', moveType: 'Electric' }))
      .toMatchObject({
        modifiers: [],
        trace: expect.arrayContaining([expect.objectContaining({ outcome: 'not-grounded' })]),
      })
    expect(local.queries.terrain.damage({ placementId: 'outside', moveType: 'Grass' }))
      .toMatchObject({
        modifiers: [],
        trace: expect.arrayContaining([expect.objectContaining({ outcome: 'outside-zone' })]),
      })
    expect(local.queries.terrain.damage({ placementId: 'actor', moveType: 'Water' }).modifiers)
      .toEqual([])
    expect(local.queries.terrain.damage({
      placementId: 'actor',
      moveType: 'Electric',
      targetImmune: true,
    })).toMatchObject({
      modifiers: [],
      trace: expect.arrayContaining([expect.objectContaining({
        terrainKind: 'electric',
        outcome: 'prevented',
        reasonCode: 'terrain.damage.target-immune',
      })]),
    })
  })

  it('prevents Sleep and enables turn healing only for grounded members', () => {
    const context = contextFixture({ globalElectric: false, localKinds: ['electric', 'grassy'] })
    const terrain = context.queries.terrain

    expect(terrain.condition({ placementId: 'actor', conditionId: 'Sleep' }))
      .toMatchObject({
        blockedBy: 'Electric Terrain (zone.terrain.electric.local)',
        trace: [{
          interaction: 'condition',
          terrainKind: 'electric',
          zoneId: 'zone.terrain.electric.local',
          placementId: 'actor',
          outcome: 'prevented',
          reasonCode: 'terrain.electric.sleep-prevention',
          value: 'sleep',
        }],
      })
    expect(terrain.condition({ placementId: 'outside', conditionId: 'Sleep' }).blockedBy)
      .toBeNull()
    expect(terrain.condition({ placementId: 'airborne', conditionId: 'Sleep' }).blockedBy)
      .toBeNull()
    expect(terrain.condition({ placementId: 'actor', conditionId: 'Burned' }))
      .toEqual({ blockedBy: null, trace: [] })

    expect(terrain.turnHealing({ placementId: 'actor' })).toMatchObject({
      applies: true,
      percent: 10,
      zoneId: 'zone.terrain.grassy.local',
      trace: [expect.objectContaining({
        outcome: 'applied',
        reasonCode: 'terrain.grassy.turn-start-healing',
      })],
    })
    expect(terrain.turnHealing({ placementId: 'outside' })).toMatchObject({
      applies: false,
      percent: null,
      zoneId: null,
    })
    expect(terrain.turnHealing({ placementId: 'airborne' }).applies).toBe(false)
  })

  it('projects compatibility terrain per grounded actor without mutating inputs', () => {
    const context = contextFixture()
    const base = {
      weather: [],
      terrains: [
        { kind: 'electric' as const, source: 'stale-editor-row' },
        { kind: 'grassy' as const, source: 'stale-editor-row' },
        { kind: 'misty' as const, source: 'future-ticket' },
      ],
      rooms: [],
    }
    const before = structuredClone(base)

    expect(context.queries.terrain.projectFieldEffects('actor', base).terrains).toEqual([
      { kind: 'misty', rounds: 5, scope: 'field', source: 'future-ticket' },
      { kind: 'grassy', scope: 'area', source: 'zone.terrain.grassy.local' },
      { kind: 'electric', scope: 'field', source: 'legacy.terrain.electric' },
    ])
    expect(context.queries.terrain.projectFieldEffects('airborne', base).terrains)
      .toEqual([{ kind: 'misty', rounds: 5, scope: 'field', source: 'future-ticket' }])
    expect(base).toEqual(before)
  })
})
