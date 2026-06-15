import { join as joinPath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  spawnGeneratedEncountersUseCase,
  type SpawnGeneratedEncountersDependencies,
} from '~~/server/useCases/spawnGeneratedEncounters'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { EncounterTable } from '~/types/encounterTable'

const table: EncounterTable = {
  name: 'Pond',
  min_level: 5,
  max_level: 5,
  entries: [{ weight: 1, species: 'Bulbasaur' }],
}

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'pond-map',
  name: 'Pond Map',
  dimensions: { x: 3, y: 2, z: 3 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [{ x: 2, y: 0, z: 2, materialId: 'shallow_water' }],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const generatedSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'wild-pond-1-bulbasaur',
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

const createDependencies = (overrides: Partial<SpawnGeneratedEncountersDependencies> = {}) => {
  const generatedFiles: string[] = []
  const generatedContent = new Map<string, string>()
  const map = mapFixture()
  const saveMap = vi.fn((slug: string, nextMap: TabletopMap, clientId?: string) => ({
    path: `data/maps/${slug}.json`,
    map: { ...nextMap, updatedAt: 1234 },
    events: [{ channel: `map:${slug}`, type: 'updated', clientId, data: nextMap }],
  }))

  const dependencies: SpawnGeneratedEncountersDependencies = {
    projectRoot: '/repo',
    encounterRoot: '/repo/encounter_tables',
    now: () => 111,
    random: sequenceRandom(0, 0, 0),
    pathExists: (path) => path === '/repo/encounter_tables/vale/pond.json',
    readTextFile: (path) => path.endsWith('/pond.json')
      ? JSON.stringify(table)
      : generatedContent.get(path) ?? '{}',
    writeTextFile: (path, content) => generatedContent.set(path, content),
    listDirectory: () => [...generatedFiles],
    ensureDirectory: vi.fn(),
    makeTempDir: (prefix) => `/tmp/${prefix}abc`,
    cleanupDirectory: vi.fn(),
    uniqueOutputDir: (parent, baseName) => `${parent}/${baseName}`,
    runPokegen: vi.fn(async (_species, _level, dir, slugPrefix) => {
      const filename = `${slugPrefix}-bulbasaur.json`
      generatedFiles.push(filename)
      generatedContent.set(joinPath(dir, filename), JSON.stringify(generatedSheet({ slug: `${slugPrefix}-bulbasaur` })))
      return { ok: true, stderr: '' }
    }),
    loadMap: () => map,
    saveMap,
    listPokemonSheets: () => [],
    listTrainerSheets: () => [],
    readGeneratedPokemonSheet: (dir, fileName) => JSON.parse(generatedContent.get(joinPath(dir, fileName)) ?? '{}') as CharacterSheet,
    createPlacementId: () => 'spawn-1',
    ...overrides,
  }

  return { dependencies, saveMap, map, generatedContent }
}

describe('spawnGeneratedEncountersUseCase', () => {
  it('generates decorated sheets and persists sensible map placements', async () => {
    const { dependencies, saveMap } = createDependencies()

    const result = await spawnGeneratedEncountersUseCase({
      region: 'vale',
      table: 'pond',
      count: 1,
      outRoot: 'data/sheets/wild',
      mapSlug: 'pond-map',
      clientId: 'client-1',
    }, dependencies)

    expect(result.relDir).toBe('data/sheets/wild/pond_1')
    expect(result.spawn).toMatchObject({
      mapSlug: 'pond-map',
      mapName: 'Pond Map',
      spawned: 1,
      failures: 0,
      placements: [{
        file: 'wild-pond-1-bulbasaur.json',
        slug: 'wild-pond-1-bulbasaur',
        placementId: 'spawn-1',
        position: { x: 2, y: 0, z: 2 },
      }],
    })
    expect(saveMap).toHaveBeenCalledWith('pond-map', expect.objectContaining({
      placements: [{
        id: 'spawn-1',
        sheetKind: 'pokemon',
        sheetSlug: 'wild-pond-1-bulbasaur',
        position: { x: 2, y: 0, z: 2 },
        facing: 'south-east',
        turned: false,
      }],
    }), 'client-1')
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sheets', type: 'updated', clientId: 'client-1' }),
      expect.objectContaining({ channel: 'map:pond-map', type: 'updated', clientId: 'client-1' }),
    ]))
    const sheetEvent = result.events.find((event) => event.channel === 'sheets')
    expect((sheetEvent?.data as { sheet?: CharacterSheet } | undefined)?.sheet).toMatchObject({
      slug: 'wild-pond-1-bulbasaur',
      folder: 'wild/pond_1',
      skillBackground: {
        description: 'Wary Canopy Trail-Bounder',
        raised: ['Acrobatics', 'Athletics'],
        lowered: ['Charm'],
      },
    })
  })

  it('reports spawn failures without saving an unchanged map', async () => {
    const { dependencies, saveMap } = createDependencies({
      readGeneratedPokemonSheet: () => generatedSheet({ species: 'Missingno' }),
    })

    const result = await spawnGeneratedEncountersUseCase({
      region: 'vale',
      table: 'pond',
      count: 1,
      outRoot: 'data/sheets/wild',
      mapSlug: 'pond-map',
    }, dependencies)

    expect(result.spawn.spawned).toBe(0)
    expect(result.spawn.failures).toBe(1)
    expect(result.spawn.placements[0]?.error).toContain('No Pokémon catalog entry')
    expect(saveMap).not.toHaveBeenCalled()
  })

  it('rejects preview mode and non-sheet output roots', async () => {
    const { dependencies } = createDependencies()

    await expect(spawnGeneratedEncountersUseCase({
      region: 'vale',
      table: 'pond',
      count: 1,
      outRoot: 'data/sheets/wild',
      mapSlug: 'pond-map',
      preview: true,
    }, dependencies)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Spawn generation cannot be preview-only',
    })

    await expect(spawnGeneratedEncountersUseCase({
      region: 'vale',
      table: 'pond',
      count: 1,
      outRoot: 'data/trainers',
      mapSlug: 'pond-map',
    }, dependencies)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Spawn output root must be data/sheets or a subfolder of data/sheets',
    })
  })
})
