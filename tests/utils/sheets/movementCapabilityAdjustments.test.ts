import { describe, expect, it } from 'vitest'
import {
  formatSheetMovementCapabilityValue,
  resolveSheetMovementCapabilityAdjustments,
} from '~/utils/sheets/movementCapabilityAdjustments'

describe('sheet movement capability adjustments', () => {
  it('applies Agility Training to the condition-adjusted final movement value', () => {
    const adjustments = resolveSheetMovementCapabilityAdjustments(
      'Overland',
      6,
      ['Slowed'],
      'Agility Training',
    )

    expect(adjustments.conditionAdjustment).toMatchObject({
      condition: 'Slowed',
      adjustedValue: 4,
      displayValue: '4',
    })
    expect(adjustments.trainingAdjustment).toMatchObject({
      featureName: 'Agility Training',
      movementCapabilityBonus: 1,
      adjustedValue: 4,
      displayValue: '+1',
    })
  })

  it('formats the displayed movement value with Agility Training applied', () => {
    expect(formatSheetMovementCapabilityValue('Sky', 6, [], 'Agile')).toBe('7')
    expect(resolveSheetMovementCapabilityAdjustments(
      'Sky',
      6,
      [],
      'Agile',
    ).trainingAdjustment).toMatchObject({
      featureName: 'Agility Training',
      adjustedValue: 7,
      displayValue: '+1',
    })
  })

  it('formats the displayed movement value with conditions and training applied', () => {
    expect(formatSheetMovementCapabilityValue('Overland', 6, ['Slowed'], 'Agility Training')).toBe('4')
    expect(formatSheetMovementCapabilityValue('Overland', 6, ['Stuck'], 'Agility Training')).toBe('0')
  })

  it('does not apply Agility Training when movement is blocked', () => {
    const adjustments = resolveSheetMovementCapabilityAdjustments(
      'Swim',
      6,
      ['Stuck'],
      'Agility Training',
    )

    expect(adjustments.conditionAdjustment).toMatchObject({
      condition: 'Stuck',
      adjustedValue: 0,
      displayValue: 'no Shift movement',
    })
    expect(adjustments.trainingAdjustment).toBeNull()
  })
})
