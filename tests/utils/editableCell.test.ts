import { describe, expect, it } from 'vitest'
import {
  editableCellDraftFromValue,
  formatEditableCellDisplay,
  isEmptyEditableCellValue,
  parseEditableCellDraft,
  resolveEditableCellOptions,
} from '~/utils/editableCell'

describe('editable cell helpers', () => {
  it('identifies empty values and display text', () => {
    expect(isEmptyEditableCellValue(null)).toBe(true)
    expect(isEmptyEditableCellValue(undefined)).toBe(true)
    expect(isEmptyEditableCellValue('')).toBe(true)
    expect(isEmptyEditableCellValue(0)).toBe(false)

    expect(formatEditableCellDisplay(undefined)).toBe('')
    expect(formatEditableCellDisplay(12)).toBe('12')
    expect(formatEditableCellDisplay('abc', (value) => `Value: ${value}`)).toBe('Value: abc')
  })

  it('creates edit drafts from current values', () => {
    expect(editableCellDraftFromValue(undefined)).toBe('')
    expect(editableCellDraftFromValue(42)).toBe('42')
    expect(editableCellDraftFromValue(false)).toBe('false')
  })

  it('normalizes select options', () => {
    expect(resolveEditableCellOptions(['A', { value: 'b', label: 'Bee' }])).toEqual([
      { value: 'A', label: 'A' },
      { value: 'b', label: 'Bee' },
    ])
  })

  it('parses and clamps numeric drafts', () => {
    expect(parseEditableCellDraft('', { type: 'number', currentValue: 5 })).toBeUndefined()
    expect(parseEditableCellDraft('bad', { type: 'number', currentValue: 5 })).toBe(5)
    expect(parseEditableCellDraft('-2', { type: 'number', currentValue: 5, min: 0 })).toBe(0)
    expect(parseEditableCellDraft('99', { type: 'number', currentValue: 5, max: 10 })).toBe(10)
    expect(parseEditableCellDraft('7', { type: 'number', currentValue: 5 })).toBe(7)
  })

  it('preserves non-number drafts as text', () => {
    expect(parseEditableCellDraft(' 7 ', { type: 'text', currentValue: 5 })).toBe(' 7 ')
    expect(parseEditableCellDraft('', { type: 'select', currentValue: 'x' })).toBe('')
  })
})
