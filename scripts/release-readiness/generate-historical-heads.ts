import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
} from '../../server/storage/migrations'
import {
  HISTORICAL_MAP_DOCUMENT,
  HISTORICAL_TRAINER_DOCUMENT,
  applyMigrationsThrough,
  canonicalDatabaseSha256,
  normalizeHistoricalNondeterminism,
  schemaObjectNames,
  seedHistoricalAuthority,
  sha256,
} from './storage-fixtures'

const ROOT = resolve(import.meta.dirname, '../..')
const OUTPUT = resolve(ROOT, 'data/release-readiness/historical-head-fixtures.v1.json')
const BOUNDARIES = new Set([1, 5, 12, 21, 28, 41, 44, 45, 46, 50, 55])

const rows = Array.from({ length: 55 }, (_, index) => {
  const version = index + 1
  const connection = new DatabaseSync(':memory:')
  try {
    applyMigrationsThrough(connection, version)
    seedHistoricalAuthority(connection)
    normalizeHistoricalNondeterminism(connection)
    const objects = schemaObjectNames(connection)
    return {
      fixtureId: `sqlite-head-v${version}`,
      schemaVersion: version,
      generator: 'prefix-application-of-reviewed-contiguous-chain',
      migrationPrefixSha256: sha256(JSON.stringify(STORAGE_MIGRATIONS
        .filter(migration => migration.version <= version)
        .map(migration => ({ version: migration.version, name: migration.name })))),
      logicalDatabaseSha256: canonicalDatabaseSha256(connection),
      schemaObjectCount: objects.length,
      schemaObjectsSha256: sha256(JSON.stringify(objects)),
      seededAuthority: {
        maps: 1,
        trainerSheets: 1,
        mapDocumentSha256: sha256(HISTORICAL_MAP_DOCUMENT),
        trainerDocumentSha256: sha256(HISTORICAL_TRAINER_DOCUMENT),
      },
      exactByteBoundary: BOUNDARIES.has(version),
      expectedAppliedVersions: STORAGE_MIGRATIONS
        .filter(migration => migration.version > version)
        .map(migration => migration.version),
    }
  } finally {
    connection.close()
  }
})

const artifact = {
  artifact: 'release-historical-sqlite-head-fixtures',
  schemaVersion: 1,
  status: 'Certified',
  generator: 'scripts/release-readiness/generate-historical-heads.ts',
  releaseSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
  fixtureCount: rows.length,
  boundaryHeads: [...BOUNDARIES],
  privateCampaignSource: false,
  documentarySourceReads: false,
  digestKind: 'canonical logical database snapshot including schema and all rows',
  fixtures: rows,
}
const expected = `${JSON.stringify(artifact, null, 2)}\n`
const check = process.argv.includes('--check')
if (check) {
  if (readFileSync(OUTPUT, 'utf8') !== expected) throw new Error('Historical-head fixture drift; run the reviewed generator')
  process.stdout.write(`Historical SQLite heads v1-v55 are reproducible and hash-bound (${rows.length} fixtures).\n`)
} else {
  writeFileSync(OUTPUT, expected)
  process.stdout.write(`Wrote ${rows.length} deterministic historical SQLite head descriptors.\n`)
}
