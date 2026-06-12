import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
  type LivePlayTokenScope,
} from '#shared/livePlayCommands'
import { createLivePlayCommandHash } from '~~/server/livePlay/opResult'
import { closeRotomDatabase, openRotomDatabase, resolveConfiguredDatabasePath, type RotomDatabase } from '~~/server/storage/database'
import { getStorageSchemaVersion, LATEST_STORAGE_SCHEMA_VERSION } from '~~/server/storage/migrations'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'

const tempRoots: string[] = []
const openDatabases: RotomDatabase[] = []

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-storage-'))
  tempRoots.push(root)
  return root
}

const openTempDatabase = (): RotomDatabase => {
  const root = makeTempRoot()
  const database = openRotomDatabase({ path: join(root, 'campaign.sqlite') })
  openDatabases.push(database)
  return database
}

afterEach(() => {
  closeRotomDatabase()
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

const tableNames = (database: RotomDatabase): string[] => database.connection.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
  ORDER BY name ASC
`).all().map((row) => String(row.name))

describe('SQLite storage foundation', () => {
  it('resolves configured database paths under the campaign root by default', () => {
    const campaignRoot = resolve(makeTempRoot(), 'campaign')

    expect(resolveConfiguredDatabasePath({ campaignRoot })).toBe(join(campaignRoot, 'rotom-table.sqlite'))
    expect(resolveConfiguredDatabasePath({ rawPath: 'table.sqlite', campaignRoot })).toBe(join(campaignRoot, 'table.sqlite'))
    expect(resolveConfiguredDatabasePath({ rawPath: '/srv/rotom-table/campaign/rotom-table.sqlite', campaignRoot }))
      .toBe('/srv/rotom-table/campaign/rotom-table.sqlite')
  })

  it('opens, enables WAL for file databases, and applies deterministic migrations', () => {
    const database = openTempDatabase()

    expect(existsSync(database.path)).toBe(true)
    expect(database.journalMode?.toLowerCase()).toBe('wal')
    expect(getStorageSchemaVersion(database.connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(database)).toEqual(['live_play_ops', 'maps', 'sheets'])

    const reopened = openRotomDatabase({ path: database.path })
    openDatabases.push(reopened)
    expect(getStorageSchemaVersion(reopened.connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(reopened)).toEqual(['live_play_ops', 'maps', 'sheets'])
  })

  it('reads and writes map and sheet documents through repository interfaces', () => {
    const database = openTempDatabase()
    const maps = createSqliteMapRepository<{ name: string; revision: number }>(database)
    const sheets = createSqliteSheetRepository<{ nickname?: string; name?: string; revision: number }>(database)

    const map = maps.save({
      slug: 'training-yard',
      document: { name: 'Training Yard', revision: 2 },
      revision: 2,
      updatedAt: 1_700_000_000_000,
    })
    const pokemon = sheets.save({
      kind: 'pokemon',
      slug: 'pikachu',
      document: { nickname: 'Sparky', revision: 5 },
      revision: 5,
      updatedAt: 1_700_000_000_100,
    })
    sheets.save({
      kind: 'trainer',
      slug: 'brock',
      document: { name: 'Brock', revision: 1 },
      revision: 1,
      updatedAt: 1_700_000_000_200,
    })

    expect(map).toEqual({
      slug: 'training-yard',
      document: { name: 'Training Yard', revision: 2 },
      revision: 2,
      updatedAt: 1_700_000_000_000,
    })
    expect(maps.get('training-yard')).toEqual(map)
    expect(pokemon).toEqual({
      kind: 'pokemon',
      slug: 'pikachu',
      document: { nickname: 'Sparky', revision: 5 },
      revision: 5,
      updatedAt: 1_700_000_000_100,
    })
    expect(sheets.get('pokemon', 'pikachu')).toEqual(pokemon)
    expect(sheets.list('pokemon').map((sheet) => sheet.slug)).toEqual(['pikachu'])
    expect(sheets.list().map((sheet) => `${sheet.kind}:${sheet.slug}`)).toEqual(['pokemon:pikachu', 'trainer:brock'])

    maps.save({
      slug: 'training-yard',
      document: { name: 'Training Yard Revised', revision: 3 },
      revision: 3,
      updatedAt: 1_700_000_000_300,
    })
    expect(maps.get('training-yard')).toMatchObject({
      document: { name: 'Training Yard Revised', revision: 3 },
      revision: 3,
      updatedAt: 1_700_000_000_300,
    })
    expect(sheets.delete('trainer', 'brock')).toBe(true)
    expect(sheets.get('trainer', 'brock')).toBeNull()
  })

  it('rolls back repository writes when an outer transaction fails', () => {
    const database = openTempDatabase()
    const maps = createSqliteMapRepository(database)
    const sheets = createSqliteSheetRepository(database)

    expect(() => database.withTransaction(() => {
      maps.save({
        slug: 'rollback-map',
        document: { slug: 'rollback-map', revision: 1 },
        revision: 1,
        updatedAt: 10,
      })
      sheets.save({
        kind: 'pokemon',
        slug: 'rollback-mon',
        document: { slug: 'rollback-mon', revision: 1 },
        revision: 1,
        updatedAt: 11,
      })
      throw new Error('force rollback')
    })).toThrow('force rollback')

    expect(maps.get('rollback-map')).toBeNull()
    expect(sheets.get('pokemon', 'rollback-mon')).toBeNull()
  })

  it('stores live-play operation results idempotently with command JSON and result revisions', () => {
    const database = openTempDatabase()
    const ops = createSqliteLivePlayOpRepository({
      database,
      clock: () => 1_700_000_000_500,
    })
    const scope: LivePlayTokenScope = { kind: 'token', placementId: 'token-1', field: 'position' }
    const command: LivePlayCommandEnvelope = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_liveplaydb01',
      mapSlug: 'training-yard',
      baseRevision: 2,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [scope],
      payload: { placementId: 'token-1', position: { x: 2, y: 0, z: 1 } },
    }
    const patch: LivePlayPatch = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      mapSlug: command.mapSlug,
      revision: 3,
      scopes: command.scopes,
      payload: command.payload,
    }
    const result = createLivePlayAcceptedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 2,
      revision: 3,
      patches: [patch],
    })
    const commandHash = createLivePlayCommandHash(command)

    const stored = ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
    })
    const duplicate = ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
    })

    expect(duplicate).toEqual(stored)
    expect(ops.getOpResult(command.mapSlug, command.opId)).toEqual(result)
    expect(ops.getStoredOpRecord(command.mapSlug, command.opId)).toMatchObject({
      schemaVersion: 1,
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
      resultRevision: 3,
      createdAt: 1_700_000_000_500,
      recordedAt: new Date(1_700_000_000_500).toISOString(),
    })
    expect(() => ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash: 'changed-hash' as never,
      command,
      result,
    })).toThrow('already recorded for a different command envelope')
  })
})
