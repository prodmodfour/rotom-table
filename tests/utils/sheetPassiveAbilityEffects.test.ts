import { describe, expect, it } from 'vitest'
import {
  applySheetPassiveAbilityTypeEffectiveness,
  applySheetPassiveTypeEffectiveness,
  computeSheetAbilityAwareMultiplier,
  getGroundsourceMoveImmunitySource,
  getPassiveGroundResistanceSource,
  getPassiveTypeEffectivenessSource,
  hasFlashFireAbility,
  hasGroundsourceImmunityCapability,
  hasLevitateAbility,
  moveHasGroundsourceKeyword,
  resolveLevitateAbilitySpeed,
} from '~/utils/sheetPassiveAbilityEffects'

describe('sheet passive ability effects', () => {
  it('recognizes Levitate and Flash Fire by canonical ability lookup', () => {
    expect(hasLevitateAbility([{ name: 'levitate' }])).toBe(true)
    expect(hasLevitateAbility(['Levitate'])).toBe(true)
    expect(hasLevitateAbility([{ name: 'Run Away' }])).toBe(false)
    expect(hasFlashFireAbility([{ name: 'flash fire' }])).toBe(true)
    expect(hasFlashFireAbility(['Flash Fire'])).toBe(true)
    expect(hasFlashFireAbility([{ name: 'Run Away' }])).toBe(false)
  })

  it('grants Levitate speed 4 or +2 to an existing Levitate speed', () => {
    expect(resolveLevitateAbilitySpeed(undefined, [{ name: 'Levitate' }])).toBe(4)
    expect(resolveLevitateAbilitySpeed(0, [{ name: 'Levitate' }])).toBe(4)
    expect(resolveLevitateAbilitySpeed(5, [{ name: 'Levitate' }])).toBe(7)
    expect(resolveLevitateAbilitySpeed(5, [{ name: 'Run Away' }])).toBe(5)
  })

  it('moves Ground effectiveness one resistance step for Levitate while preserving immunities', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 2, [{ name: 'Levitate' }])).toBe(1.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1.5, [{ name: 'Levitate' }])).toBe(1)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1, [{ name: 'Levitate' }])).toBe(0.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0.5, [{ name: 'Levitate' }])).toBe(0.25)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0.25, [{ name: 'Levitate' }])).toBe(0.125)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0, [{ name: 'Levitate' }])).toBe(0)
    expect(applySheetPassiveAbilityTypeEffectiveness('Fire', 1.5, [{ name: 'Levitate' }])).toBe(1.5)
  })

  it('makes Fire attacks immune with Flash Fire', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Fire', 2, [{ name: 'Flash Fire' }])).toBe(0)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 1.5, [{ name: 'Flash Fire' }])).toBe(1.5)
    expect(computeSheetAbilityAwareMultiplier('Fire', ['Grass'], [{ name: 'flash fire' }])).toBe(0)
    expect(getPassiveTypeEffectivenessSource('Fire', [{ name: 'Flash Fire' }])).toBe('Flash Fire')
  })

  it('recognizes Sky and Levitate capabilities as Groundsource immunity sources', () => {
    expect(hasGroundsourceImmunityCapability({ sky: 4 })).toBe(true)
    expect(hasGroundsourceImmunityCapability({ levitate: 3 })).toBe(true)
    expect(hasGroundsourceImmunityCapability({ sky: 0, levitate: 0 })).toBe(false)
    expect(moveHasGroundsourceKeyword(['Burst 2', ' Groundsource '])).toBe(true)
    expect(moveHasGroundsourceKeyword(['Ground Source'])).toBe(false)
    expect(getGroundsourceMoveImmunitySource({ sky: 8 }, ['Groundsource'])).toBe('Sky Capability')
    expect(getGroundsourceMoveImmunitySource({ levitate: 4 }, ['Groundsource'])).toBe('Levitate Capability')
    expect(getGroundsourceMoveImmunitySource({ sky: 8, levitate: 4 }, ['Groundsource'])).toBe('Sky/Levitate Capability')
    expect(getGroundsourceMoveImmunitySource({ sky: 8 }, ['Burst 1'])).toBeNull()
  })

  it('computes type matchups with Flying resistance and Levitate passive resistance', () => {
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Flying'], undefined)).toBe(0.5)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Fire', 'Flying'], undefined)).toBe(1)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Electric'], [{ name: 'Levitate' }])).toBe(1)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Flying'], [{ name: 'Levitate' }])).toBe(0.25)
  })

  it('keeps airborne capability immunity limited to Groundsource moves', () => {
    expect(applySheetPassiveTypeEffectiveness('Ground', 1, undefined, { sky: 5 })).toBe(1)
    expect(applySheetPassiveTypeEffectiveness('Ground', 0.5, [{ name: 'Levitate' }], { levitate: 4 })).toBe(0.25)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Fire'], undefined, { sky: 8 })).toBe(1.5)
    expect(computeSheetAbilityAwareMultiplier('Electric', ['Water'], undefined, { sky: 8 }, { moveKeywords: ['Groundsource'] })).toBe(0)
    expect(getPassiveGroundResistanceSource(undefined)).toBeNull()
    expect(getPassiveGroundResistanceSource([{ name: 'Levitate' }])).toBe('Levitate')
    expect(getPassiveTypeEffectivenessSource('Ground', undefined, { sky: 8 }, { moveKeywords: ['Groundsource'] })).toBe('Sky Capability')
  })
})
