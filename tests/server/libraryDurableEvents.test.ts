import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { createMapUseCase } from '../../server/useCases/createMap'
import { moveMapUseCase } from '../../server/useCases/moveMap'
import { renameMapUseCase } from '../../server/useCases/renameMap'
import { deleteMapUseCase } from '../../server/useCases/deleteMap'
import { createMapFolderUseCase } from '../../server/useCases/createMapFolder'
import { moveMapFolderUseCase } from '../../server/useCases/moveMapFolder'
import { deleteMapFolderUseCase } from '../../server/useCases/deleteMapFolder'
import { createSheetUseCase } from '../../server/useCases/createSheet'
import { moveSheetUseCase } from '../../server/useCases/moveSheet'
import { renameSheetUseCase } from '../../server/useCases/renameSheet'
import { deleteSheetUseCase } from '../../server/useCases/deleteSheet'
import { createSheetFolderUseCase } from '../../server/useCases/createSheetFolder'
import { moveSheetFolderUseCase } from '../../server/useCases/moveSheetFolder'
import { deleteSheetFolderUseCase } from '../../server/useCases/deleteSheetFolder'
import { setMapInteractionModeUseCase } from '../../server/useCases/setMapInteractionMode'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { durableHarness, mapDoc, pokemonSheet, trainerSheet } from './helpers/durableLibraryHarness'

const eventChannels = (events: readonly { readonly event: { readonly channel: string } }[]) =>
  events.map((record) => record.event.channel)

const eventTypes = (events: readonly { readonly event: { readonly type: string } }[]) =>
  events.map((record) => record.event.type)

const failingRealtime = (database: ReturnType<typeof durableHarness>['database']) => ({
  database,
  appendMany: vi.fn(() => {
    throw new Error('append failed')
  }),
})

describe('durable map library events', () => {
  it('creates a map and commits its durable maps-channel event atomically before publishing the persisted row', () => {
    const { database, maps, realtime, published } = durableHarness(5_000)

    const result = createMapUseCase({
      name: 'Sky Atrium',
      folder: 'helix/maps',
      clientId: 'client-1',
    }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 123,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(maps.getBySlug(result.map.slug)).toMatchObject({ slug: 'sky-atrium', revision: 0 })
    expect(result.realtimeEvents).toHaveLength(1)
    expect(result.realtimeEvents[0]).toMatchObject({
      sequence: 1,
      access: { kind: 'map-access', mapSlug: 'sky-atrium' },
      event: {
        sequence: 1,
        timestamp: 5_000,
        channel: 'maps',
        type: 'created',
        revision: 0,
        clientId: 'client-1',
        data: { slug: 'sky-atrium', folder: 'helix/maps', revision: 0 },
      },
    })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('moves a map, advances its revision, and stores exact map-access events; no-op moves append nothing', () => {
    const { database, maps, realtime } = durableHarness(5_100)
    maps.saveSetupMap(mapDoc({ slug: 'arena', folder: 'old', revision: 2, updatedAt: 100 }))

    const result = moveMapUseCase({ slug: 'arena', folder: 'new', clientId: 'client-1' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(result.map).toMatchObject({ slug: 'arena', folder: 'new', revision: 3, updatedAt: 200 })
    expect(eventChannels(result.realtimeEvents)).toEqual(['map:arena', 'maps'])
    expect(eventTypes(result.realtimeEvents)).toEqual(['updated', 'moved'])
    expect(result.realtimeEvents.map((event) => event.access)).toEqual([
      { kind: 'map-access', mapSlug: 'arena' },
      { kind: 'map-access', mapSlug: 'arena' },
    ])

    const noOp = moveMapUseCase({ slug: 'arena', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 300,
    })
    expect(noOp.realtimeEvents).toEqual([])
    expect(realtime.cursorState().latestSequence).toBe(2)
  })

  it('rolls back map moves when durable event append fails', () => {
    const { database, maps } = durableHarness()
    maps.saveSetupMap(mapDoc({ slug: 'arena', folder: 'old', revision: 2, updatedAt: 100 }))

    expect(() => moveMapUseCase({ slug: 'arena', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: failingRealtime(database),
      now: () => 200,
    })).toThrow('append failed')

    expect(maps.getBySlug('arena')).toMatchObject({ folder: 'old', revision: 2, updatedAt: 100 })
  })

  it('renames maps with old-channel, new-channel and global events, and skips unchanged names', () => {
    const { database, maps, realtime } = durableHarness(5_200)
    maps.saveSetupMap(mapDoc({ slug: 'old-map', name: 'Old Map', revision: 1, updatedAt: 100 }))

    const result = renameMapUseCase({ slug: 'old-map', name: 'Sky Atrium' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(maps.getBySlug('old-map')).toBeNull()
    expect(maps.getBySlug('sky-atrium')).toMatchObject({ slug: 'sky-atrium', name: 'Sky Atrium', revision: 2 })
    expect(eventChannels(result.realtimeEvents)).toEqual(['map:old-map', 'map:sky-atrium', 'maps'])
    expect(eventTypes(result.realtimeEvents)).toEqual(['renamed', 'updated', 'renamed'])
    expect(result.realtimeEvents.map((event) => event.access)).toEqual([
      { kind: 'map-access', mapSlug: 'sky-atrium' },
      { kind: 'map-access', mapSlug: 'sky-atrium' },
      { kind: 'map-access', mapSlug: 'sky-atrium' },
    ])

    const noOp = renameMapUseCase({ slug: 'sky-atrium', name: 'Sky Atrium' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 300,
    })
    expect(noOp.realtimeEvents).toEqual([])
  })

  it('deletes maps with GM-only tombstone events', () => {
    const { database, maps, realtime } = durableHarness(5_300)
    maps.saveSetupMap(mapDoc({ slug: 'arena', folder: 'old', revision: 4, updatedAt: 100 }))

    const result = deleteMapUseCase({ slug: 'arena', clientId: 'client-1' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
    })

    expect(maps.getBySlug('arena')).toBeNull()
    expect(eventChannels(result.realtimeEvents)).toEqual(['map:arena', 'maps'])
    expect(result.realtimeEvents.every((event) => event.access.kind === 'gm-only')).toBe(true)
    expect(result.realtimeEvents.map((event) => event.event.data)).toEqual([{ slug: 'arena' }, { slug: 'arena' }])
  })
})

describe('durable map folder events', () => {
  it('creates existing and new map folders with GM-only durable no-op behavior', () => {
    const { database, maps, realtime } = durableHarness(5_400)

    const created = createMapFolderUseCase({ folder: 'archive', clientId: 'gm-client' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 100,
    })
    const again = createMapFolderUseCase({ folder: 'archive' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(created.created).toBe(true)
    expect(created.realtimeEvents).toHaveLength(1)
    expect(created.realtimeEvents[0]).toMatchObject({ access: { kind: 'gm-only' }, event: { channel: 'maps', type: 'folder-created', data: { folder: 'archive' } } })
    expect(again.created).toBe(false)
    expect(again.realtimeEvents).toEqual([])
  })

  it('moves map folders with a GM-only folder event and every affected map update in order', () => {
    const { database, maps, realtime } = durableHarness(5_500)
    maps.saveSetupMap(mapDoc({ slug: 'alpha', folder: 'old', revision: 1, updatedAt: 100 }))
    maps.saveSetupMap(mapDoc({ slug: 'bravo', folder: 'old/deep', revision: 3, updatedAt: 100 }))

    const result = moveMapFolderUseCase({ from: 'old', to: 'new', clientId: 'client-1' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(result.moved).toBe(true)
    expect(maps.getBySlug('alpha')).toMatchObject({ folder: 'new', revision: 2 })
    expect(maps.getBySlug('bravo')).toMatchObject({ folder: 'new/deep', revision: 4 })
    expect(eventChannels(result.realtimeEvents)).toEqual(['maps', 'map:alpha', 'maps', 'map:bravo', 'maps'])
    expect(eventTypes(result.realtimeEvents)).toEqual(['folder-moved', 'updated', 'moved', 'updated', 'moved'])
    expect(result.realtimeEvents[0]?.access).toEqual({ kind: 'gm-only' })
    expect(result.realtimeEvents.slice(1).every((event) => event.access.kind === 'map-access')).toBe(true)
  })

  it('rolls back map folder moves when event append fails', () => {
    const { database, maps } = durableHarness()
    maps.saveSetupMap(mapDoc({ slug: 'alpha', folder: 'old', revision: 1, updatedAt: 100 }))

    expect(() => moveMapFolderUseCase({ from: 'old', to: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: failingRealtime(database),
      now: () => 200,
    })).toThrow('append failed')

    expect(maps.getBySlug('alpha')).toMatchObject({ folder: 'old', revision: 1 })
    expect(maps.listFolders()).toContain('old')
    expect(maps.listFolders()).not.toContain('new')
  })

  it('deletes map folders with GM-only folder and map tombstone events', () => {
    const { database, maps, realtime } = durableHarness(5_600)
    maps.saveSetupMap(mapDoc({ slug: 'alpha', folder: 'gone', revision: 1, updatedAt: 100 }))
    maps.saveSetupMap(mapDoc({ slug: 'bravo', folder: 'gone/deep', revision: 2, updatedAt: 100 }))

    const result = deleteMapFolderUseCase({ folder: 'gone' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
    })

    expect(maps.getBySlug('alpha')).toBeNull()
    expect(maps.getBySlug('bravo')).toBeNull()
    expect(eventChannels(result.realtimeEvents)).toEqual(['maps', 'map:alpha', 'maps', 'map:bravo', 'maps'])
    expect(result.realtimeEvents.every((event) => event.access.kind === 'gm-only')).toBe(true)
  })
})

describe('durable sheet library events', () => {
  it('creates and moves sheets with sheet-access durable events and no-op move behavior', () => {
    const { database, sheets, realtime } = durableHarness(5_700)

    const created = createSheetUseCase({ kind: 'pokemon', folder: 'party', clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 100,
    })
    expect(created.realtimeEvents).toHaveLength(1)
    expect(created.realtimeEvents[0]).toMatchObject({ access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: created.slug }, event: { channel: 'sheets', type: 'updated' } })

    const moved = moveSheetUseCase({ kind: 'pokemon', slug: created.slug, folder: 'bench', clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 200,
    })
    expect(sheets.getByRef('pokemon', created.slug)).toMatchObject({ revision: 1, sheet: { folder: 'bench' } })
    expect(moved.realtimeEvents[0]).toMatchObject({ access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: created.slug }, event: { channel: 'sheets', type: 'moved', data: { kind: 'pokemon', slug: created.slug, folder: 'bench' } } })

    const noOp = moveSheetUseCase({ kind: 'pokemon', slug: created.slug, folder: 'bench' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 300,
    })
    expect(noOp.realtimeEvents).toEqual([])
  })

  it('renames sheets and retargets map placements in the same transaction as sheet and map events', () => {
    const { database, maps, sheets, realtime } = durableHarness(5_800)
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ revision: 2, updatedAt: 100 }))
    maps.saveSetupMap(mapDoc({
      slug: 'arena',
      revision: 5,
      placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 1 } }],
      updatedAt: 100,
    }))

    const result = renameSheetUseCase({ kind: 'pokemon', slug: 'pika', name: 'Pika Prime', clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(sheets.getByRef('pokemon', 'pika')).toBeNull()
    expect(sheets.getByRef('pokemon', 'pika-prime')).toMatchObject({ revision: 3 })
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 6, placements: [{ sheetSlug: 'pika-prime' }] })
    expect(eventChannels(result.realtimeEvents)).toEqual(['sheet:pokemon:pika', 'sheet:pokemon:pika-prime', 'sheets', 'map:arena', 'maps'])
    expect(result.realtimeEvents.slice(0, 3).every((event) => event.access.kind === 'sheet-access')).toBe(true)
    expect(result.realtimeEvents.slice(3).every((event) => event.access.kind === 'map-access')).toBe(true)
  })

  it('rolls back sheet rename and map retargeting on event append failure', () => {
    const { database, maps, sheets } = durableHarness()
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ revision: 2, updatedAt: 100 }))
    maps.saveSetupMap(mapDoc({ revision: 5, placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 1 } }] }))

    expect(() => renameSheetUseCase({ kind: 'pokemon', slug: 'pika', name: 'Pika Prime' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: failingRealtime(database),
      now: () => 200,
    })).toThrow('append failed')

    expect(sheets.getByRef('pokemon', 'pika')).toMatchObject({ revision: 2 })
    expect(sheets.getByRef('pokemon', 'pika-prime')).toBeNull()
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 5, placements: [{ sheetSlug: 'pika' }] })
  })

  it('deletes sheets with GM-only tombstones and map-access cleanup events, and rolls back on event failure', () => {
    const { database, maps, sheets, realtime } = durableHarness(5_900)
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ revision: 2, updatedAt: 100 }))
    maps.saveSetupMap(mapDoc({ revision: 5, placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 1 } }] }))

    const result = deleteSheetUseCase({ kind: 'pokemon', slug: 'pika', clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
    })

    expect(sheets.getByRef('pokemon', 'pika')).toBeNull()
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 6, placements: [] })
    expect(eventChannels(result.realtimeEvents)).toEqual(['sheet:pokemon:pika', 'sheets', 'map:arena', 'maps'])
    expect(result.realtimeEvents.slice(0, 2).every((event) => event.access.kind === 'gm-only')).toBe(true)
    expect(result.realtimeEvents.slice(2).every((event) => event.access.kind === 'map-access')).toBe(true)

    const rollback = durableHarness()
    rollback.sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ revision: 2, updatedAt: 100 }))
    expect(() => deleteSheetUseCase({ kind: 'pokemon', slug: 'pika' }, {
      database: rollback.database,
      sheetRepository: rollback.sheets,
      realtimeEventRepository: failingRealtime(rollback.database),
    })).toThrow('append failed')
    expect(rollback.sheets.getByRef('pokemon', 'pika')).not.toBeNull()
  })
})

describe('durable sheet folder events', () => {
  it('creates existing and new sheet folders with GM-only durable no-op behavior', () => {
    const { database, sheets, realtime } = durableHarness(6_000)

    const created = createSheetFolderUseCase({ folder: 'box', clientId: 'gm-client' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 100,
    })
    const again = createSheetFolderUseCase({ folder: 'box' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(created.created).toBe(true)
    expect(created.realtimeEvents[0]).toMatchObject({ access: { kind: 'gm-only' }, event: { channel: 'sheets', type: 'folder-created', data: { folder: 'box' } } })
    expect(again.created).toBe(false)
    expect(again.realtimeEvents).toEqual([])
  })

  it('moves sheet folders with a GM-only folder event and complete affected sheet updates', () => {
    const { database, sheets, realtime } = durableHarness(6_100)
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ folder: 'box', revision: 1, updatedAt: 100 }))
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet({ folder: 'box/deep', revision: 3, updatedAt: 100 }))

    const result = moveSheetFolderUseCase({ from: 'box', to: 'archive', clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(result).toMatchObject({ moved: true, count: 2 })
    expect(sheets.getByRef('pokemon', 'pika')).toMatchObject({ revision: 2, sheet: { folder: 'archive' } })
    expect(sheets.getByRef('trainer', 'brock')).toMatchObject({ revision: 4, sheet: { folder: 'archive/deep' } })
    expect(eventChannels(result.realtimeEvents)).toEqual(['sheets', 'sheet:pokemon:pika', 'sheets', 'sheet:trainer:brock', 'sheets'])
    expect(eventTypes(result.realtimeEvents)).toEqual(['folder-moved', 'updated', 'updated', 'updated', 'updated'])
    expect(result.realtimeEvents[0]?.access).toEqual({ kind: 'gm-only' })
    expect(result.realtimeEvents.slice(1).every((event) => event.access.kind === 'sheet-access')).toBe(true)
  })

  it('deletes sheet folders with GM-only folder/sheet tombstones and map cleanup events, rolling back on failures', () => {
    const { database, maps, sheets, realtime } = durableHarness(6_200)
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ folder: 'box', revision: 2, updatedAt: 100 }))
    maps.saveSetupMap(mapDoc({ revision: 5, placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 1 } }] }))

    const result = deleteSheetFolderUseCase({ folder: 'box', clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
    })

    expect(result.count).toBe(1)
    expect(sheets.getByRef('pokemon', 'pika')).toBeNull()
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 6, placements: [] })
    expect(eventChannels(result.realtimeEvents)).toEqual(['sheets', 'sheet:pokemon:pika', 'sheets', 'map:arena', 'maps'])
    expect(result.realtimeEvents[0]?.access).toEqual({ kind: 'gm-only' })
    expect(result.realtimeEvents.slice(1, 3).every((event) => event.access.kind === 'gm-only')).toBe(true)
    expect(result.realtimeEvents.slice(3).every((event) => event.access.kind === 'map-access')).toBe(true)

    const rollback = durableHarness()
    rollback.sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ folder: 'box', revision: 2, updatedAt: 100 }))
    expect(() => deleteSheetFolderUseCase({ folder: 'box' }, {
      database: rollback.database,
      sheetRepository: rollback.sheets,
      realtimeEventRepository: failingRealtime(rollback.database),
    })).toThrow('append failed')
    expect(rollback.sheets.getByRef('pokemon', 'pika')).not.toBeNull()
    expect(rollback.sheets.listFolders()).toContain('box')
  })
})

describe('durable interaction-mode events and publication', () => {
  it('commits mode updates and map-access events together without revising or copying the map', () => {
    const { database, maps, modes, realtime } = durableHarness(6_300)
    maps.saveSetupMap(mapDoc({ slug: 'arena', revision: 7, updatedAt: 100 }))
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 100 })

    const result = setMapInteractionModeUseCase({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      clientId: 'client-1',
    }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(result).toMatchObject({ interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, previousInteractionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 200, syncedMapForLivePlay: false })
    expect(modes.get('arena')).toMatchObject({ interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 200 })
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 7, updatedAt: 100 })
    expect(result.realtimeEvents[0]).toMatchObject({ access: { kind: 'map-access', mapSlug: 'arena' }, event: { channel: 'map:arena', type: 'map-interaction-mode-updated', data: { slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 200 } } })
  })

  it('allows one client to switch the same map repeatedly without realtime dedupe conflicts', () => {
    const { database, maps, modes, realtime } = durableHarness(6_350)
    maps.saveSetupMap(mapDoc({ slug: 'arena' }))
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 100 })

    const setup = setMapInteractionModeUseCase({
      slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, clientId: 'client-1',
    }, {
      database, mapRepository: maps, modeRepository: modes, realtimeEventRepository: realtime,
      now: () => 200,
    })
    const live = setMapInteractionModeUseCase({
      slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, clientId: 'client-1',
    }, {
      database, mapRepository: maps, modeRepository: modes, realtimeEventRepository: realtime,
      now: () => 201,
    })

    expect(setup.realtimeEvents[0]?.dedupeKey).not.toBe(live.realtimeEvents[0]?.dedupeKey)
    expect(realtime.cursorState().latestSequence).toBe(2)
    expect(modes.get('arena')).toMatchObject({
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 201,
    })
  })

  it('preserves the existing timestamped-state behavior for unchanged mode sets', () => {
    const { database, maps, modes, realtime } = durableHarness(6_400)
    maps.saveSetupMap(mapDoc({ slug: 'arena' }))
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 100 })

    const result = setMapInteractionModeUseCase({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      realtimeEventRepository: realtime,
      now: () => 200,
    })

    expect(result.previousInteractionMode).toBe(MAP_INTERACTION_MODES.LIVE_PLAY)
    expect(result.updatedAt).toBe(200)
    expect(result.realtimeEvents).toHaveLength(1)
  })

  it('rolls back mode changes on event append failure', () => {
    const { database, maps, modes } = durableHarness()
    maps.saveSetupMap(mapDoc({ slug: 'arena' }))

    expect(() => setMapInteractionModeUseCase({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      realtimeEventRepository: failingRealtime(database),
      now: () => 200,
    })).toThrow('append failed')

    expect(modes.get('arena')).toMatchObject({ interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 0 })
  })

  it('publishes exact persisted events after commit, reports one failure, and continues later events', () => {
    const { database, maps, realtime } = durableHarness(6_500)
    maps.saveSetupMap(mapDoc({ slug: 'arena', folder: 'old', revision: 1, updatedAt: 100 }))
    const published: number[] = []
    const reports: unknown[] = []

    const result = moveMapUseCase({ slug: 'arena', folder: 'new' }, {
      database,
      mapRepository: maps,
      realtimeEventRepository: realtime,
      now: () => 200,
      publishPersistedRealtimeEvent: (event) => {
        expect(maps.getBySlug('arena')).toMatchObject({ folder: 'new', revision: 2 })
        expect(realtime.getBySequence(event.sequence)).toEqual(event)
        if (event.sequence === 1) throw new Error('publish down')
        published.push(event.sequence)
      },
      reportAfterCommitPublicationFailure: (context) => reports.push(context),
    })

    expect(result.realtimeEvents.map((event) => event.sequence)).toEqual([1, 2])
    expect(published).toEqual([2])
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ sequence: 1, channel: 'map:arena', type: 'updated' })
    expect(maps.getBySlug('arena')).toMatchObject({ folder: 'new', revision: 2 })
  })

  it('rejects migrated repository mixes that do not share one RotomDatabase', () => {
    const left = durableHarness()
    const rightRealtime = createSqliteRealtimeEventRepository({ database: durableHarness().database })
    expect(() => moveMapUseCase({ slug: 'arena', folder: 'new' }, {
      database: left.database,
      mapRepository: left.maps,
      realtimeEventRepository: rightRealtime,
    })).toThrow(/same RotomDatabase/)
  })
})

describe('migrated route architecture', () => {
  it('does not call transitional draft-event publication from migrated map and sheet routes', () => {
    const routeFiles = [
      'server/api/maps/create.post.ts',
      'server/api/maps/move.post.ts',
      'server/api/maps/rename.post.ts',
      'server/api/maps/delete.post.ts',
      'server/api/maps/create-folder.post.ts',
      'server/api/maps/move-folder.post.ts',
      'server/api/maps/delete-folder.post.ts',
      'server/api/maps/interaction-mode.post.ts',
      'server/api/sheets/create.post.ts',
      'server/api/sheets/move.post.ts',
      'server/api/sheets/rename.post.ts',
      'server/api/sheets/delete.post.ts',
      'server/api/sheets/create-folder.post.ts',
      'server/api/sheets/move-folder.post.ts',
      'server/api/sheets/delete-folder.post.ts',
    ]

    for (const file of routeFiles) {
      const text = readFileSync(join(process.cwd(), file), 'utf8')
      expect(text).not.toContain('publishUseCaseRealtimeEvents')
      expect(text).not.toContain('publishRealtime(')
    }
  })
})
