import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
  type LivePlayScope,
} from '#shared/livePlayCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { closeRotomDatabase, openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapRepository, type MapRepository } from '~~/server/storage/mapRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '~~/server/storage/sheetRepository'
import type { TabletopMap } from '~/types/map'

interface HpPayload {
  readonly placementId: string
  readonly currentHp: number
}

type HpCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  HpPayload,
  LivePlayScope
>

interface HpCommandContext {
  readonly map: TabletopMap
  readonly sheet: PersistedSheet
  readonly nextSheet?: Record<string, unknown>
}

const tempRoots: string[] = []
const openDatabases: RotomDatabase[] = []

const openTempDatabase = (): RotomDatabase => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-live-sheet-'))
  tempRoots.push(root)
  const database = openRotomDatabase({ path: join(root, 'campaign.sqlite') })
  openDatabases.push(database)
  return database
}

afterEach(() => {
  closeRotomDatabase()
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 7,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 1 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100,
  ...overrides,
})

const hpCommand = (overrides: Partial<HpCommand> = {}): HpCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_sheetcmd001',
  mapSlug: 'arena',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  scopes: [
    { kind: 'token', placementId: 'token-1', field: 'hp' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'combat.currentHp' },
  ],
  payload: { placementId: 'token-1', currentHp: 12 },
  ...overrides,
})

const createPatch = (command: HpCommand, revision: number): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: {
    placementId: command.payload.placementId,
    sheetKind: 'pokemon',
    sheetSlug: 'pikachu',
    currentHp: command.payload.currentHp,
  },
})

const setupRepositories = async (database: RotomDatabase) => {
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_700_000_001_000 })
  await maps.saveSetupMap(baseMap())
  await sheets.saveSetupSheet('pokemon', 'pikachu', {
    slug: 'pikachu',
    nickname: 'Pika',
    combat: { currentHp: 20 },
    revision: 2,
    updatedAt: 1_700_000_000_200,
  })
  return { maps, sheets, ops }
}

const createExecutor = (database: RotomDatabase, ops: ReturnType<typeof createSqliteLivePlayOpRepository>) =>
  createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
  })

const executeHpCommand = async (
  input: {
    readonly command: HpCommand
    readonly database: RotomDatabase
    readonly maps: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
    readonly sheets: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
    readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
    readonly failAfterWrites?: boolean
    readonly failAfterOpResult?: boolean
    readonly publish?: (result: unknown) => void
  },
) => {
  const executor = createExecutor(input.database, input.ops)
  return executor.execute<HpCommand, HpCommandContext, undefined, undefined>({
    command: input.command,
    readMap: async ({ command }) => {
      const map = await input.maps.getBySlug(command.mapSlug)
      if (!map) throw new Error(`Map ${command.mapSlug} not found`)
      const placement = map.placements.find((candidate) => candidate.id === command.payload.placementId)
      if (!placement) throw new Error(`Placement ${command.payload.placementId} not found`)
      const sheet = await input.sheets.getByRef(placement.sheetKind, placement.sheetSlug)
      if (!sheet) throw new Error(`Sheet ${placement.sheetKind}/${placement.sheetSlug} not found`)
      return { map, sheet }
    },
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    apply: ({ command, map, currentRevision }) => {
      const revision = nextRevision(currentRevision)
      return {
        status: 'accepted',
        previousRevision: currentRevision,
        revision,
        nextMap: {
          ...map,
          map: {
            ...map.map,
            revision,
            metadata: {
              ...map.map.metadata,
              lastHpCommand: command.opId,
            },
          },
          nextSheet: {
            ...map.sheet.sheet,
            combat: {
              ...(map.sheet.sheet.combat && typeof map.sheet.sheet.combat === 'object' && !Array.isArray(map.sheet.sheet.combat)
                ? map.sheet.sheet.combat
                : {}),
              currentHp: command.payload.currentHp,
            },
            updatedAt: 1_700_000_000_900,
          },
        },
        patches: [createPatch(command, revision)],
      }
    },
    persist: () => {
      throw new Error('commit hook should handle persistence')
    },
    commit: ({ currentRevision, nextMap, result, saveOpResult }) => {
      input.database.withTransaction(() => {
        const mapResult = input.maps.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: nextMap.map,
        })
        if (mapResult === 'stale') throw new Error('map stale')
        if (!nextMap.nextSheet) throw new Error('next sheet missing')
        const sheetResult = input.sheets.applyLivePlayUpdate({
          kind: nextMap.sheet.kind,
          slug: nextMap.sheet.slug,
          expectedRevision: nextMap.sheet.revision,
          nextSheet: nextMap.nextSheet,
        })
        if (sheetResult === 'stale') throw new Error('sheet stale')
        if (input.failAfterWrites) throw new Error('forced commit failure')
        saveOpResult()
        if (input.failAfterOpResult) throw new Error('forced commit failure')
      })
    },
    publish: ({ result }) => {
      input.publish?.(result)
    },
  })
}

describe('live-play sheet persistence transactions', () => {
  it('updates HP sheet state, map state, and command result atomically', async () => {
    const database = openTempDatabase()
    const { maps, sheets, ops } = await setupRepositories(database)
    const command = hpCommand()

    const result = await executeHpCommand({ command, database, maps, sheets, ops })

    expect(result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
    expect(maps.getBySlug('arena')).toMatchObject({
      revision: 8,
      metadata: { lastHpCommand: command.opId },
    })
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 3,
      sheet: { combat: { currentHp: 12 }, revision: 3 },
    })
    expect(ops.getStoredOpRecord('arena', command.opId)).toMatchObject({
      mapSlug: 'arena',
      opId: command.opId,
      result,
      resultRevision: 8,
    })
  })

  it('rolls back map, sheet, and command-result writes when persistence fails', async () => {
    const database = openTempDatabase()
    const { maps, sheets, ops } = await setupRepositories(database)
    const command = hpCommand({ opId: 'op_sheetcmd002' })

    const published: unknown[] = []
    const result = await executeHpCommand({
      command,
      database,
      maps,
      sheets,
      ops,
      failAfterOpResult: true,
      publish: (event) => published.push(event),
    })

    expect(result).toMatchObject({ ok: false, reason: 'persistence-failed', currentRevision: 7 })
    expect(maps.getBySlug('arena')).toMatchObject({
      revision: 7,
      metadata: {},
    })
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 2,
      sheet: { combat: { currentHp: 20 }, revision: 2 },
    })
    expect(published).toEqual([])
    expect(ops.getStoredOpRecord('arena', command.opId)).toBeNull()
  })

  it('does not share rollback fate between concurrent commands for different maps', async () => {
    const database = openTempDatabase()
    const { maps, sheets, ops } = await setupRepositories(database)
    maps.saveSetupMap(baseMap({
      slug: 'dojo',
      name: 'Dojo',
      placements: [
        { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 2, y: 0, z: 2 } },
      ],
    }))
    sheets.saveSetupSheet('pokemon', 'eevee', {
      slug: 'eevee',
      nickname: 'Eon',
      combat: { currentHp: 18 },
      revision: 2,
      updatedAt: 1_700_000_000_300,
    })

    const successCommand = hpCommand({ opId: 'op_sheetcmd_success' })
    const failingCommand = hpCommand({
      opId: 'op_sheetcmd_fail',
      mapSlug: 'dojo',
      scopes: [
        { kind: 'token', placementId: 'token-1', field: 'hp' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'eevee', field: 'combat.currentHp' },
      ],
    })

    const [success, failure] = await Promise.all([
      executeHpCommand({ command: successCommand, database, maps, sheets, ops }),
      executeHpCommand({ command: failingCommand, database, maps, sheets, ops, failAfterWrites: true }),
    ])

    expect(success).toMatchObject({ ok: true, mapSlug: 'arena', previousRevision: 7, revision: 8 })
    expect(failure).toMatchObject({ ok: false, mapSlug: 'dojo', reason: 'persistence-failed', currentRevision: 7 })
    expect(maps.getBySlug('arena')).toMatchObject({
      revision: 8,
      metadata: { lastHpCommand: successCommand.opId },
    })
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 3,
      sheet: { combat: { currentHp: 12 }, revision: 3 },
    })
    expect(ops.getStoredOpRecord('arena', successCommand.opId)).toMatchObject({ result: success })
    expect(maps.getBySlug('dojo')).toMatchObject({ revision: 7, metadata: {} })
    expect(sheets.getByRef('pokemon', 'eevee')).toMatchObject({
      revision: 2,
      sheet: { combat: { currentHp: 18 }, revision: 2 },
    })
    expect(ops.getStoredOpRecord('dojo', failingCommand.opId)).toBeNull()
  })

  it('returns duplicate op results without reapplying sheet updates', async () => {
    const database = openTempDatabase()
    const { maps, sheets, ops } = await setupRepositories(database)
    const command = hpCommand({ opId: 'op_sheetcmd003' })

    const first = await executeHpCommand({ command, database, maps, sheets, ops })
    const second = await executeHpCommand({ command, database, maps, sheets, ops })

    expect(second).toEqual(first)
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 3,
      sheet: { combat: { currentHp: 12 }, revision: 3 },
    })
    expect(ops.getStoredOpRecord('arena', command.opId)).toMatchObject({ result: first })
  })

  it('rejects stale commands without mutating sheet state', async () => {
    const database = openTempDatabase()
    const { maps, sheets, ops } = await setupRepositories(database)
    const command = hpCommand({ opId: 'op_sheetcmd004', baseRevision: 6 })

    const result = await executeHpCommand({ command, database, maps, sheets, ops })

    expect(result).toMatchObject({ ok: false, reason: 'stale-revision', currentRevision: 7 })
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 2,
      sheet: { combat: { currentHp: 20 }, revision: 2 },
    })
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 7 })
  })
})
