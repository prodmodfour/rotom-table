import { describe, expect, it, vi } from 'vitest'
import {
  generateEncountersUseCase,
  type GenerateEncountersDependencies,
} from '~~/server/useCases/generateEncounters'
import type { EncounterTable } from '~/types/encounterTable'

const table: EncounterTable = {
  name: 'Forest',
  min_level: 5,
  max_level: 5,
  entries: [[100, 'Pidgey']],
}

const sequenceRandom = (...values: number[]) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const createDependencies = (overrides: GenerateEncountersDependencies = {}) => {
  const generatedFiles: string[] = []
  const ensureDirectory = vi.fn()
  const cleanupDirectory = vi.fn()
  const runPokegen = vi.fn(async (species: string, _level: number, _dir: string, slugPrefix: string) => {
    generatedFiles.push(`${slugPrefix}-${species.toLowerCase()}.json`)
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
      : `content:${path.split('/').pop() ?? ''}`,
    listDirectory: () => [...generatedFiles],
    ensureDirectory,
    makeTempDir: (prefix) => `/tmp/${prefix}abc`,
    cleanupDirectory,
    runPokegen,
    ...overrides,
  }

  return { dependencies, ensureDirectory, cleanupDirectory, runPokegen, generatedFiles }
}

describe('generateEncountersUseCase', () => {
  it('rolls encounters, creates a unique output folder, and runs pokegen for persisted output', async () => {
    const { dependencies, ensureDirectory, runPokegen } = createDependencies()

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
    })
    expect(result.rolled).toEqual([{ species: 'Pidgey', level: 5, roll: 1 }])
    expect(result.files).toEqual([{ name: 'wild-forest-1-pidgey.json', content: undefined }])
    expect(ensureDirectory).toHaveBeenNthCalledWith(1, '/repo/data/sheets/wild')
    expect(ensureDirectory).toHaveBeenNthCalledWith(2, '/repo/data/sheets/wild/forest_1')
    expect(runPokegen).toHaveBeenCalledWith('Pidgey', 5, '/repo/data/sheets/wild/forest_1', 'wild-forest-1')
  })

  it('uses a temp output directory for previews, returns generated content, and cleans up', async () => {
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
    expect(result.files).toEqual([
      {
        name: 'preview-forest-123456-pidgey.json',
        content: 'content:preview-forest-123456-pidgey.json',
      },
    ])
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
