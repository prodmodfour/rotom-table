import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { capabilityEncounterEffectFixture } from '../../fixtures/moveAutomation/encounterEffects'
import {
  clonePersistableMapPayload,
  stablePersistableMapJson,
  stripDerivedMapFolder,
  toPersistableMapPayload,
} from '~/utils/maps/persistence'
import type { TabletopMap } from '~/types/map'

const createMap = (folder = 'maps/a'): TabletopMap => ({
  schemaVersion: 2,
  revision: 3,
  slug: 'test-map',
  name: 'Test Map',
  folder,
  dimensions: { x: 5, y: 3, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  encounterState: createEmptyEncounterState(),
  metadata: { note: 'hello' },
  createdAt: 1,
  updatedAt: 2,
})

describe('map persistence helpers', () => {
  it('strips derived folder fields without mutating the source map', () => {
    const map = createMap('folder/a')

    const persisted = stripDerivedMapFolder(map)

    expect(persisted).not.toHaveProperty('folder')
    expect(persisted).not.toBe(map)
    expect(map.folder).toBe('folder/a')
  })

  it('returns a persistable JSON-record payload', () => {
    const payload = toPersistableMapPayload(createMap(''))

    expect(payload.slug).toBe('test-map')
    expect(payload.name).toBe('Test Map')
    expect(payload.revision).toBe(3)
    expect(payload.encounterState).toEqual(createEmptyEncounterState())
    expect(payload).not.toHaveProperty('folder')
  })

  it('builds stable persisted JSON that ignores folder and sorts keys', () => {
    const first = stablePersistableMapJson({ slug: 'arena', folder: 'a', name: 'Arena' })
    const second = stablePersistableMapJson({ name: 'Arena', folder: 'b', slug: 'arena' })

    expect(first).toBe('{"name":"Arena","revision":0,"slug":"arena"}')
    expect(second).toBe(first)
  })

  it('deep-clones persistable map payloads before save requests', () => {
    const map = createMap('derived/folder')

    const payload = clonePersistableMapPayload(map)
    const { folder: _folder, ...expected } = map

    expect(payload).toEqual(expected)
    expect(payload).not.toHaveProperty('folder')
    expect(payload.metadata).toEqual(map.metadata)
    expect(payload.metadata).not.toBe(map.metadata)
    expect(payload.encounterState).toEqual(map.encounterState)
    expect(payload.encounterState).not.toBe(map.encounterState)
    expect(payload.encounterState?.effects).not.toBe(map.encounterState?.effects)
    expect(payload.encounterState?.counters).not.toBe(map.encounterState?.counters)
  })

  it('round-trips encounter state without absorbing existing combat fields', () => {
    const map: TabletopMap = {
      ...createMap(),
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [capabilityEncounterEffectFixture()],
      },
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
      fieldEffects: { weather: [{ kind: 'rainy', rounds: 3 }], terrains: [], rooms: [] },
      temporaryHitPoints: {
        scene: { name: 'Rainy arena', startedAt: 10 },
        byPlacementId: { 'token-1': 5 },
      },
      moveUsage: {
        scene: { name: 'Rainy arena', startedAt: 10 },
        byPlacementId: {},
      },
    }

    const roundTrip = JSON.parse(stablePersistableMapJson(map)) as TabletopMap

    expect(roundTrip.encounterState).toEqual(map.encounterState)
    expect(roundTrip.hazards).toEqual(map.hazards)
    expect(roundTrip.fieldEffects).toEqual(map.fieldEffects)
    expect(roundTrip.temporaryHitPoints).toEqual(map.temporaryHitPoints)
    expect(roundTrip.moveUsage).toEqual(map.moveUsage)
  })
})
