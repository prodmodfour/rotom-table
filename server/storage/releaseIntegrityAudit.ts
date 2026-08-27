import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LATEST_STORAGE_SCHEMA_VERSION } from './migrations'
import { assertAppProducedStorageSchema } from './releaseUpgrade'

export interface ReleaseIntegrityAuditReport {
  readonly artifact: 'rotom-table-release-integrity-audit'
  readonly schemaVersion: 1
  readonly status: 'passed' | 'failed'
  readonly databaseName: string
  readonly storageSchemaVersion: number | null
  readonly checks: Readonly<Record<string, 'passed' | 'failed'>>
  readonly errors: readonly string[]
  readonly counts: {
    readonly tables: number
    readonly rows: number
    readonly jsonColumns: number
    readonly invalidJsonRows: number
    readonly foreignKeyViolations: number
    readonly families: Readonly<Record<string, number>>
  }
}

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`
const storageFamily = (table: string): string => {
  if (/^breeding_|^pokemon_(?:egg|breeding)|^campaign_(?:clock|day)/u.test(table)) return 'breeding-and-campaign-time'
  if (/^onboarding_/u.test(table)) return 'onboarding'
  if (/^contest_/u.test(table) || table === 'contests') return 'contests'
  if (/^gm_/u.test(table)) return 'gm-campaign-toolkit'
  if (/^ability_/u.test(table)) return 'ability-automation'
  if (/^capability_/u.test(table)) return 'capability-automation'
  if (/^(?:item|equipment|inventory)_/u.test(table) || /^skill_check/u.test(table) || /^trainer_species/u.test(table)) return 'deferred-mechanics'
  if (/^encounter_/u.test(table) || /^realtime_/u.test(table) || table === 'live_play_ops' || table === 'pending_move_resolutions') return 'encounter-and-realtime'
  if (['maps', 'map_folders', 'map_interaction_modes', 'sheets', 'sheet_folders', 'group_inventories', 'shop_tables', 'shop_checkout_ops'].includes(table)) return 'campaign-core'
  return 'unclassified'
}

const emptyCounts = () => ({ tables: 0, rows: 0, jsonColumns: 0, invalidJsonRows: 0, foreignKeyViolations: 0, families: {} as Record<string, number> })

export const auditReleaseCampaignDatabase = (databasePath: string): ReleaseIntegrityAuditReport => {
  const path = resolve(databasePath)
  const errors: string[] = []
  const checks: Record<string, 'passed' | 'failed'> = {}
  const counts = emptyCounts()
  let storageSchemaVersion: number | null = null
  const record = (id: string, work: () => void): void => {
    try {
      work()
      checks[id] = 'passed'
    } catch (error) {
      checks[id] = 'failed'
      errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  record('sqlite-file', () => {
    if (!existsSync(path)) throw new Error('database file does not exist')
    const header = readFileSync(path).subarray(0, 16).toString('binary')
    if (header !== 'SQLite format 3\0') throw new Error('file is not SQLite format 3')
  })
  if (checks['sqlite-file'] === 'failed') return {
    artifact: 'rotom-table-release-integrity-audit', schemaVersion: 1, status: 'failed', databaseName: basename(path),
    storageSchemaVersion, checks, errors, counts,
  }

  let connection: DatabaseSync
  try {
    connection = new DatabaseSync(path, { readOnly: true, timeout: 0 })
  } catch (error) {
    errors.push(`sqlite-open: ${error instanceof Error ? error.message : String(error)}`)
    checks['sqlite-open'] = 'failed'
    return {
      artifact: 'rotom-table-release-integrity-audit', schemaVersion: 1, status: 'failed', databaseName: basename(path),
      storageSchemaVersion, checks, errors, counts,
    }
  }
  checks['sqlite-open'] = 'passed'
  try {
    storageSchemaVersion = Number(connection.prepare('PRAGMA user_version').get()?.user_version)
    record('release-schema-version', () => {
      if (storageSchemaVersion !== LATEST_STORAGE_SCHEMA_VERSION) throw new Error(`expected v${LATEST_STORAGE_SCHEMA_VERSION}, found v${storageSchemaVersion}`)
    })
    record('exact-app-schema', () => assertAppProducedStorageSchema(connection, LATEST_STORAGE_SCHEMA_VERSION))
    record('sqlite-integrity', () => {
      const rows = connection.prepare('PRAGMA integrity_check').all()
      if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error(JSON.stringify(rows))
    })
    record('foreign-keys', () => {
      const rows = connection.prepare('PRAGMA foreign_key_check').all()
      counts.foreignKeyViolations = rows.length
      if (rows.length !== 0) throw new Error(`${rows.length} violation(s)`)
    })

    const tables = connection.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(row => String(row.name))
    counts.tables = tables.length
    record('all-storage-families', () => {
      for (const table of tables) {
        const family = storageFamily(table)
        counts.families[family] = (counts.families[family] ?? 0) + 1
      }
      if (counts.families.unclassified) throw new Error(`${counts.families.unclassified} table(s) are unclassified`)
      const required = [
        'campaign-core', 'encounter-and-realtime', 'ability-automation', 'capability-automation',
        'deferred-mechanics', 'breeding-and-campaign-time', 'onboarding', 'contests', 'gm-campaign-toolkit',
      ]
      const missing = required.filter(family => !counts.families[family])
      if (missing.length) throw new Error(`missing storage family: ${missing.join(', ')}`)
    })
    record('table-readability', () => {
      for (const table of tables) {
        const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get()
        counts.rows += Number(row?.count ?? 0)
      }
    })
    record('json-authority', () => {
      for (const table of tables) {
        const columns = connection.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
          .map(row => String(row.name))
          .filter(name => name.endsWith('_json'))
        for (const column of columns) {
          counts.jsonColumns += 1
          const invalid = Number(connection.prepare(`
            SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}
            WHERE ${quoteIdentifier(column)} IS NOT NULL
              AND (typeof(${quoteIdentifier(column)}) <> 'text' OR json_valid(${quoteIdentifier(column)}) = 0)
          `).get()?.count ?? 0)
          counts.invalidJsonRows += invalid
          if (invalid) throw new Error(`${table}.${column} has ${invalid} invalid row(s)`)
        }
      }
    })
    record('gm-toolkit-signing-secret', () => {
      const rows = connection.prepare('SELECT secret_id, secret_value FROM gm_toolkit_secrets ORDER BY secret_id').all()
      if (rows.length !== 1 || rows[0]?.secret_id !== 'preview-signing-v1' || !/^[a-f0-9]{64}$/u.test(String(rows[0]?.secret_value ?? ''))) {
        throw new Error('expected exactly one valid preview-signing-v1 secret')
      }
    })
  } finally {
    connection.close()
  }
  return {
    artifact: 'rotom-table-release-integrity-audit',
    schemaVersion: 1,
    status: errors.length === 0 ? 'passed' : 'failed',
    databaseName: basename(path),
    storageSchemaVersion,
    checks,
    errors,
    counts,
  }
}
