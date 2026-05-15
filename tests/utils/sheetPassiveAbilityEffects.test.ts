import { describe, expect, it } from 'vitest'
import {
  applySheetPassiveAbilityTypeEffectiveness,
  applySheetPassiveTypeEffectiveness,
  computeSheetAbilityAwareMultiplier,
  getPassiveGroundResistanceSource,
  hasGroundResistingCapability,
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

  it('moves Ground effectiveness one resistance step while preserving immunities', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 2, [{ name: 'Levitate' }])).toBe(1.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1.5, [{ name: 'Levitate' }])).toBe(1)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1, [{ name: 'Levitate' }])).toBe(0.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0.5, [{ name: 'Levitate' }])).toBe(0.25)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0.25, [{ name: 'Levitate' }])).toBe(0.125)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0, [{ name: 'Levitate' }])).toBe(0)
    expect(applySheetPassiveAbilityTypeEffectiveness('Fire', 1.5, [{ name: 'Levitate' }])).toBe(1.5)
  })

  it('recognizes Sky and Levitate capabilities as Ground resistance sources', () => {
    expect(hasGroundResistingCapability({ sky: 4 })).toBe(true)
    expect(hasGroundResistingCapability({ levitate: 3 })).toBe(true)
    expect(hasGroundResistingCapability({ sky: 0, levitate: 0 })).toBe(false)
  })

  it('computes type matchups with Levitate passive resistance steps', () => {
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Electric'], [{ name: 'Levitate' }])).toBe(1)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Flying'], [{ name: 'Levitate' }])).toBe(0.5)
  })

  it('applies capability Ground resistance without stacking with Levitate ability', () => {
    expect(applySheetPassiveTypeEffectiveness('Ground', 1, undefined, { sky: 5 })).toBe(0.5)
    expect(applySheetPassiveTypeEffectiveness('Ground', 0.5, [{ name: 'Levitate' }], { levitate: 4 })).toBe(0.25)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Fire'], undefined, { sky: 8 })).toBe(1)
    expect(getPassiveGroundResistanceSource(undefined, { sky: 8 })).toBe('Sky Capability')
    expect(getPassiveGroundResistanceSource([{ name: 'Levitate' }], { sky: 8, levitate: 4 })).toBe('Levitate')
  })
})
