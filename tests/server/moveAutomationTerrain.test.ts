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
import {
  createMistyTerrainConditionProtectionEffects,
} from '~~/server/domain/moveAutomation/terrainConditionProtection'
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

const trainerPlacement = (id: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'trainer',
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
  kind: 'electric' | 'grassy' | 'misty' | 'psychic',
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
  readonly globalPsychic?: boolean
  readonly localKinds?: readonly ('electric' | 'grassy' | 'misty' | 'psychic')[]
  readonly activeId?: string | null
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
      ...(options.globalPsychic === false
        ? []
        : [{ kind: 'psychic' as const, scope: 'field' as const }]),
    ],
    rooms: [],
  },
  placements: [
    placement('actor', 1),
    placement('outside', 5),
    placement('airborne', 1),
    trainerPlacement('trainer', 1),
  ],
  initiative: { activeId: options.activeId ?? null, round: 1 },
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
    trainerSheets: new Map<string, TrainerSheet>([[
      'trainer',
      { slug: 'trainer', name: 'Trainer', level: 20, revision: 6 },
    ]]),
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

describe('authoritative Terrain queries', () => {
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

  it('applies Misty Dragon penalties for a grounded origin or grounded target', () => {
    const local = contextFixture({
      globalElectric: false,
      globalPsychic: false,
      localKinds: ['misty'],
    })

    expect(local.queries.terrain.damage({
      placementId: 'actor',
      targetPlacementId: 'outside',
      moveType: 'Dragon',
    })).toMatchObject({
      modifiers: [{
        id: 'damage.terrain.misty.dragon',
        source: { kind: 'field', id: 'zone.terrain.misty.local' },
        reasonCode: 'terrain.misty.dragon-damage-penalty',
        value: -10,
      }],
      trace: expect.arrayContaining([expect.objectContaining({
        terrainKind: 'misty',
        placementId: 'actor',
        outcome: 'applied',
        value: -10,
      })]),
    })
    expect(local.queries.terrain.damage({
      placementId: 'outside',
      targetPlacementId: 'actor',
      moveType: 'Dragon',
    })).toMatchObject({
      modifiers: [expect.objectContaining({ value: -10 })],
      trace: expect.arrayContaining([expect.objectContaining({
        terrainKind: 'misty',
        placementId: 'actor',
        outcome: 'applied',
      })]),
    })
    expect(local.queries.terrain.damage({
      placementId: 'airborne',
      targetPlacementId: 'outside',
      moveType: 'Dragon',
    })).toMatchObject({
      modifiers: [],
      trace: expect.arrayContaining([
        expect.objectContaining({
          terrainKind: 'misty',
          placementId: 'airborne',
          outcome: 'not-grounded',
          reasonCode: 'terrain.misty.not-grounded',
        }),
        expect.objectContaining({
          terrainKind: 'misty',
          placementId: 'outside',
          outcome: 'outside-zone',
          reasonCode: 'terrain.misty.outside-zone',
        }),
      ]),
    })
  })

  it('applies local Psychic damage for spatial origins or targets regardless of grounding', () => {
    const terrain = contextFixture({
      globalElectric: false,
      globalPsychic: false,
      localKinds: ['psychic'],
    }).queries.terrain

    for (const placementId of ['actor', 'airborne']) {
      expect(terrain.damage({
        placementId,
        targetPlacementId: 'outside',
        moveType: 'Psychic',
      })).toMatchObject({
        modifiers: [{
          id: 'damage.terrain.psychic.psychic',
          source: { kind: 'field', id: 'zone.terrain.psychic.local' },
          reasonCode: 'terrain.psychic.psychic-damage-bonus',
          value: 10,
        }],
        trace: [expect.objectContaining({
          terrainKind: 'psychic',
          placementId,
          outcome: 'applied',
          reasonCode: 'terrain.psychic.psychic-damage-bonus',
        })],
      })
    }

    expect(terrain.damage({
      placementId: 'outside',
      targetPlacementId: 'actor',
      moveType: 'Psychic',
    })).toMatchObject({
      modifiers: [expect.objectContaining({
        source: { kind: 'field', id: 'zone.terrain.psychic.local' },
        value: 10,
      })],
      trace: [expect.objectContaining({
        terrainKind: 'psychic',
        placementId: 'actor',
        outcome: 'applied',
      })],
    })
    expect(terrain.damage({
      placementId: 'outside',
      targetPlacementId: 'outside',
      moveType: 'Psychic',
    })).toMatchObject({
      modifiers: [],
      trace: [expect.objectContaining({
        terrainKind: 'psychic',
        placementId: 'outside',
        outcome: 'outside-zone',
        reasonCode: 'terrain.psychic.outside-zone',
      })],
    })
    const emptyField = { weather: [], terrains: [], rooms: [] }
    expect(terrain.projectFieldEffects('outside', emptyField, 'outside').terrains).toEqual([])
    expect(terrain.projectFieldEffects('outside', emptyField, 'actor').terrains).toEqual([{
      kind: 'psychic',
      scope: 'area',
      source: 'zone.terrain.psychic.local',
    }])
    expect(terrain.damage({
      placementId: 'actor',
      targetPlacementId: 'outside',
      moveType: 'Water',
    })).toMatchObject({
      modifiers: [],
      trace: [expect.objectContaining({
        outcome: 'not-applicable',
        reasonCode: 'terrain.psychic.damage-type-not-applicable',
      })],
    })
    const immune = terrain.damage({
      placementId: 'actor',
      targetPlacementId: 'outside',
      moveType: 'Psychic',
      targetImmune: true,
    })
    expect(immune).toMatchObject({
      modifiers: [],
      trace: [expect.objectContaining({
        outcome: 'prevented',
        reasonCode: 'terrain.damage.target-immune',
      })],
    })
    expect(Object.isFrozen(immune)).toBe(true)
    expect(Object.isFrozen(immune.trace)).toBe(true)
  })

  it('protects a grounded Misty member from the first turn of Status Afflictions', () => {
    const terrain = contextFixture({
      globalElectric: false,
      localKinds: ['misty'],
    }).queries.terrain

    expect(terrain.condition({ placementId: 'actor', conditionId: 'Burned' }))
      .toMatchObject({
        blockedBy: null,
        firstTurnProtection: {
          kind: 'ignore-first-turn',
          terrainKind: 'misty',
          zoneId: 'zone.terrain.misty.local',
          sourceLabel: 'Misty Terrain (zone.terrain.misty.local)',
          reasonCode: 'terrain.misty.first-turn-status-protection',
        },
        trace: [expect.objectContaining({
          terrainKind: 'misty',
          outcome: 'applied',
          reasonCode: 'terrain.misty.first-turn-status-protection',
          value: 'Burned',
        })],
      })
    expect(terrain.condition({ placementId: 'actor', conditionId: 'Vulnerable' }))
      .toEqual({ blockedBy: null, firstTurnProtection: null, trace: [] })
    expect(terrain.condition({ placementId: 'outside', conditionId: 'Burned' }))
      .toMatchObject({
        firstTurnProtection: null,
        trace: [expect.objectContaining({
          terrainKind: 'misty',
          placementId: 'outside',
          outcome: 'outside-zone',
          reasonCode: 'terrain.misty.outside-zone',
        })],
      })
    expect(terrain.condition({ placementId: 'airborne', conditionId: 'Burned' }))
      .toMatchObject({
        firstTurnProtection: null,
        trace: [expect.objectContaining({ outcome: 'not-grounded' })],
      })
  })

  it('suppresses Flinch and its derived Vulnerable state together for the protected turn', () => {
    const effects = createMistyTerrainConditionProtectionEffects({
      protection: {
        kind: 'ignore-first-turn',
        terrainKind: 'misty',
        zoneId: 'legacy.terrain.misty',
        sourceLabel: 'Misty Terrain (legacy.terrain.misty)',
        reasonCode: 'terrain.misty.first-turn-status-protection',
      },
      conditionId: 'Flinch',
      operationId: 'operation.apply-flinch',
      moveId: 'move.fake-out',
      sourcePlacementId: 'actor',
      recipientPlacementId: 'outside',
      createdRound: 1,
      createdTurn: 0,
    })

    expect(effects.map(effect => effect.payload)).toEqual([
      { conditionId: 'flinch', action: 'suppress', saveTiming: null },
      { conditionId: 'vulnerable', action: 'suppress', saveTiming: null },
    ])
    expect(new Set(effects.map(effect => effect.id)).size).toBe(2)
    expect(effects.every(effect => Object.isFrozen(effect))).toBe(true)
  })

  it('blocks only grounded off-turn Pokémon Priority and Interrupt declarations', () => {
    const fixture = {
      globalElectric: false,
      globalPsychic: false,
      localKinds: ['psychic'] as const,
    }
    const offTurn = contextFixture(fixture).queries.terrain
    for (const timing of ['priority', 'interrupt'] as const) {
      const decision = offTurn.action({ placementId: 'actor', timing })
      expect(decision).toMatchObject({
        allowed: false,
        blockedBy: 'Psychic Terrain (zone.terrain.psychic.local)',
        trace: [{
          interaction: 'action',
          terrainKind: 'psychic',
          zoneId: 'zone.terrain.psychic.local',
          placementId: 'actor',
          outcome: 'prevented',
          reasonCode: 'terrain.psychic.off-turn-priority-interrupt-prevention',
          value: timing,
        }],
      })
      expect(Object.isFrozen(decision)).toBe(true)
      expect(Object.isFrozen(decision.trace)).toBe(true)
    }

    expect(offTurn.action({ placementId: 'actor', timing: 'reaction' })).toMatchObject({
      allowed: true,
      blockedBy: null,
      trace: [expect.objectContaining({
        outcome: 'not-applicable',
        reasonCode: 'terrain.psychic.reaction-action-unrestricted',
      })],
    })
    expect(contextFixture({ ...fixture, activeId: 'actor' }).queries.terrain.action({
      placementId: 'actor',
      timing: 'priority',
    })).toMatchObject({
      allowed: true,
      trace: [expect.objectContaining({
        outcome: 'not-applicable',
        reasonCode: 'terrain.psychic.action-on-own-initiative',
      })],
    })
    expect(offTurn.action({ placementId: 'airborne', timing: 'interrupt' })).toMatchObject({
      allowed: true,
      blockedBy: null,
      trace: [expect.objectContaining({
        outcome: 'not-grounded',
        reasonCode: 'terrain.psychic.not-grounded',
      })],
    })
    expect(offTurn.action({ placementId: 'outside', timing: 'reaction' })).toMatchObject({
      allowed: true,
      blockedBy: null,
      trace: [expect.objectContaining({
        outcome: 'outside-zone',
        reasonCode: 'terrain.psychic.outside-zone',
      })],
    })
    expect(offTurn.action({ placementId: 'trainer', timing: 'reaction' })).toMatchObject({
      allowed: true,
      blockedBy: null,
      trace: [expect.objectContaining({
        outcome: 'not-applicable',
        reasonCode: 'terrain.psychic.non-pokemon-action-unrestricted',
      })],
    })
    expect(offTurn.action({ placementId: 'actor', timing: 'ordinary' }))
      .toEqual({ allowed: true, blockedBy: null, trace: [] })
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
      .toEqual({ blockedBy: null, firstTurnProtection: null, trace: [] })

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
      { kind: 'grassy', scope: 'area', source: 'zone.terrain.grassy.local' },
      { kind: 'electric', scope: 'field', source: 'legacy.terrain.electric' },
      { kind: 'psychic', scope: 'field', source: 'legacy.terrain.psychic' },
    ])
    expect(context.queries.terrain.projectFieldEffects('airborne', base).terrains)
      .toEqual([{ kind: 'psychic', scope: 'field', source: 'legacy.terrain.psychic' }])
    expect(base).toEqual(before)
  })
})
