import { describe, expect, it } from 'vitest'
import {
  assertEncounterPathInsideRoot,
  readEncounterGenerateRequest,
  rollEncounterTable,
  safeEncounterTablePath,
  sanitizeEncounterCount,
  sanitizeEncounterNameComponent,
  sanitizeEncounterOutRoot,
  slugifyEncounterOutputPath,
  uniqueEncounterOutputDir,
} from '~/server/utils/encounterGeneration'
import type { EncounterTable } from '~/types/encounterTable'

const statusMessageFor = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    return (error as { statusMessage?: string }).statusMessage
  }
  return undefined
}

const table: EncounterTable = {
  name: 'Test Table',
  min_level: 3,
  max_level: 5,
  entries: [[25, 'Pidgey'], [100, 'Rattata']],
}

describe('server encounter generation helpers', () => {
  it('sanitizes region/table names and out roots', () => {
    expect(sanitizeEncounterNameComponent('thickerby_vale-1', 'region')).toBe('thickerby_vale-1')
    expect(statusMessageFor(() => sanitizeEncounterNameComponent('../bad', 'region'))).toContain('region must match')

    expect(sanitizeEncounterOutRoot('data//sheets\\wild/forest')).toBe('data/sheets/wild/forest')
    expect(statusMessageFor(() => sanitizeEncounterOutRoot('../data'))).toBe('Invalid outRoot segment')
    expect(statusMessageFor(() => sanitizeEncounterOutRoot('data/sheets/bad name'))).toContain('outRoot segment')
  })

  it('sanitizes count and whole request bodies', () => {
    expect(sanitizeEncounterCount(1)).toBe(1)
    expect(sanitizeEncounterCount('30')).toBe(30)
    expect(statusMessageFor(() => sanitizeEncounterCount(0))).toBe('count must be an integer between 1 and 30')
    expect(statusMessageFor(() => sanitizeEncounterCount(31))).toBe('count must be an integer between 1 and 30')

    expect(readEncounterGenerateRequest({ region: 'r', table: 't', count: 2, preview: true })).toEqual({
      region: 'r',
      tableKey: 't',
      outRoot: 'data/sheets/wild',
      count: 2,
      preview: true,
    })
  })

  it('formats slug prefixes and safe paths', () => {
    expect(slugifyEncounterOutputPath('wild/Forest Run #2')).toBe('wild-forest-run-2')
    expect(slugifyEncounterOutputPath('!!!')).toBe('sheet')
    expect(safeEncounterTablePath('/repo/encounter_tables', 'region', 'forest')).toBe('/repo/encounter_tables/region/forest.json')
    expect(statusMessageFor(() => safeEncounterTablePath('/repo/encounter_tables', '..', 'forest'))).toBe('Invalid table path')
  })

  it('asserts output paths stay inside the project root', () => {
    expect(() => assertEncounterPathInsideRoot('/repo', '/repo/data/sheets')).not.toThrow()
    expect(statusMessageFor(() => assertEncounterPathInsideRoot('/repo', '/tmp/out'))).toBe('Invalid outRoot')
  })

  it('rolls encounter tables with injectable randomness and fallback species', () => {
    const first = rollEncounterTable(table, () => 0)
    expect(first).toEqual({ species: 'Pidgey', level: 3, roll: 1 })

    const second = rollEncounterTable(table, () => 0.99)
    expect(second).toEqual({ species: 'Rattata', level: 5, roll: 100 })

    expect(rollEncounterTable({ ...table, entries: [] }, () => 0.5).species).toBe('Magikarp')
  })

  it('allocates unique output directories without touching the filesystem', () => {
    const existing = new Set(['/repo/out/table_3', '/repo/out/table_3-2'])
    const exists = (path: string) => existing.has(path)

    expect(uniqueEncounterOutputDir('/repo/out', 'new', exists)).toBe('/repo/out/new')
    expect(uniqueEncounterOutputDir('/repo/out', 'table_3', exists)).toBe('/repo/out/table_3-3')
  })
})
