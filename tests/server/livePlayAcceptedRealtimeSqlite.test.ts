import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES, type RealtimeEvent } from '#shared/realtime'
import { acceptedCommandRealtimeDedupeKey } from '~~/server/livePlay/acceptedCommandRealtime'
import { livePlaySheetUpdateRealtimeAppendInputs } from '~~/server/livePlay/sheetUpdateRealtime'
import {
  createSqliteAuthoritativeLivePlayCommandExecutor,
  type CreateSqliteAuthoritativeLivePlayCommandExecutorOptions,
} from '~~/server/livePlay/sqliteCommandExecutor'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository, type LivePlayOpRepository } from '~~/server/storage/opRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventDraft,
  type RealtimeEventRepository,
} from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import type { SheetKind, TabletopMap } from '~/types/map'

interface SqliteHarness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly realtime: RealtimeEventRepository
  readonly published: RealtimeEvent[]
  readonly executor: ReturnType<typeof createSqliteAuthoritativeLivePlayCommandExecutor>
}

const openDatabases: RotomDatabase[] = []
const tempRoots: string[] = []

const closeLater = (database: RotomDatabase): RotomDatabase => {
  openDatabases.push(database)
  return database
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  revision: 0,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 1,
  updatedAt: 10,
  ...overrides,
})

const command = (opId = 'op_sqlrt001', baseRevision = 0): LivePlayCommandEnvelope => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision,
  type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
  scopes: [{ kind: 'map', lane: 'scene' }],
  payload: { scene: 'next' },
})

const sheetCommand = (opId = 'op_sqlsheet1', baseRevision = 0): LivePlayCommandEnvelope => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision,
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' }],
  payload: { placementId: 'token-1', currentHp: 12 },
})

const mapPatch = (
  currentCommand: LivePlayCommandEnvelope,
  revision: number,
  overrides: Partial<LivePlayPatch> = {},
): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  mapSlug: currentCommand.mapSlug,
  revision,
  scopes: currentCommand.scopes,
  payload: { previous: null, current: { name: 'Next' } },
  ...overrides,
})

const sheetPatch = (currentCommand: LivePlayCommandEnvelope, revision: number): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  mapSlug: currentCommand.mapSlug,
  revision,
  scopes: currentCommand.scopes,
  payload: { sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp', previous: 10, current: 12 },
})

const createHarness = (options: {
  readonly database?: RotomDatabase
  readonly realtime?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly opStore?: LivePlayOpRepository
  readonly publishAcceptedRealtimeEvent?: CreateSqliteAuthoritativeLivePlayCommandExecutorOptions['publishAcceptedRealtimeEvent']
  readonly reportAfterCommitPublicationFailure?: CreateSqliteAuthoritativeLivePlayCommandExecutorOptions['reportAfterCommitPublicationFailure']
  readonly clock?: () => number
} = {}): SqliteHarness => {
  const database = options.database ?? closeLater(openRotomDatabase({ path: ':memory:', enableWal: false }))
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: options.clock ?? (() => 1_000) })
  const published: RealtimeEvent[] = []
  maps.saveSetupMap(baseMap())
  sheets.saveSetupSheet('pokemon', 'pikachu', { slug: 'pikachu', species: 'Pikachu', hp: 10, revision: 0 })
  const executor = createSqliteAuthoritativeLivePlayCommandExecutor({
    database,
    ...(options.opStore === undefined ? {} : { opStore: options.opStore }),
    realtimeEventRepository: options.realtime ?? realtime,
    publishAcceptedRealtimeEvent: options.publishAcceptedRealtimeEvent ?? ((event) => {
      published.push(event.event)
    }),
    reportAfterCommitPublicationFailure: options.reportAfterCommitPublicationFailure,
  })
  return { database, maps, sheets, realtime, published, executor }
}

const executeMapOnly = (
  harness: SqliteHarness,
  currentCommand: LivePlayCommandEnvelope = command(),
  options: {
    readonly failMap?: boolean
    readonly throwAfterSave?: boolean
  } = {},
) => harness.executor.execute<typeof currentCommand, TabletopMap, { readonly clientId: string }, { readonly clientId: string }>({
  command: currentCommand,
  actor: { clientId: 'client-sql' },
  readMap: ({ command: inputCommand }) => {
    const map = harness.maps.getBySlug(inputCommand.mapSlug)
    if (!map) throw new Error('map missing')
    return map
  },
  apply: ({ command: inputCommand, map, currentRevision }) => ({
    status: 'accepted',
    nextMap: {
      ...map,
      revision: currentRevision + 1,
      metadata: { ...map.metadata, accepted: inputCommand.opId },
      updatedAt: 2_000,
    },
    patches: [mapPatch(inputCommand, currentRevision + 1)],
  }),
  persist: () => {
    throw new Error('commit hook required')
  },
  commit: ({ currentRevision, nextMap, saveOpResult }) => harness.database.withTransaction(() => {
    const mapResult = harness.maps.applyLivePlayUpdate({
      slug: currentCommand.mapSlug,
      expectedRevision: options.failMap ? currentRevision + 1 : currentRevision,
      nextMap,
    })
    if (mapResult === 'stale') throw new Error('map stale')
    saveOpResult()
    if (options.throwAfterSave) throw new Error('after save failure')
  }),
})

const executeSheetChanging = (
  harness: SqliteHarness,
  currentCommand: LivePlayCommandEnvelope = sheetCommand(),
  options: { readonly failSheet?: boolean } = {},
) => harness.executor.execute<typeof currentCommand, TabletopMap, { readonly clientId: string }, { readonly clientId: string }>({
  command: currentCommand,
  actor: { clientId: 'client-sql' },
  readMap: ({ command: inputCommand }) => {
    const map = harness.maps.getBySlug(inputCommand.mapSlug)
    if (!map) throw new Error('map missing')
    return map
  },
  apply: ({ command: inputCommand, map, currentRevision }) => ({
    status: 'accepted',
    nextMap: {
      ...map,
      revision: currentRevision + 1,
      metadata: { ...map.metadata, sheetChanged: true },
      updatedAt: 2_000,
    },
    patches: [sheetPatch(inputCommand, currentRevision + 1)],
  }),
  persist: () => {
    throw new Error('commit hook required')
  },
  commit: ({ actor, command, currentRevision, nextMap, recordRealtimeEvents, saveOpResult }) => harness.database.withTransaction(() => {
    const mapResult = harness.maps.applyLivePlayUpdate({
      slug: currentCommand.mapSlug,
      expectedRevision: currentRevision,
      nextMap,
    })
    if (mapResult === 'stale') throw new Error('map stale')
    const sheet = harness.sheets.getByRef('pokemon', 'pikachu')
    if (!sheet) throw new Error('sheet missing')
    const sheetResult = harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: 'pikachu',
      expectedRevision: options.failSheet ? sheet.revision + 1 : sheet.revision,
      nextSheet: { ...sheet.sheet, hp: 12, updatedAt: 2_000 },
    })
    if (sheetResult === 'stale') throw new Error('sheet stale')
    const authoritativeSheet = harness.sheets.getByRef('pokemon', 'pikachu')
    if (!authoritativeSheet) throw new Error('sheet missing after update')
    recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
      command,
      updates: [{ kind: authoritativeSheet.kind, slug: authoritativeSheet.slug, sheet: authoritativeSheet.sheet }],
      clientId: actor.clientId,
    }))
    saveOpResult()
  }),
})

const opRecord = (harness: SqliteHarness, opId: string) =>
  createSqliteLivePlayOpRepository({ database: harness.database }).getStoredOpRecord('arena', opId)

const eventRecord = (harness: SqliteHarness, opId: string) =>
  harness.realtime.getByDedupeKey(acceptedCommandRealtimeDedupeKey({ mapSlug: 'arena', opId }))

describe('SQLite accepted command realtime journaling', () => {
  it('commits map-only state, operation result, and accepted event together with global sequence identity', async () => {
    let now = 100
    const harness = createHarness({ clock: () => ++now })
    harness.realtime.append({
      event: { channel: 'maps', type: 'updated', data: { slug: 'other' } },
      access: { kind: 'gm-only' },
    })

    const result = await executeMapOnly(harness, command('op_sqlrt001'))

    expect(result).toMatchObject({ ok: true, mapSlug: 'arena', previousRevision: 0, revision: 1 })
    expect(harness.maps.getBySlug('arena')).toMatchObject({ revision: 1, metadata: { accepted: 'op_sqlrt001' } })
    expect(opRecord(harness, 'op_sqlrt001')?.result).toEqual(result)
    const event = eventRecord(harness, 'op_sqlrt001')
    expect(event).not.toBeNull()
    expect(event).toMatchObject({
      sequence: 2,
      dedupeKey: 'live-play-command:arena:op_sqlrt001:accepted',
      access: { kind: 'map-access', mapSlug: 'arena' },
      event: {
        sequence: 2,
        timestamp: 102,
        channel: 'map:arena',
        type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
        mapSlug: 'arena',
        opId: 'op_sqlrt001',
        previousRevision: 0,
        revision: 1,
        clientId: 'client-sql',
      },
    })
    expect(event?.event.patches).toEqual((result as { readonly patches: readonly LivePlayPatch[] }).patches)
    expect(harness.published).toEqual([event?.event])
  })

  it('commits sheet-changing map, sheet, sheet events, op result, and accepted event in sequence order', async () => {
    const harness = createHarness()

    const result = await executeSheetChanging(harness, sheetCommand('op_sqlsheet1'))

    expect(result).toMatchObject({ ok: true, revision: 1 })
    expect(harness.maps.getBySlug('arena')).toMatchObject({ revision: 1, metadata: { sheetChanged: true } })
    expect(harness.sheets.getByRef('pokemon', 'pikachu')).toMatchObject({ revision: 1, sheet: { hp: 12 } })
    expect(opRecord(harness, 'op_sqlsheet1')?.result).toEqual(result)
    const events = harness.realtime.readAfter({ afterSequence: 0 }).events
    expect(events).toHaveLength(3)
    expect(events.map((stored) => stored.event.channel)).toEqual(['sheet:pokemon:pikachu', 'sheets', 'map:arena'])
    expect(events.slice(0, 2).map((stored) => stored.access)).toEqual([
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    ])
    const event = eventRecord(harness, 'op_sqlsheet1')
    expect(event?.event).toMatchObject({ type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED, sequence: 3 })
    expect(harness.published).toEqual(events.map((stored) => stored.event))
  })

  it('rolls back durable events with map, sheet, op-result, append, dedupe, and later commit failures', async () => {
    const mapFailure = createHarness()
    await expect(executeMapOnly(mapFailure, command('op_mapfail01'), { failMap: true }))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(mapFailure.maps.getBySlug('arena')?.revision).toBe(0)
    expect(opRecord(mapFailure, 'op_mapfail01')).toBeNull()
    expect(eventRecord(mapFailure, 'op_mapfail01')).toBeNull()

    const sheetFailure = createHarness()
    await expect(executeSheetChanging(sheetFailure, sheetCommand('op_sheetfail1'), { failSheet: true }))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(sheetFailure.maps.getBySlug('arena')?.revision).toBe(0)
    expect(sheetFailure.sheets.getByRef('pokemon', 'pikachu')?.revision).toBe(0)
    expect(opRecord(sheetFailure, 'op_sheetfail1')).toBeNull()
    expect(eventRecord(sheetFailure, 'op_sheetfail1')).toBeNull()

    const sheetEventAppendFailure = createHarness({
      realtime: { appendMany: vi.fn(() => { throw new Error('sheet event append failed') }) },
    })
    await expect(executeSheetChanging(sheetEventAppendFailure, sheetCommand('op_sheetevtfail')))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(sheetEventAppendFailure.maps.getBySlug('arena')?.revision).toBe(0)
    expect(sheetEventAppendFailure.sheets.getByRef('pokemon', 'pikachu')?.revision).toBe(0)
    expect(opRecord(sheetEventAppendFailure, 'op_sheetevtfail')).toBeNull()
    expect(sheetEventAppendFailure.realtime.cursorState().latestSequence).toBe(0)

    const database = closeLater(openRotomDatabase({ path: ':memory:', enableWal: false }))
    const throwingOpStore: LivePlayOpRepository = {
      ...createSqliteLivePlayOpRepository({ database }),
      saveCommandResult: () => {
        throw new Error('op insert failed')
      },
      saveOpResult: () => {
        throw new Error('op insert failed')
      },
    }
    const opFailure = createHarness({ database, opStore: throwingOpStore })
    await expect(executeMapOnly(opFailure, command('op_opfail001')))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(opFailure.maps.getBySlug('arena')?.revision).toBe(0)
    expect(eventRecord(opFailure, 'op_opfail001')).toBeNull()

    const appendFailure = createHarness({
      realtime: { appendMany: vi.fn(() => { throw new Error('event append failed') }) },
    })
    await expect(executeMapOnly(appendFailure, command('op_appendf01')))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(appendFailure.maps.getBySlug('arena')?.revision).toBe(0)
    expect(opRecord(appendFailure, 'op_appendf01')).toBeNull()
    expect(eventRecord(appendFailure, 'op_appendf01')).toBeNull()

    const dedupeConflict = createHarness()
    const conflictingCommand = command('op_dedupef01')
    dedupeConflict.realtime.append({
      event: {
        channel: 'map:arena',
        type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
        mapSlug: 'arena',
        previousRevision: 0,
        revision: 99,
        opId: conflictingCommand.opId,
        patches: [mapPatch(conflictingCommand, 99)],
      } as RealtimeEventDraft,
      access: { kind: 'map-access', mapSlug: 'arena' },
      dedupeKey: acceptedCommandRealtimeDedupeKey({ mapSlug: 'arena', opId: conflictingCommand.opId }),
    })
    await expect(executeMapOnly(dedupeConflict, conflictingCommand))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(dedupeConflict.maps.getBySlug('arena')?.revision).toBe(0)
    expect(opRecord(dedupeConflict, conflictingCommand.opId)).toBeNull()
    expect(dedupeConflict.realtime.cursorState().latestSequence).toBe(1)

    const laterFailure = createHarness()
    await expect(executeMapOnly(laterFailure, command('op_laterfail1'), { throwAfterSave: true }))
      .resolves.toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(laterFailure.maps.getBySlug('arena')?.revision).toBe(0)
    expect(opRecord(laterFailure, 'op_laterfail1')).toBeNull()
    expect(eventRecord(laterFailure, 'op_laterfail1')).toBeNull()
    expect(laterFailure.realtime.cursorState().latestSequence).toBe(0)
  })

  it('keeps committed state and queryable durable events when process-local publication fails', async () => {
    const reports: unknown[] = []
    const harness = createHarness({
      publishAcceptedRealtimeEvent: () => {
        throw new Error('subscriber unavailable')
      },
      reportAfterCommitPublicationFailure: (context) => reports.push(context),
    })

    const result = await executeMapOnly(harness, command('op_pubfail01'))

    expect(result).toMatchObject({ ok: true, revision: 1 })
    expect(harness.maps.getBySlug('arena')?.revision).toBe(1)
    expect(opRecord(harness, 'op_pubfail01')?.result).toEqual(result)
    expect(eventRecord(harness, 'op_pubfail01')).not.toBeNull()
    expect(reports).toEqual([expect.objectContaining({ phase: 'accepted-realtime' })])
  })

  it('does not append or republish for duplicate accepted command requests', async () => {
    const harness = createHarness()
    const currentCommand = command('op_duplicate1')

    const first = await executeMapOnly(harness, currentCommand)
    const second = await executeMapOnly(harness, currentCommand)

    expect(second).toEqual(first)
    expect(harness.realtime.cursorState().latestSequence).toBe(1)
    expect(harness.published).toHaveLength(1)
  })

  it('persists accepted events across repository restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-accepted-rt-'))
    tempRoots.push(root)
    const databasePath = join(root, 'campaign.sqlite')
    const database = closeLater(openRotomDatabase({ path: databasePath, enableWal: false }))
    const harness = createHarness({ database })

    await expect(executeMapOnly(harness, command('op_restart1'))).resolves.toMatchObject({ ok: true })
    database.close()
    openDatabases.pop()

    const reopened = closeLater(openRotomDatabase({ path: databasePath, enableWal: false }))
    const realtime = createSqliteRealtimeEventRepository({ database: reopened })
    expect(realtime.getByDedupeKey(acceptedCommandRealtimeDedupeKey({ mapSlug: 'arena', opId: 'op_restart1' })))
      .toMatchObject({ event: { type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED, opId: 'op_restart1' } })
  })
})
