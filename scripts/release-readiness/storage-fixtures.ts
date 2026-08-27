import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { STORAGE_MIGRATIONS } from '../../server/storage/migrations'

export const HISTORICAL_MAP_SLUG = 'release-historical-map'
export const HISTORICAL_TRAINER_SLUG = 'release-historical-trainer'
export const HISTORICAL_MAP_DOCUMENT = JSON.stringify({
  schemaVersion: 2,
  slug: HISTORICAL_MAP_SLUG,
  name: 'Release historical map',
  folder: 'release-fixtures',
  revision: 7,
  updatedAt: 1_700_000_000_000,
  dimensions: { x: 2, y: 1, z: 2 },
  voxels: [],
  placements: [],
})
export const HISTORICAL_TRAINER_DOCUMENT = JSON.stringify({
  schemaVersion: 1,
  slug: HISTORICAL_TRAINER_SLUG,
  name: 'Release Historical Trainer',
  revision: 4,
  updatedAt: 1_700_000_000_000,
  inventory: {},
})

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

export const applyMigrationsThrough = (connection: DatabaseSync, version: number): void => {
  if (!Number.isSafeInteger(version) || version < 0 || version > STORAGE_MIGRATIONS.length) {
    throw new Error(`Historical fixture version must be 0..${STORAGE_MIGRATIONS.length}`)
  }
  connection.exec('PRAGMA foreign_keys = OFF')
  for (const migration of STORAGE_MIGRATIONS) {
    if (migration.version > version) break
    migration.up(connection)
    connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
  connection.exec('PRAGMA foreign_keys = ON')
}

export const normalizeHistoricalNondeterminism = (connection: DatabaseSync): void => {
  const secretTable = connection.prepare(`
    SELECT 1 present FROM sqlite_schema WHERE type = 'table' AND name = 'gm_toolkit_secrets'
  `).get()
  if (secretTable) {
    connection.prepare(`
      UPDATE gm_toolkit_secrets
      SET secret_value = ?, created_at = ?
      WHERE secret_id = 'preview-signing-v1'
    `).run('0123456789abcdef'.repeat(4), '2026-08-27T00:00:00.000Z')
  }
}

export const seedHistoricalAuthority = (connection: DatabaseSync): void => {
  connection.prepare(`
    INSERT INTO maps (slug, document_json, revision, updated_at)
    VALUES (?, ?, 7, 1700000000000)
  `).run(HISTORICAL_MAP_SLUG, HISTORICAL_MAP_DOCUMENT)
  connection.prepare(`
    INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
    VALUES ('trainer', ?, ?, 4, 1700000000000)
  `).run(HISTORICAL_TRAINER_SLUG, HISTORICAL_TRAINER_DOCUMENT)
}

const stableValue = (value: unknown): unknown => {
  if (value instanceof Uint8Array) return { $blobHex: Buffer.from(value).toString('hex') }
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, stableValue(child)]))
}

const tableNames = (connection: DatabaseSync): string[] => connection.prepare(`
  SELECT name FROM sqlite_schema
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map(row => String(row.name))

export const canonicalDatabaseSnapshot = (connection: DatabaseSync): unknown => {
  const schema = connection.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all().map(stableValue)
  const rows = Object.fromEntries(tableNames(connection).map((table) => {
    const records = connection.prepare(`SELECT * FROM ${JSON.stringify(table)}`).all()
      .map(stableValue)
      .map(record => JSON.stringify(record))
      .sort()
      .map(record => JSON.parse(record))
    return [table, records]
  }))
  return {
    userVersion: connection.prepare('PRAGMA user_version').get()?.user_version,
    schema,
    rows,
  }
}

export const canonicalDatabaseSha256 = (connection: DatabaseSync): string => (
  sha256(JSON.stringify(canonicalDatabaseSnapshot(connection)))
)

export const schemaObjectNames = (connection: DatabaseSync): string[] => connection.prepare(`
  SELECT type || ':' || name AS identity FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'trigger', 'view')
  ORDER BY identity
`).all().map(row => String(row.identity))

export const authorityDocumentBytes = (connection: DatabaseSync): {
  readonly map: string
  readonly trainer: string
} => {
  const map = connection.prepare('SELECT document_json FROM maps WHERE slug = ?').get(HISTORICAL_MAP_SLUG)?.document_json
  const trainer = connection.prepare("SELECT document_json FROM sheets WHERE kind = 'trainer' AND slug = ?").get(HISTORICAL_TRAINER_SLUG)?.document_json
  if (typeof map !== 'string' || typeof trainer !== 'string') throw new Error('Historical authority seed is missing')
  return { map, trainer }
}
