import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '../../server/storage/opRepository'
import {
  createSqliteRealtimeEventRepository,
  RealtimeEventDedupeConflictError,
  type RealtimeEventRepository,
} from '../../server/storage/realtimeEventRepository'
import {
  setupMapSaveRealtimeDedupeKey,
} from '../../server/realtime/setupDocumentRealtime'
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

const trackedDb = () => {
  const real = db()
  let depth = 0
  const database: RotomDatabase = {
    ...real,
    withTransaction: (work) => {
      depth += 1
      try {
        return real.withTransaction(work)
      } finally {
        depth -= 1
      }
    },
  }
  return { database, transactionDepth: () => depth }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('save map use case', () => {
  it('commits a changed map and two durable map-access events in deterministic order', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 900 })
    const published: unknown[] = []
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Arena Prime', revision: 999, updatedAt: 999 }),
      expectedRevision: 2,
      clientId: 'client-1',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 300,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(result.map).toMatchObject({ slug: 'arena', name: 'Arena Prime', revision: 3, updatedAt: 300, folder: 'maps' })
    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena Prime', revision: 3 })
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual(['map:arena', 'maps'])
    expect(result.realtimeEvents.map((event) => event.dedupeKey)).toEqual([
      'setup-map:arena:3:map',
      'setup-map:arena:3:summary',
    ])
    expect(result.realtimeEvents.map((event) => event.access)).toEqual([
      { kind: 'map-access', mapSlug: 'arena' },
      { kind: 'map-access', mapSlug: 'arena' },
    ])
    expect(result.realtimeEvents[0]?.event).toMatchObject({
      sequence: 1,
      timestamp: 900,
      channel: 'map:arena',
      type: 'updated',
      revision: 3,
      clientId: 'client-1',
      data: result.map,
    })
    expect(result.realtimeEvents[1]?.event).toMatchObject({
      sequence: 2,
      timestamp: 900,
      channel: 'maps',
      type: 'updated',
      revision: 3,
      clientId: 'client-1',
      data: {
        slug: 'arena',
        name: 'Arena Prime',
        folder: 'maps',
        revision: 3,
        updatedAt: 300,
        placementCount: 0,
      },
    })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('publishes persisted events only after the SQLite transaction commits', () => {
    const { database, transactionDepth } = trackedDb()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 902 })
    const depths: number[] = []
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))

    saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'After Commit' }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 300,
      publishPersistedRealtimeEvent: () => depths.push(transactionDepth()),
    })

    expect(depths).toEqual([0, 0])
  })

  it('reports one after-commit publication failure, continues later publications, and keeps durable rows', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 901 })
    const attempted: unknown[] = []
    const report = vi.fn()
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Arena Prime', revision: 999, updatedAt: 999 }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 300,
      publishPersistedRealtimeEvent: (event) => {
        attempted.push(event)
        if (event.sequence === 1) throw new Error('hub unavailable')
      },
      reportAfterCommitPublicationFailure: report,
    })

    expect(result.ok).toBe(true)
    expect(attempted).toEqual(result.realtimeEvents)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 1,
      channel: 'map:arena',
      type: 'updated',
      resource: { kind: 'map', mapSlug: 'arena' },
    }))
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena Prime', revision: 3 })
  })

  it('returns the current document without advancing revision, appending, or publishing on no-op saves', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    maps.saveSetupMap(mapDoc({ revision: 5, updatedAt: 500 }))

    const result = saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ revision: 0, updatedAt: 0 }),
      expectedRevision: 5,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { database, mapRepository: maps, realtimeEventRepository: realtime, now: () => 600, publishPersistedRealtimeEvent: publish })

    expect(result.map.revision).toBe(5)
    expect(result.map.updatedAt).toBe(500)
    expect(result.realtimeEvents).toEqual([])
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects stale expected revisions without appending or publishing', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    maps.saveSetupMap(mapDoc({ revision: 2 }))

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Stale' }),
      expectedRevision: 1,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { database, mapRepository: maps, realtimeEventRepository: realtime, publishPersistedRealtimeEvent: publish })).toThrow(SaveMapUseCaseError)

    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena', revision: 2 })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('clears old live operation history after setup edits', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const ops = createSqliteLivePlayOpRepository({ database, clock: () => 10 })
    maps.saveSetupMap(mapDoc({ revision: 2 }))
    ops.saveCommandResult({
      mapSlug: 'arena',
      opId: 'op_aaaaaaaa',
      commandHash: 'hash' as any,
      command: { schemaVersion: 1, opId: 'op_aaaaaaaa', mapSlug: 'arena', baseRevision: 1, type: 'noop', scopes: [], payload: {} },
      result: { ok: true, opId: 'op_aaaaaaaa', mapSlug: 'arena', previousRevision: 1, revision: 2, patches: [] },
    })

    saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Fresh' }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { database, mapRepository: maps, realtimeEventRepository: realtime })
    expect(ops.listAcceptedOpsSinceRevision({ mapSlug: 'arena', baseRevision: 1, currentRevision: 3 })).toEqual([])
  })

  it('rolls back the map when the first realtime append fails', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))
    const failingRealtime = {
      database,
      appendMany: vi.fn(() => { throw new Error('first append failed') }),
    }

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Broken' }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { database, mapRepository: maps, realtimeEventRepository: failingRealtime })).toThrow('first append failed')

    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena', revision: 2, updatedAt: 200 })
  })

  it('rolls back the first event and the map when the second realtime append fails', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))
    const partialRealtime = {
      database,
      appendMany: vi.fn((inputs: Parameters<RealtimeEventRepository['appendMany']>[0]) => {
        const first = inputs[0]
        if (!first) throw new Error('missing first event')
        realtime.append(first)
        throw new Error('second append failed')
      }),
    }

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Broken' }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { database, mapRepository: maps, realtimeEventRepository: partialRealtime })).toThrow('second append failed')

    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena', revision: 2, updatedAt: 200 })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(realtime.getBySequence(1)).toBeNull()
  })

  it('rolls back map revision and operation-history clearing on dedupe conflicts', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const ops = createSqliteLivePlayOpRepository({ database, clock: () => 10 })
    maps.saveSetupMap(mapDoc({ revision: 2, updatedAt: 200 }))
    ops.saveCommandResult({
      mapSlug: 'arena',
      opId: 'op_bbbbbbbb',
      commandHash: 'hash' as any,
      command: { schemaVersion: 1, opId: 'op_bbbbbbbb', mapSlug: 'arena', baseRevision: 1, type: 'noop', scopes: [], payload: {} },
      result: { ok: true, opId: 'op_bbbbbbbb', mapSlug: 'arena', previousRevision: 1, revision: 2, patches: [] },
    })
    realtime.append({
      event: { channel: 'map:arena', type: 'updated', data: { wrong: true } },
      access: { kind: 'map-access', mapSlug: 'arena' },
      dedupeKey: setupMapSaveRealtimeDedupeKey({ mapSlug: 'arena', revision: 3, destination: 'map' }),
    })

    expect(() => saveMapUseCase({
      role: 'gm',
      slug: 'arena',
      map: mapDoc({ name: 'Conflict' }),
      expectedRevision: 2,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    }, { database, mapRepository: maps, realtimeEventRepository: realtime })).toThrow(RealtimeEventDedupeConflictError)

    expect(maps.getBySlug('arena')).toMatchObject({ name: 'Arena', revision: 2, updatedAt: 200 })
    expect(ops.listAcceptedOpsSinceRevision({ mapSlug: 'arena', baseRevision: 1, currentRevision: 2 })).toHaveLength(1)
    expect(realtime.cursorState().latestSequence).toBe(1)
  })

  it('blocks player saves and live-play whole-map saves', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    maps.saveSetupMap(mapDoc())

    expect(() => saveMapUseCase({ role: 'player', slug: 'arena', map: mapDoc(), expectedRevision: 0, interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT }, { database, mapRepository: maps }))
      .toThrow('Player whole-map saves are not allowed')
    expect(() => saveMapUseCase({ role: 'gm', slug: 'arena', map: mapDoc(), expectedRevision: 0, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY }, { database, mapRepository: maps }))
      .toThrow('Whole-map saves are setup/edit-only')
  })
})
