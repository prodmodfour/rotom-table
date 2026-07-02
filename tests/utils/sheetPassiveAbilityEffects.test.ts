import { describe, expect, it } from 'vitest'
import {
  applySheetPassiveAbilityTypeEffectiveness,
  applySheetPassiveTypeEffectiveness,
  computeSheetAbilityAwareMultiplier,
  getGroundsourceMoveImmunitySource,
  getPassiveGroundResistanceSource,
  getPassiveTypeEffectivenessSource,
  getSonicMoveImmunitySource,
  hasFlashFireAbility,
  hasGroundsourceImmunityCapability,
  hasLevitateAbility,
  hasMudDwellerAbility,
  hasSoundproofAbility,
  hasToleranceAbility,
  moveHasGroundsourceKeyword,
  moveHasSonicKeyword,
  resolveLevitateAbilitySpeed,
} from '~/utils/sheetPassiveAbilityEffects'

describe('sheet passive ability effects', () => {
  it('recognizes Levitate, Flash Fire, Tolerance, Soundproof, and Mud Dweller by canonical ability lookup', () => {
    expect(hasLevitateAbility([{ name: 'levitate' }])).toBe(true)
    expect(hasLevitateAbility(['Levitate'])).toBe(true)
    expect(hasLevitateAbility([{ name: 'Run Away' }])).toBe(false)
    expect(hasFlashFireAbility([{ name: 'flash fire' }])).toBe(true)
    expect(hasFlashFireAbility(['Flash Fire'])).toBe(true)
    expect(hasFlashFireAbility([{ name: 'Run Away' }])).toBe(false)
    expect(hasToleranceAbility([{ name: 'tolerance' }])).toBe(true)
    expect(hasToleranceAbility(['Tolerance'])).toBe(true)
    expect(hasToleranceAbility([{ name: 'Run Away' }])).toBe(false)
    expect(hasSoundproofAbility([{ name: 'soundproof' }])).toBe(true)
    expect(hasSoundproofAbility(['Soundproof'])).toBe(true)
    expect(hasSoundproofAbility([{ name: 'Run Away' }])).toBe(false)
    expect(hasMudDwellerAbility([{ name: 'mud-dweller' }])).toBe(true)
    expect(hasMudDwellerAbility(['Mud Dweller'])).toBe(true)
    expect(hasMudDwellerAbility([{ name: 'Run Away' }])).toBe(false)
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

  it('moves Ground and Water effectiveness one resistance step for Mud Dweller while preserving immunities', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1.5, [{ name: 'Mud Dweller' }])).toBe(1)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 1, [{ name: 'Mud Dweller' }])).toBe(0.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 1.5, [{ name: 'Mud Dweller' }])).toBe(1)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 0.5, [{ name: 'Mud Dweller' }])).toBe(0.25)
    expect(applySheetPassiveAbilityTypeEffectiveness('Fire', 1.5, [{ name: 'Mud Dweller' }])).toBe(1.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Ground', 0, [{ name: 'Mud Dweller' }])).toBe(0)
    expect(computeSheetAbilityAwareMultiplier('Water', ['Fire'], [{ name: 'mud-dweller' }])).toBe(1)
    expect(getPassiveTypeEffectivenessSource('Water', [{ name: 'Mud Dweller' }], undefined, { baseMultiplier: 1 })).toBe('Mud Dweller')
  })

  it('makes Fire attacks immune with Flash Fire', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Fire', 2, [{ name: 'Flash Fire' }])).toBe(0)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 1.5, [{ name: 'Flash Fire' }])).toBe(1.5)
    expect(computeSheetAbilityAwareMultiplier('Fire', ['Grass'], [{ name: 'flash fire' }])).toBe(0)
    expect(getPassiveTypeEffectivenessSource('Fire', [{ name: 'Flash Fire' }])).toBe('Flash Fire')
  })

  it('makes Sonic moves immune with Soundproof', () => {
    expect(moveHasSonicKeyword(['Cone 2', ' Sonic '])).toBe(true)
    expect(moveHasSonicKeyword(['Supersonic'])).toBe(false)
    expect(getSonicMoveImmunitySource([{ name: 'Soundproof' }], ['Sonic'])).toBe('Soundproof')
    expect(getSonicMoveImmunitySource([{ name: 'Soundproof' }], ['Burst 1'])).toBeNull()
    expect(applySheetPassiveTypeEffectiveness('Dark', 1, [{ name: 'Soundproof' }], undefined, { moveKeywords: ['Sonic'] }))
      .toBe(0)
    expect(applySheetPassiveTypeEffectiveness('Dark', 1, [{ name: 'Soundproof' }])).toBe(1)
    expect(computeSheetAbilityAwareMultiplier('Dark', ['Normal'], [{ name: 'soundproof' }], undefined, { moveKeywords: ['Sonic'] }))
      .toBe(0)
    expect(getPassiveTypeEffectivenessSource('Dark', [{ name: 'Soundproof' }], undefined, { moveKeywords: ['Sonic'] }))
      .toBe('Soundproof')
  })

  it('moves resisted type effectiveness one step further with Tolerance', () => {
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 0.5, [{ name: 'Tolerance' }]))
      .toBe(0.25)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 0.25, [{ name: 'Tolerance' }]))
      .toBe(0.125)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 1, [{ name: 'Tolerance' }]))
      .toBe(1)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 1.5, [{ name: 'Tolerance' }]))
      .toBe(1.5)
    expect(applySheetPassiveAbilityTypeEffectiveness('Water', 0, [{ name: 'Tolerance' }]))
      .toBe(0)
    expect(computeSheetAbilityAwareMultiplier('Fire', ['Water'], [{ name: 'tolerance' }]))
      .toBe(0.25)
    expect(computeSheetAbilityAwareMultiplier(
      'Ground',
      ['Fire', 'Flying'],
      [{ name: 'Levitate' }, { name: 'Tolerance' }],
    )).toBe(0.25)
    expect(getPassiveTypeEffectivenessSource(
      'Fire',
      [{ name: 'Tolerance' }],
      undefined,
      { baseMultiplier: 0.5 },
    )).toBe('Tolerance')
    expect(getPassiveTypeEffectivenessSource(
      'Ground',
      [{ name: 'Levitate' }, { name: 'Tolerance' }],
      undefined,
      { baseMultiplier: 1 },
    )).toBe('Levitate, Tolerance')
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
    expect(computeSheetAbilityAwareMultiplier('Water', ['Fire'], [{ name: 'Mud Dweller' }])).toBe(1)
  })

  it('keeps airborne capability immunity limited to Groundsource moves', () => {
    expect(applySheetPassiveTypeEffectiveness('Ground', 1, undefined, { sky: 5 })).toBe(1)
    expect(applySheetPassiveTypeEffectiveness('Ground', 0.5, [{ name: 'Levitate' }], { levitate: 4 })).toBe(0.25)
    expect(computeSheetAbilityAwareMultiplier('Ground', ['Fire'], undefined, { sky: 8 })).toBe(1.5)
    expect(computeSheetAbilityAwareMultiplier('Electric', ['Water'], undefined, { sky: 8 }, { moveKeywords: ['Groundsource'] })).toBe(0)
    expect(getPassiveGroundResistanceSource(undefined)).toBeNull()
    expect(getPassiveGroundResistanceSource([{ name: 'Levitate' }])).toBe('Levitate')
    expect(getPassiveGroundResistanceSource([{ name: 'Mud Dweller' }])).toBe('Mud Dweller')
    expect(getPassiveGroundResistanceSource([{ name: 'Levitate' }, { name: 'Mud Dweller' }])).toBe('Levitate, Mud Dweller')
    expect(getPassiveTypeEffectivenessSource('Ground', undefined, { sky: 8 }, { moveKeywords: ['Groundsource'] })).toBe('Sky Capability')
  })
})
