import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import type { TabletopMap } from '~/types/map'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const scriptPath = resolve(repoRoot, 'scripts/export-sqlite-json.mjs')
const tempRoots: string[] = []
const openDatabases: RotomDatabase[] = []

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-sqlite-export-'))
  tempRoots.push(root)
  return root
}

const mapDocument = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  folder: 'region/one',
  revision: 3,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: { exported: true },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  ...overrides,
})

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

const seedCampaignDatabase = (campaignRoot: string): void => {
  const database = openRotomDatabase({ path: join(campaignRoot, 'rotom-table.sqlite') })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

  maps.createFolder('empty/nested')
  maps.saveSetupMap(mapDocument())
  sheets.createFolder('pokemon', 'bench/empty')
  sheets.saveSetupSheet('pokemon', 'pika', {
    slug: 'pika',
    nickname: 'Pika',
    species: 'Pikachu',
    folder: 'party',
    revision: 4,
    updatedAt: 1_700_000_000_600,
  })
  sheets.saveSetupSheet('trainer', 'brock', {
    slug: 'brock',
    name: 'Brock',
    folder: 'npcs',
    revision: 2,
    updatedAt: 1_700_000_000_700,
  })
  database.close()
  openDatabases.pop()
}

const exportEnv = (campaignRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ROTOM_CAMPAIGN_ROOT: campaignRoot,
  ROTOM_DB_PATH: 'rotom-table.sqlite',
})

const runExport = (campaignRoot: string, output: string, extraArgs: string[] = []) => spawnSync(
  process.execPath,
  [scriptPath, '--output', output, ...extraArgs],
  { cwd: repoRoot, env: exportEnv(campaignRoot), encoding: 'utf8' },
)

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite JSON export script', () => {
  it('exports maps, sheets, trainers, and empty folders to the legacy hierarchy', () => {
    const root = makeTempRoot()
    const campaignRoot = join(root, 'campaign')
    seedCampaignDatabase(campaignRoot)
    const output = join(root, 'export')

    const result = runExport(campaignRoot, output)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('Maps exported: 1')
    expect(result.stdout).toContain('Pokémon sheets exported: 1')
    expect(result.stdout).toContain('Trainer sheets exported: 1')

    expect(existsSync(join(output, 'data/maps/empty/nested'))).toBe(true)
    expect(existsSync(join(output, 'data/sheets/bench/empty'))).toBe(true)

    expect(readJson(join(output, 'data/maps/region/one/arena.json'))).toMatchObject({
      slug: 'arena',
      folder: 'region/one',
      revision: 3,
      updatedAt: 1_700_000_000_500,
    })
    expect(readJson(join(output, 'data/sheets/party/pika.json'))).toMatchObject({
      slug: 'pika',
      folder: 'party',
      revision: 4,
    })
    expect(readJson(join(output, 'data/trainers/npcs/brock.json'))).toMatchObject({
      slug: 'brock',
      folder: 'npcs',
      revision: 2,
    })
  })

  it('refuses surprising overwrites unless --force is passed', () => {
    const root = makeTempRoot()
    const campaignRoot = join(root, 'campaign')
    seedCampaignDatabase(campaignRoot)
    const output = join(root, 'export')
    mkdirSync(output, { recursive: true })

    const refused = runExport(campaignRoot, output)
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('output already exists')

    const forced = runExport(campaignRoot, output, ['--force'])
    expect(forced.status, forced.stderr || forced.stdout).toBe(0)
    expect(existsSync(join(output, 'data/maps/region/one/arena.json'))).toBe(true)
  })
})
