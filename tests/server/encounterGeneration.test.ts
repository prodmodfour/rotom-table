import { describe, expect, it } from 'vitest'
import {
  EncounterGenerationInputError,
  assertEncounterPathInsideRoot,
  readEncounterGenerateRequest,
  randomEncounterGenerateCount,
  rollEncounterTable,
  safeEncounterTablePath,
  sanitizeEncounterCount,
  sanitizeEncounterCountRange,
  sanitizeEncounterFolderPath,
  sanitizeEncounterNameComponent,
  sanitizeEncounterOutRoot,
  slugifyEncounterOutputPath,
  uniqueEncounterOutputDir,
} from '~~/server/utils/encounterGeneration'
import type { EncounterTable } from '~/types/encounterTable'

const errorFor = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

const statusMessageFor = (fn: () => unknown): string | undefined => {
  const error = errorFor(fn) as { statusMessage?: string; message?: string } | undefined
  return error?.statusMessage ?? error?.message
}

const sequenceRandom = (...values: number[]) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const table: EncounterTable = {
  name: 'Test Table',
  min_level: 3,
  max_level: 5,
  entries: [{ weight: 1, species: 'Pidgey' }, { weight: 3, species: 'Rattata' }],
}

describe('server encounter generation helpers', () => {
  it('throws typed input errors without depending on H3 errors', () => {
    const error = errorFor(() => sanitizeEncounterNameComponent('../bad', 'region'))

    expect(error).toBeInstanceOf(EncounterGenerationInputError)
    expect(error).toMatchObject({
      statusCode: 400,
      statusMessage: 'region must match /^[A-Za-z0-9_-]+$/',
    })
  })

  it('sanitizes region/table names and out roots', () => {
    expect(sanitizeEncounterNameComponent('thickerby_vale-1', 'region')).toBe('thickerby_vale-1')
    expect(statusMessageFor(() => sanitizeEncounterNameComponent('../bad', 'region'))).toContain('region must match')
    expect(sanitizeEncounterFolderPath('thickerby_vale//deep-woods', 'region')).toBe('thickerby_vale/deep-woods')
    expect(sanitizeEncounterFolderPath('', 'region', true)).toBe('')
    expect(statusMessageFor(() => sanitizeEncounterFolderPath('../bad', 'region'))).toBe('Invalid region segment')

    expect(sanitizeEncounterOutRoot('data//sheets\\wild/forest')).toBe('data/sheets/wild/forest')
    expect(statusMessageFor(() => sanitizeEncounterOutRoot('../data'))).toBe('Invalid outRoot segment')
    expect(statusMessageFor(() => sanitizeEncounterOutRoot('data/sheets/bad name'))).toContain('outRoot segment')
  })

  it('sanitizes count ranges and whole request bodies', () => {
    expect(sanitizeEncounterCount(1)).toBe(1)
    expect(sanitizeEncounterCount('30')).toBe(30)
    expect(statusMessageFor(() => sanitizeEncounterCount(0))).toBe('count must be an integer between 1 and 30')
    expect(statusMessageFor(() => sanitizeEncounterCount(31))).toBe('count must be an integer between 1 and 30')
    expect(sanitizeEncounterCountRange(2, '5')).toEqual({ min: 2, max: 5 })
    expect(statusMessageFor(() => sanitizeEncounterCountRange(0, 5))).toBe('countMin must be an integer between 1 and 30')
    expect(statusMessageFor(() => sanitizeEncounterCountRange(5, 31))).toBe('countMax must be an integer between 1 and 30')
    expect(statusMessageFor(() => sanitizeEncounterCountRange(5, 2))).toBe('countMin must be less than or equal to countMax')

    expect(readEncounterGenerateRequest({ region: 'r', table: 't', count: 2, preview: true })).toEqual({
      region: 'r',
      tableKey: 't',
      outRoot: 'data/sheets/wild',
      countRange: { min: 2, max: 2 },
      preview: true,
    })
    expect(readEncounterGenerateRequest({ region: 'r', table: 't', countMin: 2, countMax: 5, preview: true })).toEqual({
      region: 'r',
      tableKey: 't',
      outRoot: 'data/sheets/wild',
      countRange: { min: 2, max: 5 },
      preview: true,
    })
  })

  it('formats slug prefixes and safe paths', () => {
    expect(slugifyEncounterOutputPath('wild/Forest Run #2')).toBe('wild-forest-run-2')
    expect(slugifyEncounterOutputPath('!!!')).toBe('sheet')
    expect(safeEncounterTablePath('/repo/encounter_tables', 'region/deep', 'forest')).toBe('/repo/encounter_tables/region/deep/forest.json')
    expect(safeEncounterTablePath('/repo/encounter_tables', '', 'forest')).toBe('/repo/encounter_tables/forest.json')
    expect(statusMessageFor(() => safeEncounterTablePath('/repo/encounter_tables', '..', 'forest'))).toBe('Invalid table path')
  })

  it('asserts output paths stay inside the project root', () => {
    expect(() => assertEncounterPathInsideRoot('/repo', '/repo/data/sheets')).not.toThrow()
    expect(statusMessageFor(() => assertEncounterPathInsideRoot('/repo', '/tmp/out'))).toBe('Invalid outRoot')
  })

  it('rolls weighted encounter tables with injectable randomness and per-row level ranges', () => {
    expect(randomEncounterGenerateCount({ min: 2, max: 4 }, () => 0.99)).toBe(4)

    const first = rollEncounterTable(table, () => 0)
    expect(first).toEqual({ species: 'Pidgey', level: 3, roll: 1 })

    const second = rollEncounterTable(table, sequenceRandom(0.05, 0.99))
    expect(second).toEqual({ species: 'Rattata', level: 5, roll: 4 })

    expect(rollEncounterTable(table, () => 0.99)).toBeNull()

    const perRow = rollEncounterTable({
      ...table,
      entries: [
        { weight: 1, species: 'Oddish', min_level: 10, max_level: 10 },
        { weight: 1, species: 'Zubat', min_level: 12, max_level: 12 },
      ],
    }, () => 0)
    expect(perRow).toEqual({ species: 'Oddish', level: 10, roll: 1 })

    expect(rollEncounterTable({ ...table, entries: [] }, () => 0.5)).toBeNull()
  })

  it('allocates unique output directories without touching the filesystem', () => {
    const existing = new Set(['/repo/out/table_3', '/repo/out/table_3-2'])
    const exists = (path: string) => existing.has(path)

    expect(uniqueEncounterOutputDir('/repo/out', 'new', exists)).toBe('/repo/out/new')
    expect(uniqueEncounterOutputDir('/repo/out', 'table_3', exists)).toBe('/repo/out/table_3-3')
  })
})
