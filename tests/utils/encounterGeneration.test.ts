import { describe, expect, it } from 'vitest'
import {
  buildEncounterGenerateRequestBody,
  clampEncounterGenerateCount,
  coerceTableKeyForRegion,
  errorMessageForEncounterGenerate,
  initialEncounterGenerationSelection,
  normalizeEncounterGenerateCountRange,
  randomEncounterGenerateCount,
  toggleOpenGenerateFile,
} from '~/utils/encounterGeneration'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entries: EncounterTableEntry[] = [
  { region: 'vale', key: 'forest', table: { name: 'Forest', min_level: 1, max_level: 5, entries: [[100, 'Oddish']] } },
  { region: 'vale', key: 'river', table: { name: 'River', min_level: 1, max_level: 5, entries: [[100, 'Magikarp']] } },
]

describe('encounter generation helpers', () => {
  it('clamps generation counts and normalizes count ranges', () => {
    expect(clampEncounterGenerateCount(Number.NaN)).toBe(1)
    expect(clampEncounterGenerateCount(0)).toBe(1)
    expect(clampEncounterGenerateCount(3.9)).toBe(3)
    expect(clampEncounterGenerateCount(99)).toBe(30)
    expect(normalizeEncounterGenerateCountRange(8, 2)).toEqual({ min: 2, max: 8 })
    expect(normalizeEncounterGenerateCountRange(99, 0)).toEqual({ min: 1, max: 30 })
  })

  it('rolls a random count inside a normalized range', () => {
    expect(randomEncounterGenerateCount({ min: 2, max: 4 }, () => 0)).toBe(2)
    expect(randomEncounterGenerateCount({ min: 2, max: 4 }, () => 0.99)).toBe(4)
    expect(randomEncounterGenerateCount({ min: 3, max: 3 }, () => {
      throw new Error('exact counts do not need randomness')
    })).toBe(3)
  })

  it('derives initial selection from route query or fallback entry', () => {
    expect(initialEncounterGenerationSelection({ region: 'query-region', table: 'query-table' }, entries[0])).toEqual({
      region: 'query-region',
      tableKey: 'query-table',
    })
    expect(initialEncounterGenerationSelection({}, entries[0])).toEqual({ region: 'vale', tableKey: 'forest' })
    expect(initialEncounterGenerationSelection({}, null)).toEqual({ region: '', tableKey: '' })
  })

  it('coerces table keys to an available table in the selected region', () => {
    expect(coerceTableKeyForRegion('river', entries)).toBe('river')
    expect(coerceTableKeyForRegion('missing', entries)).toBe('forest')
    expect(coerceTableKeyForRegion('missing', [])).toBe('')
  })

  it('builds normalized request bodies', () => {
    expect(buildEncounterGenerateRequestBody({
      region: 'vale',
      tableKey: 'river',
      countMin: 99,
      countMax: 2,
      outRoot: 'data/sheets/wild',
      preview: true,
    })).toEqual({
      region: 'vale',
      table: 'river',
      countMin: 2,
      countMax: 30,
      outRoot: 'data/sheets/wild',
      preview: true,
    })
  })

  it('toggles open generated files without mutating the original set', () => {
    const first = new Set(['a.json'])
    const opened = toggleOpenGenerateFile(first, 'b.json')
    const closed = toggleOpenGenerateFile(opened, 'a.json')

    expect([...first]).toEqual(['a.json'])
    expect([...opened].sort()).toEqual(['a.json', 'b.json'])
    expect([...closed]).toEqual(['b.json'])
  })

  it('normalizes generation errors from common fetch shapes', () => {
    expect(errorMessageForEncounterGenerate({ statusMessage: 'Bad request' })).toBe('Bad request')
    expect(errorMessageForEncounterGenerate({ data: { statusMessage: 'Nested' } })).toBe('Nested')
    expect(errorMessageForEncounterGenerate({ message: 'Message' })).toBe('Message')
    expect(errorMessageForEncounterGenerate(null)).toBe('Unknown error')
  })
})
