import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
  type StorageMigrationHooks,
} from './migrations'

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary')

export type ReleaseUpgradeErrorCode =
  | 'input-missing'
  | 'input-not-file'
  | 'input-not-sqlite'
  | 'input-read-only'
  | 'input-sidecars-present'
  | 'input-locked'
  | 'input-corrupt'
  | 'input-partial'
  | 'input-unsupported-version'
  | 'backup-exists'
  | 'upgrade-failed'

export class ReleaseUpgradeError extends Error {
  constructor(readonly code: ReleaseUpgradeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReleaseUpgradeError'
  }
}

export interface ReleaseUpgradeOptions {
  readonly databasePath: string
  readonly backupPath?: string
  readonly hooks?: StorageMigrationHooks
  readonly now?: number
}

export interface ReleaseUpgradeResult {
  readonly status: 'upgraded' | 'already-current'
  readonly databasePath: string
  readonly backupPath: string | null
  readonly fromVersion: number
  readonly toVersion: number
  readonly appliedVersions: readonly number[]
  readonly beforeSha256: string
  readonly afterSha256: string
  readonly integrity: 'ok'
  readonly foreignKeyViolations: 0
}

const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const supportedBoundary = `Rotom Table 1.0 supports app-produced SQLite schema versions 1-${LATEST_STORAGE_SCHEMA_VERSION}; restore a verified backup or use the documented JSON-era import for other inputs.`

const fail = (code: ReleaseUpgradeErrorCode, message: string, cause?: unknown): never => {
  throw new ReleaseUpgradeError(code, `${message} ${supportedBoundary}`, cause === undefined ? undefined : { cause })
}

const assertSqliteFile = (path: string): void => {
  if (!existsSync(path)) fail('input-missing', `Campaign database does not exist: ${path}.`)
  const stats = lstatSync(path)
  if (!stats.isFile()) fail('input-not-file', `Campaign database must be a regular file: ${path}.`)
  if ((stats.mode & 0o222) === 0 || (lstatSync(dirname(path)).mode & 0o222) === 0) {
    fail('input-read-only', `Campaign database and parent directory must be writable for atomic replacement: ${path}.`)
  }
  const header = readFileSync(path).subarray(0, SQLITE_HEADER.length)
  if (!header.equals(SQLITE_HEADER)) fail('input-not-sqlite', `Input is not a SQLite 3 database: ${path}.`)
  const sidecars = [`${path}-wal`, `${path}-shm`].filter(existsSync)
  if (sidecars.length > 0) {
    fail('input-sidecars-present', `Refusing an offline upgrade while SQLite sidecars exist (${sidecars.map(sidecar => basename(sidecar)).join(', ')}); stop the service and checkpoint/close the database first.`)
  }
}

const schemaRows = (connection: DatabaseSync): Map<string, string | null> => new Map(connection.prepare(`
  SELECT type || ':' || name AS identity, sql
  FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'trigger', 'view')
  ORDER BY identity
`).all().map(row => [String(row.identity), typeof row.sql === 'string' ? row.sql : null]))

const expectedSchemaCache = new Map<number, Map<string, string | null>>()
const expectedSchema = (version: number): Map<string, string | null> => {
  const cached = expectedSchemaCache.get(version)
  if (cached) return cached
  const connection = new DatabaseSync(':memory:')
  try {
    connection.exec('PRAGMA foreign_keys = OFF')
    for (const migration of STORAGE_MIGRATIONS.filter(row => row.version <= version)) {
      migration.up(connection)
      connection.exec(`PRAGMA user_version = ${migration.version}`)
    }
    const rows = schemaRows(connection)
    expectedSchemaCache.set(version, rows)
    return rows
  } finally {
    connection.close()
  }
}

const assertExpectedSchema = (connection: DatabaseSync, version: number): void => {
  const actual = schemaRows(connection)
  const missing: string[] = []
  const changed: string[] = []
  for (const [identity, sql] of expectedSchema(version)) {
    if (!actual.has(identity)) missing.push(identity)
    else if (actual.get(identity) !== sql) changed.push(identity)
  }
  if (missing.length > 0 || changed.length > 0) {
    fail(
      'input-partial',
      `Database claims schema v${version} but is partial or modified (missing: ${missing.slice(0, 5).join(', ') || 'none'}; changed: ${changed.slice(0, 5).join(', ') || 'none'}).`,
    )
  }
}

const assertIntegrity = (connection: DatabaseSync): void => {
  const integrity = connection.prepare('PRAGMA integrity_check').all()
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    fail('input-corrupt', `SQLite integrity_check failed: ${JSON.stringify(integrity.slice(0, 5))}.`)
  }
  connection.exec('PRAGMA foreign_keys = ON')
  const foreignKeys = connection.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeys.length > 0) fail('input-corrupt', `SQLite foreign_key_check found ${foreignKeys.length} violation(s).`)
}

const inspectAndLock = (path: string): { version: number; mode: number } => {
  let connection: DatabaseSync
  try {
    connection = new DatabaseSync(path, { timeout: 0 })
  } catch (error) {
    fail('input-corrupt', 'SQLite could not open the campaign database.', error)
  }
  try {
    try {
      connection.exec('BEGIN EXCLUSIVE')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/locked|busy/u.test(message)) {
        fail('input-locked', 'Campaign database is locked or concurrently open; stop Rotom Table before upgrading.', error)
      }
      fail('input-corrupt', 'SQLite could not begin a safe inspection transaction.', error)
    }
    try {
      const version = getStorageSchemaVersion(connection)
      if (version < 1 || version > LATEST_STORAGE_SCHEMA_VERSION) {
        fail('input-unsupported-version', `SQLite schema version ${version} is outside the supported upgrade boundary.`)
      }
      assertExpectedSchema(connection, version)
      assertIntegrity(connection)
      connection.exec('ROLLBACK')
      return { version, mode: lstatSync(path).mode & 0o777 }
    } catch (error) {
      if (connection.isTransaction) connection.exec('ROLLBACK')
      if (error instanceof ReleaseUpgradeError) throw error
      fail('input-corrupt', 'SQLite inspection failed before any upgrade write.', error)
    }
  } finally {
    connection.close()
  }
}

const syncFile = (path: string): void => {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

export const upgradeCampaignDatabase = (options: ReleaseUpgradeOptions): ReleaseUpgradeResult => {
  const path = resolve(options.databasePath)
  assertSqliteFile(path)
  const beforeSha256 = sha256File(path)
  const inspected = inspectAndLock(path)
  if (inspected.version === LATEST_STORAGE_SCHEMA_VERSION) {
    return {
      status: 'already-current', databasePath: path, backupPath: null,
      fromVersion: inspected.version, toVersion: inspected.version, appliedVersions: [],
      beforeSha256, afterSha256: beforeSha256, integrity: 'ok', foreignKeyViolations: 0,
    }
  }

  const backupPath = resolve(options.backupPath ?? `${path}.pre-upgrade-v${inspected.version}.bak`)
  if (existsSync(backupPath) && sha256File(backupPath) !== beforeSha256) {
    fail('backup-exists', `Refusing to overwrite a non-matching pre-upgrade backup: ${backupPath}.`)
  }
  const stagingPath = resolve(dirname(path), `.${basename(path)}.upgrade-${process.pid}-${options.now ?? Date.now()}.tmp`)
  try {
    if (!existsSync(backupPath)) {
      copyFileSync(path, backupPath)
      chmodSync(backupPath, 0o600)
    }
    if (sha256File(backupPath) !== beforeSha256) throw new Error('Pre-upgrade backup digest mismatch')
    copyFileSync(path, stagingPath)
    chmodSync(stagingPath, inspected.mode)
    const staged = new DatabaseSync(stagingPath, { timeout: 0 })
    let migrationResult
    try {
      staged.exec('PRAGMA foreign_keys = ON')
      migrationResult = applyStorageMigrations(staged, options.hooks)
      assertExpectedSchema(staged, LATEST_STORAGE_SCHEMA_VERSION)
      assertIntegrity(staged)
      staged.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all()
    } finally {
      staged.close()
    }
    syncFile(stagingPath)
    renameSync(stagingPath, path)
    const afterSha256 = sha256File(path)
    return {
      status: 'upgraded', databasePath: path, backupPath,
      fromVersion: migrationResult.fromVersion,
      toVersion: migrationResult.toVersion,
      appliedVersions: migrationResult.appliedVersions,
      beforeSha256,
      afterSha256,
      integrity: 'ok',
      foreignKeyViolations: 0,
    }
  } catch (error) {
    rmSync(stagingPath, { force: true })
    rmSync(`${stagingPath}-wal`, { force: true })
    rmSync(`${stagingPath}-shm`, { force: true })
    if (error instanceof ReleaseUpgradeError) throw error
    fail('upgrade-failed', `Atomic upgrade failed; the original database remains byte-exact and the pre-upgrade backup is retained at ${backupPath}.`, error)
  }
}
