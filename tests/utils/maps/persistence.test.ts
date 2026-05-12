import { describe, expect, it } from 'vitest'
import {
  clonePersistableMapPayload,
  stablePersistableMapJson,
  stripDerivedMapFolder,
  toPersistableMapPayload,
} from '~/utils/maps/persistence'
import type { TabletopMap } from '~/types/map'

const createMap = (folder = 'maps/a'): TabletopMap => ({
  schemaVersion: 2,
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
    expect(payload).not.toHaveProperty('folder')
  })

  it('builds stable persisted JSON that ignores folder and sorts keys', () => {
    const first = stablePersistableMapJson({ slug: 'arena', folder: 'a', name: 'Arena' })
    const second = stablePersistableMapJson({ name: 'Arena', folder: 'b', slug: 'arena' })

    expect(first).toBe('{"name":"Arena","slug":"arena"}')
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
  })
})
