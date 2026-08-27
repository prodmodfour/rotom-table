import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import { runAtomicJsonCampaignMigration } from '../../scripts/release-readiness/migrate-json-campaign'

const roots: string[] = []
const makeRoot = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'rotom-release-json-import-'))
  roots.push(path)
  return path
}
afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }) })
const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
const fixture = (): { campaignRoot: string; backupRoot: string; databasePath: string } => {
  const parent = makeRoot()
  const campaignRoot = join(parent, 'campaign')
  const backupRoot = join(parent, 'backups')
  const databasePath = join(campaignRoot, 'rotom-table.sqlite')
  writeJson(join(campaignRoot, 'data/maps/release-map.json'), {
    schemaVersion: 2,
    slug: 'release-map',
    name: 'Release JSON-era map',
    folder: '',
    revision: 3,
    updatedAt: 1_700_000_000_000,
    dimensions: { x: 1, y: 1, z: 1 },
    voxels: [],
    placements: [],
  })
  writeJson(join(campaignRoot, 'data/sheets/release-pokemon.json'), {
    slug: 'release-pokemon',
    nickname: 'Release Pokémon',
    revision: 2,
    updatedAt: 1_700_000_000_000,
  })
  return { campaignRoot, backupRoot, databasePath }
}

const envFor = (campaignRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ROTOM_CAMPAIGN_ROOT: campaignRoot,
  ROTOM_DB_PATH: 'rotom-table.sqlite',
})

describe('Plan 13 atomic JSON-era campaign import', () => {
  it('backs up, atomically imports to release schema, validates, and reruns without duplicate authority', () => {
    const { campaignRoot, backupRoot, databasePath } = fixture()
    const argv = ['--backup-root', backupRoot]
    const first = runAtomicJsonCampaignMigration({ argv, env: envFor(campaignRoot), now: new Date('2026-08-27T00:00:00.000Z') })
    expect(first.exitCode).toBe(0)
    expect(first.finalSchemaVersion).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    const connection = new DatabaseSync(databasePath)
    expect(connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_STORAGE_SCHEMA_VERSION })
    expect(connection.prepare("SELECT slug, revision FROM maps WHERE slug = 'release-map'").get()).toEqual({ slug: 'release-map', revision: 3 })
    expect(connection.prepare("SELECT kind, slug, revision FROM sheets WHERE slug = 'release-pokemon'").get()).toEqual({ kind: 'pokemon', slug: 'release-pokemon', revision: 3 })
    expect(connection.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    connection.prepare('PRAGMA journal_mode = DELETE').get()
    connection.close()

    const second = runAtomicJsonCampaignMigration({ argv, env: envFor(campaignRoot), now: new Date('2026-08-27T00:00:01.000Z') })
    expect(second.exitCode).toBe(0)
    expect(second.counts.skippedUnchanged).toBe(2)
    const backups = readdirSync(backupRoot).filter(name => name.startsWith('rotom-sqlite-migration-')).sort()
    expect(backups).toHaveLength(2)
    expect(existsSync(join(backupRoot, backups[1]!, 'campaign', 'rotom-table.sqlite'))).toBe(true)
  })

  it('rejects malformed roots and injected migration failures without a partial database', () => {
    const malformedParent = makeRoot()
    const malformedRoot = join(malformedParent, 'campaign')
    const malformedBackup = join(malformedParent, 'backups')
    mkdirSync(join(malformedRoot, 'data/maps'), { recursive: true })
    writeFileSync(join(malformedRoot, 'data/maps/bad.json'), '{broken')
    const malformed = runAtomicJsonCampaignMigration({
      argv: ['--backup-root', malformedBackup],
      env: envFor(malformedRoot),
      now: new Date('2026-08-27T00:01:00.000Z'),
    })
    expect(malformed.exitCode).toBe(1)
    expect(malformed.errors.join('\n')).toMatch(/not valid JSON/u)
    expect(existsSync(join(malformedRoot, 'rotom-table.sqlite'))).toBe(false)

    const { campaignRoot, backupRoot, databasePath } = fixture()
    expect(() => runAtomicJsonCampaignMigration({
      argv: ['--backup-root', backupRoot],
      env: envFor(campaignRoot),
      now: new Date('2026-08-27T00:02:00.000Z'),
      hooks: { afterMigration: migration => { if (migration.version === 42) throw new Error('injected JSON import interruption') } },
    })).toThrow('injected JSON import interruption')
    expect(existsSync(databasePath)).toBe(false)
    expect(readdirSync(campaignRoot).some(name => name.includes('.json-import-'))).toBe(false)
    expect(readdirSync(backupRoot).length).toBeGreaterThan(0)
    expect(readFileSync(join(campaignRoot, 'data/maps/release-map.json'), 'utf8')).toContain('Release JSON-era map')
  })
})
