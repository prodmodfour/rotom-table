import { describe, expect, it } from 'vitest'
import {
  formatCsvList,
  formatCsvSingleOrList,
  parseAllowedCsvList,
  parseCsvList,
  toOptionalSingleOrList,
} from '~/utils/sheets/csvFields'

describe('CSV sheet field helpers', () => {
  it('parses and formats comma-separated lists', () => {
    expect(parseCsvList(' alpha, beta ,, gamma ')).toEqual(['alpha', 'beta', 'gamma'])
    expect(formatCsvList(['alpha', 'beta'])).toBe('alpha, beta')
    expect(formatCsvList(undefined)).toBe('')
  })

  it('filters parsed values to an allowed set', () => {
    expect(parseAllowedCsvList('focus, invalid, command', ['focus', 'command'] as const))
      .toEqual(['focus', 'command'])
  })

  it('converts optional single-or-list values for sheet storage', () => {
    expect(formatCsvSingleOrList('focus')).toBe('focus')
    expect(formatCsvSingleOrList(['focus', 'command'])).toBe('focus, command')
    expect(toOptionalSingleOrList([])).toBeUndefined()
    expect(toOptionalSingleOrList(['focus'])).toBe('focus')
    expect(toOptionalSingleOrList(['focus', 'command'])).toEqual(['focus', 'command'])
  })
})
