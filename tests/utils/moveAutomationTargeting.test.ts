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
    expect(determineMoveAutomationTargetMode({ name: 'Tackle', range: 'Melee, 1 Target' })).toBe('one-target')
    expect(determineMoveAutomationTargetMode({ name: 'Mystery Blast', damage_base: 6 })).toBe('one-target')
    expect(determineMoveAutomationTargetMode({ name: 'Taunt', effect: 'The target cannot use Status moves.' })).toBe('one-target')
    expect(determineMoveAutomationTargetMode({ name: 'Splash', range: 'None', effect: 'None' })).toBe('none')
  })

  it('resolves target counts compatibly with manual fallback scripts', () => {
    expect(determineMoveAutomationTargetCount({ range: 'Self' }, 'self')).toBe(1)
    expect(determineMoveAutomationTargetCount({ range: 'Hazard' }, 'hazard')).toBeNull()
    expect(determineMoveAutomationTargetCount({ range: '6, 3 Targets' }, 'multi-target')).toBe(3)
    expect(determineMoveAutomationTargetCount({ range: 'Melee, Double Strike' }, 'one-target')).toBe(1)
    expect(determineMoveAutomationTargetCount({ range: 'Melee, 1 Target' }, 'one-target')).toBe(1)
    expect(determineMoveAutomationTargetCount({ range: 'Burst 1' }, 'multi-target')).toBeNull()
  })

  it('builds filtered range keywords and parses critical ranges', () => {
    expect(buildMoveAutomationRangeKeywords('6, 1 Target, Priority, Set-Up')).toEqual(['Priority', 'Set-Up'])
    expect(buildMoveAutomationRangeKeywords('Melee; Single Target; Double Strike')).toEqual(['Melee', 'Double Strike'])

    expect(parseMoveAutomationCriticalRange('Critical Hit on 18+.')).toBe(18)
    expect(parseMoveAutomationCriticalRange('Critical Hit on a 19+.')).toBe(19)
    expect(parseMoveAutomationCriticalRange('No special critical rule.')).toBeNull()
  })
})
