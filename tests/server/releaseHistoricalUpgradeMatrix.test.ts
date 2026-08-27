import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import historicalFixtures from '../../data/release-readiness/historical-head-fixtures.v1.json'
import upgradeBudget from '../../data/release-readiness/upgrade-performance-budget.v1.json'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
} from '../../server/storage/migrations'
import {
  HISTORICAL_MAP_DOCUMENT,
  HISTORICAL_TRAINER_DOCUMENT,
  applyMigrationsThrough,
  authorityDocumentBytes,
  canonicalDatabaseSha256,
  normalizeHistoricalNondeterminism,
  seedHistoricalAuthority,
} from '../../scripts/release-readiness/storage-fixtures'

const connections: DatabaseSync[] = []
const open = (): DatabaseSync => {
  const connection = new DatabaseSync(':memory:')
  connections.push(connection)
  return connection
}
afterEach(() => { while (connections.length > 0) connections.pop()!.close() })

const applicationSchema = (connection: DatabaseSync): unknown[] => connection.prepare(`
  SELECT type, name, tbl_name, sql FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name
`).all()

describe('Plan 13 full historical campaign upgrade guarantee', () => {
  it('reproduces and upgrades every promised SQLite head v1-v55 exactly once', () => {
    expect(historicalFixtures.fixtureCount).toBe(55)
    expect(historicalFixtures.releaseSchemaVersion).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    for (const fixture of historicalFixtures.fixtures) {
      const connection = open()
      applyMigrationsThrough(connection, fixture.schemaVersion)
      seedHistoricalAuthority(connection)
      normalizeHistoricalNondeterminism(connection)
      expect(canonicalDatabaseSha256(connection), `logical fixture v${fixture.schemaVersion}`).toBe(fixture.logicalDatabaseSha256)
      const before = authorityDocumentBytes(connection)
      const result = applyStorageMigrations(connection)
      expect(result, `upgrade result v${fixture.schemaVersion}`).toEqual({
        fromVersion: fixture.schemaVersion,
        toVersion: LATEST_STORAGE_SCHEMA_VERSION,
        appliedVersions: fixture.expectedAppliedVersions,
      })
      expect(authorityDocumentBytes(connection), `authority bytes v${fixture.schemaVersion}`).toEqual(before)
      expect(connection.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
      expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(applyStorageMigrations(connection)).toEqual({
        fromVersion: LATEST_STORAGE_SCHEMA_VERSION,
        toVersion: LATEST_STORAGE_SCHEMA_VERSION,
        appliedVersions: [],
      })
      connection.close()
      connections.pop()
    }
  })

  it('proves exact document-byte preservation at every reviewed boundary head', () => {
    for (const version of historicalFixtures.boundaryHeads) {
      const connection = open()
      applyMigrationsThrough(connection, version)
      seedHistoricalAuthority(connection)
      applyStorageMigrations(connection)
      expect(authorityDocumentBytes(connection)).toEqual({
        map: HISTORICAL_MAP_DOCUMENT,
        trainer: HISTORICAL_TRAINER_DOCUMENT,
      })
      connection.close()
      connections.pop()
    }
  })

  it('rolls back an injected interruption at every migration boundary and then converges', () => {
    for (const migration of STORAGE_MIGRATIONS) {
      const connection = open()
      const before = applicationSchema(connection)
      expect(() => applyStorageMigrations(connection, {
        afterMigration: applied => {
          if (applied.version === migration.version) throw new Error(`injected-after-v${migration.version}`)
        },
      }), `interruption after v${migration.version}`).toThrow(`injected-after-v${migration.version}`)
      expect(getStorageSchemaVersion(connection), `rolled-back user_version after v${migration.version}`).toBe(0)
      expect(applicationSchema(connection), `rolled-back schema after v${migration.version}`).toEqual(before)
      expect(applyStorageMigrations(connection).toVersion).toBe(LATEST_STORAGE_SCHEMA_VERSION)
      expect(connection.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
      connection.close()
      connections.pop()
    }
  })

  it('upgrades the reviewed large campaign inside the frozen one-worker budget', () => {
    const connection = open()
    applyMigrationsThrough(connection, 1)
    connection.exec('BEGIN')
    const mapInsert = connection.prepare('INSERT INTO maps (slug, document_json, revision, updated_at) VALUES (?, ?, 1, 1700000000000)')
    const sheetInsert = connection.prepare("INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('trainer', ?, ?, 1, 1700000000000)")
    const payload = 'x'.repeat(upgradeBudget.fixture.payloadBytes)
    for (let index = 0; index < upgradeBudget.fixture.mapRows; index += 1) {
      mapInsert.run(`large-map-${index}`, JSON.stringify({ schemaVersion: 2, slug: `large-map-${index}`, payload }))
    }
    for (let index = 0; index < upgradeBudget.fixture.trainerRows; index += 1) {
      sheetInsert.run(`large-trainer-${index}`, JSON.stringify({ slug: `large-trainer-${index}`, payload }))
    }
    connection.exec('COMMIT')
    const started = performance.now()
    const result = applyStorageMigrations(connection)
    const elapsedMs = performance.now() - started
    expect(result.toVersion).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(elapsedMs).toBeLessThan(upgradeBudget.maximumMilliseconds)
    expect(connection.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
  }, 30_000)
})
