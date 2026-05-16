import { describe, expect, it } from 'vitest'
import {
  conditionAccuracyModifier,
  conditionAdjustedAccuracy,
  conditionAdjustedCombatStage,
  conditionAdjustedEvasion,
  conditionAdjustedInitiative,
  conditionAdjustedMovement,
  conditionAdjustedMovementCapability,
  conditionBlocksShiftMovement,
  describeSheetConditionEffects,
  evasionSuppressedByCondition,
  movementCapabilityConditionAdjustment,
  speedEvasionSuppressedByCondition,
} from '~/utils/sheetConditionEffects'

describe('sheet condition effects', () => {
  it('applies condition combat-stage modifiers with clamping', () => {
    expect(conditionAdjustedCombatStage(0, ['Burned'], 'def')).toBe(-2)
    expect(conditionAdjustedCombatStage(-5, ['Burned'], 'def')).toBe(-6)
    expect(conditionAdjustedCombatStage(1, ['Poisoned'], 'sdef')).toBe(-1)
    expect(conditionAdjustedCombatStage(1, ['Badly Poisoned'], 'sdef')).toBe(-1)
    expect(conditionAdjustedCombatStage(2, ['Burned'], 'atk')).toBe(2)
  })

  it('applies evasion suppression and condition stages', () => {
    expect(conditionAdjustedEvasion({
      statTotal: 30,
      combatStage: 0,
      bonus: 1,
      conditions: ['Burned'],
      statStageKey: 'def',
      kind: 'physical',
    })).toMatchObject({
      total: 5,
      base: 4,
      conditionStageModifier: -2,
      effectiveStage: -2,
      effectiveStat: 24,
      suppressedByCondition: null,
    })

    expect(conditionAdjustedEvasion({
      statTotal: 30,
      combatStage: 0,
      bonus: 1,
      conditions: ['Burned'],
      statStageKey: 'def',
      kind: 'physical',
      applyCombatStages: false,
    })).toMatchObject({
      total: 7,
      base: 6,
      conditionStageModifier: -2,
      effectiveStage: -2,
      effectiveStat: 30,
      suppressedByCondition: null,
    })

    expect(conditionAdjustedEvasion({
      statTotal: 30,
      combatStage: 0,
      bonus: 2,
      conditions: ['Sleep'],
      statStageKey: 'spd',
      kind: 'speed',
    })).toMatchObject({ total: 0, suppressedByCondition: 'Sleep' })

    expect(conditionAdjustedEvasion({
      statTotal: 30,
      combatStage: 0,
      bonus: 2,
      conditions: ['Bad SLeep'],
      statStageKey: 'spd',
      kind: 'speed',
    })).toMatchObject({ total: 0, suppressedByCondition: 'Bad Sleep' })

    expect(conditionAdjustedEvasion({
      statTotal: 30,
      combatStage: 0,
      bonus: 2,
      conditions: ['Stuck'],
      statStageKey: 'spd',
      kind: 'speed',
    })).toMatchObject({ total: 0, suppressedByCondition: 'Stuck' })
  })

  it('resolves initiative, movement, and accuracy modifiers from conditions', () => {
    expect(conditionAdjustedInitiative(31, ['Paralysis'])).toBe(15)
    expect(conditionAdjustedInitiative(31, ['Paralysis', 'Flinch'])).toBe(10)
    expect(conditionAdjustedInitiative(31, ['Flinch', 'Flinched'])).toBe(21)
    expect(conditionAdjustedMovement(7, ['Slowed'])).toBe(3)
    expect(conditionAdjustedMovement(1, ['Slowed'])).toBe(1)
    expect(conditionAdjustedMovement(0, ['Slowed'])).toBe(0)
    expect(conditionAdjustedMovement(7, ['Stuck'])).toBe(0)
    expect(conditionAdjustedMovement(7, ['Tripped'])).toBe(0)
    expect(conditionAdjustedMovement(7, ['Stuck', 'Slowed'])).toBe(0)
    expect(conditionAdjustedMovement(7, [])).toBe(7)
    expect(conditionBlocksShiftMovement(['Stuck'])).toBe(true)
    expect(conditionBlocksShiftMovement(['Tripped'])).toBe(true)
    expect(conditionAdjustedMovementCapability('Levitate', 4, ['Slow Condition'])).toBe(2)
    expect(conditionAdjustedMovementCapability('teleporter', 5, ['Slowed'])).toBe(2)
    expect(conditionAdjustedMovementCapability('Overland', 5, ['Stuck'])).toBe(0)
    expect(conditionAdjustedMovementCapability('Overland', 5, ['Tripped'])).toBe(0)
    expect(conditionAdjustedMovementCapability('Overland', '5', [])).toBe('5')
    expect(conditionAdjustedMovementCapability('Power', 8, ['Slowed'])).toBe(8)
    expect(movementCapabilityConditionAdjustment('Overland', 5, ['Stuck'])).toMatchObject({
      condition: 'Stuck',
      adjustedValue: 0,
      displayValue: 'no Shift movement',
    })
    expect(movementCapabilityConditionAdjustment('Overland', 5, ['Tripped'])).toMatchObject({
      condition: 'Tripped',
      adjustedValue: 0,
      displayValue: 'stand first',
    })
    expect(conditionAccuracyModifier(['Blindness'])).toBe(-6)
    expect(conditionAccuracyModifier(['Blindness', 'Total Blindness'])).toBe(-10)
    expect(conditionAdjustedAccuracy(2, ['Total Blindness'])).toBe(-8)
  })

  it('identifies evasion-suppressing conditions and describes sheet effects', () => {
    expect(evasionSuppressedByCondition(['Tripped'])).toBe('Tripped')
    expect(evasionSuppressedByCondition(['Bad SLeep'])).toBe('Bad Sleep')
    expect(speedEvasionSuppressedByCondition(['Stuck'])).toBe('Stuck')

    const effects = describeSheetConditionEffects(['Burned', 'Bad Sleep', 'Flinch', 'Flinch', 'Disabled: Thunder Wave'], { tickValue: 7 })
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Burned', description: expect.stringContaining('Defense Combat Stage -2') }),
      expect.objectContaining({ label: 'Bad Sleep', description: expect.stringMatching(/Applies no Evasion.*14 HP/) }),
      expect.objectContaining({ label: 'Flinch ×2', description: expect.stringContaining('lowered by 10') }),
      expect.objectContaining({ label: 'Disabled: Thunder Wave', description: expect.stringContaining('Thunder Wave cannot be used') }),
    ]))
  })
})
