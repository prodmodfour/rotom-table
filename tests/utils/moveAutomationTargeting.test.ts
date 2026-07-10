import { describe, expect, it } from 'vitest'
import {
  buildMoveAutomationRangeKeywords,
  determineMoveAutomationTargetCount,
  determineMoveAutomationTargetMode,
  parseMoveAutomationCriticalRange,
} from '~/utils/moveAutomationTargeting'

describe('move automation targeting helpers', () => {
  it('detects target modes from range, name, effect, and damage', () => {
    expect(determineMoveAutomationTargetMode({ name: 'Toxic Spikes', range: 'Status' })).toBe('hazard')
    expect(determineMoveAutomationTargetMode({ name: 'Weather Ball', range: 'Field, Weather' })).toBe('field')
    expect(determineMoveAutomationTargetMode({ name: 'Rest', range: 'Self' })).toBe('self')
    expect(determineMoveAutomationTargetMode({ name: 'Explosion', range: 'Burst 2' })).toBe('multi-target')
    expect(determineMoveAutomationTargetMode({ name: 'Discharge', range: 'All Cardinally Adjacent Targets' })).toBe('multi-target')
    expect(determineMoveAutomationTargetMode({ name: 'Twin Beam', range: '6, 2 Targets' })).toBe('multi-target')
    expect(determineMoveAutomationTargetMode({ name: 'Wide Guard', range: 'Melee, 4 Targets' })).toBe('multi-target')
    expect(determineMoveAutomationTargetMode({ name: 'Dragon Darts', range: '6, 1 Target, Double Strike; or 6, 2 Targets' })).toBe('multi-target')
    expect(determineMoveAutomationTargetMode({ name: 'Tackle', range: 'Melee, 1 Target' })).toBe('one-target')
    expect(determineMoveAutomationTargetMode({ name: 'Mystery Blast', damage_base: 6 })).toBe('one-target')
    expect(determineMoveAutomationTargetMode({ name: 'Taunt', effect: 'The target cannot use Status moves.' })).toBe('one-target')
    expect(determineMoveAutomationTargetMode({ name: 'Splash', range: 'None', effect: 'None' })).toBe('none')
  })

  it('resolves target counts for generated move scripts', () => {
    expect(determineMoveAutomationTargetCount({ range: 'Self' }, 'self')).toBe(1)
    expect(determineMoveAutomationTargetCount({ range: 'Hazard' }, 'hazard')).toBeNull()
    expect(determineMoveAutomationTargetCount({ range: '6, 2 Targets' }, 'multi-target')).toBe(2)
    expect(determineMoveAutomationTargetCount({ range: 'Melee, 3 Targets' }, 'multi-target')).toBe(3)
    expect(determineMoveAutomationTargetCount({ range: '3, 5 Targets' }, 'multi-target')).toBe(5)
    expect(determineMoveAutomationTargetCount({ range: '9, 10 Targets' }, 'multi-target')).toBe(10)
    expect(determineMoveAutomationTargetCount({ range: '6, 1 Target, Double Strike; or 6, 2 Targets' }, 'multi-target')).toBe(2)
    expect(determineMoveAutomationTargetCount({ range: '5, 2-Targets' }, 'multi-target')).toBe(2)
    expect(determineMoveAutomationTargetCount({ range: 'Melee, Double Strike' }, 'one-target')).toBe(1)
    expect(determineMoveAutomationTargetCount({ range: 'Melee, 1 Target' }, 'one-target')).toBe(1)
    expect(determineMoveAutomationTargetCount({ range: 'Burst 1' }, 'multi-target')).toBeNull()
  })

  it('keeps explicit target-count parsing independent from area-template ranges', () => {
    const alternateRange = '6, 1 Target, Double Strike; or 6, 2 Targets'

    expect(determineMoveAutomationTargetMode({ name: 'Dragon Darts', range: alternateRange })).toBe('multi-target')
    expect(determineMoveAutomationTargetCount({ range: alternateRange }, 'multi-target')).toBe(2)
    expect(determineMoveAutomationTargetCount({ range: 'Range 6, 2-Targets' }, 'multi-target')).toBe(2)
    expect(determineMoveAutomationTargetCount({ range: 'Burst 1' }, 'multi-target')).toBeNull()
    expect(buildMoveAutomationRangeKeywords(alternateRange)).toEqual(['Double Strike'])
  })

  it('builds filtered range keywords and parses critical ranges', () => {
    expect(buildMoveAutomationRangeKeywords('6, 1 Target, Priority, Set-Up')).toEqual(['Priority', 'Set-Up'])
    expect(buildMoveAutomationRangeKeywords('6, 2 Targets, Priority')).toEqual(['Priority'])
    expect(buildMoveAutomationRangeKeywords('Range 6, 2-Targets, Priority')).toEqual(['Priority'])
    expect(buildMoveAutomationRangeKeywords('6, 1 Target, Double Strike; or 6, 2 Targets')).toEqual(['Double Strike'])
    expect(buildMoveAutomationRangeKeywords('Melee; Single Target; Double Strike')).toEqual(['Melee', 'Double Strike'])

    expect(parseMoveAutomationCriticalRange('Critical Hit on 18+.')).toBe(18)
    expect(parseMoveAutomationCriticalRange('Critical Hit on a 19+.')).toBe(19)
    expect(parseMoveAutomationCriticalRange('No special critical rule.')).toBeNull()
  })
})
