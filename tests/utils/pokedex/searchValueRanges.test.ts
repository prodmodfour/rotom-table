import { describe, expect, it } from 'vitest'
import {
  formatSkillDiceSearchValue,
  maximumNumericComponent,
  minimumIntegerSearchValues,
  minimumSkillDiceSearchValues,
  parseSkillDiceValue,
  stripParenthetical,
} from '~/utils/pokedex/searchValueRanges'

describe('pokedex search value range helpers', () => {
  it('strips parenthetical qualifiers before labelled range indexing', () => {
    expect(stripParenthetical('Threaded 4 (limited)')).toBe('Threaded 4')
    expect(stripParenthetical('  Glow  ')).toBe('Glow')
  })

  it('builds minimum integer aliases from finite numeric values', () => {
    expect(minimumIntegerSearchValues(3.7)).toEqual([1, 2, 3])
    expect(minimumIntegerSearchValues(0)).toEqual([])
    expect(minimumIntegerSearchValues(Number.POSITIVE_INFINITY)).toEqual([])
    expect(minimumIntegerSearchValues(null)).toEqual([])
  })

  it('extracts the largest numeric component from capability values', () => {
    expect(maximumNumericComponent('2/4')).toBe(4)
    expect(maximumNumericComponent('Jump 1.5')).toBe(1.5)
    expect(maximumNumericComponent(6)).toBe(6)
    expect(maximumNumericComponent('none')).toBeNull()
  })

  it('parses and formats skill dice values without adding semantic conversions', () => {
    expect(parseSkillDiceValue('4d6+2')).toEqual({ dice: 4, modifier: 2 })
    expect(parseSkillDiceValue('3 d 6 - 1')).toEqual({ dice: 3, modifier: -1 })
    expect(parseSkillDiceValue('0d6')).toBeNull()
    expect(formatSkillDiceSearchValue(4, 2)).toBe('4d6+2')
    expect(formatSkillDiceSearchValue(4, -1)).toBe('4d6-1')
  })

  it('builds minimum skill dice aliases for dice and positive modifiers', () => {
    expect(minimumSkillDiceSearchValues('4d6+2')).toEqual([
      '1d6',
      '2d6',
      '3d6',
      '4d6',
      '4d6+1',
      '4d6+2',
    ])
    expect(minimumSkillDiceSearchValues('3d6-1')).toEqual(['1d6', '2d6', '3d6'])
    expect(minimumSkillDiceSearchValues('expert')).toEqual([])
  })
})
