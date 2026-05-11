import { describe, expect, it } from 'vitest'
import {
  findMoveDamageBase,
  formatMoveDamageBase,
  formatMoveDamageBaseFormula,
  rollMoveDamageFormula,
} from '~/utils/moveDamageBase'
import { formatDamageBase } from '~/utils/moveAutomation'


describe('move damage-base helpers', () => {
  it('formats the move-automation damage-base table with existing PTU 1.05 values', () => {
    const db4 = findMoveDamageBase(4)

    expect(db4).toEqual({ db: 4, count: 1, sides: 8, mod: 6 })
    expect(formatMoveDamageBaseFormula(db4!)).toBe('1d8+6')
    expect(formatMoveDamageBase(28)).toBe('8d12+65')
    expect(formatMoveDamageBase(99)).toBe('DB 99')
  })

  it('keeps the legacy moveAutomation formatter export compatible', () => {
    expect(formatDamageBase(6)).toBe('2d6+8')
    expect(formatDamageBase(99)).toBe('DB 99')
  })

  it('rolls formulas deterministically with an injected random source', () => {
    const values = [0, 0.999, 0.5]
    const result = rollMoveDamageFormula('3d6 + 2', () => values.shift() ?? 0)

    expect(result).toEqual({
      formula: '3d6+2',
      count: 3,
      sides: 6,
      mod: 2,
      rolls: [1, 6, 4],
      total: 13,
    })
  })

  it('rejects invalid or non-positive dice formulas', () => {
    expect(rollMoveDamageFormula('DB 6')).toBeNull()
    expect(rollMoveDamageFormula('0d6+1')).toBeNull()
    expect(rollMoveDamageFormula('2d0+1')).toBeNull()
  })
})
