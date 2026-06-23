import { afterEach, describe, expect, it } from 'vitest'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '../../server/storage/opRepository'
import { SaveMapUseCaseError, saveMapUseCase } from '../../server/useCases/saveMap'

const mapDoc = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'arena',
  name: 'Arena',
  folder: 'maps',
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  placements: [],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  initiative: { activeId: null, round: 1 },
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
})

let databases: RotomDatabase[] = []
const db = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('save map use case', () => {
  it('updates SQLite, advances revision once, emits after commit and does not write JSON', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Arena Prime', revision: 999, updatedAt: 999 }),
      expectedRevision: 2,
      clientId: 'client-1',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { mapRepository: maps, now: () => 300 })

    expect(result.map).toMatchObject({ slug: 'arena', name: 'Arena Prime', revision: 3, updatedAt: 300, folder: 'maps' })
    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena Prime', revision: 3 })
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toMatchObject({ channel: 'map:arena', type: 'updated', revision: 3, clientId: 'client-1' })
  })

  it('returns the current document without advancing revision when there is no semantic change', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc({ revision: 5, updatedAt: 500 }))

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ revision: 0, updatedAt: 0 }),
      expectedRevision: 5,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { mapRepository: maps, now: () => 600 })

    expect(result.map.revision).toBe(5)
    expect(result.map.updatedAt).toBe(500)
    expect(result.events).toEqual([])
  })

  it('rejects stale expected revisions and clears old live operation history after setup edits', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const ops = createSqliteLivePlayOpRepository({ database, clock: () => 10 })
    maps.saveSetupMap(mapDoc({ revision: 2 }))
    ops.saveCommandResult({
      mapSlug: 'arena',
      opId: 'op_aaaaaaaa',
      commandHash: 'hash' as any,
      command: { schemaVersion: 1, opId: 'op_aaaaaaaa', mapSlug: 'arena', baseRevision: 1, type: 'noop', scopes: [], payload: {} },
      result: { ok: true, opId: 'op_aaaaaaaa', mapSlug: 'arena', previousRevision: 1, revision: 2, patches: [] },
    })

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Stale' }),
      expectedRevision: 1,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { mapRepository: maps })).toThrow(SaveMapUseCaseError)

    saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Fresh' }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { mapRepository: maps })
    expect(ops.listAcceptedOpsSinceRevision({ mapSlug: 'arena', baseRevision: 1, currentRevision: 3 })).toEqual([])
  })

  it('blocks player saves and live-play whole-map saves', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc())

    expect(() => saveMapUseCase({ role: 'player', slug: 'arena', map: mapDoc(), expectedRevision: 0, interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT }, { mapRepository: maps }))
      .toThrow('Player whole-map saves are not allowed')
    expect(() => saveMapUseCase({ role: 'gm', slug: 'arena', map: mapDoc(), expectedRevision: 0, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY }, { mapRepository: maps }))
      .toThrow('Whole-map saves are setup/edit-only')
  })
})
