import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const scriptPath = resolve(repoRoot, 'scripts/migrate-campaign-to-sqlite.mjs')
const tempRoots: string[] = []
const openDatabases: RotomDatabase[] = []

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-sqlite-migration-'))
  tempRoots.push(root)
  return root
}

const mapDocument = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'training-yard',
  name: 'Training Yard',
  folder: '',
  revision: 0,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  ...overrides,
})

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const emptyGroupInventory = (): GroupInventoryDocument['inventory'] => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as unknown as GroupInventoryDocument['inventory']

const makeFixtureCampaign = (): string => {
  const parent = makeTempRoot()
  const campaignRoot = join(parent, 'campaign')

  writeJson(join(campaignRoot, 'data/maps/region-one/training-yard.json'), {
    ...mapDocument({ revision: undefined }),
    folder: 'document-folder-is-ignored',
  })
  writeJson(join(campaignRoot, 'data/sheets/party/pikachu.json'), {
    slug: 'pikachu',
    nickname: 'Pika',
    revision: 6,
    updatedAt: 1_700_000_000_600,
  })
  writeJson(join(campaignRoot, 'data/trainers/brock.json'), {
    name: 'Brock',
  })
  writeJson(join(campaignRoot, 'data/group-inventories/main.json'), {
    slug: GROUP_INVENTORY_MAIN_SLUG,
    revision: 7,
    updatedAt: 1_700_000_000_900,
    money: 1200,
    notes: 'Shared stash',
    inventory: {
      ...emptyGroupInventory(),
      pokemonItems: [{ id: 'group-item-potion', name: 'Potion', qty: 5 }],
    },
  })
  writeJson(join(campaignRoot, 'data/shops/city/potion-mart.json'), {
    slug: 'potion-mart',
    revision: 3,
    updatedAt: 1_700_000_001_000,
    name: 'Potion Mart',
    playerVisible: true,
    open: true,
    allowedPaymentSources: ['trainer'],
    allowedDeliveryTargets: ['trainer'],
    entries: [{ id: 'potion-row', itemName: 'Potion', section: 'medicalKit', price: 300, stock: 5 }],
  })
  writeJson(join(campaignRoot, 'data/player-profiles/profile_ash00000.json'), {
    schemaVersion: 1,
    id: 'profile_ash00000',
    displayName: 'Ash',
    linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
  })

  return campaignRoot
}

const migrationEnv = (campaignRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ROTOM_CAMPAIGN_ROOT: campaignRoot,
  ROTOM_DB_PATH: 'rotom-table.sqlite',
})

const runMigration = (campaignRoot: string) => spawnSync(process.execPath, [scriptPath], {
  cwd: repoRoot,
  env: migrationEnv(campaignRoot),
  encoding: 'utf8',
})

const openDatabase = (campaignRoot: string): RotomDatabase => {
  const database = openRotomDatabase({ path: join(campaignRoot, 'rotom-table.sqlite') })
  openDatabases.push(database)
  return database
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite campaign migration script', () => {
  it('backs up a fixture campaign, imports maps and sheets, validates loads, and is idempotent', async () => {
    const campaignRoot = makeFixtureCampaign()

    const first = runMigration(campaignRoot)
    expect(first.status, first.stderr || first.stdout).toBe(0)
    expect(first.stdout).toContain('Maps imported: 1')
    expect(first.stdout).toContain('Sheets imported: 2')
    expect(first.stdout).toContain('Group inventories imported: 1')
    expect(first.stdout).toContain('Skipped unchanged: 0')
    expect(first.stdout).toContain('Player profiles validated: 1')
    expect(first.stdout).toContain('Validation: loaded 1 maps, 2 sheets, and 1 group inventories from SQLite')
    expect(first.stdout).toContain('Errors: 0')

    const backupRoot = join(dirname(campaignRoot), 'backups')
    const backupNames = readdirSync(backupRoot).filter((name) => name.startsWith('rotom-sqlite-migration-'))
    expect(backupNames).toHaveLength(1)
    const backupPath = join(backupRoot, backupNames[0])
    expect(existsSync(join(backupPath, 'manifest.json'))).toBe(true)
    expect(existsSync(join(backupPath, 'campaign/data/maps/region-one/training-yard.json'))).toBe(true)
    expect(existsSync(join(backupPath, 'campaign/data/group-inventories/main.json'))).toBe(true)
    expect(existsSync(join(backupPath, 'campaign/data/shops/city/potion-mart.json'))).toBe(true)
    expect(existsSync(join(backupPath, 'campaign/data/player-profiles/profile_ash00000.json'))).toBe(true)

    const migratedConnection = new DatabaseSync(join(campaignRoot, 'rotom-table.sqlite'))
    expect(migratedConnection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 27 })
    for (const table of [
      'pending_move_resolutions',
      'encounter_documents',
      'encounter_director_ops',
      'encounter_launch_ops',
      'encounter_ux_metric_aggregates',
      'breeding_incubation_segments',
      'trainer_species_acquisition_source_operations',
    ]) {
      expect(migratedConnection.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `).get(table)).toEqual({ name: table })
    }
    migratedConnection.close()

    const database = openDatabase(campaignRoot)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const groupInventories = createSqliteGroupInventoryRepository(database)

    expect(maps.getBySlug('training-yard')).toMatchObject({
      slug: 'training-yard',
      folder: 'region-one',
      revision: 0,
      updatedAt: 1_700_000_000_500,
    })
    expect(sheets.getByRef('pokemon', 'pikachu')).toMatchObject({
      kind: 'pokemon',
      slug: 'pikachu',
      revision: 6,
      sheet: { slug: 'pikachu', nickname: 'Pika', revision: 6, updatedAt: 1_700_000_000_600 },
    })
    expect(sheets.getByRef('trainer', 'brock')).toMatchObject({
      kind: 'trainer',
      slug: 'brock',
      revision: 0,
      sheet: { slug: 'brock', name: 'Brock', revision: 0 },
    })
    expect(groupInventories.get(GROUP_INVENTORY_MAIN_SLUG)?.document).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 7,
      updatedAt: 1_700_000_000_900,
      money: 1200,
      notes: 'Shared stash',
      inventory: {
        pokemonItems: [{ id: 'group-item-potion', name: 'Potion', qty: 5 }],
      },
    })

    const second = runMigration(campaignRoot)
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(second.stdout).toContain('Maps imported: 0')
    expect(second.stdout).toContain('Sheets imported: 0')
    expect(second.stdout).toContain('Group inventories imported: 0')
    expect(second.stdout).toContain('Skipped unchanged: 4')
    expect(second.stdout).toContain('Errors: 0')
  })

  it('refuses to run without an explicit campaign root or with a missing campaign path', () => {
    const { ROTOM_CAMPAIGN_ROOT: _campaignRoot, ROTOM_DB_PATH: _dbPath, ...env } = process.env
    const missingEnv = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    })

    expect(missingEnv.status).toBe(2)
    expect(missingEnv.stderr).toContain('ROTOM_CAMPAIGN_ROOT must be set')

    const missingRoot = join(makeTempRoot(), 'does-not-exist')
    const missingPath = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: migrationEnv(missingRoot),
      encoding: 'utf8',
    })

    expect(missingPath.status).toBe(2)
    expect(missingPath.stderr).toContain('ROTOM_CAMPAIGN_ROOT does not exist')
  })

  it('refuses to place private campaign migration output in the app checkout', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: migrationEnv(repoRoot),
      encoding: 'utf8',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('must not be inside the Rotom Table app checkout')
  })

  it('exposes the operator command through npm scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['migrate:sqlite']).toBe('node scripts/migrate-campaign-to-sqlite.mjs')
  })
})
