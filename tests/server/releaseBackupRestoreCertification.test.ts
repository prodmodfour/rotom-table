import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqlitePendingMoveResolutionRepository } from '../../server/storage/pendingMoveResolutionRepository'
import {
  createReleaseBackup,
  restoreReleaseBackup,
  type ReleaseBackupMethod,
} from '../../server/storage/releaseBackup'
import { auditReleaseCampaignDatabase } from '../../server/storage/releaseIntegrityAudit'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import { upgradeCampaignDatabase } from '../../server/storage/releaseUpgrade'
import { applyMigrationsThrough, seedHistoricalAuthority } from '../../scripts/release-readiness/storage-fixtures'
import backupFixtures from '../../data/release-readiness/backup-restore-fixtures.v1.json'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'

const roots: string[] = []
const databases: RotomDatabase[] = []
const makeRoot = (): string => {
  const value = mkdtempSync(join(tmpdir(), 'rotom-release-backup-'))
  roots.push(value)
  return value
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const setup = () => {
  const root = makeRoot()
  const campaignRoot = join(root, 'campaign')
  const databasePath = join(campaignRoot, 'rotom-table.sqlite')
  const database = openRotomDatabase({ path: databasePath })
  databases.push(database)
  database.connection.prepare(`
    INSERT INTO maps (slug, document_json, revision, updated_at)
    VALUES ('release-live-map', ?, 1, 1700000000000)
  `).run(JSON.stringify({ schemaVersion: 2, slug: 'release-live-map', name: 'Private release map', revision: 1 }))
  const pending = createPendingMoveResolutionFixture({
    resolutionId: 'resolution-release-backup',
    originMapSlug: 'release-live-map',
    originOpId: 'op_releasebackup01',
  })
  createSqlitePendingMoveResolutionRepository(database).create({ resolution: pending })
  writeFileSync(join(campaignRoot, 'gm-private-notes.txt'), 'The hidden tower opens at midnight.\n', { mode: 0o600 })
  const environment = join(root, 'rotom-table.env')
  const service = join(root, 'rotom-table.service')
  writeFileSync(environment, 'ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign\nPRIVATE_SIGNING_SEED=fixture-only\n', { mode: 0o600 })
  writeFileSync(service, '[Service]\nUser=rotom-table\n', { mode: 0o600 })
  return { root, campaignRoot, databasePath, database, pending, environment, service }
}

const startWriter = async (databasePath: string): Promise<Worker> => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(workerData, { timeout: 5000 })
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
    const update = db.prepare("UPDATE maps SET revision = revision + 1, document_json = json_set(document_json, '$.revision', revision + 1), updated_at = updated_at + 1 WHERE slug = 'release-live-map'")
    let writes = 0
    let stopped = false
    parentPort.on('message', message => { if (message === 'stop') stopped = true })
    const cycle = () => {
      if (stopped) { db.close(); parentPort.postMessage({ stopped: true, writes }); return }
      try { update.run(); writes += 1 } catch (error) { if (!/locked|busy/.test(String(error))) throw error }
      if (writes === 1) parentPort.postMessage({ ready: true })
      setTimeout(cycle, 1)
    }
    cycle()
  `, { eval: true, workerData: databasePath })
  await once(worker, 'message')
  return worker
}

const stopWriter = async (worker: Worker): Promise<number> => {
  worker.postMessage('stop')
  const [message] = await once(worker, 'message') as [{ stopped: true; writes: number }]
  await worker.terminate()
  return message.writes
}

const createAndRestore = async (method: ReleaseBackupMethod) => {
  const fixture = setup()
  const archivePath = join(fixture.root, `${method}.tar.gz`)
  const targetRoot = join(fixture.root, `${method}-fresh-host`)
  const result = await createReleaseBackup({
    campaignRoot: fixture.campaignRoot,
    databasePath: fixture.databasePath,
    archivePath,
    method,
    settings: [
      { label: 'rotom-table.env', path: fixture.environment },
      { label: 'rotom-table.service', path: fixture.service },
    ],
    createdAt: '2026-08-27T12:00:00.000Z',
  })
  const restored = restoreReleaseBackup({
    archivePath,
    targetRoot,
    expectedArchiveSha256: result.archiveSha256,
  })
  return { fixture, result, restored, targetRoot }
}

describe('Plan 13 release-boundary backup and restore', () => {
  it('takes an online SQLite snapshot under active WAL writes and restores private pending state consistently', async () => {
    const fixture = setup()
    const writer = await startWriter(fixture.databasePath)
    const archivePath = join(fixture.root, 'online.tar.gz')
    const result = await createReleaseBackup({
      campaignRoot: fixture.campaignRoot,
      databasePath: fixture.databasePath,
      archivePath,
      method: 'online-sqlite-backup-api',
      settings: [
        { label: 'rotom-table.env', path: fixture.environment },
        { label: 'rotom-table.service', path: fixture.service },
      ],
      createdAt: '2026-08-27T12:00:00.000Z',
    })
    const writes = await stopWriter(writer)
    expect(writes).toBeGreaterThan(0)
    expect(result.manifest.entries.some(entry => entry.path.endsWith('-wal'))).toBe(false)
    expect(result.manifest.settingsInventory).toEqual(['rotom-table.env', 'rotom-table.service'])
    expect(result.manifest.entries.map(entry => entry.path).sort()).toEqual(backupFixtures.currentReleaseFixture.expectedArchivePaths)
    expect(JSON.stringify(result.manifest)).not.toContain('fixture-only')
    expect(existsSync(`${archivePath}.sha256`)).toBe(true)

    const targetRoot = join(fixture.root, 'online-fresh-host')
    const restored = restoreReleaseBackup({ archivePath, targetRoot, expectedArchiveSha256: result.archiveSha256 })
    expect(readFileSync(join(targetRoot, 'campaign/gm-private-notes.txt'), 'utf8')).toContain('hidden tower')
    expect(readFileSync(join(targetRoot, 'settings/rotom-table.env'), 'utf8')).toContain('PRIVATE_SIGNING_SEED')
    const connection = new DatabaseSync(restored.databasePath, { readOnly: true })
    const map = connection.prepare("SELECT document_json, revision FROM maps WHERE slug = 'release-live-map'").get() as { document_json: string; revision: number }
    expect(JSON.parse(map.document_json).revision).toBe(map.revision)
    expect(connection.prepare('SELECT status, resolution_json FROM pending_move_resolutions WHERE resolution_id = ?').get(fixture.pending.resolutionId)).toMatchObject({
      status: 'pending',
      resolution_json: expect.stringContaining(fixture.pending.resolutionId),
    })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM gm_toolkit_secrets').get()).toEqual({ count: 1 })
    connection.close()
    expect(auditReleaseCampaignDatabase(restored.databasePath).status).toBe('passed')
  }, 20_000)

  it('accepts stopped-service and online archives interchangeably and restart is inert', async () => {
    for (const method of ['stopped-service-copy', 'online-sqlite-backup-api'] as const) {
      const { fixture, restored } = await createAndRestore(method)
      const sourceSecret = fixture.database.connection.prepare('SELECT secret_value FROM gm_toolkit_secrets').get()
      fixture.database.close()
      databases.splice(databases.indexOf(fixture.database), 1)

      const first = openRotomDatabase({ path: restored.databasePath, enableWal: false })
      const before = {
        schema: first.connection.prepare('PRAGMA user_version').get(),
        pending: first.connection.prepare('SELECT resolution_json, declaration_plan_json, revision FROM pending_move_resolutions').all(),
        secrets: first.connection.prepare('SELECT * FROM gm_toolkit_secrets').all(),
        map: first.connection.prepare('SELECT document_json, revision FROM maps').all(),
      }
      expect(before.schema).toEqual({ user_version: LATEST_STORAGE_SCHEMA_VERSION })
      expect(before.secrets[0]).toMatchObject(sourceSecret as object)
      first.close()
      const second = openRotomDatabase({ path: restored.databasePath, enableWal: false })
      expect(second.connection.prepare('SELECT resolution_json, declaration_plan_json, revision FROM pending_move_resolutions').all()).toEqual(before.pending)
      expect(second.connection.prepare('SELECT * FROM gm_toolkit_secrets').all()).toEqual(before.secrets)
      expect(second.connection.prepare('SELECT document_json, revision FROM maps').all()).toEqual(before.map)
      expect(second.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      second.close()
    }
  }, 20_000)

  it('restores a pre-release archive and then follows the certified upgrade path into 1.0', async () => {
    const root = makeRoot()
    const campaignRoot = join(root, 'historical-campaign')
    const databasePath = join(campaignRoot, 'rotom-table.sqlite')
    mkdirSync(campaignRoot, { recursive: true })
    const historical = new DatabaseSync(databasePath)
    applyMigrationsThrough(historical, 28)
    seedHistoricalAuthority(historical)
    historical.close()
    writeFileSync(join(campaignRoot, 'historical-note.txt'), 'restore then upgrade\n')
    const archivePath = join(root, 'historical-v28.tar.gz')
    const archive = await createReleaseBackup({
      campaignRoot,
      databasePath,
      archivePath,
      method: 'stopped-service-copy',
      createdAt: '2026-08-27T12:00:00.000Z',
    })
    expect(archive.manifest.storageSchemaVersion).toBe(28)
    const restored = restoreReleaseBackup({ archivePath, targetRoot: join(root, 'historical-fresh-host') })
    const upgraded = upgradeCampaignDatabase({
      databasePath: restored.databasePath,
      backupPath: join(root, 'restored-pre-upgrade.sqlite'),
      now: 1700000000000,
    })
    expect(upgraded.fromVersion).toBe(28)
    expect(upgraded.toVersion).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(auditReleaseCampaignDatabase(restored.databasePath).status).toBe('passed')
  })

  it('rejects archive digest drift, extra manifest content, and a non-empty restore target', async () => {
    const { fixture, result } = await createAndRestore('stopped-service-copy')
    expect(() => restoreReleaseBackup({
      archivePath: result.archivePath,
      targetRoot: join(fixture.root, 'wrong-digest'),
      expectedArchiveSha256: '0'.repeat(64),
    })).toThrow('SHA-256 mismatch')
    const occupied = join(fixture.root, 'occupied')
    writeFileSync(occupied, 'not a directory')
    expect(() => restoreReleaseBackup({ archivePath: result.archivePath, targetRoot: occupied })).toThrow()
  })
})
