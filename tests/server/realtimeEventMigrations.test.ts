import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
} from '~~/server/storage/migrations'

const openConnections: DatabaseSync[] = []

const openMemoryConnection = (): DatabaseSync => {
  const connection = new DatabaseSync(':memory:')
  openConnections.push(connection)
  return connection
}

afterEach(() => {
  while (openConnections.length > 0) openConnections.pop()?.close()
})

const tableNames = (connection: DatabaseSync): string[] => connection.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name ASC
`).all().map((row) => String(row.name))

const indexList = (connection: DatabaseSync, table: string): Array<{ readonly name: string; readonly unique: number }> =>
  connection.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all()
    .map((row) => ({ name: String(row.name), unique: Number(row.unique) }))

const tableColumns = (connection: DatabaseSync, table: string): Array<{
  readonly name: string
  readonly type: string
  readonly notNull: number
  readonly primaryKeyPosition: number
}> => connection.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()
  .map((row) => ({
    name: String(row.name),
    type: String(row.type),
    notNull: Number(row.notnull),
    primaryKeyPosition: Number(row.pk),
  }))

const applyMigrationsThroughVersion = (connection: DatabaseSync, version: number): void => {
  for (const migration of STORAGE_MIGRATIONS.filter((candidate) => candidate.version <= version)) {
    migration.up(connection)
    connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
}

const expectedTableNames = [
  'group_inventories',
  'live_play_ops',
  'map_folders',
  'map_interaction_modes',
  'maps',
  'realtime_event_log_state',
  'realtime_events',
  'sheet_folders',
  'sheets',
  'shop_checkout_ops',
  'shop_tables',
]

const documentStoreTableColumns = [
  { name: 'slug', type: 'TEXT', notNull: 0, primaryKeyPosition: 1 },
  { name: 'document_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
  { name: 'revision', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
  { name: 'updated_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
]

describe('SQLite storage migrations', () => {
  it('keeps migration versions contiguous through schema version 8', () => {
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(8)
    expect(STORAGE_MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('creates realtime event-log, group inventory, and shop tables for a fresh database', () => {
    const connection = openMemoryConnection()

    const result = applyStorageMigrations(connection)

    expect(result).toMatchObject({ fromVersion: 0, toVersion: 8, appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8] })
    expect(getStorageSchemaVersion(connection)).toBe(8)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT latest_sequence, earliest_available_sequence FROM realtime_event_log_state WHERE singleton = 1').get())
      .toEqual({ latest_sequence: 0, earliest_available_sequence: 1 })

    const indexes = indexList(connection, 'realtime_events')
    expect(indexes.map((index) => index.name)).toContain('realtime_events_channel_sequence_idx')
    expect(indexes.map((index) => index.name)).toContain('realtime_events_created_at_idx')
    expect(indexes.some((index) => index.unique === 1)).toBe(true)

    expect(tableColumns(connection, 'group_inventories')).toEqual(documentStoreTableColumns)
    expect(tableColumns(connection, 'shop_tables')).toEqual(documentStoreTableColumns)
    expect(tableColumns(connection, 'shop_checkout_ops')).toEqual([
      { name: 'op_id', type: 'TEXT', notNull: 0, primaryKeyPosition: 1 },
      { name: 'shop_slug', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'command_hash', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'command_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'result_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'result_revision', type: 'INTEGER', notNull: 0, primaryKeyPosition: 0 },
      { name: 'created_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
    ])
    expect(indexList(connection, 'shop_checkout_ops').map((index) => index.name))
      .toContain('shop_checkout_ops_shop_revision_idx')

    connection.prepare(`
      INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at)
      VALUES ('same-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'maps', 'updated', '{}', '{}', 1)
    `).run()
    expect(() => connection.prepare(`
      INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at)
      VALUES ('same-key', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'maps', 'updated', '{}', '{}', 2)
    `).run()).toThrow()
  })

  it('upgrades schema version 4 databases without deleting existing campaign rows', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 4)
    connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('training-yard', '{"slug":"training-yard"}', 4, 100)
    `).run()
    connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('pokemon', 'pikachu', '{"slug":"pikachu"}', 2, 101)
    `).run()
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_abcdefgh', 'training-yard', 'hash', '{}', '{"ok":false,"opId":"op_abcdefgh","mapSlug":"training-yard","reason":"invalid","message":"old"}', NULL, 102)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({ fromVersion: 4, toVersion: 8, appliedVersions: [5, 6, 7, 8] })
    expect(getStorageSchemaVersion(connection)).toBe(8)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT COUNT(*) AS count FROM maps').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM live_play_ops').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM group_inventories').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_tables').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT latest_sequence, earliest_available_sequence FROM realtime_event_log_state WHERE singleton = 1').get())
      .toEqual({ latest_sequence: 0, earliest_available_sequence: 1 })

    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 8, toVersion: 8, appliedVersions: [] })
  })

  it('upgrades schema version 6 databases with the shop table without touching existing rows', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 6)
    connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('training-yard', '{"slug":"training-yard"}', 4, 100)
    `).run()
    connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('trainer', 'brock', '{"slug":"brock"}', 3, 101)
    `).run()
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_shopmig1', 'training-yard', 'hash', '{}', '{"ok":false,"opId":"op_shopmig1","mapSlug":"training-yard","reason":"invalid","message":"old"}', NULL, 102)
    `).run()
    connection.prepare(`
      INSERT INTO group_inventories (slug, document_json, revision, updated_at)
      VALUES ('main', '{"slug":"main"}', 8, 103)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({ fromVersion: 6, toVersion: 8, appliedVersions: [7, 8] })
    expect(getStorageSchemaVersion(connection)).toBe(8)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(tableColumns(connection, 'shop_tables')).toEqual(documentStoreTableColumns)
    expect(connection.prepare('SELECT slug, revision, updated_at FROM maps').get())
      .toEqual({ slug: 'training-yard', revision: 4, updated_at: 100 })
    expect(connection.prepare('SELECT kind, slug, revision, updated_at FROM sheets').get())
      .toEqual({ kind: 'trainer', slug: 'brock', revision: 3, updated_at: 101 })
    expect(connection.prepare('SELECT op_id, map_slug, created_at FROM live_play_ops').get())
      .toEqual({ op_id: 'op_shopmig1', map_slug: 'training-yard', created_at: 102 })
    expect(connection.prepare('SELECT slug, revision, updated_at FROM group_inventories').get())
      .toEqual({ slug: 'main', revision: 8, updated_at: 103 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_tables').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })

    connection.prepare(`
      INSERT INTO shop_tables (slug, document_json, revision, updated_at)
      VALUES ('mart', '{"slug":"mart"}', 1, 104)
    `).run()
    expect(connection.prepare('SELECT slug, revision, updated_at FROM shop_tables').get())
      .toEqual({ slug: 'mart', revision: 1, updated_at: 104 })
  })

  it('upgrades schema version 7 databases with shop checkout operation history without touching shop rows', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 7)
    connection.prepare(`
      INSERT INTO shop_tables (slug, document_json, revision, updated_at)
      VALUES ('mart', '{"slug":"mart","name":"Mart"}', 2, 104)
    `).run()
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_oldmapop1', 'training-yard', 'hash', '{}', '{"ok":false,"opId":"op_oldmapop1","mapSlug":"training-yard","reason":"invalid","message":"old"}', NULL, 105)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({ fromVersion: 7, toVersion: 8, appliedVersions: [8] })
    expect(getStorageSchemaVersion(connection)).toBe(8)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT slug, revision, updated_at FROM shop_tables').get())
      .toEqual({ slug: 'mart', revision: 2, updated_at: 104 })
    expect(connection.prepare('SELECT op_id, map_slug, created_at FROM live_play_ops').get())
      .toEqual({ op_id: 'op_oldmapop1', map_slug: 'training-yard', created_at: 105 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })

    connection.prepare(`
      INSERT INTO shop_checkout_ops (op_id, shop_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES (
        'op_shopckmig01',
        'mart',
        'hash',
        '{"schemaVersion":1,"opId":"op_shopckmig01","type":"shopCheckout","scopes":[{"kind":"shop","shopSlug":"mart","field":"purchase"}],"payload":{"shopSlug":"mart","shopRevision":2,"paymentSource":{"kind":"trainer","slug":"ash","revision":1},"deliveryTarget":{"kind":"trainer","slug":"ash","revision":1},"lines":[{"entryId":"potion","quantity":1}],"origin":{"kind":"shopPage"}}}',
        '{"ok":false,"opId":"op_shopckmig01","shopSlug":"mart","reason":"invalid","message":"migration smoke","currentShopRevision":2}',
        2,
        106
      )
    `).run()
    expect(connection.prepare('SELECT op_id, shop_slug, result_revision, created_at FROM shop_checkout_ops').get())
      .toEqual({ op_id: 'op_shopckmig01', shop_slug: 'mart', result_revision: 2, created_at: 106 })
  })

  it('upgrades schema version 5 databases with group inventory and shop tables', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 5)
    connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('training-yard', '{"slug":"training-yard"}', 4, 100)
    `).run()
    connection.prepare(`
      INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at)
      VALUES ('group-inventory-upgrade', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'maps', 'updated', '{}', '{}', 103)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({ fromVersion: 5, toVersion: 8, appliedVersions: [6, 7, 8] })
    expect(getStorageSchemaVersion(connection)).toBe(8)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(tableColumns(connection, 'group_inventories')).toEqual(documentStoreTableColumns)
    expect(tableColumns(connection, 'shop_tables')).toEqual(documentStoreTableColumns)
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM maps').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 1 })

    connection.prepare(`
      INSERT INTO group_inventories (slug, document_json, revision, updated_at)
      VALUES ('main', '{"slug":"main"}', 0, 104)
    `).run()
    expect(connection.prepare('SELECT slug, revision, updated_at FROM group_inventories').get())
      .toEqual({ slug: 'main', revision: 0, updated_at: 104 })
  })
})
