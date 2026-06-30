import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
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

const emptyGroupInventory = (): GroupInventoryDocument['inventory'] => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as unknown as GroupInventoryDocument['inventory']

const seedCampaignDatabase = (campaignRoot: string): void => {
  const database = openRotomDatabase({ path: join(campaignRoot, 'rotom-table.sqlite') })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const groupInventories = createSqliteGroupInventoryRepository(database)
  const realtimeEvents = createSqliteRealtimeEventRepository({ database, clock: () => 1_700_000_000_800 })
  const shops = createSqliteShopTableRepository(database)

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
  groupInventories.save({
    slug: GROUP_INVENTORY_MAIN_SLUG,
    revision: 7,
    updatedAt: 1_700_000_000_900,
    document: {
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 7,
      updatedAt: 1_700_000_000_900,
      money: 1200,
      notes: 'Shared stash',
      inventory: {
        ...emptyGroupInventory(),
        pokemonItems: [{ id: 'group-item-potion', name: 'Potion', qty: 5 }],
      },
    },
  })
  shops.create({
    slug: 'potion-mart',
    now: 1_700_000_001_000,
    document: {
      name: 'Potion Mart',
      folder: 'city/shops',
      playerVisible: true,
      open: true,
      allowedPaymentSources: ['trainer', 'groupInventory'],
      allowedDeliveryTargets: ['trainer'],
      entries: [{
        id: 'potion-row',
        itemName: 'Potion',
        section: 'medicalKit',
        price: 300,
        stock: 5,
        maxPerPurchase: 2,
        playerDescription: 'Restores HP.',
        gmNotes: 'Wholesale stock.',
        tags: ['medicine'],
      }],
      gmNotes: 'Restock between sessions.',
    },
  })
  realtimeEvents.append({
    event: { channel: 'maps', type: 'updated', data: { export: 'event-log-only' } },
    access: { kind: 'gm-only' },
    dedupeKey: 'export-ignored-event',
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
  it('exports maps, sheets, trainers, shops, group inventories, and empty folders to the maintenance hierarchy', () => {
    const root = makeTempRoot()
    const campaignRoot = join(root, 'campaign')
    seedCampaignDatabase(campaignRoot)
    const output = join(root, 'export')

    const result = runExport(campaignRoot, output)
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('Maps exported: 1')
    expect(result.stdout).toContain('Pokémon sheets exported: 1')
    expect(result.stdout).toContain('Trainer sheets exported: 1')
    expect(result.stdout).toContain('Group inventories exported: 1')
    expect(result.stdout).toContain('Shops exported: 1')

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
    expect(readJson(join(output, 'data/group-inventories/main.json'))).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 7,
      updatedAt: 1_700_000_000_900,
      money: 1200,
      inventory: {
        pokemonItems: [{ id: 'group-item-potion', name: 'Potion', qty: 5 }],
      },
    })
    expect(readJson(join(output, 'data/shops/city/shops/potion-mart.json'))).toMatchObject({
      slug: 'potion-mart',
      folder: 'city/shops',
      revision: 0,
      updatedAt: 1_700_000_001_000,
      name: 'Potion Mart',
      playerVisible: true,
      open: true,
      entries: [{
        id: 'potion-row',
        itemName: 'Potion',
        section: 'medicalKit',
        price: 300,
        stock: 5,
        maxPerPurchase: 2,
      }],
    })
    expect(existsSync(join(output, 'realtime_events.json'))).toBe(false)
    expect(readFileSync(join(output, 'data/maps/region/one/arena.json'), 'utf8')).not.toContain('event-log-only')
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
