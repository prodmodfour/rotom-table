import { describe, expect, it, vi } from 'vitest'
import {
  EncounterTableFileError,
  encounterTableNotFoundMessage,
  readEncounterTableFile,
} from '~~/server/utils/encounterTableFiles'
import { EncounterGenerationInputError } from '~~/server/utils/encounterGeneration'
import type { EncounterTable } from '~/types/encounterTable'

const table: EncounterTable = {
  name: 'Forest',
  min_level: 4,
  max_level: 6,
  entries: [[100, 'Pidgey']],
}

describe('encounter table file helpers', () => {
  it('reads an encounter table through a sanitized table path', () => {
    const pathExists = vi.fn((path: string) => path === '/repo/encounter_tables/vale/forest.json')
    const readTextFile = vi.fn(() => JSON.stringify(table))

    expect(readEncounterTableFile('vale', 'forest', {
      encounterRoot: '/repo/encounter_tables',
      pathExists,
      readTextFile,
    })).toEqual(table)
    expect(pathExists).toHaveBeenCalledWith('/repo/encounter_tables/vale/forest.json')
    expect(readTextFile).toHaveBeenCalledWith('/repo/encounter_tables/vale/forest.json')
  })

  it('throws a typed 404 when the table file is missing', () => {
    expect(encounterTableNotFoundMessage('missing', 'forest')).toBe('Table missing/forest not found')
    expect(encounterTableNotFoundMessage('', 'forest')).toBe('Table forest not found')

    expect(() => readEncounterTableFile('missing', 'forest', {
      encounterRoot: '/repo/encounter_tables',
      pathExists: () => false,
      readTextFile: () => JSON.stringify(table),
    })).toThrow(EncounterTableFileError)

    expect(() => readEncounterTableFile('missing', 'forest', {
      encounterRoot: '/repo/encounter_tables',
      pathExists: () => false,
      readTextFile: () => JSON.stringify(table),
    })).toThrow('Table missing/forest not found')
  })

  it('keeps path traversal validation at the table-file boundary', () => {
    expect(() => readEncounterTableFile('..', 'forest', {
      encounterRoot: '/repo/encounter_tables',
      pathExists: () => true,
      readTextFile: () => JSON.stringify(table),
    })).toThrow(EncounterGenerationInputError)
  })
})
