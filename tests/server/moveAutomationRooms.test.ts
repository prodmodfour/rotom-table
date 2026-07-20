import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  advanceMapGlobalFields,
  materializeMapGlobalFieldZones,
} from '~~/server/domain/moveAutomation/fieldMapState'
import {
  createMoveAutomationRoomResolver,
} from '~~/server/domain/moveAutomation/rooms'
import type { TabletopMap } from '~/types/map'

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'room-arena',
  name: 'Room Arena',
  revision: 7,
  dimensions: { x: 6, y: 3, z: 6 },
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  encounterState: createEmptyEncounterState(),
  ...overrides,
})

const nativeRoom = (input: {
  readonly id: 'trick' | 'wonder'
  readonly startsNextRound?: boolean
  readonly remaining?: number
}) => parseEncounterZone({
  id: `zone.room.${input.id}`,
  kind: 'room',
  source: {
    kind: 'operation',
    operationId: `operation.room.${input.id}`,
    moveId: `move.${input.id}-room`,
    placementId: 'actor-token',
  },
  sideId: null,
  geometry: { kind: 'battlefield' },
  layer: 1,
  duration: {
    kind: 'rounds',
    boundary: 'end',
    remaining: input.remaining ?? 5,
  },
  stacking: { kind: 'replace', maxLayers: null },
  fieldPolicy: {
    priority: 0,
    replacementGroup: `field.room.${input.id}`,
    suppression: { sources: [] },
  },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['global-field', 'room', input.id],
  payload: {
    roomId: input.id,
    startsNextRound: input.startsNextRound ?? false,
  },
})

describe('authoritative Room mechanics', () => {
  it('exposes only active Rooms and maps Wonder Room through non-destructive Pokémon stat overlays', () => {
    const map = mapFixture({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [
          { kind: 'trick', rounds: 5, startsNextRound: true },
          { kind: 'wonder', rounds: 5 },
        ],
      },
      encounterState: undefined,
    })
    const before = structuredClone(map)
    const rooms = createMoveAutomationRoomResolver(map)

    expect(rooms.active().map(room => room.kind)).toEqual(['wonder'])
    expect(rooms.calculatedInitiativeDirection()).toBe('highest-first')
    expect(rooms.statOverlay({
      placement: { sheetKind: 'pokemon' },
      stat: 'defense',
    })).toMatchObject({
      sourceStat: 'special-defense',
      reasonCode: 'room.wonder.defenses-switched',
    })
    expect(rooms.statOverlay({
      placement: { sheetKind: 'pokemon' },
      stat: 'special-defense',
    })).toMatchObject({ sourceStat: 'defense' })
    expect(rooms.statOverlay({
      placement: { sheetKind: 'trainer' },
      stat: 'defense',
    })).toBeNull()
    expect(rooms.statOverlay({
      placement: { sheetKind: 'pokemon' },
      stat: 'attack',
    })).toBeNull()
    expect(rooms.projectFieldEffects()).toEqual({
      weather: [],
      terrains: [],
      rooms: [{ kind: 'wonder', source: 'legacy.room.wonder' }],
    })
    expect(map).toEqual(before)
    expect(Object.isFrozen(rooms.active())).toBe(true)
  })

  it('lets inactive native identities shadow compatibility rows', () => {
    const delayed = nativeRoom({ id: 'trick', startsNextRound: true })
    const map = mapFixture({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [{ kind: 'trick', rounds: 5, startsNextRound: false }],
      },
      encounterState: {
        ...createEmptyEncounterState(),
        zones: [delayed],
      },
    })
    const rooms = createMoveAutomationRoomResolver(map)

    expect(rooms.active()).toEqual([])
    expect(rooms.calculatedInitiativeDirection()).toBe('highest-first')
    expect(rooms.projectFieldEffects().rooms).toEqual([])
  })

  it('rejects conflicting dual-read room state instead of silently preferring a lane', () => {
    const map = mapFixture({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [{ kind: 'wonder', rounds: 2 }],
      },
      encounterState: {
        ...createEmptyEncounterState(),
        zones: [nativeRoom({ id: 'wonder', remaining: 5 })],
      },
    })

    expect(() => materializeMapGlobalFieldZones(map)).toThrowError(expect.objectContaining({
      name: 'EncounterStateMigrationConflictError',
      code: 'conflicting-dual-representation',
    }))
  })

  it('activates Trick Room at the next round start, retains five full rounds, then expires once', () => {
    const delayed = mapFixture({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [{ kind: 'trick', rounds: 5, startsNextRound: true, source: 'Trick Room' }],
      },
      encounterState: undefined,
    })

    const afterDeclarationRound = advanceMapGlobalFields({
      map: delayed,
      event: { kind: 'round-end' },
    })
    expect(createMoveAutomationRoomResolver(afterDeclarationRound.map)
      .calculatedInitiativeDirection()).toBe('highest-first')
    expect(afterDeclarationRound.currentFieldEffects.rooms).toEqual([{
      kind: 'trick',
      rounds: 5,
      startsNextRound: true,
      source: 'Trick Room',
    }])

    let current = advanceMapGlobalFields({
      map: afterDeclarationRound.map,
      event: { kind: 'round-start' },
    }).map
    expect(createMoveAutomationRoomResolver(current).calculatedInitiativeDirection())
      .toBe('lowest-first')
    expect(current.fieldEffects?.rooms).toEqual([{
      kind: 'trick',
      rounds: 5,
      startsNextRound: false,
      source: 'Trick Room',
    }])

    for (const remaining of [4, 3, 2, 1]) {
      current = advanceMapGlobalFields({ map: current, event: { kind: 'round-end' } }).map
      expect(current.fieldEffects?.rooms).toEqual([{
        kind: 'trick',
        rounds: remaining,
        startsNextRound: false,
        source: 'Trick Room',
      }])
      current = advanceMapGlobalFields({ map: current, event: { kind: 'round-start' } }).map
      expect(createMoveAutomationRoomResolver(current).calculatedInitiativeDirection())
        .toBe('lowest-first')
    }

    const expired = advanceMapGlobalFields({ map: current, event: { kind: 'round-end' } })
    expect(expired.currentFieldEffects.rooms).toEqual([])
    expect(expired.currentEncounterState.zones).toEqual([])
    expect(expired.lifecycle.transitions).toEqual([
      expect.objectContaining({
        fieldId: 'trick',
        kind: 'expired',
        reasonCode: 'field-duration-expired',
      }),
    ])
    expect(createMoveAutomationRoomResolver(expired.map).calculatedInitiativeDirection())
      .toBe('highest-first')
    expect(materializeMapGlobalFieldZones(expired.map).zones).toEqual([])
  })
})
