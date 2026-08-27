import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ReleaseUpgradeError,
  upgradeCampaignDatabase,
} from '../../server/storage/releaseUpgrade'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import {
  HISTORICAL_MAP_DOCUMENT,
  HISTORICAL_MAP_SLUG,
  applyMigrationsThrough,
  authorityDocumentBytes,
  seedHistoricalAuthority,
} from '../../scripts/release-readiness/storage-fixtures'

const roots: string[] = []
const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'rotom-release-upgrade-'))
  roots.push(path)
  return path
}
afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }) })
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

const createHead = (path: string, version: number, seed = true): void => {
  const connection = new DatabaseSync(path)
  try {
    applyMigrationsThrough(connection, version)
    if (seed) seedHistoricalAuthority(connection)
    connection.prepare('PRAGMA journal_mode = DELETE').get()
  } finally {
    connection.close()
  }
}

const expectCode = (work: () => unknown, code: ReleaseUpgradeError['code']): void => {
  try {
    work()
    throw new Error('Expected release upgrade rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseUpgradeError)
    expect((error as ReleaseUpgradeError).code).toBe(code)
    expect((error as Error).message).toContain(`schema versions 1-${LATEST_STORAGE_SCHEMA_VERSION}`)
  }
}

describe('Plan 13 operator campaign upgrade safety', () => {
  it('upgrades a copied historical campaign through staging with an exact rollback backup', () => {
    const directory = root()
    const databasePath = join(directory, 'rotom-table.sqlite')
    const backupPath = join(directory, 'pre-upgrade.sqlite')
    createHead(databasePath, 1)
    const before = sha(databasePath)

    const result = upgradeCampaignDatabase({ databasePath, backupPath, now: 100 })
    expect(result.status).toBe('upgraded')
    expect(result.fromVersion).toBe(1)
    expect(result.toVersion).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(result.appliedVersions).toEqual(Array.from({ length: 55 }, (_, index) => index + 2))
    expect(result.beforeSha256).toBe(before)
    expect(sha(backupPath)).toBe(before)
    const current = new DatabaseSync(databasePath, { readOnly: true })
    expect(current.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_STORAGE_SCHEMA_VERSION })
    expect(authorityDocumentBytes(current).map).toBe(HISTORICAL_MAP_DOCUMENT)
    expect(current.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    current.close()

    copyFileSync(backupPath, databasePath)
    expect(sha(databasePath)).toBe(before)
    const restored = new DatabaseSync(databasePath, { readOnly: true })
    expect(restored.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(restored.prepare('SELECT document_json FROM maps WHERE slug = ?').get(HISTORICAL_MAP_SLUG)).toEqual({ document_json: HISTORICAL_MAP_DOCUMENT })
    restored.close()
  })

  it('leaves the original byte-exact on interruption and a rerun converges using the same backup', () => {
    const directory = root()
    const databasePath = join(directory, 'rotom-table.sqlite')
    const backupPath = join(directory, 'pre-upgrade.sqlite')
    createHead(databasePath, 28)
    const before = sha(databasePath)
    expectCode(() => upgradeCampaignDatabase({
      databasePath,
      backupPath,
      now: 101,
      hooks: { afterMigration: migration => { if (migration.version === 42) throw new Error('injected interruption') } },
    }), 'upgrade-failed')
    expect(sha(databasePath)).toBe(before)
    expect(sha(backupPath)).toBe(before)

    const result = upgradeCampaignDatabase({ databasePath, backupPath, now: 102 })
    expect(result.status).toBe('upgraded')
    expect(result.appliedVersions).toEqual(Array.from({ length: 28 }, (_, index) => index + 29))
    expect(upgradeCampaignDatabase({ databasePath, now: 103 }).status).toBe('already-current')
  })

  it('rejects non-database, corrupt, partial, future, read-only, sidecar, and locked inputs before writes', () => {
    const directory = root()

    const nonDatabase = join(directory, 'not-a-database.sqlite')
    writeFileSync(nonDatabase, 'not sqlite')
    const nonDatabaseBefore = sha(nonDatabase)
    expectCode(() => upgradeCampaignDatabase({ databasePath: nonDatabase }), 'input-not-sqlite')
    expect(sha(nonDatabase)).toBe(nonDatabaseBefore)

    const corrupt = join(directory, 'corrupt.sqlite')
    writeFileSync(corrupt, Buffer.concat([Buffer.from('SQLite format 3\0', 'binary'), Buffer.alloc(512, 0xff)]))
    const corruptBefore = sha(corrupt)
    expectCode(() => upgradeCampaignDatabase({ databasePath: corrupt }), 'input-corrupt')
    expect(sha(corrupt)).toBe(corruptBefore)

    const partial = join(directory, 'partial.sqlite')
    const partialConnection = new DatabaseSync(partial)
    partialConnection.exec('CREATE TABLE maps (slug TEXT PRIMARY KEY); PRAGMA user_version = 1')
    partialConnection.close()
    const partialBefore = sha(partial)
    expectCode(() => upgradeCampaignDatabase({ databasePath: partial }), 'input-partial')
    expect(sha(partial)).toBe(partialBefore)

    const unknownZero = join(directory, 'unknown-zero.sqlite')
    const unknownZeroConnection = new DatabaseSync(unknownZero)
    unknownZeroConnection.exec('CREATE TABLE unknown_authority (id TEXT PRIMARY KEY)')
    unknownZeroConnection.close()
    const unknownZeroBefore = sha(unknownZero)
    expectCode(() => upgradeCampaignDatabase({ databasePath: unknownZero }), 'input-unsupported-version')
    expect(sha(unknownZero)).toBe(unknownZeroBefore)

    const future = join(directory, 'future.sqlite')
    createHead(future, LATEST_STORAGE_SCHEMA_VERSION, false)
    const futureConnection = new DatabaseSync(future)
    futureConnection.exec(`PRAGMA user_version = ${LATEST_STORAGE_SCHEMA_VERSION + 1}`)
    futureConnection.close()
    const futureBefore = sha(future)
    expectCode(() => upgradeCampaignDatabase({ databasePath: future }), 'input-unsupported-version')
    expect(sha(future)).toBe(futureBefore)

    const readOnly = join(directory, 'read-only.sqlite')
    createHead(readOnly, 1)
    const readOnlyBefore = sha(readOnly)
    chmodSync(readOnly, 0o400)
    expectCode(() => upgradeCampaignDatabase({ databasePath: readOnly }), 'input-read-only')
    expect(sha(readOnly)).toBe(readOnlyBefore)
    chmodSync(readOnly, 0o600)

    const sidecar = join(directory, 'sidecar.sqlite')
    createHead(sidecar, 1)
    writeFileSync(`${sidecar}-wal`, 'present')
    const sidecarBefore = sha(sidecar)
    expectCode(() => upgradeCampaignDatabase({ databasePath: sidecar }), 'input-sidecars-present')
    expect(sha(sidecar)).toBe(sidecarBefore)

    const locked = join(directory, 'locked.sqlite')
    createHead(locked, 1)
    const lock = new DatabaseSync(locked)
    lock.exec('BEGIN EXCLUSIVE')
    const lockedBefore = sha(locked)
    expectCode(() => upgradeCampaignDatabase({ databasePath: locked }), 'input-locked')
    expect(sha(locked)).toBe(lockedBefore)
    lock.exec('ROLLBACK')
    lock.close()
  })
})
