import { describe, expect, it } from 'vitest'
import {
  applySheetPassiveAbilityTypeEffectiveness,
  computeSheetAbilityAwareMultiplier,
  hasLevitateAbility,
  resolveLevitateAbilitySpeed,
} from '~/utils/sheetPassiveAbilityEffects'

describe('sheet passive ability effects', () => {
  it('recognizes Levitate by canonical ability lookup', () => {
    expect(hasLevitateAbility([{ name: 'levitate' }])).toBe(true)
    expect(hasLevitateAbility(['Levitate'])).toBe(true)
    expect(hasLevitateAbility([{ name: 'Run Away' }])).toBe(false)
  })

  it('grants Levitate speed 4 or +2 to an existing Levitate speed', () => {
    expect(resolveLevitateAbilitySpeed(undefined, [{ name: 'Levitate' }])).toBe(4)
    expect(resolveLevitateAbilitySpeed(0, [{ name: 'Levitate' }])).toBe(4)
    expect(resolveLevitateAbilitySpeed(5, [{ name: 'Levitate' }])).toBe(7)
    expect(resolveLevitateAbilitySpeed(5, [{ name: 'Run Away' }])).toBe(5)
  })

  it('caps Ground effectiveness at resistance while preserving immunities and stronger resistances', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1.5, [{ name: 'Levitate' }])).toBe(0.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1, [{ name: 'Levitate' }])).toBe(0.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0.25, [{ name: 'Levitate' }])).toBe(0.25)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0, [{ name: 'Levitate' }])).toBe(0)
    expect(applySheetPassiveAbilityTypeEffectiveness('Fire', 1.5, [{ name: 'Levitate' }])).toBe(1.5)
  })

  it('computes type matchups with Levitate passive resistance', () => {
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Electric'], [{ name: 'Levitate' }])).toBe(0.5)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Flying'], [{ name: 'Levitate' }])).toBe(0)
  })
})
