import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  activeEncounterRoomKinds,
  encounterCalculatedInitiativeDirection,
} from '~/utils/encounterRooms'
import type { TabletopMap } from '~/types/map'

const delayedNativeTrickRoom = () => parseEncounterZone({
  id: 'zone.room.trick',
  kind: 'room',
  source: {
    kind: 'operation',
    operationId: 'operation.room.trick',
    moveId: 'move.trick-room',
    placementId: 'actor-token',
  },
  sideId: null,
  geometry: { kind: 'battlefield' },
  layer: 1,
  duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
  stacking: { kind: 'replace', maxLayers: null },
  fieldPolicy: {
    priority: 0,
    replacementGroup: 'field.room.trick',
    suppression: { sources: [] },
  },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['global-field', 'room', 'trick'],
  payload: { roomId: 'trick', startsNextRound: true },
})

const map = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'room-client-map',
  name: 'Room Client Map',
  dimensions: { x: 4, y: 2, z: 4 },
  voxels: [],
  placements: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  encounterState: createEmptyEncounterState(),
  ...overrides,
})

describe('encounter Room presentation queries', () => {
  it('uses active legacy Rooms and ignores delayed or expired compatibility rows', () => {
    expect(encounterCalculatedInitiativeDirection(map({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [{ kind: 'trick', rounds: 5 }],
      },
    }))).toBe('lowest-first')
    expect(encounterCalculatedInitiativeDirection(map({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [{ kind: 'trick', rounds: 5, startsNextRound: true }],
      },
    }))).toBe('highest-first')
    expect(encounterCalculatedInitiativeDirection(map({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [{ kind: 'trick', rounds: 0 }],
      },
    }))).toBe('highest-first')
  })

  it('lets an inactive native Room shadow the renderer compatibility row', () => {
    const state = {
      ...createEmptyEncounterState(),
      zones: [delayedNativeTrickRoom()],
    }
    const fixture = map({
      fieldEffects: {
        weather: [],
        terrains: [],
        rooms: [
          { kind: 'trick', rounds: 5 },
          { kind: 'wonder', rounds: 5 },
        ],
      },
      encounterState: state,
    })

    expect([...activeEncounterRoomKinds(fixture)]).toEqual(['wonder'])
    expect(encounterCalculatedInitiativeDirection(fixture)).toBe('highest-first')
  })
})
