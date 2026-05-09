import { describe, expect, it } from 'vitest'
import {
  calculatePtuDamageLoss,
  findManualDamageBase,
  formatDamageBaseFormula,
  rollDamageBase,
} from '~/utils/ptuDamage'

describe('PTU damage helpers', () => {
  it('formats and rolls damage base entries deterministically with injected rng', () => {
    const db6 = findManualDamageBase(6)

    expect(db6).toEqual({ db: 6, count: 2, sides: 6, mod: 8 })
    expect(formatDamageBaseFormula(db6!)).toBe('2d6+8')
    expect(rollDamageBase(db6!, () => 0)).toEqual({
      db: 6,
      formula: '2d6+8',
      rolls: [1, 1],
      mod: 8,
      total: 10,
    })
  })

  it('applies PTU defense, multiplier, immunity, and minimum damage rules', () => {
    expect(calculatePtuDamageLoss({
      rawDamage: 20,
      attackBonus: 7,
      defense: 10,
      multiplier: 2,
    })).toBe(34)

    expect(calculatePtuDamageLoss({
      rawDamage: 20,
      attackBonus: 0,
      defense: 999,
      multiplier: 1,
    })).toBe(1)

    expect(calculatePtuDamageLoss({
      rawDamage: 20,
      attackBonus: 7,
      defense: 10,
      multiplier: 0,
    })).toBe(0)

    expect(calculatePtuDamageLoss({
      rawDamage: 0,
      attackBonus: 7,
      defense: 10,
      multiplier: 2,
    })).toBe(0)
  })
})
