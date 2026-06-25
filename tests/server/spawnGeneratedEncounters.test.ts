import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  spawnGeneratedEncountersUseCase,
  type SpawnGeneratedEncountersDependencies,
} from '~~/server/useCases/spawnGeneratedEncounters'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { EncounterTable } from '~/types/encounterTable'

const databases: RotomDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

const table: EncounterTable = {
  name: 'Pond',
  min_level: 5,
  max_level: 5,
  entries: [{ weight: 1, species: 'Bulbasaur' }],
}

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'pond-map',
  name: 'Pond Map',
  folder: '',
  dimensions: { x: 3, y: 2, z: 3 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [{ x: 2, y: 0, z: 2, materialId: 'shallow_water' }],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  createdAt: 10,
  updatedAt: 10,
  ...overrides,
})

const generatedSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'wild-pond-1-bulbasaur-lv5-1',
  nickname: 'Bulbasaur',
  species: 'Bulbasaur',
  level: 5,
  capabilities: { overland: 2, swim: 6 },
  stats: {},
  ...overrides,
} as CharacterSheet)

const sequenceRandom = (...values: number[]) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const createHarness = (overrides: Partial<SpawnGeneratedEncountersDependencies> = {}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database, maps)
  const modes = createSqliteMapInteractionModeRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 99_999 })
  const published: PersistedRealtimeEvent[] = []
  const writeTextFile = vi.fn(() => { throw new Error('spawn must not write generated JSON files') })
  const runPokegenSheet = vi.fn(async (_species: string, _level: number, slugPrefix: string, sequence: number) => ({
    ok: true,
    stderr: '',
    content: JSON.stringify(generatedSheet({ slug: `${slugPrefix}-bulbasaur-lv5-${sequence}` })),
  }))
  const placementIds = ['spawn-1', 'spawn-2', 'spawn-3']
  let placementIndex = 0

  maps.create({ slug: 'pond-map', map: mapFixture(), now: 10 })
  modes.set({ slug: 'pond-map', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 11 })

  const dependencies: SpawnGeneratedEncountersDependencies = {
    database,
    mapRepository: maps,
    sheetRepository: sheets,
    mapInteractionModeRepository: modes,
    realtimeEventRepository: realtime,
    projectRoot: '/repo',
    encounterRoot: '/repo/encounter_tables',
    now: () => 111,
    random: sequenceRandom(0, 0, 0, 0, 0),
    pathExists: (path) => path === '/repo/encounter_tables/vale/pond.json',
    readTextFile: (path) => {
      if (path.endsWith('/pond.json')) return JSON.stringify(table)
      throw new Error(`unexpected runtime file read: ${path}`)
    },
    writeTextFile,
    listDirectory: vi.fn(() => { throw new Error('spawn must not inspect generated JSON directories') }),
    ensureDirectory: vi.fn(() => { throw new Error('spawn must not create generated JSON directories') }),
    makeTempDir: vi.fn(() => { throw new Error('spawn must not use export temp directories') }),
    cleanupDirectory: vi.fn(),
    uniqueOutputDir: (parent, baseName) => `${parent}/${baseName}`,
    runPokegen: vi.fn(async () => { throw new Error('spawn must use in-memory pokegen') }),
    runPokegenSheet,
    createPlacementId: () => placementIds[placementIndex++] ?? `spawn-${placementIndex}`,
    publishPersistedRealtimeEvent: (event) => published.push(event),
    ...overrides,
  }

  return { database, maps, sheets, modes, realtime, published, dependencies, writeTextFile, runPokegenSheet }
}

const spawnBody = {
  region: 'vale',
  table: 'pond',
  count: 1,
  outRoot: 'data/sheets/wild',
  mapSlug: 'pond-map',
  clientId: 'client-1',
}

describe('spawnGeneratedEncountersUseCase', () => {
  it('uses in-memory generated sheets and atomically commits sheets, placements, folders, and durable events', async () => {
    const { dependencies, sheets, maps, realtime, published, writeTextFile, runPokegenSheet } = createHarness()

    const result = await spawnGeneratedEncountersUseCase(spawnBody, dependencies)

    expect(runPokegenSheet).toHaveBeenCalledWith('Bulbasaur', 5, 'wild-pond-1', 1)
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.relDir).toBe('data/sheets/wild/pond_1')
    expect(result.spawn).toMatchObject({
      mapSlug: 'pond-map',
      mapName: 'Pond Map',
      spawned: 1,
      failures: 0,
      placements: [{
        slug: 'wild-pond-1-bulbasaur-lv5-1',
        placementId: 'spawn-1',
        position: { x: 2, y: 0, z: 2 },
      }],
    })

    const sheet = sheets.getByRef('pokemon', 'wild-pond-1-bulbasaur-lv5-1')
    expect(sheet?.revision).toBe(0)
    expect(sheet?.sheet).toMatchObject({
      slug: 'wild-pond-1-bulbasaur-lv5-1',
      folder: 'wild/pond_1',
      updatedAt: 111,
      skillBackground: expect.objectContaining({ description: expect.any(String) }),
    })
    expect(sheets.listFolders('pokemon')).toContain('wild/pond_1')

    const map = maps.getBySlug('pond-map')!
    expect(map.revision).toBe(1)
    expect(map.placements).toEqual([{ id: 'spawn-1', sheetKind: 'pokemon', sheetSlug: 'wild-pond-1-bulbasaur-lv5-1', position: { x: 2, y: 0, z: 2 }, facing: 'south-east', turned: false }])
    expect(result.realtimeEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual([
      'sheet:pokemon:wild-pond-1-bulbasaur-lv5-1',
      'sheets',
      'map:pond-map',
      'maps',
    ])
    expect(result.realtimeEvents.slice(0, 2).every((event) => event.access.kind === 'sheet-access')).toBe(true)
    expect(result.realtimeEvents.slice(2).every((event) => event.access.kind === 'map-access')).toBe(true)
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('allocates final slugs safely when generated slugs collide and uses final slugs in placements', async () => {
    const { dependencies, sheets, maps } = createHarness()
    sheets.saveSetupSheet('pokemon', 'wild-pond-1-bulbasaur-lv5-1', generatedSheet({ slug: 'wild-pond-1-bulbasaur-lv5-1', revision: 5 }) as unknown as Record<string, unknown>)

    const result = await spawnGeneratedEncountersUseCase(spawnBody, dependencies)

    expect(sheets.getByRef('pokemon', 'wild-pond-1-bulbasaur-lv5-1')?.revision).toBe(5)
    expect(sheets.getByRef('pokemon', 'wild-pond-1-bulbasaur-lv5-1-1')?.sheet.slug).toBe('wild-pond-1-bulbasaur-lv5-1-1')
    expect(result.spawn.placements[0]?.slug).toBe('wild-pond-1-bulbasaur-lv5-1-1')
    expect(maps.getBySlug('pond-map')?.placements[0]?.sheetSlug).toBe('wild-pond-1-bulbasaur-lv5-1-1')
  })

  it('rolls back generated sheets when the map update fails', async () => {
    const { dependencies, sheets, maps, realtime, database } = createHarness()
    const failingMapRepository = {
      database,
      getBySlug: maps.getBySlug,
      replaceSetupMap: vi.fn(() => { throw new Error('map write failed') }),
    }

    await expect(spawnGeneratedEncountersUseCase(spawnBody, {
      ...dependencies,
      mapRepository: failingMapRepository,
    })).rejects.toThrow('map write failed')

    expect(sheets.list('pokemon')).toEqual([])
    expect(maps.getBySlug('pond-map')?.revision).toBe(0)
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })

  it('rolls back the map update when a generated sheet insert fails', async () => {
    const { dependencies, sheets, maps, database } = createHarness()
    const failingSheets = {
      database,
      list: sheets.list,
      listFolders: sheets.listFolders,
      getByRef: sheets.getByRef,
      saveSetupSheet: vi.fn(() => { throw new Error('sheet insert failed') }),
    }

    await expect(spawnGeneratedEncountersUseCase(spawnBody, {
      ...dependencies,
      sheetRepository: failingSheets,
    })).rejects.toThrow('sheet insert failed')

    expect(maps.getBySlug('pond-map')?.revision).toBe(0)
    expect(maps.getBySlug('pond-map')?.placements).toEqual([])
    expect(sheets.list('pokemon')).toEqual([])
  })

  it('rolls back sheets and map placements when durable event append fails', async () => {
    const { dependencies, sheets, maps, database } = createHarness()

    await expect(spawnGeneratedEncountersUseCase(spawnBody, {
      ...dependencies,
      realtimeEventRepository: { database, appendMany: vi.fn(() => { throw new Error('durable events failed') }) },
    })).rejects.toThrow('durable events failed')

    expect(sheets.list('pokemon')).toEqual([])
    expect(maps.getBySlug('pond-map')?.revision).toBe(0)
    expect(maps.getBySlug('pond-map')?.placements).toEqual([])
  })

  it('rejects safely when the map leaves Prepare Map mode during generation', async () => {
    const { dependencies, sheets, maps, modes } = createHarness()
    const runPokegenSheet = vi.fn(async (_species: string, _level: number, slugPrefix: string, sequence: number) => {
      modes.set({ slug: 'pond-map', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 222 })
      return { ok: true, stderr: '', content: JSON.stringify(generatedSheet({ slug: `${slugPrefix}-bulbasaur-lv5-${sequence}` })) }
    })

    await expect(spawnGeneratedEncountersUseCase(spawnBody, {
      ...dependencies,
      runPokegenSheet,
    })).rejects.toMatchObject({ statusCode: 409 })

    expect(sheets.list('pokemon')).toEqual([])
    expect(maps.getBySlug('pond-map')?.revision).toBe(0)
    expect(maps.getBySlug('pond-map')?.placements).toEqual([])
  })

  it('keeps successfully generated but unplaceable sheets in the encounter folder without advancing the map revision', async () => {
    const runPokegenSheet = vi.fn(async (_species: string, _level: number, slugPrefix: string, sequence: number) => ({
      ok: true,
      stderr: '',
      content: JSON.stringify(generatedSheet({ slug: `${slugPrefix}-missingno-lv5-${sequence}`, species: 'Missingno' })),
    }))
    const { dependencies, sheets, maps } = createHarness({ runPokegenSheet })

    const result = await spawnGeneratedEncountersUseCase(spawnBody, dependencies)

    expect(result.spawn.spawned).toBe(0)
    expect(result.spawn.failures).toBe(1)
    expect(result.spawn.placements[0]?.error).toContain('No Pokémon catalog entry')
    expect(sheets.getByRef('pokemon', 'wild-pond-1-missingno-lv5-1')?.sheet.folder).toBe('wild/pond_1')
    expect(maps.getBySlug('pond-map')?.revision).toBe(0)
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual([
      'sheet:pokemon:wild-pond-1-missingno-lv5-1',
      'sheets',
    ])
  })

  it('can be retried without creating map references to missing sheets', async () => {
    const { dependencies, sheets, maps } = createHarness()

    await spawnGeneratedEncountersUseCase(spawnBody, dependencies)
    await spawnGeneratedEncountersUseCase(spawnBody, dependencies)

    const map = maps.getBySlug('pond-map')!
    expect(map.placements).toHaveLength(2)
    for (const placement of map.placements) {
      expect(sheets.getByRef('pokemon', placement.sheetSlug)).not.toBeNull()
    }
  })

  it('rejects preview mode and non-sheet output roots', async () => {
    const { dependencies } = createHarness()

    await expect(spawnGeneratedEncountersUseCase({
      ...spawnBody,
      preview: true,
    }, dependencies)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Spawn generation cannot be preview-only',
    })

    await expect(spawnGeneratedEncountersUseCase({
      ...spawnBody,
      outRoot: 'data/trainers',
    }, dependencies)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Spawn output root must be data/sheets or a subfolder of data/sheets',
    })
  })
})
