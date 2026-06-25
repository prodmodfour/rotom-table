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

const applyMigrationsThroughVersion = (connection: DatabaseSync, version: number): void => {
  for (const migration of STORAGE_MIGRATIONS.filter((candidate) => candidate.version <= version)) {
    migration.up(connection)
    connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
}

describe('durable realtime event-log migration', () => {
  it('keeps migration versions contiguous through schema version 5', () => {
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(5)
    expect(STORAGE_MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5])
  })

  it('creates event and cursor-state tables for a fresh database', () => {
    const connection = openMemoryConnection()

    const result = applyStorageMigrations(connection)

    expect(result).toMatchObject({ fromVersion: 0, toVersion: 5, appliedVersions: [1, 2, 3, 4, 5] })
    expect(getStorageSchemaVersion(connection)).toBe(5)
    expect(tableNames(connection)).toEqual([
      'live_play_ops',
      'map_folders',
      'map_interaction_modes',
      'maps',
      'realtime_event_log_state',
      'realtime_events',
      'sheet_folders',
      'sheets',
    ])
    expect(connection.prepare('SELECT latest_sequence, earliest_available_sequence FROM realtime_event_log_state WHERE singleton = 1').get())
      .toEqual({ latest_sequence: 0, earliest_available_sequence: 1 })

    const indexes = indexList(connection, 'realtime_events')
    expect(indexes.map((index) => index.name)).toContain('realtime_events_channel_sequence_idx')
    expect(indexes.map((index) => index.name)).toContain('realtime_events_created_at_idx')
    expect(indexes.some((index) => index.unique === 1)).toBe(true)

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

    expect(result).toEqual({ fromVersion: 4, toVersion: 5, appliedVersions: [5] })
    expect(getStorageSchemaVersion(connection)).toBe(5)
    expect(connection.prepare('SELECT COUNT(*) AS count FROM maps').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM live_play_ops').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT latest_sequence, earliest_available_sequence FROM realtime_event_log_state WHERE singleton = 1').get())
      .toEqual({ latest_sequence: 0, earliest_available_sequence: 1 })

    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 5, toVersion: 5, appliedVersions: [] })
  })
})
