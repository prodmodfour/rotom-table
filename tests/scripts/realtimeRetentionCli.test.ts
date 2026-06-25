import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const scriptPath = resolve(repoRoot, 'scripts/realtime-retention.mjs')
const tempRoots: string[] = []
const openDatabases: RotomDatabase[] = []

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-realtime-retention-cli-'))
  tempRoots.push(root)
  return root
}

const seedDatabase = (campaignRoot: string): string => {
  const databasePath = join(campaignRoot, 'rotom-table.sqlite')
  const database = openRotomDatabase({ path: databasePath })
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_700_000_000_000 })
  realtime.appendMany([
    {
      event: { channel: 'maps', type: 'updated', data: { privatePayload: 'secret-payload-one' } },
      access: { kind: 'gm-only' },
      dedupeKey: 'secret-one',
    },
    {
      event: { channel: 'maps', type: 'updated', data: { privatePayload: 'secret-payload-two' } },
      access: { kind: 'gm-only' },
    },
    {
      event: { channel: 'maps', type: 'updated', data: { privatePayload: 'secret-payload-three' } },
      access: { kind: 'gm-only' },
    },
  ])
  database.close()
  return databasePath
}

const cliEnv = (campaignRoot: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_OPTIONS: '--no-warnings',
  ROTOM_CAMPAIGN_ROOT: campaignRoot,
  ROTOM_DB_PATH: 'rotom-table.sqlite',
  ROTOM_REALTIME_EVENT_MAX_ROWS: '2',
  ROTOM_REALTIME_EVENT_RETENTION_DAYS: '3650',
  ...extra,
})

const runCli = (campaignRoot: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) => spawnSync(
  process.execPath,
  [scriptPath, ...args],
  { cwd: repoRoot, env: cliEnv(campaignRoot, extraEnv), encoding: 'utf8' },
)

const retainedSequences = (databasePath: string): number[] => {
  const database = openRotomDatabase({ path: databasePath })
  openDatabases.push(database)
  const realtime = createSqliteRealtimeEventRepository({ database })
  const state = realtime.cursorState()
  return realtime.readAfter({ afterSequence: state.earliestAvailableSequence - 1, limit: 10 })
    .events.map((event) => event.sequence)
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('realtime retention operator CLI', () => {
  it('prints status without event payloads or access metadata', () => {
    const root = makeTempRoot()
    const databasePath = seedDatabase(root)

    const result = runCli(root, ['status'])

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain(`Database path: ${databasePath}`)
    expect(result.stdout).toContain('Journal mode: wal')
    expect(result.stdout).toContain('Cursor state: latest=3 earliest=1')
    expect(result.stdout).toContain('Retained row count: 3')
    expect(result.stdout).toContain('Retention enabled: true')
    expect(result.stdout).toContain('Maximum rows: 2')
    expect(result.stdout).toContain('Planned cutoff sequence: 1')
    expect(result.stdout).not.toContain('secret-payload')
    expect(result.stdout).not.toContain('gm-only')
  })

  it('dry-runs without changing the database', () => {
    const root = makeTempRoot()
    const databasePath = seedDatabase(root)

    const result = runCli(root, ['prune', '--dry-run'])

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('Dry run: no changes applied')
    expect(retainedSequences(databasePath)).toEqual([1, 2, 3])
  })

  it('requires an explicit apply flag and then deletes expected rows', () => {
    const root = makeTempRoot()
    const databasePath = seedDatabase(root)

    const refused = runCli(root, ['prune'])
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('prune requires exactly one of --dry-run or --apply')
    expect(retainedSequences(databasePath)).toEqual([1, 2, 3])
    while (openDatabases.length > 0) openDatabases.pop()?.close()

    const applied = runCli(root, ['prune', '--apply'])
    expect(applied.status, applied.stderr || applied.stdout).toBe(0)
    expect(applied.stdout).toContain('Deleted rows: 1')
    expect(applied.stdout).toContain('Current earliest sequence: 2')
    expect(retainedSequences(databasePath)).toEqual([2, 3])
  })

  it('exits non-zero for invalid retention configuration', () => {
    const root = makeTempRoot()
    seedDatabase(root)

    const result = runCli(root, ['status'], { ROTOM_REALTIME_EVENT_MAX_ROWS: '0' })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid realtime event retention configuration')
  })
})
