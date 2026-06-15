import { join as joinPath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  generateEncountersUseCase,
  type GenerateEncountersDependencies,
} from '~~/server/useCases/generateEncounters'
import type { CharacterSheet } from '~/types/characterSheet'
import type { EncounterTable } from '~/types/encounterTable'

const table: EncounterTable = {
  name: 'Forest',
  min_level: 5,
  max_level: 5,
  entries: [{ weight: 1, species: 'Pidgey' }],
}

const generatedSheet = (species = 'Pidgey', level = 5): CharacterSheet => ({
  slug: species.toLowerCase(),
  nickname: species,
  species,
  level,
})

const sequenceRandom = (...values: number[]) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const createDependencies = (overrides: GenerateEncountersDependencies = {}) => {
  const generatedFiles: string[] = []
  const generatedContent = new Map<string, string>()
  const ensureDirectory = vi.fn()
  const cleanupDirectory = vi.fn()
  const writeTextFile = vi.fn((path: string, content: string) => generatedContent.set(path, content))
  const runPokegen = vi.fn(async (species: string, level: number, dir: string, slugPrefix: string) => {
    const filename = `${slugPrefix}-${species.toLowerCase()}.json`
    generatedFiles.push(filename)
    generatedContent.set(joinPath(dir, filename), JSON.stringify(generatedSheet(species, level)))
    return { ok: true, stderr: '' }
  })

  const dependencies: GenerateEncountersDependencies = {
    projectRoot: '/repo',
    encounterRoot: '/repo/encounter_tables',
    now: () => 123456,
    random: sequenceRandom(0, 0),
    pathExists: (path) => path === '/repo/encounter_tables/vale/forest.json',
    readTextFile: (path) => path.endsWith('/forest.json')
      ? JSON.stringify(table)
      : generatedContent.get(path) ?? `content:${path.split('/').pop() ?? ''}`,
    writeTextFile,
    listDirectory: () => [...generatedFiles],
    ensureDirectory,
    makeTempDir: (prefix) => `/tmp/${prefix}abc`,
    cleanupDirectory,
    runPokegen,
    ...overrides,
  }

  return { dependencies, ensureDirectory, cleanupDirectory, runPokegen, generatedFiles, generatedContent, writeTextFile }
}

describe('generateEncountersUseCase', () => {
  it('rolls encounters, creates a unique output folder, runs pokegen, and decorates persisted output', async () => {
    const { dependencies, ensureDirectory, runPokegen, writeTextFile, generatedContent } = createDependencies()

    const result = await generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      count: 1,
      outRoot: 'data/sheets/wild',
    }, dependencies)

    expect(result).toMatchObject({
      ok: true,
      dir: '/repo/data/sheets/wild/forest_1',
      relDir: 'data/sheets/wild/forest_1',
      failures: 0,
      preview: false,
      beforeCount: 0,
      count: 1,
    })
    expect(result.rolled).toEqual([{ species: 'Pidgey', level: 5, roll: 1 }])
    expect(result.files).toEqual([{ name: 'wild-forest-1-pidgey.json', content: undefined }])
    expect(ensureDirectory).toHaveBeenNthCalledWith(1, '/repo/data/sheets/wild')
    expect(ensureDirectory).toHaveBeenNthCalledWith(2, '/repo/data/sheets/wild/forest_1')
    expect(runPokegen).toHaveBeenCalledWith('Pidgey', 5, '/repo/data/sheets/wild/forest_1', 'wild-forest-1')
    expect(writeTextFile).toHaveBeenCalledWith(
      '/repo/data/sheets/wild/forest_1/wild-forest-1-pidgey.json',
      expect.stringMatching(/\n$/),
    )
    expect(JSON.parse(generatedContent.get('/repo/data/sheets/wild/forest_1/wild-forest-1-pidgey.json')!))
      .toMatchObject({
        skillBackground: {
          description: 'Wary Canopy Trail-Bounder',
          raised: ['Acrobatics', 'Athletics'],
          lowered: ['Charm'],
        },
      })
  })

  it('chooses encounter count from the requested range', async () => {
    const { dependencies, runPokegen } = createDependencies({
      random: sequenceRandom(0.99, 0, 0, 0, 0, 0, 0),
    })

    const result = await generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      countMin: 1,
      countMax: 3,
      preview: true,
    }, dependencies)

    expect(result.count).toBe(3)
    expect(result.rolled).toHaveLength(3)
    expect(runPokegen).toHaveBeenCalledTimes(3)
  })

  it('omits Nothing rolls from generated Pokémon output', async () => {
    const { dependencies, runPokegen } = createDependencies({
      random: sequenceRandom(0.99, 0, 0, 0.5),
    })

    const result = await generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      count: 3,
      preview: true,
    }, dependencies)

    expect(result.count).toBe(3)
    expect(result.rolled).toEqual([{ species: 'Pidgey', level: 5, roll: 1 }])
    expect(runPokegen).toHaveBeenCalledTimes(1)
  })

  it('uses a temp output directory for previews, returns decorated generated content, and cleans up', async () => {
    const { dependencies, cleanupDirectory, runPokegen } = createDependencies()

    const result = await generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      count: 1,
      preview: true,
    }, dependencies)

    expect(result).toMatchObject({
      ok: true,
      dir: '',
      relDir: '',
      failures: 0,
      preview: true,
    })
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.name).toBe('preview-forest-123456-pidgey.json')
    expect(JSON.parse(result.files[0]!.content!)).toMatchObject({
      skillBackground: {
        description: 'Wary Canopy Trail-Bounder',
        raised: ['Acrobatics', 'Athletics'],
        lowered: ['Charm'],
      },
    })
    expect(runPokegen).toHaveBeenCalledWith(
      'Pidgey',
      5,
      '/tmp/rotom-encounter-forest-abc',
      'preview-forest-123456',
    )
    expect(cleanupDirectory).toHaveBeenCalledWith('/tmp/rotom-encounter-forest-abc')
  })

  it('records pokegen failures and zero-file successful runs without aborting the batch', async () => {
    const failing = createDependencies({
      runPokegen: vi.fn(async () => ({ ok: false, stderr: ' nope\n' })),
    })
    await expect(generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      count: 1,
    }, failing.dependencies)).resolves.toMatchObject({
      failures: 1,
      files: [{ name: 'Pidgey Lv 5', error: 'nope' }],
    })

    const noFile = createDependencies({
      runPokegen: vi.fn(async () => ({ ok: true, stderr: '' })),
    })
    await expect(generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      count: 1,
    }, noFile.dependencies)).resolves.toMatchObject({
      failures: 1,
      files: [{ name: 'Pidgey Lv 5', error: 'pokegen exited 0 but did not write a new file' }],
    })
  })

  it('reports invalid generated JSON as a per-file decorating failure', async () => {
    const { dependencies } = createDependencies({
      readTextFile: (path) => path.endsWith('/forest.json') ? JSON.stringify(table) : '{not json',
    })

    await expect(generateEncountersUseCase({
      region: 'vale',
      table: 'forest',
      count: 1,
    }, dependencies)).resolves.toMatchObject({
      failures: 1,
      files: [expect.objectContaining({ name: 'wild-forest-1-pidgey.json', error: expect.any(String) })],
    })
  })

  it('maps validation and missing-table failures to use-case errors with HTTP-compatible status', async () => {
    const { dependencies } = createDependencies()

    await expect(generateEncountersUseCase({
      region: '../bad',
      table: 'forest',
      count: 1,
    }, dependencies)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid region segment',
    })

    await expect(generateEncountersUseCase({
      region: 'missing',
      table: 'forest',
      count: 1,
    }, dependencies)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Table missing/forest not found',
    })
  })
})
