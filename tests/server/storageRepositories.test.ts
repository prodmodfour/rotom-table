import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
  type LivePlayTokenScope,
} from '#shared/livePlayCommands'
import { createLivePlayCommandHash } from '~~/server/livePlay/opResult'
import { createAcceptedMoveCompensationResult } from '~~/server/domain/moveAutomation/planAcceptedMoveCompensation'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
} from '~~/server/domain/moveAutomation/plan'
import { closeRotomDatabase, openRotomDatabase, resolveConfiguredDatabasePath, type RotomDatabase } from '~~/server/storage/database'
import { getStorageSchemaVersion, LATEST_STORAGE_SCHEMA_VERSION } from '~~/server/storage/migrations'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository, SheetRevisionConflictError } from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { importMapsFromJson } from '~~/server/storage/importMapsFromJson'
import { importSheetsFromJson } from '~~/server/storage/importSheetsFromJson'
import type { TabletopMap } from '~/types/map'

const tempRoots: string[] = []
const openDatabases: RotomDatabase[] = []

const withRotomDbPath = <T>(value: string | undefined, work: () => T): T => {
  const previous = process.env.ROTOM_DB_PATH
  if (value === undefined) delete process.env.ROTOM_DB_PATH
  else process.env.ROTOM_DB_PATH = value
  try {
    return work()
  } finally {
    if (previous === undefined) delete process.env.ROTOM_DB_PATH
    else process.env.ROTOM_DB_PATH = previous
  }
}

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
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name ASC
`).all().map((row) => String(row.name))

const mapDocument = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'training-yard',
  name: 'Training Yard',
  folder: '',
  revision: 4,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: { owner: 'gm' },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100,
  ...overrides,
})

describe('SQLite storage foundation', () => {
  it('resolves configured database paths under the campaign root by default', () => {
    withRotomDbPath(undefined, () => {
      const campaignRoot = resolve(makeTempRoot(), 'campaign')

      expect(resolveConfiguredDatabasePath({ campaignRoot })).toBe(join(campaignRoot, 'rotom-table.sqlite'))
      expect(resolveConfiguredDatabasePath({ rawPath: 'table.sqlite', campaignRoot })).toBe(join(campaignRoot, 'table.sqlite'))
      expect(resolveConfiguredDatabasePath({ rawPath: '/srv/rotom-table/campaign/rotom-table.sqlite', campaignRoot }))
        .toBe('/srv/rotom-table/campaign/rotom-table.sqlite')
    })
  })

  it('opens, enables WAL for file databases, and applies deterministic migrations', () => {
    const database = openTempDatabase()

    expect(existsSync(database.path)).toBe(true)
    expect(database.journalMode?.toLowerCase()).toBe('wal')
    expect(getStorageSchemaVersion(database.connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(database)).toEqual([
      'ability_declaration_offers',
      'ability_resolution_ops',
      'breeding_archive_import_requests',
      'breeding_archive_restore_receipts',
      'breeding_archives',
      'breeding_authorization_receipts',
      'breeding_checks',
      'breeding_consents',
      'breeding_gm_adjudications',
      'breeding_gm_overrides',
      'breeding_incubation_segments',
      'breeding_inheritance_learning_records',
      'breeding_operation_scopes',
      'breeding_operations',
      'breeding_option_offers',
      'breeding_projects',
      'breeding_read_sets',
      'breeding_rolls',
      'campaign_clock',
      'capability_adjudications',
      'capability_resolution_ops',
      'encounter_director_ops',
      'encounter_documents',
      'encounter_launch_ops',
      'encounter_ux_metric_aggregates',
      'group_inventories',
      'live_play_ops',
      'map_folders',
      'map_interaction_modes',
      'maps',
      'pending_move_resolutions',
      'pokemon_breeding_origins',
      'pokemon_egg_transfer_consents',
      'pokemon_eggs',
      'realtime_event_log_state',
      'realtime_events',
      'sheet_folders',
      'sheets',
      'shop_checkout_ops',
      'shop_tables',
      'trainer_species_acquisitions',
    ])

    const reopened = openRotomDatabase({ path: database.path })
    openDatabases.push(reopened)
    expect(getStorageSchemaVersion(reopened.connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(reopened)).toEqual([
      'ability_declaration_offers',
      'ability_resolution_ops',
      'breeding_archive_import_requests',
      'breeding_archive_restore_receipts',
      'breeding_archives',
      'breeding_authorization_receipts',
      'breeding_checks',
      'breeding_consents',
      'breeding_gm_adjudications',
      'breeding_gm_overrides',
      'breeding_incubation_segments',
      'breeding_inheritance_learning_records',
      'breeding_operation_scopes',
      'breeding_operations',
      'breeding_option_offers',
      'breeding_projects',
      'breeding_read_sets',
      'breeding_rolls',
      'campaign_clock',
      'capability_adjudications',
      'capability_resolution_ops',
      'encounter_director_ops',
      'encounter_documents',
      'encounter_launch_ops',
      'encounter_ux_metric_aggregates',
      'group_inventories',
      'live_play_ops',
      'map_folders',
      'map_interaction_modes',
      'maps',
      'pending_move_resolutions',
      'pokemon_breeding_origins',
      'pokemon_egg_transfer_consents',
      'pokemon_eggs',
      'realtime_event_log_state',
      'realtime_events',
      'sheet_folders',
      'sheets',
      'shop_checkout_ops',
      'shop_tables',
      'trainer_species_acquisitions',
    ])
  })

  it('reads and writes map, sheet, and shared interaction-mode state through repository interfaces', () => {
    const database = openTempDatabase()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const sheets = createSqliteSheetRepository<{ nickname?: string; name?: string; revision: number }>(database)
    const modes = createSqliteMapInteractionModeRepository(database)

    const map = maps.save({
      slug: 'training-yard',
      document: {
        schemaVersion: 2,
        slug: 'training-yard',
        name: 'Training Yard',
        revision: 2,
        dimensions: { x: 10, y: 1, z: 10 },
        voxels: [],
        placements: [],
      },
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
      document: expect.objectContaining({ name: 'Training Yard', slug: 'training-yard', revision: 2, updatedAt: 1_700_000_000_000 }),
      revision: 2,
      updatedAt: 1_700_000_000_000,
    })
    expect(maps.get('training-yard')).toEqual(map)
    expect(pokemon).toEqual({
      kind: 'pokemon',
      slug: 'pikachu',
      document: { nickname: 'Sparky', slug: 'pikachu', revision: 5, updatedAt: 1_700_000_000_100 },
      revision: 5,
      updatedAt: 1_700_000_000_100,
    })
    expect(sheets.get('pokemon', 'pikachu')).toEqual(pokemon)
    expect(sheets.list('pokemon').map((sheet) => sheet.slug)).toEqual(['pikachu'])
    expect(sheets.list().map((sheet) => `${sheet.kind}:${sheet.slug}`)).toEqual(['pokemon:pikachu', 'trainer:brock'])
    expect(modes.get('training-yard')).toEqual({
      slug: 'training-yard',
      interactionMode: 'live-play',
      updatedAt: 0,
    })
    expect(modes.set({ slug: 'training-yard', interactionMode: 'setup-edit', updatedAt: 1_700_000_000_250 })).toEqual({
      slug: 'training-yard',
      interactionMode: 'setup-edit',
      updatedAt: 1_700_000_000_250,
    })
    expect(modes.get('training-yard')).toEqual({
      slug: 'training-yard',
      interactionMode: 'setup-edit',
      updatedAt: 1_700_000_000_250,
    })

    maps.save({
      slug: 'training-yard',
      document: {
        schemaVersion: 2,
        slug: 'training-yard',
        name: 'Training Yard Revised',
        revision: 3,
        dimensions: { x: 10, y: 1, z: 10 },
        voxels: [],
        placements: [],
      },
      revision: 3,
      updatedAt: 1_700_000_000_300,
    })
    expect(maps.get('training-yard')).toMatchObject({
      document: expect.objectContaining({ name: 'Training Yard Revised', revision: 3 }),
      revision: 3,
      updatedAt: 1_700_000_000_300,
    })
    expect(sheets.delete('trainer', 'brock')).toBe(true)
    expect(sheets.get('trainer', 'brock')).toBeNull()
  })

  it('commits synchronous withTransaction callbacks normally', () => {
    const database = openTempDatabase()
    const maps = createSqliteMapRepository(database)

    const result = database.withTransaction(() => {
      maps.save({
        slug: 'commit-map',
        document: { slug: 'commit-map', revision: 1 },
        revision: 1,
        updatedAt: 10,
      })
      return 'committed'
    })

    expect(result).toBe('committed')
    expect(maps.get('commit-map')).toMatchObject({ slug: 'commit-map', revision: 1 })
  })

  it('rejects promise-returning withTransaction callbacks and rolls back their writes', () => {
    const database = openTempDatabase()
    const maps = createSqliteMapRepository(database)

    // @ts-expect-error Promise-returning callbacks are intentionally rejected by the transaction API.
    expect(() => database.withTransaction(() => {
      maps.save({
        slug: 'async-map',
        document: { slug: 'async-map', revision: 1 },
        revision: 1,
        updatedAt: 10,
      })
      return Promise.resolve('not allowed')
    })).toThrow('withTransaction callbacks must be synchronous')

    expect(maps.get('async-map')).toBeNull()

    expect(() => database.withTransaction(() => {
      try {
        // @ts-expect-error Promise-returning nested callbacks are intentionally rejected too.
        database.withTransaction(() => {
          maps.save({
            slug: 'nested-async-map',
            document: { slug: 'nested-async-map', revision: 1 },
            revision: 1,
            updatedAt: 11,
          })
          return Promise.resolve('not allowed')
        })
      } catch {
        maps.save({
          slug: 'after-nested-async-map',
          document: { slug: 'after-nested-async-map', revision: 1 },
          revision: 1,
          updatedAt: 12,
        })
      }
    })).toThrow('withTransaction callbacks must be synchronous')
    expect(maps.get('nested-async-map')).toBeNull()
    expect(maps.get('after-nested-async-map')).toBeNull()
    expect(database.withTransaction(() => 'depth-restored')).toBe('depth-restored')
  })

  it('imports JSON map documents into SQLite idempotently with folders and revisions', async () => {
    const database = openTempDatabase()
    const mapsRoot = join(makeTempRoot(), 'data', 'maps')
    mkdirSync(join(mapsRoot, 'region-one'), { recursive: true })
    writeFileSync(join(mapsRoot, 'legacy-map.json'), JSON.stringify({
      ...mapDocument({ slug: 'legacy-map', name: 'Legacy Map', revision: undefined, metadata: { note: 'old' } }),
      folder: 'ignored-document-folder',
    }), 'utf8')
    writeFileSync(join(mapsRoot, 'region-one', 'nested-map.json'), JSON.stringify(mapDocument({
      slug: 'nested-map',
      name: 'Nested Map',
      folder: undefined,
      revision: 7,
      metadata: { region: 'one' },
      updatedAt: 1_700_000_000_700,
    })), 'utf8')

    const repository = createSqliteMapRepository<TabletopMap>(database)
    const first = await importMapsFromJson({ mapsRoot, repository })
    const second = await importMapsFromJson({ mapsRoot, repository })

    expect(first.count).toBe(2)
    expect(second.count).toBe(2)
    expect(repository.getBySlug('legacy-map')).toMatchObject({
      slug: 'legacy-map',
      folder: '',
      revision: 0,
      metadata: { note: 'old' },
    })
    expect(repository.getBySlug('nested-map')).toMatchObject({
      slug: 'nested-map',
      folder: 'region-one',
      revision: 7,
      metadata: { region: 'one' },
      updatedAt: 1_700_000_000_700,
    })
    expect(repository.list().map((map) => `${map.slug}:${map.revision}`)).toEqual(['legacy-map:0', 'nested-map:7'])
  })

  it('imports JSON sheet documents into SQLite idempotently with folders and revisions', async () => {
    const database = openTempDatabase()
    const root = makeTempRoot()
    const pokemonRoot = join(root, 'data', 'sheets')
    const trainerRoot = join(root, 'data', 'trainers')
    mkdirSync(join(pokemonRoot, 'party'), { recursive: true })
    mkdirSync(trainerRoot, { recursive: true })
    writeFileSync(join(pokemonRoot, 'party', 'pikachu.json'), JSON.stringify({
      slug: 'pikachu',
      nickname: 'Pika',
      revision: 6,
      folder: 'derived-folder',
    }), 'utf8')
    writeFileSync(join(trainerRoot, 'brock.json'), JSON.stringify({
      name: 'Brock',
      revision: undefined,
    }), 'utf8')

    const repository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const first = await importSheetsFromJson({
      roots: { pokemon: pokemonRoot, trainer: trainerRoot },
      repository,
      updatedAtForFile: (path) => path.includes('pikachu') ? 1_700_000_000_600 : 1_700_000_000_100,
    })
    const second = await importSheetsFromJson({
      roots: { pokemon: pokemonRoot, trainer: trainerRoot },
      repository,
      updatedAtForFile: (path) => path.includes('pikachu') ? 1_700_000_000_600 : 1_700_000_000_100,
    })

    expect(first.count).toBe(2)
    expect(second.count).toBe(2)
    expect(first.imported).toEqual([
      {
        kind: 'pokemon',
        slug: 'pikachu',
        folder: 'party',
        revision: 6,
        updatedAt: 1_700_000_000_600,
        sourcePath: join(pokemonRoot, 'party', 'pikachu.json'),
      },
      {
        kind: 'trainer',
        slug: 'brock',
        folder: '',
        revision: 0,
        updatedAt: 1_700_000_000_100,
        sourcePath: join(trainerRoot, 'brock.json'),
      },
    ])
    expect(repository.getByRef('pokemon', 'pikachu')).toMatchObject({
      kind: 'pokemon',
      slug: 'pikachu',
      revision: 6,
      sheet: { slug: 'pikachu', nickname: 'Pika', revision: 6, updatedAt: 1_700_000_000_600 },
      updatedAt: 1_700_000_000_600,
    })
    expect(repository.getByRef('trainer', 'brock')).toMatchObject({
      kind: 'trainer',
      slug: 'brock',
      revision: 0,
      sheet: { slug: 'brock', name: 'Brock', revision: 0, updatedAt: 1_700_000_000_100 },
      updatedAt: 1_700_000_000_100,
    })
  })

  it('applies live-play sheet updates only when the expected revision matches', async () => {
    const database = openTempDatabase()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    await sheets.saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu',
      nickname: 'Pika',
      combat: { currentHp: 20 },
      revision: 3,
      updatedAt: 1_700_000_000_300,
    })

    const stale = await sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: 'pikachu',
      expectedRevision: 2,
      nextSheet: { slug: 'pikachu', nickname: 'Stale', combat: { currentHp: 1 }, updatedAt: 1_700_000_000_400 },
    })
    expect(stale).toBe('stale')
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 3,
      sheet: { nickname: 'Pika', combat: { currentHp: 20 }, revision: 3 },
    })

    const applied = await sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: 'pikachu',
      expectedRevision: 3,
      nextSheet: { slug: 'pikachu', nickname: 'Pika', combat: { currentHp: 12 }, updatedAt: 1_700_000_000_500 },
    })

    expect(applied).toBe('applied')
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      revision: 4,
      updatedAt: 1_700_000_000_500,
      sheet: { slug: 'pikachu', nickname: 'Pika', combat: { currentHp: 12 }, revision: 4 },
    })
  })

  it('asserts consulted sheet revisions without writing unchanged sheets', () => {
    const database = openTempDatabase()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu',
      nickname: 'Pika',
      revision: 3,
      updatedAt: 1_700_000_000_300,
    })
    sheets.saveSetupSheet('trainer', 'misty', {
      slug: 'misty',
      name: 'Misty',
      revision: 5,
      updatedAt: 1_700_000_000_500,
    })
    const before = sheets.list()

    expect(() => sheets.assertRevisions([
      { kind: 'pokemon', slug: 'pikachu', revision: 3 },
      { kind: 'pokemon', slug: 'pikachu', revision: 3 },
      { kind: 'trainer', slug: 'misty', revision: 5 },
    ])).not.toThrow()
    expect(sheets.list()).toEqual(before)

    expect(() => sheets.assertRevisions([
      { kind: 'pokemon', slug: 'pikachu', revision: 2 },
      { kind: 'trainer', slug: 'missing', revision: 0 },
    ])).toThrow(SheetRevisionConflictError)

    try {
      sheets.assertRevisions([
        { kind: 'pokemon', slug: 'pikachu', revision: 2 },
        { kind: 'trainer', slug: 'missing', revision: 0 },
      ])
      throw new Error('expected revision assertion to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(SheetRevisionConflictError)
      expect((error as SheetRevisionConflictError).mismatches).toEqual([
        { kind: 'pokemon', slug: 'pikachu', expectedRevision: 2, currentRevision: 3 },
        { kind: 'trainer', slug: 'missing', expectedRevision: 0, currentRevision: null },
      ])
    }
    expect(sheets.list()).toEqual(before)
  })

  it('applies live-play map updates only when the expected revision matches', async () => {
    const database = openTempDatabase()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    await maps.saveSetupMap(mapDocument())

    const stale = await maps.applyLivePlayUpdate({
      slug: 'training-yard',
      expectedRevision: 3,
      nextMap: mapDocument({ name: 'Stale Overwrite', revision: 4, updatedAt: 1_700_000_000_300 }),
    })
    expect(stale).toBe('stale')
    expect(maps.getBySlug('training-yard')).toMatchObject({
      name: 'Training Yard',
      revision: 4,
      updatedAt: 1_700_000_000_100,
    })

    const applied = await maps.applyLivePlayUpdate({
      slug: 'training-yard',
      expectedRevision: 4,
      nextMap: mapDocument({
        name: 'Accepted Update',
        revision: 999,
        placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } }],
        updatedAt: 1_700_000_000_500,
      }),
    })

    expect(applied).toBe('applied')
    expect(maps.getBySlug('training-yard')).toMatchObject({
      name: 'Accepted Update',
      revision: 5,
      updatedAt: 1_700_000_000_500,
      placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } }],
    })
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
    const moveCompensation = createAcceptedMoveCompensationResult({
      mapSlug: command.mapSlug,
      originOperationId: command.opId,
      plan: createMoveStateChangePlan([{
        kind: 'map-hazards',
        scope: { kind: 'map', mapSlug: command.mapSlug },
        expectedRevision: 2,
        sourceOperationId: 'move.add-hazard',
        reasonCode: 'hazard-added',
        previous: [],
        current: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      }]),
    })

    const stored = ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
      moveCompensation,
    })
    const duplicate = ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
      moveCompensation,
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
      moveCompensation,
      resultRevision: 3,
      createdAt: 1_700_000_000_500,
      recordedAt: new Date(1_700_000_000_500).toISOString(),
    })
    expect(ops.listAcceptedOpsSinceRevision({
      mapSlug: command.mapSlug,
      baseRevision: 2,
      currentRevision: 3,
    })).toEqual([
      {
        mapSlug: command.mapSlug,
        opId: command.opId,
        revision: 3,
        scopes: [scope],
        command,
        result,
      },
    ])
    expect(ops.listAcceptedOpsSinceRevision({
      mapSlug: command.mapSlug,
      baseRevision: 3,
      currentRevision: 3,
    })).toEqual([])
    expect(() => ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
    })).toThrow('different move compensation metadata')
    expect(() => ops.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash: 'changed-hash' as never,
      command,
      result,
    })).toThrow('already recorded for a different command envelope')
  })

  it('rejects SQLite operation result collisions for the same command hash', () => {
    const database = openTempDatabase()
    const ops = createSqliteLivePlayOpRepository({ database })
    const command: LivePlayCommandEnvelope = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_liveplaydb02',
      mapSlug: 'training-yard',
      baseRevision: 2,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-1', field: 'position' }],
      payload: { placementId: 'token-1', position: { x: 2, y: 0, z: 1 } },
    }
    const commandHash = createLivePlayCommandHash(command)
    const accepted = createLivePlayAcceptedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 2,
      revision: 3,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: command.mapSlug,
        revision: 3,
        scopes: command.scopes,
        payload: command.payload,
      }],
    })
    const differentAccepted = createLivePlayAcceptedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 2,
      revision: 4,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: command.mapSlug,
        revision: 4,
        scopes: command.scopes,
        payload: command.payload,
      }],
    })
    const abandoned = createLivePlayRejectedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'abandoned',
      message: 'This live-play operation was abandoned before execution.',
      currentRevision: 2,
    })
    const rejected = createLivePlayRejectedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'stale-revision',
      message: 'Refresh before retrying.',
      currentRevision: 5,
    })

    const stored = ops.saveCommandResult({ mapSlug: command.mapSlug, opId: command.opId, commandHash, command, result: accepted })
    expect(ops.saveCommandResult({ mapSlug: command.mapSlug, opId: command.opId, commandHash, command, result: accepted })).toEqual(stored)
    expect(() => ops.saveCommandResult({ mapSlug: command.mapSlug, opId: command.opId, commandHash, command, result: differentAccepted }))
      .toThrow(/different terminal result/)
    expect(() => ops.saveCommandResult({ mapSlug: command.mapSlug, opId: command.opId, commandHash, command, result: abandoned }))
      .toThrow(/different terminal result/)

    const rejectedCommand = { ...command, opId: 'op_liveplaydb03' }
    const rejectedHash = createLivePlayCommandHash(rejectedCommand)
    ops.saveCommandResult({ mapSlug: rejectedCommand.mapSlug, opId: rejectedCommand.opId, commandHash: rejectedHash, command: rejectedCommand, result: { ...rejected, opId: rejectedCommand.opId } })
    expect(() => ops.saveCommandResult({
      mapSlug: rejectedCommand.mapSlug,
      opId: rejectedCommand.opId,
      commandHash: rejectedHash,
      command: rejectedCommand,
      result: { ...rejected, opId: rejectedCommand.opId, message: 'Different rejection.' },
    })).toThrow(/different terminal result/)
  })

  it('stores abandoned SQLite operation tombstones without accepted-operation history revisions', () => {
    const database = openTempDatabase()
    const ops = createSqliteLivePlayOpRepository({ database })
    const command: LivePlayCommandEnvelope = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_liveplaydb04',
      mapSlug: 'training-yard',
      baseRevision: 2,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-1', field: 'position' }],
      payload: { placementId: 'token-1', position: { x: 2, y: 0, z: 1 } },
    }
    const result = createLivePlayRejectedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'abandoned',
      message: 'This live-play operation was abandoned before execution.',
      currentRevision: 2,
    })
    const commandHash = createLivePlayCommandHash(command)

    const stored = ops.saveCommandResult({ mapSlug: command.mapSlug, opId: command.opId, commandHash, command, result })

    expect(stored.resultRevision).toBeUndefined()
    expect(ops.listAcceptedOpsSinceRevision({ mapSlug: command.mapSlug, baseRevision: 0, currentRevision: 5 })).toEqual([])
  })
})
