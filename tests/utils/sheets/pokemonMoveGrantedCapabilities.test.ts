import { describe, expect, it } from 'vitest'
import {
  applyJumpCapabilityBonuses,
  applyNumberedCapabilityBonus,
  removeJumpCapabilityBonusesForStorage,
  removeNumberedCapabilityBonusForStorage,
  resolveMoveGrantedCapabilities,
} from '~/utils/sheets/pokemonMoveGrantedCapabilities'

describe('pokemon move-granted capability helpers', () => {
  it('extracts named capabilities granted by move reference special text', () => {
    expect(resolveMoveGrantedCapabilities([{ name: 'Ember' }]).other).toEqual(['Firestarter'])
    expect(resolveMoveGrantedCapabilities([{ name: 'Water Gun' }, { name: 'Water Sport' }]).other)
      .toEqual(['Fountain'])
  })

  it('extracts numbered and jump bonuses from move grants', () => {
    const grants = resolveMoveGrantedCapabilities([
      { name: 'Dig' },
      { name: 'Fly' },
      { name: 'Strength' },
      { name: 'Splash' },
      { name: 'Bounce' },
    ])

    expect(grants.numberedBonuses).toMatchObject({ burrow: 3, sky: 3, power: 1 })
    expect(grants.jumpBonuses).toEqual({ long: 1, high: 1 })
  })

  it('keeps valued non-sheet capability bonuses separate for Other capabilities', () => {
    const grants = resolveMoveGrantedCapabilities([{ name: 'Teleport' }])

    expect(grants.other).toEqual([])
    expect(grants.valuedOtherBonuses).toEqual([{ capability: 'Teleporter', bonus: 4 }])
  })

  it('applies and removes displayed movement bonuses for sparse storage', () => {
    expect(applyNumberedCapabilityBonus(2, 3)).toBe(5)
    expect(applyNumberedCapabilityBonus(undefined, 3)).toBe(3)
    expect(removeNumberedCapabilityBonusForStorage(5, 3)).toBe(2)
    expect(removeNumberedCapabilityBonusForStorage(1, 3)).toBe(0)

    expect(applyJumpCapabilityBonuses('2/1', { long: 1, high: 2 })).toBe('3/3')
    expect(applyJumpCapabilityBonuses(undefined, { long: 1, high: 0 })).toBe('1/0')
    expect(removeJumpCapabilityBonusesForStorage('3/3', { long: 1, high: 2 })).toBe('2/1')
  })
})
