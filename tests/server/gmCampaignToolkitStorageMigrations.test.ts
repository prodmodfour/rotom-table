import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
} from '~~/server/storage/migrations'

const connections: DatabaseSync[] = []
const open = (): DatabaseSync => { const connection = new DatabaseSync(':memory:'); connection.exec('PRAGMA foreign_keys = ON'); connections.push(connection); return connection }
afterEach(() => { while (connections.length) connections.pop()!.close() })
const through = (connection: DatabaseSync, version: number): void => {
  connection.exec('PRAGMA foreign_keys = OFF')
  for (const migration of STORAGE_MIGRATIONS.filter(row => row.version <= version)) {
    migration.up(connection); connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
  connection.exec('PRAGMA foreign_keys = ON')
}
const tableNames = (connection: DatabaseSync): string[] => connection.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name))

const baselineRows = (connection: DatabaseSync) => {
  const map = JSON.stringify({ schemaVersion: 2, slug: 'p12-baseline-map', name: 'P12 Baseline Map', folder: '', revision: 7, updatedAt: 700, dimensions: { x: 1, y: 1, z: 1 }, voxels: [], placements: [] })
  const sheet = JSON.stringify({ slug: 'p12-baseline-trainer', name: 'Baseline Trainer', revision: 4, updatedAt: 700 })
  connection.prepare('INSERT INTO maps (slug, document_json, revision, updated_at) VALUES (?, ?, ?, ?)').run('p12-baseline-map', map, 7, 700)
  connection.prepare('INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES (?, ?, ?, ?, ?)').run('trainer', 'p12-baseline-trainer', sheet, 4, 700)
  return {
    map: JSON.stringify(connection.prepare("SELECT * FROM maps WHERE slug = 'p12-baseline-map'").get()),
    sheet: JSON.stringify(connection.prepare("SELECT * FROM sheets WHERE kind = 'trainer' AND slug = 'p12-baseline-trainer'").get()),
  }
}

describe('Plan 12 GM Campaign Toolkit storage migrations', () => {
  it('creates a fresh campaign through contiguous schema v56 with every toolkit authority and seed', () => {
    const connection = open()
    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 0,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: Array.from({ length: LATEST_STORAGE_SCHEMA_VERSION }, (_, index) => index + 1),
    })
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(56)
    expect(getStorageSchemaVersion(connection)).toBe(56)
    expect(STORAGE_MIGRATIONS.slice(50).map(row => row.version)).toEqual([51, 52, 53, 54, 55, 56])
    expect(tableNames(connection)).toEqual(expect.arrayContaining([
      'gm_encounter_tables', 'gm_encounter_table_ops', 'gm_wild_generation_ops', 'gm_generated_packages',
      'gm_toolkit_secrets', 'gm_npc_archetypes', 'gm_npc_archetype_ops', 'gm_npc_generation_ops',
      'gm_npc_packages', 'gm_session_preparations', 'gm_session_preparation_ops',
    ]))
    expect(connection.prepare('SELECT COUNT(*) count FROM gm_encounter_tables').get()).toEqual({ count: 4 })
    expect(connection.prepare('SELECT COUNT(*) count FROM gm_npc_archetypes').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) count FROM gm_toolkit_secrets').get()).toEqual({ count: 1 })
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('upgrades the exact Plan 11 v50 baseline through all six versions without rewriting ordinary authority', () => {
    const connection = open(); through(connection, 50); const before = baselineRows(connection)
    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 50, toVersion: 56, appliedVersions: [51, 52, 53, 54, 55, 56] })
    expect(JSON.stringify(connection.prepare("SELECT * FROM maps WHERE slug = 'p12-baseline-map'").get())).toBe(before.map)
    expect(JSON.stringify(connection.prepare("SELECT * FROM sheets WHERE kind = 'trainer' AND slug = 'p12-baseline-trainer'").get())).toBe(before.sheet)
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 56, toVersion: 56, appliedVersions: [] })
  })

  it.each([
    { from: 51, expected: [52, 53, 54, 55, 56] },
    { from: 52, expected: [53, 54, 55, 56] },
    { from: 53, expected: [54, 55, 56] },
    { from: 54, expected: [55, 56] },
    { from: 55, expected: [56] },
  ])('accepts historical toolkit head v$from exactly once', ({ from, expected }) => {
    const connection = open(); through(connection, from)
    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: from, toVersion: 56, appliedVersions: expected })
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('refuses a future v57 campaign before writing any toolkit authority', () => {
    const connection = open(); through(connection, 56)
    connection.exec('CREATE TABLE future_toolkit_authority (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    connection.prepare('INSERT INTO future_toolkit_authority VALUES (?, ?)').run('future', 'retain')
    connection.exec('PRAGMA user_version = 57')
    const tables = tableNames(connection)
    expect(() => applyStorageMigrations(connection)).toThrow('SQLite schema version 57 is newer than this Rotom Table build supports (56)')
    expect(getStorageSchemaVersion(connection)).toBe(57)
    expect(tableNames(connection)).toEqual(tables)
    expect(connection.prepare('SELECT * FROM future_toolkit_authority').all()).toEqual([{ id: 'future', value: 'retain' }])
  })
})
