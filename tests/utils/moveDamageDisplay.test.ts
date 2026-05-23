import { describe, expect, it } from 'vitest'
import {
  averageMoveDamageForDb,
  formatMoveDamageAverage,
  formatMoveDamageDisplay,
  nextMoveDamageDisplayMode,
} from '~/utils/moveDamageDisplay'

describe('move damage display helpers', () => {
  it('averages move damage base dice with attack bonuses', () => {
    expect(averageMoveDamageForDb(6, 14)).toBe(29)
    expect(averageMoveDamageForDb(4, 20)).toBe(30.5)
  })

  it('formats fractional average damage compactly', () => {
    expect(formatMoveDamageAverage(29)).toBe('29')
    expect(formatMoveDamageAverage(30.5)).toBe('30.5')
  })

  it('formats average damage by default and can toggle back to roll formulas', () => {
    const values = { damageAverage: 29, damageFormula: '2d6+8+14' }

    expect(formatMoveDamageDisplay(values)).toBe('29')
    expect(formatMoveDamageDisplay(values, 'roll')).toBe('2d6+8+14')
    expect(nextMoveDamageDisplayMode('average')).toBe('roll')
    expect(nextMoveDamageDisplayMode('roll')).toBe('average')
  })
})
